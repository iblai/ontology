import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiAddress } from "./address";
import { HostError } from "./errors";
import { readEnv, setEnv } from "./files";
import { forget, liveTokens, requestToken, tokenFor, tokenUrlOf, type TokenAsk } from "./oauth";
import type { HostApiOAuth } from "./types";

vi.mock("./address", () => ({
  apiAddress: vi.fn<typeof import("./address").apiAddress>(async (base) => ({
    address: base,
    private: false,
    local: false,
  })),
}));
vi.mock("./platform", () => ({ currentPlatform: () => "acme" }));
vi.mock("./files", async (actual) => ({
  ...(await actual<typeof import("./files")>()),
  readEnv: vi.fn<typeof import("./files").readEnv>(),
  setEnv: vi.fn<typeof import("./files").setEnv>(async () => undefined),
}));

const oauth = (extra: Partial<HostApiOAuth> = {}): HostApiOAuth => ({
  grant: "client_credentials",
  tokenUrl: "/oauth2/token",
  clientId: "console",
  clientAuth: "basic",
  scope: "",
  ...extra,
});

const ask = (extra: Partial<HostApiOAuth> = {}, secrets: Partial<TokenAsk> = {}): TokenAsk => ({
  oauth: oauth(extra),
  baseUrl: "https://learn.example/api/",
  clientSecret: "s3cret-value",
  refreshToken: "",
  ...secrets,
});

const answering = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>(
    async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  );

const sent = (fetcher: ReturnType<typeof answering>) => {
  const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string>, form: String(init.body) };
};

const failure = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error("it did not throw");
};

beforeEach(() => {
  vi.mocked(readEnv).mockResolvedValue({ CANVAS_OAUTH_CLIENT_SECRET: "s3cret-value" });
  vi.mocked(setEnv).mockClear();
  vi.mocked(apiAddress).mockClear();
});

describe("a token address", () => {
  it("stands on the base URL’s origin when it is a path", () => {
    expect(tokenUrlOf("/learn/oauth2/token", "https://learn.example/api/v1/")).toBe(
      "https://learn.example/learn/oauth2/token",
    );
  });

  it("is itself when it is an address, and refused when it is neither", () => {
    expect(tokenUrlOf(" https://login.example/t ", "https://a.example/")).toBe(
      "https://login.example/t",
    );
    expect(() => tokenUrlOf("login.example/t", "https://a.example/")).toThrow(HostError);
  });
});

