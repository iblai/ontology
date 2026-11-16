import { parse } from "yaml";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiDocs,
  checkApi,
  endpointsFromSpec,
  listApis,
  saveApi,
  askForSpec,
  specHeader,
  type SpecMiss,
  TOOL_NAME_MAX,
} from "./apis";
import { readText, setEnv, writeAtomic } from "./files";
import { validateDocs, writingToolsets } from "./toolbox-config";
import type { HostApiEndpoint, HostApiInput } from "./types";

vi.mock("./address", () => ({
  apiAddress: vi.fn<typeof import("./address").apiAddress>(async (base: string) => ({
    address: `${base.trim().replace(/\/+$/, "")}/`,
    private: base.includes("//10."),
    local: base.includes("//127."),
  })),
}));
vi.mock("./semantic", () => ({
  SEMANTIC_TOOLS: [{ name: "ask_question" }, { name: "search_terms" }, { name: "describe_table" }],
}));
vi.mock("./files", async (actual) => ({
  ...(await actual<typeof import("./files")>()),
  homePath: (...parts: string[]) => `/home/${parts.join("/")}`,
  readText: vi.fn<typeof import("./files").readText>(async () => null),
  writeAtomic: vi.fn<typeof import("./files").writeAtomic>(async () => {}),
  setEnv: vi.fn<typeof import("./files").setEnv>(async () => {}),
}));

const endpoint = (extra: Partial<HostApiEndpoint> = {}): HostApiEndpoint => ({
  name: "list_invoices",
  method: "GET",
  path: "/invoices",
  description: "Lists invoices.",
  query: [],
  ...extra,
});

const input = (extra: Partial<HostApiInput> = {}): HostApiInput => ({
  name: "acme",
  baseUrl: "https://api.acme.example/v1",
  authHeader: "Authorization: Bearer sk_live_123",
  endpoints: [
    endpoint({ query: ["status"] }),
    endpoint({
      name: "add_note",
      method: "POST",
      path: "/invoices/{invoice_id}/notes",
      description: "Adds a note.",
    }),
  ],
  ...extra,
});

beforeEach(() => {
  vi.mocked(readText).mockResolvedValue(null);
  vi.mocked(setEnv).mockClear();
  vi.mocked(writeAtomic).mockClear();
});

describe("the auth header", () => {
  it("moves the secret to the env and keeps a reference", async () => {
    const { api, secret } = await checkApi(input());
    expect(secret).toBe("sk_live_123");
    expect(api.secretEnv).toBe("ACME_API_KEY");
    expect(api.authHeader).toBe("Authorization: Bearer ${ACME_API_KEY}");
    expect(JSON.stringify(api)).not.toContain("sk_live_123");
  });

  it("takes a header with no scheme", async () => {
    const { api, secret } = await checkApi(input({ authHeader: "X-Api-Key: abc123" }));
    expect(api.authHeader).toBe("X-Api-Key: ${ACME_API_KEY}");
    expect(secret).toBe("abc123");
  });

  it("keeps a reference as written and stores nothing", async () => {
    const { api, secret } = await checkApi(input({ authHeader: "Authorization: Token ${MY_KEY}" }));
    expect(api.authHeader).toBe("Authorization: Token ${MY_KEY}");
    expect(api.secretEnv).toBe("MY_KEY");
    expect(secret).toBeNull();
  });

  it("allows no header at all", async () => {
    const { api, secret } = await checkApi(input({ authHeader: "  " }));
    expect(api.authHeader).toBe("");
    expect(api.secretEnv).toBeNull();
    expect(secret).toBeNull();
  });

  it.each([
    ["Bearer abc123", "Authorization: Bearer ${ACME_API_KEY}", "abc123"],
    ["abc123", "Authorization: ${ACME_API_KEY}", "abc123"],
    ["${MY_KEY}", "Authorization: ${MY_KEY}", null],
  ])("takes %s alone as the value of Authorization", async (authHeader, stored, kept) => {
    const { api, secret } = await checkApi(input({ authHeader }));
    expect(api.authHeader).toBe(stored);
    expect(secret).toBe(kept);
  });

  it.each([
    ["Bearer abc:def", /not a header a key goes in/],
    ["Host: abc", /not a header a key goes in/],
    ["Content-Type: abc", /not a header a key goes in/],
    ["Authorization:", /has no key/],
    ["Authorization: Bearer ${lower}", /as itself or as \$\{NAME\}/],
    ['Authorization: Bearer a"b', /a quote or a backslash/],
  ])("refuses %s", async (authHeader, why) => {
    await expect(checkApi(input({ authHeader }))).rejects.toThrow(why);
  });
});

