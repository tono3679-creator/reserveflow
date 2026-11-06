import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ReserveFlow", template: "%s | ReserveFlow" },
  description: "予約管理をシンプルに。店舗経営をスマートに。美容室・整体院・パーソナルジム・レンタルスペースで使えるクラウド予約・顧客管理システム。",
};

export const viewport: Viewport = {
  themeColor: "#1b2440",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // 毎回サーバーで描画する（ログイン状態で内容が変わり、CSP の nonce をスクリプトに付けるため）
  await connection();
  return (
    <html lang="ja">
      <body>
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        <Toaster />
      </body>
    </html>
  );
}
