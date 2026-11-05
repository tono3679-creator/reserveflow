import { expect, test, type Page } from "@playwright/test";
import { endDemo, startDemo, switchRole } from "./helpers";

const menu = (page: Page, name: string) => page.getByRole("navigation", { name: "メインメニュー" }).getByRole("link", { name });
const kpis = (page: Page) => page.getByRole("region", { name: "主な指標" });

test.describe("分析：ダッシュボード・売上分析・顧客分析と権限", () => {
  test("オーナーは KPI・グラフ・インサイトを確認し、期間を変えて売上・無断キャンセル・リピートを分析できる", async ({ page }) => {
    await startDemo(page);
    await expect(kpis(page).getByText("本日の売上")).toBeVisible();
    await expect(kpis(page).getByText("予約枠稼働率（直近30日）")).toBeVisible();
    await expect(page.getByRole("heading", { name: "インサイト" })).toBeVisible();
    await expect(page.getByRole("img", { name: /月別売上の棒グラフ/ })).toBeVisible();

    await menu(page, "売上分析").click();
    await expect(page.getByRole("heading", { name: "売上分析", level: 1 })).toBeVisible();
    await page.getByRole("combobox", { name: "対象期間" }).selectOption("last_month");
    await page.waitForURL(/preset=last_month/);
    await expect(page.getByText(/対象期間：\d{4}年\d+月1日〜/)).toBeVisible();
    await expect(page.getByText(/比較：/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "スタッフ別" })).toBeVisible();
    // 表で見る（グラフの数値を表でも確認できる）
    await page.getByText("表で見る").first().click();
    await expect(page.getByRole("columnheader", { name: "売上" }).first()).toBeVisible();

    await menu(page, "顧客分析").click();
    await expect(page.getByText("無断キャンセル率 ＝ 無断キャンセル件数 ÷ 対象予約件数 × 100")).toBeVisible();
    await expect(kpis(page).getByText("推定機会損失額")).toBeVisible();
    await expect(page.getByText("実際の逸失利益とは異なります")).toBeVisible();
    await page.getByRole("link", { name: "リピート率分析" }).click();
    await expect(page.getByText("リピート率 ＝ 対象期間内のリピーター数 ÷ 対象期間内の来店顧客数 × 100")).toBeVisible();
    await expect(page.getByText("30日以内")).toBeVisible();
    await expect(page.getByText(/観測中 \d+人/).first()).toBeVisible();
    await endDemo(page);
  });

  test("マネージャーは売上を見られず、スタッフは分析を使えない", async ({ page }) => {
    await startDemo(page);
    await switchRole(page, "マネージャー");
    await expect(kpis(page).getByText("リピート率（直近30日）")).toBeVisible();
    await expect(kpis(page).getByText("本日の売上")).toHaveCount(0);
    await expect(menu(page, "売上分析")).toHaveCount(0);
    await page.goto("/analytics/sales");
    await page.waitForURL("**/dashboard?denied=1");
    await page.goto("/analytics/customers");
    await expect(page.getByText("金額はオーナーだけが確認できます。")).toBeVisible();

    await switchRole(page, "スタッフ");
    await expect(menu(page, "顧客分析")).toHaveCount(0);
    await expect(kpis(page)).toHaveCount(0);
    await expect(page.getByText("本日の担当予約")).toBeVisible();
    await page.goto("/analytics/customers");
    await page.waitForURL("**/dashboard?denied=1");
    await endDemo(page);
  });
});
