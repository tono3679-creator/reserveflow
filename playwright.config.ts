import { defineConfig, devices } from "@playwright/test";

/**
 * ブラウザでの E2E テスト（npm run test:e2e）。
 * ローカル PostgreSQL（npm run db:local:reset && SEED_LOGIN_PASSWORD=… npm run db:seed 済み）を使う。
 * テストごとに「デモを体験」から専用の環境を作るので、テスト同士・既存データと干渉しない。
 *
 *   npm run test:e2e                                       … next dev で起動して実行
 *   E2E_COMMAND="npx next start -p 3100" npm run test:e2e  … ビルド済みのアプリで実行（CI）
 */
const PORT = 3100;
const BASE_URL = process.env.E2E_BASE_URL?.replace(/\/$/, "") || `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: process.env.CI ? 2 : 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    navigationTimeout: 45_000,
    actionTimeout: 20_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } }, grepInvert: /@mobile/ },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } }, grep: /@mobile/ },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: process.env.E2E_COMMAND ?? `npx next dev -p ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/reserveflow",
      AUTH_PROVIDER: "local",
      DEMO_MAX_ACTIVE: "1000",
      DEMO_CREATE_LIMIT_PER_HOUR: "100000",
    },
  },
});
