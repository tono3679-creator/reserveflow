import { expect, test, type Page } from "@playwright/test";

const menu = (page: Page, name: string) => page.getByRole("navigation", { name: "メインメニュー" }).getByRole("link", { name });
import { endDemo, startDemo, switchRole } from "./helpers";

/** 店舗の今日から n 日後（テストはデモ環境の「今」を基準にする） */
function daysAhead(n: number) {
  const d = new Date(Date.now() + n * 86_400_000);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(d);
}

/** 予約フォームに入力する（営業開始前の 08:00 にして、既存のデモ予約と重ならないようにする） */
async function fillBookingForm(page: Page, opts: { customer: string; date: string; start: string }) {
  const dialog = page.getByRole("dialog", { name: "新しい予約" });
  await dialog.getByRole("combobox", { name: "顧客を検索" }).fill(opts.customer);
  await dialog.getByRole("listbox", { name: "顧客の候補" }).getByRole("button").first().click();
  await dialog.getByLabel("サービス").selectOption({ index: 1 });
  await dialog.getByLabel("担当スタッフ").selectOption({ index: 1 });
  await dialog.getByLabel("日付").fill(opts.date);
  await dialog.getByLabel("開始").fill(opts.start);
  return dialog;
}

test.describe("予約：登録・重なりの拒否・変更・キャンセル", () => {
  test("営業時間外は確認のうえで登録でき、同じ担当・時間の予約は拒否される", async ({ page }) => {
    await startDemo(page);
    const date = daysAhead(5);
    await menu(page, "予約一覧").click();
    await page.getByRole("button", { name: "新規予約" }).click();
    let dialog = await fillBookingForm(page, { customer: "", date, start: "08:00" });
    await dialog.getByRole("button", { name: "予約を登録" }).click();

    // 営業時間外・勤務時間外は警告を確認して登録する
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("営業時間外");
    await confirm.getByRole("button", { name: "このまま登録する" }).click();
    await expect(page.getByText("予約を登録しました")).toBeVisible();
    await page.waitForURL(/\/bookings\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "予約の詳細", level: 1 })).toBeVisible();
    await expect(page.getByText("予約確定").first()).toBeVisible();
    const detailUrl = page.url();

    // 同じスタッフ・同じ時間にもう1件 → 確認しても DB とサーバーが拒否する
    await menu(page, "予約一覧").click();
    await page.getByRole("button", { name: "新規予約" }).click();
    dialog = await fillBookingForm(page, { customer: "", date, start: "08:00" });
    await dialog.getByRole("button", { name: "予約を登録" }).click();
    await expect(page.getByText(/別の予約と時間が重なっています/)).toBeVisible();
    await page.keyboard.press("Escape");

    // 日時を変更する（同じ日の 08:30 → まだ重なるので拒否、翌日なら変更できる）
    await page.goto(detailUrl);
    await page.getByRole("button", { name: "内容を編集" }).click();
    const edit = page.getByRole("dialog", { name: "予約を編集" });
    await edit.getByLabel("日付").fill(daysAhead(6));
    await edit.getByRole("button", { name: "変更を保存" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "このまま登録する" }).click();
    await expect(page.getByText("予約を変更しました")).toBeVisible();

    // キャンセルすると枠が空き、履歴に残る
    await page.getByRole("button", { name: "店舗都合でキャンセル" }).click();
    await page.getByLabel("理由（任意）").fill("E2E テスト");
    await page.getByRole("alertdialog").getByRole("button", { name: "店舗都合でキャンセル" }).click();
    await expect(page.getByText("「店舗キャンセル」に変更しました")).toBeVisible();
    await expect(page.getByText("理由：E2E テスト")).toBeVisible();
    await endDemo(page);
  });

  test("スタッフの立場では予約の登録ボタンが出ず、担当分だけが表示される", async ({ page }) => {
    await startDemo(page);
    await switchRole(page, "スタッフ");
    await menu(page, "予約カレンダー").click();
    await expect(page.getByRole("heading", { name: "予約カレンダー", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "新規予約" })).toHaveCount(0);
    await menu(page, "予約一覧").click();
    await expect(page.getByText("ご自身が担当する予約だけが表示されます。")).toBeVisible();
    await expect(menu(page, "メニュー・サービス")).toHaveCount(0);
    await page.goto("/services");
    await page.waitForURL("**/dashboard?denied=1");
    await endDemo(page);
  });

  test("顧客を登録してメモを残せる", async ({ page }) => {
    await startDemo(page);
    await menu(page, "顧客管理").click();
    await page.getByRole("button", { name: "顧客を登録" }).click();
    const dialog = page.getByRole("dialog", { name: "顧客を登録" });
    await dialog.getByLabel("氏名").fill("テスト 花子");
    await dialog.getByLabel("電話番号").fill("090-1234-5678");
    await dialog.getByRole("button", { name: "登録する" }).click();
    await page.waitForURL(/\/customers\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "テスト 花子 様", level: 1 })).toBeVisible();
    await expect(page.getByText("未来店")).toBeVisible();
    await page.getByPlaceholder(/カラーは明るめが好み/).fill("初回はカウンセリングを長めに");
    await page.getByRole("button", { name: "メモを追加" }).click();
    await expect(page.getByText("初回はカウンセリングを長めに")).toBeVisible();
    // 予約がない顧客は削除できる
    await page.getByRole("button", { name: "削除" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "削除する" }).click();
    await page.waitForURL("**/customers");
    await endDemo(page);
  });
  test("サービスとスタッフを登録し、担当と休暇を設定できる", async ({ page }) => {
    await startDemo(page);
    await menu(page, "メニュー・サービス").click();
    await page.getByRole("button", { name: "サービスを追加" }).click();
    let dialog = page.getByRole("dialog", { name: "サービスを追加" });
    await dialog.getByLabel("サービス名").fill("E2E ヘッドマッサージ");
    await dialog.getByLabel("料金（円）").fill("3300");
    await dialog.getByLabel("所要時間（分）").fill("45");
    await dialog.getByRole("button", { name: "追加する" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("E2E ヘッドマッサージ")).toBeVisible();

    await menu(page, "スタッフ管理").click();
    await page.getByRole("button", { name: "スタッフを追加" }).click();
    dialog = page.getByRole("dialog", { name: "スタッフを追加" });
    await dialog.getByLabel("氏名").fill("E2E 太郎");
    await dialog.getByRole("checkbox", { name: "E2E ヘッドマッサージ" }).check();
    await dialog.getByRole("button", { name: "追加する" }).click();
    // 追加するとスタッフの詳細へ移る
    await page.waitForURL(/\/staff\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "E2E 太郎", level: 1 })).toBeVisible();
    await expect(page.getByText("E2E ヘッドマッサージ").first()).toBeVisible();

    await page.getByLabel("日付").fill(daysAhead(5));
    await page.getByLabel("理由（任意）").fill("E2E 研修");
    await page.getByRole("button", { name: "登録", exact: true }).click();
    await expect(page.getByText("E2E 研修")).toBeVisible();
    await endDemo(page);
  });
});
