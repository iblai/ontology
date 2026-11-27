import { parse, stringify } from "yaml";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiDocs,
  checkApi,
  dollarQueries,
  endpointsFromSpec,
  listApis,
  saveApi,
  askForSpec,
  signedTools,
  specHeader,
  specToken,
  type SpecMiss,
  TOOL_NAME_MAX,
} from "./apis";
import { apiAddress } from "./address";
import { HostError } from "./errors";
import { readEnv, readText, setEnv, writeAtomic } from "./files";
import { forget, requestToken } from "./oauth";
import { pathFits } from "./openapi";
import { validateDocs, writingToolsets } from "./toolbox-config";
import type { HostApiEndpoint, HostApiInput, HostApiOAuthInput } from "./types";

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
vi.mock("./oauth", async (actual) => ({
  ...(await actual<typeof import("./oauth")>()),
  requestToken: vi.fn<typeof import("./oauth").requestToken>(),
  forget: vi.fn<typeof import("./oauth").forget>(),
}));
vi.mock("./files", async (actual) => ({
  ...(await actual<typeof import("./files")>()),
  homePath: (...parts: string[]) => `/home/${parts.join("/")}`,
  readEnv: vi.fn<typeof import("./files").readEnv>(async () => ({})),
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
    [{ path: "/invoices/{id}", query: ["ID"] }, /list_invoices has two parameters .* alike/],
    [{ method: "POST" as const, query: ["body"] }, /alike/],
    [{ query: ["1x"] }, /A query name of list_invoices/],
    [{ query: ["$1x"] }, /A query name/],
    [{ query: ["top", "$top"] }, /alike/],
    [{ path: "/invoices/{id}", query: ["$id"] }, /alike/],
    [{ path: "/a/{id}/b/{ID}" }, /alike/],
    [{ method: "POST" as const, path: "/a/{body}" }, /alike/],
    [{ path: `/a/{${"x".repeat(65)}}` }, /A path starts with \//],
  ])("refuses %o", async (extra, why) => {
    await expect(check(extra)).rejects.toThrow(why);
  });

  it("keeps a query name that starts with $, as Graph writes it", async () => {
    const { api } = await check({ query: ["$filter", "$top"] });
    expect(api.endpoints[0].query).toEqual(["$filter", "$top"]);
  });

  it("describes a parameter named like an object's own property by its name", async () => {
    const { api } = await check({ query: ["constructor", "page"], notes: { page: "Which page." } });
    const docs = apiDocs(api);
    expect(() => validateDocs(docs)).not.toThrow();
    const tool = docs.find((doc) => doc.kind === "tool") as unknown as { queryParams: object[] };
    expect(tool.queryParams).toMatchObject([
      { name: "constructor", description: "constructor" },
      { name: "page", description: "Which page." },
    ]);
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
    expect(() => endpointsFromSpec({})).toThrow(HostError);
  });

  // What Canvas, Zendesk and Microsoft Graph publish, which a save used to refuse.
  const vendor = {
    openapi: "3.0.0",
    paths: {
      "/users/{user-id}/messages": {
        get: {
          operationId: "listMessages",
          summary: "Lists ${count} messages.",
          parameters: [
            { name: "user-id", in: "path", description: "The user." },
            { name: "include[]", in: "query" },
            { name: "page[size]", in: "query" },
            { name: "per_page", in: "query" },
            { name: "Per_Page", in: "query" },
            { name: "user_id", in: "query" },
            { name: "per_page", in: "query" },
          ],
        },
      },
      "/users/$count": { get: { operationId: "countUsers" } },
      "/users(userPrincipalName='{name}')": { get: {}, patch: {} },
    },
  };

  it("leaves out what a tool cannot carry, counted, and names a value as a parameter", () => {
    expect(endpointsFromSpec(vendor)).toEqual({
      title: "",
      endpoints: [
        {
          name: "list_messages",
          method: "GET",
          path: "/users/{user_id}/messages",
          description: "Lists $ {count} messages.",
          query: ["per_page"],
          notes: { user_id: "The user." },
        },
      ],
      left: { operations: 3, parameters: 4 },
    });
  });

  it("lists nothing a save would refuse", async () => {
    const { endpoints } = endpointsFromSpec(vendor);
    await expect(checkApi(input({ endpoints }))).resolves.toBeTruthy();
  });

  it("leaves out what a save would refuse for its parameters, counted", () => {
    const { endpoints, left } = endpointsFromSpec({
      openapi: "3.0.0",
      paths: {
        "/a/{body}": { post: {}, get: {} }, // body is a write's own parameter
        "/b/{id}/c/{ID}": { get: {} },
        [`/c/{${"x".repeat(65)}}`]: { get: {} },
      },
    });
    expect(endpoints.map((ep) => `${ep.method} ${ep.path}`)).toEqual(["GET /a/{body}"]);
    expect(left).toEqual({ operations: 3, parameters: 0 });
  });

  it("reads at most 100 parameters of an operation, the rest counted", () => {
    const parameters = Array.from({ length: 150 }, (_, i) => ({ name: `p${i}`, in: "query" }));
    const { endpoints, left } = endpointsFromSpec({
      openapi: "3.0.0",
      paths: { "/a": { get: { parameters } } },
    });
    expect(endpoints[0].query).toHaveLength(100);
    expect(left).toEqual({ operations: 0, parameters: 50 });
  });

  it("takes an operation's own description of a parameter over its path's", () => {
    const shared = [{ name: "page", in: "query", description: "Shared." }];
    const own = [{ name: "page", in: "query", description: "Its own." }];
    const [found] = endpointsFromSpec({
      openapi: "3.0.0",
      paths: { "/a": { parameters: shared, get: { parameters: own } } },
    }).endpoints;
    expect(found.query).toEqual(["page"]);
    expect(found.notes).toEqual({ page: "Its own." });
  });

  it("reads a document that would cost the host, quickly and only so far", () => {
    const path = `/a${"/".repeat(1_000_000)}b`; // a quadratic trim would take minutes
    const value = `/x/{a${"_".repeat(1_000_000)}b}`;
    const long = endpointsFromSpec({
      openapi: "3.0.0",
      paths: { [path]: { get: {} }, [value]: { get: {} } },
    });
    expect(long).toEqual({ title: "", endpoints: [], left: { operations: 2, parameters: 0 } });
    const many = Object.fromEntries(
      Array.from({ length: 6000 }, (_, i) => [`/p${i}`, { get: { operationId: "same" } }]),
    );
    const capped = endpointsFromSpec({ openapi: "3.0.0", paths: many });
    expect(capped.endpoints).toHaveLength(5000);
    expect(capped.endpoints.at(-1)?.name).toBe("same_5000");
    expect(capped.left).toEqual({ operations: 1000, parameters: 0 });
  });

  it("keeps Graph's $ names, and the first of two an agent would see alike", () => {
    const { endpoints, left } = endpointsFromSpec({
      openapi: "3.0.4",
      paths: {
        "/users": {
          get: {
            operationId: "listUsers",
            parameters: ["$filter", "$top", "filter", "$1"].map((name) => ({ name, in: "query" })),
          },
        },
      },
    });
    expect(endpoints[0].query).toEqual(["$filter", "$top"]);
    expect(left).toEqual({ operations: 0, parameters: 2 });
  });

  it.each([
    ["/v4/spreadsheets/{id}/values/{range}:append", true],
    ["/tasks/v1/users/@me/lists", true],
    ["/v1:validateAddress", false],
    ["/a//b", false],
    ["/a/../b", false],
    ["/users/$count", false],
    ["/users(id='{id}')", false],
  ])("takes %s as a path a tool can call: %s", (path, fits) => {
    expect(pathFits(path)).toBe(fits);
  });
});

