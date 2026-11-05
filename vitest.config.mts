import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": here("./src"),
      // サーバー専用モジュールをテストから直接読み込めるようにする
      "server-only": here("./tests/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**"],
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    testTimeout: 30000,
    hookTimeout: 120000,
    fileParallelism: false,
  },
});
