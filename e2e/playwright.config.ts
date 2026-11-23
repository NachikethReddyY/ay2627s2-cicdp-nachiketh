import { defineConfig, devices, type ReporterDescription } from "@playwright/test";

const port = Number(process.env.E2E_WEB_PORT ?? 5173);
const reporter: ReporterDescription[] = [["list"], ["html", { open: "never" }]];
if (process.env.PLAYWRIGHT_JSON_OUTPUT_FILE) reporter.push(["json"]);

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter,
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm --filter @learnquest/web exec vite build && pnpm --filter @learnquest/web exec vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