describe("a Google Discovery document", () => {
  const discovery = {
    kind: "discovery#restDescription",
    title: "Sheets",
    rootUrl: "https://sheets.example/",
    servicePath: "",
    methods: {
      ping: { id: "sheets.ping", httpMethod: "GET", path: "v4/ping", description: "Answers." },
    },
    resources: {
      spreadsheets: {
        methods: {
          get: {
            id: "sheets.spreadsheets.get",
            httpMethod: "GET",
            path: "v4/spreadsheets/{spreadsheetId}",
            flatPath: "v4/spreadsheets/{spreadsheetId}",
            description: "Returns a\n spreadsheet.",
            parameters: {
              spreadsheetId: { location: "path", description: "The spreadsheet." },
              ranges: { location: "query", repeated: true, description: "A1 ranges." },
              "include[]": { location: "query" },
            },
          },
          // The runtime would read the first segment's ':' as a scheme.
          validate: { id: "sheets.validate", httpMethod: "POST", path: "v4:validate" },
        },
        resources: {
          values: {
            methods: {
              append: {
                id: "sheets.spreadsheets.values.append",
                httpMethod: "POST",
                path: "v4/spreadsheets/{spreadsheetId}/values/{range}:append",
                parameters: {
                  spreadsheetId: { location: "path" },
                  range: { location: "path", description: "A1 notation." },
                  valueInputOption: { location: "query" },
                },
              },
            },
          },
        },
      },
      spaces: {
        methods: {
          list: {
            id: "chat.spaces.messages.list",
            httpMethod: "GET",
            path: "v1/{+parent}/messages",
            flatPath: "v1/spaces/{spacesId}/messages",
            parameters: {
              parent: { location: "path", description: "The space." },
              pageSize: { location: "query" },
            },
          },
          // A {+name} value holds slashes, which a value cannot carry.
          patch: { id: "chat.spaces.patch", httpMethod: "PATCH", path: "v1/{+name}" },
          lists: {
            id: "tasks.tasklists.list",
            httpMethod: "GET",
            path: "tasks/v1/users/@me/lists",
          },
        },
      },
    },
  };

  it("lists its methods at any depth, each path under rootUrl and servicePath", () => {
    expect(endpointsFromSpec(discovery)).toEqual({
      title: "Sheets",
      endpoints: [
        {
          name: "sheets_ping",
          method: "GET",
          path: "/v4/ping",
          description: "Answers.",
          query: [],
        },
        {
          name: "sheets_spreadsheets_get",
          method: "GET",
          path: "/v4/spreadsheets/{spreadsheetId}",
          description: "Returns a spreadsheet.",
          query: ["ranges"],
          notes: { spreadsheetId: "The spreadsheet.", ranges: "A1 ranges." },
        },
        {
          name: "sheets_spreadsheets_values_append",
          method: "POST",
          path: "/v4/spreadsheets/{spreadsheetId}/values/{range}:append",
          description: "POST /v4/spreadsheets/{spreadsheetId}/values/{range}:append",
          query: ["valueInputOption"],
          notes: { range: "A1 notation." },
        },
        {
          name: "chat_spaces_messages_list",
          method: "GET",
          path: "/v1/spaces/{spacesId}/messages",
          description: "GET /v1/spaces/{spacesId}/messages",
          query: ["pageSize"],
        },
        {
          name: "tasks_tasklists_list",
          method: "GET",
          path: "/tasks/v1/users/@me/lists",
          description: "GET /tasks/v1/users/@me/lists",
          query: [],
        },
      ],
      left: { operations: 2, parameters: 1 },
    });
  });

  it("lists nothing a save would refuse", async () => {
    const { endpoints } = endpointsFromSpec(discovery);
    const { api } = await checkApi(input({ endpoints }));
    expect(() => validateDocs(apiDocs(api))).not.toThrow();
  });

  it("reads a method once however many names it is under, and only so deep", () => {
    const methods = { list: { id: "x.list", httpMethod: "GET", path: "v1/x" } };
    // As YAML aliases parse: one object under many names.
    const resources = Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [`r${i}`, { methods }]),
    );
    expect(endpointsFromSpec({ ...discovery, methods: {}, resources }).endpoints).toHaveLength(1);
    let deep: Record<string, unknown> = {
      methods: { deep: { id: "d", httpMethod: "GET", path: "v1/d" } },
    };
    for (let i = 0; i < 10_000; i++) deep = { resources: { r: deep } };
    expect(endpointsFromSpec({ kind: discovery.kind, ...deep }).endpoints).toEqual([]);
    const odd = { methods: { a: { httpMethod: { toString: 1 }, path: "v1/a" } } };
    expect(endpointsFromSpec({ kind: discovery.kind, ...odd }).endpoints).toEqual([]);
  });

  it("reads a parameters map once, however many methods name it", () => {
    const parameters = { q: { location: "query" } }; // as a YAML alias parses
    const methods = {
      a: { id: "x.a", httpMethod: "GET", path: "v1/a", parameters },
      b: { id: "x.b", httpMethod: "GET", path: "v1/b", parameters },
    };
    const { endpoints } = endpointsFromSpec({ kind: discovery.kind, methods });
    expect(endpoints.map((ep) => ep.query)).toEqual([["q"], []]);
  });

  it("offers the document's own fields parameter on every method, and no other", () => {
    const parameters = {
      fields: { location: "query", description: "Which fields to include in the answer." },
      key: { location: "query", description: "API key." },
      alt: { location: "query" },
    };
    const { endpoints } = endpointsFromSpec({ ...discovery, parameters });
    expect(endpoints.map((ep) => ep.query.at(-1))).toEqual(Array(endpoints.length).fill("fields"));
    expect(endpoints.flatMap((ep) => ep.query)).not.toContain("key");
    expect(endpoints[0].notes?.fields).toBe("Which fields to include in the answer.");
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

describe("OAuth", () => {
  const oauth = (extra: Partial<HostApiOAuthInput> = {}): HostApiOAuthInput => ({
    grant: "client_credentials",
    tokenUrl: " /oauth2/token ",
    clientId: " console ",
    clientAuth: "basic",
    scope: " roster.readonly   grades ",
    clientSecret: "s3cret-value",
    refreshToken: "",
    ...extra,
  });
  const signedIn = (extra: Partial<HostApiOAuthInput> = {}, more: Partial<HostApiInput> = {}) =>
    input({ authHeader: "", oauth: oauth(extra), ...more });
  const kept = {
    grant: "client_credentials",
    tokenUrl: "/oauth2/token",
    clientId: "console",
    clientAuth: "basic",
    scope: "roster.readonly grades",
  };

  beforeEach(() => {
    vi.mocked(readEnv).mockResolvedValue({});
    vi.mocked(forget).mockClear();
    vi.mocked(requestToken).mockReset();
    vi.mocked(requestToken).mockResolvedValue({ token: "tok", seconds: 3600, refreshToken: null });
  });

  it("is kept without its secrets", async () => {
    const { api, secret, oauth: secrets } = await checkApi(signedIn());
    expect(api.oauth).toEqual(kept);
    expect(api.authHeader).toBe("");
    expect(secret).toBeNull();
    expect(secrets).toEqual({ clientSecret: "s3cret-value", refreshToken: "" });
    expect(JSON.stringify(api)).not.toContain("s3cret-value");
  });

  it("checks the token address as it checks the API’s own", async () => {
    vi.mocked(apiAddress).mockClear();
    await checkApi(signedIn());
    expect(apiAddress).toHaveBeenCalledWith("https://api.acme.example/oauth2/token");
    await checkApi(signedIn({ tokenUrl: "https://login.example/t" }));
    expect(apiAddress).toHaveBeenCalledWith("https://login.example/t");
  });

  it.each([
    [signedIn({}, { authHeader: "Bearer abc123" }), /a header or with OAuth, not with both/],
    [signedIn({ clientId: "  " }), /needs a client ID/],
    [signedIn({ grant: "password" as never }), /client credentials or a refresh token/],
    [signedIn({ clientAuth: "query" as never }), /by header or body/],
    [signedIn({ clientId: "a\tb" }), /plain text on one line/],
    [signedIn({ tokenUrl: "oauth2/token" }), /not a token address/],
    [
      signedIn({}, { endpoints: [endpoint({ query: ["authorization"] })] }),
      /gateway sets Authorization itself: list_invoices/,
    ],
    [
      signedIn({}, { endpoints: [endpoint({ query: ["$Authorization"] })] }),
      /gateway sets Authorization itself: list_invoices/,
    ],
  ])("refuses a sign-in that cannot be made (%#)", async (entered, why) => {
    await expect(checkApi(entered)).rejects.toThrow(why);
  });

  it("gives every tool the header as a parameter, and its sources no key", async () => {
    const { api } = await checkApi(signedIn());
    const docs = apiDocs(api);
    expect(() => validateDocs(docs)).not.toThrow();
    for (const doc of docs.filter((d) => d.kind === "source")) expect(doc.headers).toBeUndefined();
    const header = [{ name: "Authorization", type: "string", description: "Set by the gateway." }];
    for (const doc of docs.filter((d) => d.kind === "tool")) {
      expect(doc.headerParams).toEqual(header);
    }
    expect(signedTools(docs)).toEqual({ list_invoices: "acme", add_note: "acme" });
    expect(JSON.stringify(docs)).not.toContain("s3cret-value");
  });

  it("names each tool’s $ query names, on no prototype", async () => {
    const { api } = await checkApi(
      input({ endpoints: [endpoint({ query: ["$filter", "status"] })] }),
    );
    const found = dollarQueries(apiDocs(api));
    expect(found).toEqual({ list_invoices: ["$filter"] });
    expect("constructor" in found).toBe(false);
  });

  it("signs none of a header API’s tools", async () => {
    const { api } = await checkApi(input());
    const signed = signedTools(apiDocs(api));
    expect(signed).toEqual({});
    // Whatever a tool is named: "constructor" is a name an endpoint may have.
    expect(signed.constructor).toBeUndefined();
    expect("constructor" in signed).toBe(false);
  });

  it("signs in once before it saves, then keeps the secret in the env", async () => {
    const shown = await saveApi(signedIn());
    expect(requestToken).toHaveBeenCalledWith({
      oauth: kept,
      baseUrl: "https://api.acme.example/v1/",
      clientSecret: "s3cret-value",
      refreshToken: "",
    });
    expect(vi.mocked(setEnv).mock.calls).toEqual([["ACME_OAUTH_CLIENT_SECRET", "s3cret-value"]]);
    expect(forget).toHaveBeenCalledWith("acme");
    // After the write: a token asked for later is asked with the new sign-in.
    expect(vi.mocked(writeAtomic).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(forget).mock.invocationCallOrder[0],
    );
    expect(shown.oauth).toEqual(kept);
    const text = vi.mocked(writeAtomic).mock.calls[0][1];
    expect(parse(text)[0].oauth).toEqual(kept);
    expect(text).not.toContain("s3cret-value");
  });

  it("saves nothing when the sign-in is refused, and says why", async () => {
    vi.mocked(requestToken).mockRejectedValue(new Error("idp refused the sign-in (401)"));
    const failed = await saveApi(signedIn()).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(HostError);
    expect((failed as HostError).message).toBe("idp refused the sign-in (401)");
    expect(setEnv).not.toHaveBeenCalled();
    expect(writeAtomic).not.toHaveBeenCalled();
  });

  it("uses the secrets the host holds when the form leaves them empty", async () => {
    vi.mocked(readEnv).mockResolvedValue({
      ACME_OAUTH_CLIENT_SECRET: "held-secret",
      ACME_OAUTH_REFRESH_TOKEN: "held-refresh",
    });
    vi.mocked(requestToken).mockResolvedValue({ token: "t", seconds: 60, refreshToken: "next" });
    await saveApi(signedIn({ grant: "refresh_token", clientSecret: "", refreshToken: "" }));
    expect(vi.mocked(requestToken).mock.calls[0][0]).toMatchObject({
      clientSecret: "held-secret",
      refreshToken: "held-refresh",
    });
    // The refresh token the answer gave is kept, over the one read, while that is still there.
    expect(setEnv).toHaveBeenCalledWith("ACME_OAUTH_REFRESH_TOKEN", "next", "held-refresh");
  });

  it("keeps an API saved while another signs in", async () => {
    let file: string | null = null;
    vi.mocked(readText).mockImplementation(async () => file);
    vi.mocked(writeAtomic).mockImplementation(async (...args) => {
      file = args[1];
    });
    let answer: () => void = () => {};
    vi.mocked(requestToken).mockImplementation(
      () =>
        new Promise((done) => {
          answer = () => done({ token: "tok", seconds: 3600, refreshToken: null });
        }),
    );
    const one = endpoint({ name: "graph_list" });
    const signing = saveApi(signedIn({}, { name: "graph", endpoints: [one] }));
    await vi.waitFor(() => expect(requestToken).toHaveBeenCalled());
    await saveApi(input({ name: "zendesk", endpoints: [endpoint({ name: "zendesk_list" })] }));
    answer();
    await signing;
    expect((parse(file ?? "") as { name: string }[]).map((api) => api.name)).toEqual([
      "zendesk",
      "graph",
    ]);
    vi.mocked(writeAtomic).mockImplementation(async () => {});
  });

  it("asks for the secret again when the token address moves to another host", async () => {
    vi.mocked(readEnv).mockResolvedValue({ ACME_OAUTH_CLIENT_SECRET: "held-secret" });
    const { api } = await checkApi(signedIn());
    vi.mocked(readText).mockResolvedValue(stringify([api]));
    const moved = signedIn({ tokenUrl: "https://login.elsewhere.example/t", clientSecret: "" });
    await expect(saveApi(moved)).rejects.toThrow(/moved to another host/);
    expect(requestToken).not.toHaveBeenCalled();
  });

  it("spends no token on a save that changes neither the sign-in nor a secret", async () => {
    const held = { ACME_OAUTH_CLIENT_SECRET: "held-secret", ACME_OAUTH_REFRESH_TOKEN: "held" };
    vi.mocked(readEnv).mockResolvedValue(held);
    const { api } = await checkApi(signedIn({ grant: "refresh_token" }));
    vi.mocked(readText).mockResolvedValue(stringify([api]));
    await saveApi(signedIn({ grant: "refresh_token", clientSecret: "", refreshToken: "" }));
    expect(requestToken).not.toHaveBeenCalled();
    expect(forget).not.toHaveBeenCalled();
    expect(writeAtomic).toHaveBeenCalled(); // the API itself is still saved
    // A changed scope is a new sign-in: it is proven.
    await saveApi(
      signedIn({ grant: "refresh_token", scope: "grades", clientSecret: "", refreshToken: "" }),
    );
    expect(requestToken).toHaveBeenCalledTimes(1);
  });

  it("fetches a document with a token it signs in for, sent to the API’s own origin alone", async () => {
    const base = "https://api.acme.example/v1";
    const own = await specToken("https://api.acme.example/openapi.json", base, oauth());
    expect(own).toEqual({ headers: { Authorization: "Bearer tok" }, withheld: false });
    expect(vi.mocked(requestToken).mock.calls[0][0]).toMatchObject({
      baseUrl: "https://api.acme.example/v1/",
      clientSecret: "s3cret-value",
    });
    vi.mocked(requestToken).mockClear();
    const other = await specToken("https://docs.acme.example/openapi.json", base, oauth());
    expect(other).toEqual({ headers: {}, withheld: true });
    expect(requestToken).not.toHaveBeenCalled();
  });

  it("uses up no refresh token to fetch a document, and says why a sign-in failed", async () => {
    const url = "https://api.acme.example/openapi.json";
    const base = "https://api.acme.example/v1";
    // Asked for without a token: Google's Discovery documents need none.
    expect(await specToken(url, base, oauth({ grant: "refresh_token" }))).toEqual({
      headers: {},
      withheld: false,
    });
    expect(requestToken).not.toHaveBeenCalled();
    vi.mocked(requestToken).mockRejectedValue(new Error("idp refused the sign-in (401)"));
    const failed = await specToken(url, base, oauth()).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(HostError);
    expect((failed as HostError).message).toBe("idp refused the sign-in (401)");
  });

  it("refuses a sign-in with nothing to make it with", async () => {
    await expect(saveApi(signedIn({ clientSecret: "" }))).rejects.toThrow(
      /needs the client secret/,
    );
    await expect(saveApi(signedIn({ grant: "refresh_token" }))).rejects.toThrow(
      /needs a refresh token/,
    );
    expect(requestToken).not.toHaveBeenCalled();
  });
});
