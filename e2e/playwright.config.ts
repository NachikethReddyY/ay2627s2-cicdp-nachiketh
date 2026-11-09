import { defineConfig, devices } from "@playwright/test";

// The API and Postgres run in compose (scripts/ci.sh). Vite preview serves the built web app and
// proxies /api to the API on :3000, the same way the production build is served.
const port = 5173;

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm --filter @learnquest/web exec vite build && pnpm --filter @learnquest/web exec vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    // Never reuse a server on this port: a dev server there would make the run test something else.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
