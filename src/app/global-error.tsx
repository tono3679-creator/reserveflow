"use client";
import "./globals.css";

/**
 * ルートのレイアウト自体が表示できないときの画面（通常は使われない）。
 * レイアウトの代わりに表示されるため、html・body とスタイルをここで読み込む。
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error && typeof error === "object" && "digest" in error && typeof error.digest === "string" ? error.digest : null;
  return (
    <html lang="ja">
      <body>
        <title>エラー | ReserveFlow</title>
        <main className="flex min-h-dvh items-center justify-center px-4">
          <div role="alert" className="flex max-w-md flex-col items-center gap-3 rounded-xl border bg-card px-6 py-12 text-center">
            <h1 className="text-lg font-semibold">画面を表示できませんでした</h1>
            <p className="text-keep text-sm text-muted-foreground">
              一時的な問題の可能性があります。時間をおいてから、もう一度お試しください。
            </p>
            {digest && <p className="text-xs text-muted-foreground">エラーID：{digest}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => retry()}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                もう一度読み込む
              </button>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- ルートのレイアウトが壊れているときは通常の遷移で読み込み直す */}
              <a href="/" className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">トップへ戻る</a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
