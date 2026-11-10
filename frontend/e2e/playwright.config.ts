import { defineConfig, devices } from "@playwright/test";

/** Mock-mode journeys: the server runs with no upstream URL and its own dist dir, beside any dev
 *  server. One worker, because the mock is one in-memory store shared by every page. */
export default defineConfig({
  testDir: "./journeys",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 180_000,
    env: { ONTOLOGY_API_URL: "", ONTOLOGY_MULTI_PLATFORM: "", NEXT_DIST_DIR: ".next-e2e" },
  },
});
