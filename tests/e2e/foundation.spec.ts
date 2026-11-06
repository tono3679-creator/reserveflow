import { expect, test } from "@playwright/test";
import { endDemo, startDemo, switchRole } from "./helpers";

test.describe("基盤：デモ・権限・店舗設定", () => {
  test("デモを始めると、自分専用の4店舗を切り替えられる", async ({ page }) => {
    await startDemo(page);
    await expect(page.getByText("デモ環境（オーナーとして表示中）")).toBeVisible();
    await page.getByRole("button", { name: "店舗を切り替える" }).click();
    const items = page.getByRole("menuitem");
    await expect(items).toHaveCount(4);
    await page.getByRole("menuitem", { name: /BODY CRAFT GYM/ }).click();
    await expect(page.getByRole("button", { name: "店舗を切り替える" })).toContainText("BODY CRAFT GYM");
    await endDemo(page);
  });

  test("店舗設定を変更すると保存され、再読み込みしても残る", async ({ page }) => {
    await startDemo(page);
    await page.getByRole("link", { name: "店舗設定" }).click();
    await page.getByLabel("店舗名").fill("Hair Salon LUMIÈRE 表参道 本店");
    await page.getByRole("button", { name: "保存する" }).click();
    await expect(page.getByText("店舗情報を保存しました")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("店舗名")).toHaveValue("Hair Salon LUMIÈRE 表参道 本店");

    await page.getByRole("tab", { name: "営業時間・定休日" }).click();
    await page.getByLabel("火曜日に営業する").click();
    await page.getByRole("button", { name: "保存する" }).click();
    await expect(page.getByText("営業時間を保存しました")).toBeVisible();
    await page.reload();
    await page.getByRole("tab", { name: "営業時間・定休日" }).click();
    await expect(page.getByLabel("火曜日に営業する")).toHaveAttribute("aria-checked", "false");

    await page.getByRole("tab", { name: "予約受付・キャンセル" }).click();
    await page.getByLabel("何日先まで予約できるか").fill("0");
    await page.getByRole("button", { name: "保存する" }).click();
    await expect(page.getByText("1日以上にしてください")).toBeVisible();
    await endDemo(page);
  });

  test("スタッフの立場では、権限のない画面はメニューに出ず、URL を開いても表示されない", async ({ page }) => {
    await startDemo(page);
    await switchRole(page, "スタッフ");
    await expect(page.getByRole("link", { name: "店舗設定" })).toHaveCount(0);
    await page.goto("/settings");
    await page.waitForURL("**/dashboard?denied=1");
    await expect(page.getByText("今の立場（役割）では利用できません")).toBeVisible();
    await switchRole(page, "マネージャー");
    await expect(page.getByRole("link", { name: "店舗設定" })).toHaveCount(0);
    await switchRole(page, "オーナー");
    await expect(page.getByRole("link", { name: "店舗設定" })).toBeVisible();
    await endDemo(page);
  });

  test("ログインしていなければ管理画面はログイン画面へ移る", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("メールアドレス").fill("owner@reserveflow.example");
    await page.getByLabel("パスワード").fill("wrong-password");
    await page.getByRole("button", { name: "ログイン" }).click();
    await expect(page.getByText("メールアドレスまたはパスワードが正しくありません。")).toBeVisible();
  });

  test("スマートフォンではメニューがドロワーになる @mobile", async ({ page }) => {
    await startDemo(page);
    await expect(page.getByRole("navigation", { name: "メインメニュー" })).toBeHidden();
    await page.getByRole("button", { name: "メニューを開く" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "店舗設定" }).click();
    await expect(page.getByRole("heading", { name: "店舗設定", level: 1 })).toBeVisible();
    await endDemo(page);
  });
});

test("見本の企業にログインして、テナント（企業）をまたいで店舗を切り替えられる", async ({ page }) => {
  const password = process.env.E2E_LOGIN_PASSWORD;
  test.skip(!password, "E2E_LOGIN_PASSWORD（db:seed の SEED_LOGIN_PASSWORD と同じ値）を渡したときだけ実行する");
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill("owner@reserveflow.example");
  await page.getByLabel("パスワード").fill(password!);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL("**/dashboard");
  await page.getByRole("button", { name: "店舗を切り替える" }).click();
  await page.getByRole("menuitem", { name: /シェアスペース ソラ/ }).click();
  await expect(page.getByRole("button", { name: "店舗を切り替える" })).toContainText("シェアスペース ソラ");
  await expect(page.locator("aside")).toContainText("ソラスペース株式会社");
  await page.getByRole("button", { name: "ユーザーメニュー" }).click();
  await page.getByRole("menuitem", { name: "ログアウト" }).click();
  await page.waitForURL("**/login");
});
