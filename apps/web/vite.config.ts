import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { execFileSync } from "node:child_process";

const proxy = { "/api": { target: "http://localhost:3000", ws: true } };
const gitBranch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim() || "detached";

export default defineConfig({
  define: { __LEARNQUEST_GIT_BRANCH__: JSON.stringify(gitBranch) },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "webcontainer-test-editor-isolation",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url?.split("?", 1)[0] === "/test/editor") {
            response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
            response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
          }
          next();
        });
      },
    },
  ],
  server: { proxy },
  preview: { proxy },
});