describe("a token request", () => {
  it("is a form posted with the client’s ID and secret in a Basic header", async () => {
    const fetcher = answering({ access_token: "tok-1", expires_in: 3600 });
    const got = await requestToken(ask({ scope: "roster.readonly grades" }), fetcher);
    const { url, init, headers, form } = sent(fetcher);
    expect(url).toBe("https://learn.example/oauth2/token");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(headers.authorization).toBe(
      `Basic ${Buffer.from("console:s3cret-value").toString("base64")}`,
    );
    expect(form).toBe("grant_type=client_credentials&scope=roster.readonly+grades");
    expect(got).toEqual({ token: "tok-1", seconds: 3600, refreshToken: null });
    expect(apiAddress).toHaveBeenCalledWith("https://learn.example/oauth2/token");
  });

  it("puts them in the form instead when the API wants that", async () => {
    const fetcher = answering({ access_token: "tok-1" });
    await requestToken(ask({ clientAuth: "body" }), fetcher);
    const { headers, form } = sent(fetcher);
    expect(headers.authorization).toBeUndefined();
    expect(form).toBe("grant_type=client_credentials&client_id=console&client_secret=s3cret-value");
  });

  it("sends the refresh token for that grant, and gives back the one to use next", async () => {
    const fetcher = answering({ access_token: "tok-1", refresh_token: "next-refresh" });
    const got = await requestToken(
      ask({ grant: "refresh_token" }, { refreshToken: "first-refresh" }),
      fetcher,
    );
    expect(sent(fetcher).form).toBe("grant_type=refresh_token&refresh_token=first-refresh");
    expect(got.refreshToken).toBe("next-refresh");
  });

  it.each([
    [{ access_token: "t" }, 300],
    [{ access_token: "t", expires_in: "120" }, 120],
    [{ access_token: "t", expires_in: 999_999 }, 86_400],
    [{ access_token: "t", expires_in: -5 }, 300],
  ])("reads how long %j lasts as %i s", async (body, seconds) => {
    expect((await requestToken(ask(), answering(body))).seconds).toBe(seconds);
  });

  it("says why in the endpoint’s own words, with the secrets hidden", async () => {
    const refused = answering(
      { error: "invalid_client", error_description: "s3cret-value is not console’s secret" },
      401,
    );
    const error = await failure(() => requestToken(ask(), refused));
    expect(error.message).toBe(
      "learn.example refused the sign-in (401 invalid_client): ******** is not console’s secret",
    );
    expect(error).not.toBeInstanceOf(HostError);
  });

  it("hides a secret before it cuts long words, so none shows in part", async () => {
    const long = `${"x".repeat(295)}s3cret-value`;
    const refused = answering({ error: "invalid_client", error_description: long }, 401);
    const error = await failure(() => requestToken(ask(), refused));
    expect(error.message).not.toContain("s3cre");
    expect(error.message.endsWith(`${"x".repeat(295)}*****`)).toBe(true);
  });

  it("refuses an answer that is not JSON, holds no token, or is not a bearer token", async () => {
    const page = await failure(() => requestToken(ask(), answering("<html>", 500)));
    expect(page.message).toBe("learn.example refused the sign-in (500)");
    const empty = await failure(() => requestToken(ask(), answering({ token: "x" })));
    expect(empty.message).toBe("learn.example refused the sign-in (200)");
    const mac = await failure(() =>
      requestToken(ask(), answering({ access_token: "t", token_type: "mac" })),
    );
    expect(mac.message).toContain("only a bearer token is sent");
  });

  it("refuses an answer over 64 KB, and says when there was none", async () => {
    const huge = await failure(() => requestToken(ask(), answering("x".repeat(70_000))));
    expect(huge.message).toContain("more than 64 KB");
    const down = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED") });
    });
    const none = await failure(() => requestToken(ask(), down));
    expect(none.message).toBe("learn.example did not answer the sign-in: connect ECONNREFUSED");
  });

  it("asks nothing of an address the host may not call", async () => {
    vi.mocked(apiAddress).mockRejectedValueOnce(new HostError(400, "is this machine"));
    const fetcher = answering({ access_token: "t" });
    await expect(requestToken(ask(), fetcher)).rejects.toThrow("is this machine");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("the token kept for an API", () => {
  const api = (name: string, extra: Partial<HostApiOAuth> = {}) => ({
    name,
    baseUrl: "https://learn.example/api/",
    oauth: oauth(extra),
  });

  it("is asked for once and given again until a minute before its end", async () => {
    const fetcher = answering({ access_token: "tok-a", expires_in: 3600 });
    let clock = 1_000_000;
    const now = () => clock;
    expect(await tokenFor(api("kept"), fetcher, now)).toBe("tok-a");
    clock += 3_539_000;
    expect(await tokenFor(api("kept"), fetcher, now)).toBe("tok-a");
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock += 2_000; // 59 s left
    await tokenFor(api("kept"), fetcher, now);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("is one request for callers that come together", async () => {
    const fetcher = answering({ access_token: "tok-b", expires_in: 3600 });
    const all = await Promise.all(
      Array.from({ length: 10 }, () => tokenFor(api("crowd"), fetcher)),
    );
    expect(new Set(all)).toEqual(new Set(["tok-b"]));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("is not kept when the request failed: the next call asks again", async () => {
    await expect(tokenFor(api("flaky"), answering({ error: "server_error" }, 503))).rejects.toThrow(
      "refused the sign-in (503 server_error)",
    );
    expect(await tokenFor(api("flaky"), answering({ access_token: "tok-c" }))).toBe("tok-c");
  });

  it("signs in with the secrets the env file holds for it", async () => {
    vi.mocked(readEnv).mockResolvedValue({
      WORKDAY_OAUTH_CLIENT_SECRET: "wd-secret-1",
      WORKDAY_OAUTH_REFRESH_TOKEN: "wd-refresh-1",
    });
    const fetcher = answering({ access_token: "tok-d", refresh_token: "wd-refresh-2" });
    await tokenFor(api("workday", { grant: "refresh_token", clientAuth: "body" }), fetcher);
    expect(sent(fetcher).form).toBe(
      "grant_type=refresh_token&refresh_token=wd-refresh-1&client_id=console&client_secret=wd-secret-1",
    );
    // Written over the one just used, and only over that one.
    expect(setEnv).toHaveBeenCalledWith(
      "WORKDAY_OAUTH_REFRESH_TOKEN",
      "wd-refresh-2",
      "wd-refresh-1",
    );
  });

  it("writes nothing back when the refresh token stayed the same", async () => {
    vi.mocked(readEnv).mockResolvedValue({ SAME_OAUTH_REFRESH_TOKEN: "same-refresh" });
    const fetcher = answering({ access_token: "tok-e", refresh_token: "same-refresh" });
    await tokenFor(api("same", { grant: "refresh_token" }), fetcher);
    expect(setEnv).not.toHaveBeenCalled();
  });

  it("is asked for again once forgotten, and stays masked: it may still be valid", async () => {
    await tokenFor(api("listed"), answering({ access_token: "tok-listed", expires_in: 3600 }));
    expect(liveTokens()).toContain("tok-listed");
    forget("listed");
    expect(liveTokens()).toContain("tok-listed");
    const again = answering({ access_token: "tok-new", expires_in: 3600 });
    expect(await tokenFor(api("listed"), again)).toBe("tok-new");
    expect(again).toHaveBeenCalledTimes(1);
    expect(liveTokens()).toEqual(expect.arrayContaining(["tok-listed", "tok-new"]));
  });

  it("gives a token asked for before its sign-in was forgotten to that call alone", async () => {
    let answer: (value: Response) => void = () => {};
    const slow = vi.fn<typeof fetch>(() => new Promise<Response>((done) => (answer = done)));
    const asked = tokenFor(api("changed"), slow);
    await vi.waitFor(() => expect(slow).toHaveBeenCalled());
    forget("changed"); // the sign-in changed while the request was out
    answer(new Response(JSON.stringify({ access_token: "tok-stale", expires_in: 3600 })));
    expect(await asked).toBe("tok-stale");
    expect(liveTokens()).toContain("tok-stale"); // masked, though no longer given out
    const again = answering({ access_token: "tok-fresh", expires_in: 3600 });
    expect(await tokenFor(api("changed"), again)).toBe("tok-fresh");
    expect(again).toHaveBeenCalledTimes(1);
  });

  it("keeps no token asked for with a count from before a forget", async () => {
    forget("counted"); // as when the gateway read the API just before its sign-in changed
    const fetcher = answering({ access_token: "tok-counted", expires_in: 3600 });
    expect(await tokenFor({ ...api("counted"), since: 0 }, fetcher)).toBe("tok-counted");
    expect(liveTokens()).toContain("tok-counted");
    await tokenFor(api("counted"), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps the token it replaced masked too", async () => {
    let clock = 5_000_000;
    const now = () => clock;
    await tokenFor(api("renewed"), answering({ access_token: "tok-old", expires_in: 90 }), now);
    clock += 60_000; // 30 s left: still valid, and replaced
    await tokenFor(api("renewed"), answering({ access_token: "tok-next", expires_in: 90 }), now);
    expect(liveTokens()).toEqual(expect.arrayContaining(["tok-old", "tok-next"]));
  });
});