describe("endpoint rules", () => {
  const check = (extra: Partial<HostApiEndpoint>) =>
    checkApi(input({ endpoints: [endpoint(extra)] }));

  it("keeps an endpoint as entered, tidied", async () => {
    const { api } = await check({
      method: "get" as HostApiEndpoint["method"],
      description: "  Lists\n invoices. ",
      query: [" status ", ""],
    });
    expect(api.endpoints).toEqual([endpoint({ query: ["status"] })]);
    expect(api.tools).toBe(1);
  });

  it("says the request line when there is no description", async () => {
    const { api } = await check({ path: "/invoices/{id}", description: " " });
    expect(api.endpoints[0].description).toBe("GET /invoices/{id}");
  });

  it.each([
    [{ name: "List" }, /endpoint’s name/],
    [{ name: "1st" }, /endpoint’s name/],
    [{ name: "a".repeat(TOOL_NAME_MAX + 1) }, /endpoint’s name/],
    [{ name: "ask_question" }, /exists already/],
    [{ method: "HEAD" as HostApiEndpoint["method"] }, /method is one of/],
    [{ description: "Costs ${amount}" }, /without '\$\{'/],
    [{ path: "invoices" }, /A path starts with \//],
    [{ path: "/" }, /A path starts with \//],
    [{ path: "/a/../b" }, /A path starts with \//],
    [{ path: "/a?b=1" }, /A path starts with \//],
    [{ path: "/invoices/{id}", query: ["ID"] }, /repeats no name/],
    [{ method: "POST" as const, query: ["body"] }, /repeats no name/],
    [{ query: ["1x"] }, /A query name/],
  ])("refuses %o", async (extra, why) => {
    await expect(check(extra)).rejects.toThrow(why);
  });

  it("refuses two endpoints of one name", async () => {
    const endpoints = [endpoint(), endpoint({ path: "/bills" })];
    await expect(checkApi(input({ endpoints }))).rejects.toThrow(/Two endpoints/);
  });
});

describe("the documents", () => {
  it("splits reads from writes, on two sources and two toolsets", async () => {
    const { api } = await checkApi(input());
    const docs = apiDocs(api);
    expect(() => validateDocs(docs)).not.toThrow();
    expect(writingToolsets(docs)).toEqual(["acme-writes"]);
    const byName = Object.fromEntries(docs.map((doc) => [`${doc.kind}/${doc.name}`, doc]));
    expect(Object.keys(byName)).toEqual([
      "source/acme-reads",
      "source/acme-writes",
      "tool/list_invoices",
      "tool/add_note",
      "toolset/acme-reads",
      "toolset/acme-writes",
    ]);
    expect(byName["source/acme-reads"]).toEqual({
      kind: "source",
      name: "acme-reads",
      type: "http",
      baseUrl: "https://api.acme.example/v1/",
      timeout: "20s",
      returnFullError: true,
      headers: { Authorization: "Bearer ${ACME_API_KEY}" },
    });
    expect(byName["tool/list_invoices"]).toMatchObject({
      source: "acme-reads",
      method: "GET",
      path: "invoices",
      queryParams: [{ name: "status", type: "string", description: "status", required: false }],
    });
    expect(byName["tool/add_note"]).toEqual({
      kind: "tool",
      name: "add_note",
      type: "http",
      source: "acme-writes",
      description: "Adds a note.",
      method: "POST",
      path: "invoices/{{pathEscape .invoice_id}}/notes",
      pathParams: [{ name: "invoice_id", type: "string", description: "invoice id" }],
      headers: { "Content-Type": "application/json" },
      bodyParams: [
        { name: "body", type: "map", description: "The JSON body to send, as one object." },
      ],
      requestBody: "{{json .body}}",
    });
    expect(byName["toolset/acme-writes"]).toEqual({
      kind: "toolset",
      name: "acme-writes",
      tools: ["add_note"],
    });
  });

  it("leaves out a side with no tools, and lets a private address through", async () => {
    const { api } = await checkApi(
      input({ baseUrl: "http://10.0.0.5/api", authHeader: "", endpoints: [endpoint()] }),
    );
    const docs = apiDocs(api);
    expect(docs.map((doc) => `${doc.kind}/${doc.name}`)).toEqual([
      "source/acme-reads",
      "tool/list_invoices",
      "toolset/acme-reads",
    ]);
    expect(docs[0].headers).toBeUndefined();
    expect(docs[0].allowedIpRanges).toEqual([
      "10.0.0.0/8",
      "172.16.0.0/12",
      "192.168.0.0/16",
      "fc00::/7",
    ]);
  });

  it("lets an API on this machine reach loopback, and only that", async () => {
    const { api } = await checkApi(
      input({ baseUrl: "http://127.0.0.1:3030/rest", authHeader: "", endpoints: [endpoint()] }),
    );
    expect(api.local).toBe(true);
    expect(apiDocs(api)[0].allowedIpRanges).toEqual(["127.0.0.0/8", "::1/128"]);
  });

  it("gives no ranges to a public API", async () => {
    const { api } = await checkApi(input());
    expect(apiDocs(api)[0].allowedIpRanges).toBeUndefined();
  });
});

describe("the document's header", () => {
  const base = "http://localhost:3030/rest";
  const doc = "http://localhost:3030/rest/open-api/core";
  const env = { TWENTY_KEY: "tw_secret" };

  it("sends a literal header to the API's own origin", () => {
    expect(specHeader(doc, base, "Authorization: Bearer tw_literal", env)).toEqual({
      headers: { Authorization: "Bearer tw_literal" },
      withheld: false,
    });
  });

  it("reads a ${NAME} from the platform's env", () => {
    expect(specHeader(doc, base, "Authorization: Bearer ${TWENTY_KEY}", env).headers).toEqual({
      Authorization: "Bearer tw_secret",
    });
    expect(specHeader(doc, base, "X-Api-Key: ${TWENTY_KEY}", env).headers).toEqual({
      "X-Api-Key": "tw_secret",
    });
  });

  it.each(["Authorization: Bearer tw_literal", "Authorization: Bearer ${TWENTY_KEY}"])(
    "withholds %s from another origin",
    (header) => {
      for (const other of [
        "http://localhost:3031/rest/open-api/core",
        "https://localhost:3030/rest/open-api/core",
        "http://evil.example/rest/open-api/core",
      ]) {
        expect(specHeader(other, base, header, env)).toEqual({ headers: {}, withheld: true });
      }
      expect(specHeader(doc, "", header, env)).toEqual({ headers: {}, withheld: true });
    },
  );

  it("sends nothing without a header", () => {
    expect(specHeader(doc, base, " ", env)).toEqual({ headers: {}, withheld: false });
  });

  it("names a ${NAME} the env lacks, and refuses what the save refuses", () => {
    expect(() => specHeader(doc, base, "Authorization: Bearer ${MISSING_KEY}", env)).toThrow(
      /MISSING_KEY is not in this platform’s secrets/,
    );
    expect(() => specHeader(doc, base, "Host: abc", env)).toThrow(/not a header a key goes in/);
  });

  it("sends a value alone as Authorization", () => {
    expect(specHeader(doc, base, "Bearer abc", env).headers).toEqual({
      Authorization: "Bearer abc",
    });
    expect(specHeader(doc, base, "abc", env).headers).toEqual({ Authorization: "abc" });
  });
});

describe("asking for the document", () => {
  const header = { Authorization: "Bearer k" };
  const pause = async () => {};
  const asker = () => vi.fn<(sent: Record<string, string>) => Promise<Response | SpecMiss>>();

  it("sends the header three times, then asks once without it", async () => {
    const get = asker()
      .mockResolvedValueOnce({ status: 401 })
      .mockResolvedValueOnce({ reason: "reset" })
      .mockResolvedValueOnce({ status: 503 })
      .mockResolvedValueOnce(new Response("{}"));
    const { got, withAuth } = await askForSpec(get, header, pause);
    expect(got).toBeInstanceOf(Response);
    expect(withAuth).toEqual({ status: 503 });
    expect(get.mock.calls.map(([sent]) => sent)).toEqual([header, header, header, {}]);
  });

  it("stops at the first answer, and asks once when there is no header", async () => {
    const get = asker()
      .mockResolvedValueOnce({ status: 500 })
      .mockResolvedValue(new Response("{}"));
    expect((await askForSpec(get, header, pause)).withAuth).toBeNull();
    expect(get).toHaveBeenCalledTimes(2);
    get.mockClear();
    await askForSpec(get, {}, pause);
    expect(get.mock.calls).toEqual([[{}]]);
  });

  it("answers with both failures when neither request gets the document", async () => {
    const get = asker().mockResolvedValue({ status: 401 });
    expect(await askForSpec(get, header, pause)).toEqual({
      got: { status: 401 },
      withAuth: { status: 401 },
    });
    expect(get).toHaveBeenCalledTimes(4);
  });
});

describe("apis.yaml", () => {
  it("stores the secret in the env and the API without it", async () => {
    const shown = await saveApi(input());
    expect(setEnv).toHaveBeenCalledWith("ACME_API_KEY", "sk_live_123");
    const [file, text] = vi.mocked(writeAtomic).mock.calls[0];
    expect(file).toBe("/home/apis.yaml");
    expect(text).not.toContain("sk_live_123");
    expect(parse(text)[0]).toMatchObject({
      name: "acme",
      secretEnv: "ACME_API_KEY",
      private: false,
    });
    expect(shown).toEqual({
      name: "acme",
      baseUrl: "https://api.acme.example/v1/",
      authHeader: "Authorization: Bearer ${ACME_API_KEY}",
      endpoints: input().endpoints,
      tools: 2,
    });
  });

  it("replaces an API of the same name and refuses another API's tool name", async () => {
    const { api: old } = await checkApi(input({ endpoints: [] }));
    const { api: other } = await checkApi(input({ name: "other", endpoints: [endpoint()] }));
    vi.mocked(readText).mockResolvedValue(JSON.stringify([old, other]));
    expect(await listApis()).toEqual([old, other]);
    await expect(saveApi(input())).rejects.toThrow(/list_invoices exists already/);
    await saveApi(input({ endpoints: [endpoint({ name: "get_invoices" })] }));
    const saved = parse(vi.mocked(writeAtomic).mock.calls[0][1]);
    expect(saved.map((api: { name: string }) => api.name)).toEqual(["acme", "other"]);
  });

  it("reads no file as no APIs", async () => {
    expect(await listApis()).toEqual([]);
  });
});

describe("OpenAPI", () => {
  const spec = {
    openapi: "3.0.3",
    info: { title: "Acme" },
    components: { parameters: { Page: { name: "page", in: "query" } } },
    paths: {
      "/v3/objects/{id}": {
        parameters: [{ $ref: "#/components/parameters/Page" }],
        get: { operationId: "getObjectById", summary: "One object." },
        delete: { description: "Removes\n an object.", parameters: [{ name: "id", in: "path" }] },
        head: { operationId: "headObject" },
        options: {},
      },
      "/v3/objects": {
        post: { operationId: "createObject", parameters: [{ name: "dry", in: "query" }] },
      },
    },
  };

  it("lists the operations it takes", () => {
    expect(endpointsFromSpec(spec)).toEqual({
      title: "Acme",
      endpoints: [
        {
          name: "get_object_by_id",
          method: "GET",
          path: "/v3/objects/{id}",
          description: "One object.",
          query: ["page"],
        },
        {
          name: "delete_v3_objects_id",
          method: "DELETE",
          path: "/v3/objects/{id}",
          description: "Removes an object.",
          query: ["page"],
        },
        {
          name: "create_object",
          method: "POST",
          path: "/v3/objects",
          description: "POST /v3/objects",
          query: ["dry"],
        },
      ],
    });
  });

  it("takes Swagger 2, keeps names short and distinct", () => {
    const long = "x".repeat(80);
    const { endpoints } = endpointsFromSpec({
      swagger: "2.0",
      paths: {
        "/a": { get: { operationId: long }, put: { operationId: long } },
        "/9": { get: {} },
      },
    });
    expect(endpoints.map((e) => e.name)).toEqual([
      "x".repeat(TOOL_NAME_MAX),
      `${"x".repeat(TOOL_NAME_MAX - 2)}_2`,
      "get_9",
    ]);
  });

  it("refuses what is not such a document", () => {
    expect(() => endpointsFromSpec({ openapi: "3.1.0" })).toThrow(/not an OpenAPI 3/);
    expect(() => endpointsFromSpec({ paths: {} })).toThrow(/not an OpenAPI 3/);
    expect(() => endpointsFromSpec("openapi: 3.0.0")).toThrow(/not an OpenAPI 3/);
  });
});

describe("what a parameter means", () => {
  const spec = {
    openapi: "3.1.1",
    paths: {
      "/people/{id}": {
        get: {
          operationId: "findOnePerson",
          parameters: [
            { name: "id", in: "path", description: "Object id." },
            {
              name: "depth",
              in: "query",
              description: "Nested objects:\n - 0: none\n - 1: direct",
            },
            {
              name: "filter",
              in: "query",
              description: `Format ${"$"}{field}: ${"x".repeat(400)}`,
            },
            { name: "limit", in: "query" },
            { name: "X-Trace", in: "header", description: "not a parameter of ours" },
          ],
        },
      },
    },
  };

  it("keeps each description from the document, as one bounded line", () => {
    const [found] = endpointsFromSpec(spec).endpoints;
    expect(found.query).toEqual(["depth", "filter", "limit"]);
    expect(Object.keys(found.notes ?? {})).toEqual(["id", "depth", "filter"]);
    expect(found.notes?.depth).toBe("Nested objects: - 0: none - 1: direct");
    expect(found.notes?.filter).toHaveLength(300);
    expect(found.notes?.filter).not.toContain("${");
  });

  it("puts it on the tool's parameters, and the name where there is none", async () => {
    const [found] = endpointsFromSpec(spec).endpoints;
    const { api } = await checkApi(input({ endpoints: [found] }));
    const docs = apiDocs(api);
    expect(() => validateDocs(docs)).not.toThrow();
    const tool = docs.find((doc) => doc.kind === "tool") as unknown as {
      pathParams: { name: string; description: string }[];
      queryParams: { name: string; description: string }[];
    };
    expect(tool.pathParams).toEqual([{ name: "id", type: "string", description: "Object id." }]);
    expect(tool.queryParams.map((p) => [p.name, p.description.slice(0, 16)])).toEqual([
      ["depth", "Nested objects: "],
      ["filter", "Format $ {field}"],
      ["limit", "limit"],
    ]);
  });

  it("drops a note for a parameter the endpoint does not have", async () => {
    const { api } = await checkApi(
      input({
        endpoints: [endpoint({ query: ["status"], notes: { status: "open or paid", x: "?" } })],
      }),
    );
    expect(api.endpoints[0].notes).toEqual({ status: "open or paid" });
  });
});
