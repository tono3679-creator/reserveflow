import { expect, test, type Page } from "@playwright/test";
import { endDemo, startDemo, switchRole } from "./helpers";

const menu = (page: Page, name: string) => page.getByRole("navigation", { name: "メインメニュー" }).getByRole("link", { name });

test.describe("スマート空き枠提案", () => {
  test("候補を探して、おすすめの枠から予約を登録できる", async ({ page }) => {
    await startDemo(page);
    await menu(page, "スマート空き枠提案").click();
    await expect(page.getByRole("heading", { name: "スマート空き枠提案", level: 1 })).toBeVisible();

    const form = page.getByRole("form", { name: "空き枠の検索条件" });
    await form.getByLabel("希望時刻（任意）").fill("14:00");
    await form.getByLabel("探す範囲").selectOption("7");
    await form.getByRole("button", { name: "空き枠を探す" }).click();
    await page.waitForURL(/time=14%3A00/);

    const list = page.getByRole("list", { name: "おすすめ予約枠" });
    const first = list.getByRole("listitem").first();
    await expect(first).toBeVisible();
    // 理由は実際に計算した値から作る（希望時刻との差など）
    await expect(first.getByText(/希望時刻（14:00）/)).toBeVisible();
    const heading = (await first.locator("p").first().innerText()).trim(); // 例: 11月6日(金) 15:00〜16:00
    const time = heading.match(/(\d{2}:\d{2})〜/)?.[1];
    expect(time).toBeTruthy();

    const calendarHref = await first.getByRole("link", { name: "カレンダーで見る" }).getAttribute("href");
    expect(calendarHref).toMatch(/^\/calendar\?date=\d{4}-\d{2}-\d{2}&view=staff$/);
    await first.getByRole("button", { name: "この枠で予約" }).click();
    const dialog = page.getByRole("dialog", { name: "新しい予約" });
    await expect(dialog.getByLabel("開始")).toHaveValue(time as string);
    await dialog.getByRole("combobox", { name: "顧客を検索" }).fill("");
    await dialog.getByRole("listbox", { name: "顧客の候補" }).getByRole("button").first().click();
    await dialog.getByRole("button", { name: "予約を登録" }).click();
    await expect(page.getByRole("heading", { name: "予約の詳細", level: 1 })).toBeVisible();
    await expect(page.getByText(time as string).first()).toBeVisible();

    // カレンダー連携：その日のスタッフ別表示で開く
    await page.goto(calendarHref as string);
    await expect(page.getByRole("tab", { name: "スタッフ別" })).toHaveAttribute("aria-selected", "true");
    await endDemo(page);
  });

  test("重みは店舗設定で変更でき、スタッフには提案画面を出さない", async ({ page }) => {
    await startDemo(page, "整体院で試す");
    await page.goto("/settings");
    await page.getByRole("tab", { name: "空き枠提案" }).click();
    await page.getByLabel("希望時刻との近さ").fill("0");
    await page.getByLabel("隙間の少なさ").fill("0");
    await page.getByLabel("スタッフ稼働率の平準化").fill("0");
    await page.getByLabel("店舗の未利用時間の削減").fill("0");
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("どれか1つは 1 以上にしてください")).toBeVisible();
    await page.getByLabel("隙間の少なさ").fill("100");
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("空き枠提案の重みを保存しました")).toBeVisible();

    await page.goto("/suggestions");
    await expect(page.getByText("（重み 100）")).toBeVisible();

    await switchRole(page, "スタッフ");
    await expect(menu(page, "スマート空き枠提案")).toHaveCount(0);
    await page.goto("/suggestions");
    await expect(page.getByRole("heading", { name: "スマート空き枠提案", level: 1 })).toHaveCount(0);
    await endDemo(page);
  });
});
