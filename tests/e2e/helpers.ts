import { expect, type Page } from "@playwright/test";

/** トップページから業種を選んでデモを始める */
export async function startDemo(page: Page, industryButton = "美容室で試す") {
  await page.goto("/");
  await page.getByRole("button", { name: industryButton }).click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "ダッシュボード", level: 1 })).toBeVisible();
}

/** デモを終了する（テストで作ったデータを片付ける） */
export async function endDemo(page: Page) {
  await page.getByRole("button", { name: "ユーザーメニュー" }).click();
  await page.getByRole("menuitem", { name: "デモを終了する" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

export async function switchRole(page: Page, label: "オーナー" | "マネージャー" | "スタッフ") {
  await page.getByRole("button", { name: "ユーザーメニュー" }).click();
  await page.getByRole("menuitem", { name: `${label}に切り替え` }).click();
  await expect(page.getByText(`${label}として表示中`)).toBeVisible();
}
