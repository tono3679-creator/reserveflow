import { devices, expect, test } from "@playwright/test";
import { endDemo, startDemo } from "./helpers";

const menu = (page: import("@playwright/test").Page, name: string) =>
  page.getByRole("navigation", { name: "メインメニュー" }).getByRole("link", { name });

test.describe("公開予約ページ：予約・確認リンクでのキャンセル・通知", () => {
  test("お客様がスマートフォンで予約し、リンクからキャンセルすると、管理画面に通知が残る", async ({ page, browser }) => {
    await startDemo(page);
    await menu(page, "予約カレンダー").click();
    const href = await page.getByRole("link", { name: "公開予約ページ" }).getAttribute("href");
    expect(href).toMatch(/^\/book\/[a-z0-9-]+$/);

    // お客様側（ログインしていないスマートフォン）
    const phone = await browser.newContext({ ...devices["Pixel 7"], locale: "ja-JP", timezoneId: "Asia/Tokyo", baseURL: test.info().project.use.baseURL });
    const guest = await phone.newPage();
    await guest.goto(href!);
    await expect(guest.getByRole("heading", { name: "サービスを選ぶ" })).toBeVisible();
    await guest.getByRole("button", { name: /カット/ }).first().click();

    await expect(guest.getByRole("heading", { name: "スタッフを選ぶ" })).toBeVisible();
    await guest.getByRole("button", { name: /指名なし/ }).click();

    await expect(guest.getByRole("heading", { name: "日付を選ぶ" })).toBeVisible();
    // 空きのある日のうち、3つ目（今日・明日は避ける）
    await guest.getByRole("button", { name: /空き\d+件/ }).nth(2).click();

    await expect(guest.getByRole("heading", { name: "時間を選ぶ" })).toBeVisible();
    await guest.getByRole("button", { name: /^\d{2}:\d{2}$/ }).first().click();

    await expect(guest.getByRole("heading", { name: "お客様情報" })).toBeVisible();
    // 未入力では進めない
    await guest.getByRole("button", { name: "確認へ進む" }).click();
    await expect(guest.getByLabel("お名前")).toHaveAttribute("aria-invalid", "true");
    await guest.getByLabel("お名前").fill("公開 予約太郎");
    await guest.getByLabel("電話番号").fill("090-1111-2222");
    await guest.getByLabel("メールアドレス").fill("guest-e2e@example.com");
    await guest.getByRole("button", { name: "確認へ進む" }).click();

    await expect(guest.getByRole("heading", { name: "内容の確認" })).toBeVisible();
    await expect(guest.getByText("キャンセルポリシー", { exact: true })).toBeVisible();
    const confirmButton = guest.getByRole("button", { name: "この内容で予約を確定する" });
    await expect(confirmButton).toBeDisabled();
    await guest.getByLabel("キャンセルポリシーを確認し、同意します").check();
    await confirmButton.click();

    await expect(guest.getByText("ご予約を承りました")).toBeVisible();
    await guest.getByRole("link", { name: "予約を確認する" }).click();
    await guest.waitForURL(/\/manage\/[A-Za-z0-9_-]{43}$/);
    await expect(guest.getByRole("heading", { name: "ご予約の確認" })).toBeVisible();
    await expect(guest.getByText("予約確定")).toBeVisible();

    // 確認リンクから日時を変更する（自分の予約の枠は空きとして数える）
    await guest.getByRole("button", { name: "日時を変更する" }).click();
    const change = guest.getByRole("region", { name: "日時の変更" });
    await change.getByRole("button", { name: /空き\d+件/ }).nth(3).click();
    await change.getByRole("button", { name: /^\d{2}:\d{2}$/ }).last().click();
    await expect(change.getByText(/変更後：/)).toBeVisible();
    await change.getByRole("button", { name: "この日時に変更する" }).click();
    await expect(guest.getByText("日時を変更しました")).toBeVisible();

    // 確認リンクからキャンセル
    await guest.getByRole("button", { name: "キャンセルする" }).click();
    await guest.getByLabel("理由（任意）").fill("予定が合わなくなりました");
    await guest.getByRole("button", { name: "キャンセルを確定する" }).click();
    await expect(guest.getByText("予約をキャンセルしました")).toBeVisible();
    await expect(guest.getByText("顧客キャンセル")).toBeVisible();
    await expect(guest.getByRole("button", { name: "日時を変更する" })).toHaveCount(0);

    // でたらめなトークンでは見つからない
    const res = await guest.goto(`${href}/manage/${"x".repeat(43)}`);
    expect(res?.status()).toBe(404);
    await phone.close();

    // 管理画面：予約と通知（デモなのでメールは送らず「デモ表示」）
    await menu(page, "予約一覧").click();
    await page.getByRole("searchbox").or(page.getByPlaceholder(/顧客名/)).first().fill("公開 予約太郎");
    await page.getByRole("button", { name: "検索" }).click();
    await expect(page.getByRole("cell", { name: "Web予約" }).first()).toBeVisible();

    await menu(page, "通知管理").click();
    await expect(page.getByRole("heading", { name: "通知管理", level: 1 })).toBeVisible();
    await page.getByPlaceholder("顧客名・宛先").fill("公開 予約太郎");
    await page.getByRole("button", { name: "検索" }).click();
    const rows = page.getByRole("row").filter({ hasText: "公開 予約太郎" });
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: "予約変更" })).toContainText("デモ表示");
    await expect(rows.filter({ hasText: "予約確定" })).toContainText("デモ表示");
    await expect(rows.filter({ hasText: "予約キャンセル" })).toContainText("デモ表示");
    await rows.filter({ hasText: "予約確定" }).getByRole("button", { name: /本文を見る/ }).click();
    const body = page.getByRole("dialog");
    await expect(body).toContainText("guest-e2e@example.com");
    await expect(body).toContainText(/\/book\/[a-z0-9-]+\/manage\/[A-Za-z0-9_-]{43}/);
    await page.keyboard.press("Escape");

    await endDemo(page);
  });
});
