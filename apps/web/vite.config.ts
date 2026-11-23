import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proxy = { "/api": { target: process.env.DEV_API_ORIGIN ?? "http://localhost:3000", ws: true } };
const gitBranch = (() => {
  try {
    return execFileSync("/usr/bin/git", ["branch", "--show-current"], { encoding: "utf8" }).trim() || "detached";
  } catch {
    return "detached";
  }
})();

const envDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, ["POSTHOG_PROJECT_TOKEN", "POSTHOG_HOST"]);
  return {
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    define: {
      __LEARNQUEST_GIT_BRANCH__: JSON.stringify(gitBranch),
      __POSTHOG_PROJECT_TOKEN__: JSON.stringify(env.POSTHOG_PROJECT_TOKEN ?? ""),
      __POSTHOG_HOST__: JSON.stringify(env.POSTHOG_HOST ?? ""),
    },
    plugins: [react(), tailwindcss()],
    server: { proxy },
    preview: { proxy },
  };
});
