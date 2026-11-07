import type { Page } from "@playwright/test";

/** The localStorage shape the SDK shell reads, so journeys never go through SSO. */
export async function seedAuth(page: Page, username = "tester") {
  // The mock is one store on the server: every journey starts from the seed.
  await page.request.post("/api/ontology/reset");
  const expiresAt = "2099-01-01T00:00:00.000Z";
  const tenant = {
    user_id: 1,
    username,
    email: `${username}@example.com`,
    user_active: true,
    key: "main",
    org: "main",
    platform_name: "Test",
    is_admin: true,
    is_staff: true,
    active: true,
  };
  await page.addInitScript(
    ({ username, expiresAt, tenant }) => {
      localStorage.setItem("tenant", "main");
      // The shape the app's saveCurrentTenant writes; any other makes the SDK's cookie sync redirect to login.
      localStorage.setItem("current_tenant", "main");
      localStorage.setItem("tenants", JSON.stringify([tenant]));
      localStorage.setItem(
        "userData",
        JSON.stringify({
          user_id: 1,
          user_nicename: username,
          username,
          email: `${username}@example.com`,
        }),
      );
      // The SDK's AuthProvider decodes this as a JWT and matches its user_id with userData.
      const b64 = (o: object) =>
        btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ user_id: 1, username, exp: 4102444800 })}.sig`;
      localStorage.setItem("edx_jwt_token", jwt);
      localStorage.setItem("axd_token", "stub-axd-token");
      localStorage.setItem("axd_token_expires", expiresAt);
      localStorage.setItem("dm_token", "stub-dm-token");
      localStorage.setItem("dm_token_expires", expiresAt);
    },
    { username, expiresAt, tenant },
  );
  // The platform is never reached from a journey; the SDK picks the platform from the memberships array.
  await page.route("**/api.iblai.app/**", (route) =>
    route.fulfill({
      json: route.request().url().includes("/users/manage/platform/") ? [tenant] : {},
    }),
  );
}
