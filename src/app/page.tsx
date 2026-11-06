import Link from "next/link";
import { CalendarCheck2, ChartColumn, Clock3, Dumbbell, HandHeart, ShieldCheck, Scissors, Sparkles, Building } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { DemoStartButton } from "@/components/marketing/demo-start";
import { Button } from "@/components/ui/button";

const DEMOS = [
  { industry: "beauty_salon", icon: Scissors, title: "美容室", text: "スタイリスト5名・カット／カラーなど8メニュー", slug: "demo-salon" },
  { industry: "chiropractic", icon: HandHeart, title: "整体院", text: "施術者3名・ベッド2台（設備の空きも判定）", slug: "demo-seitai" },
  { industry: "personal_gym", icon: Dumbbell, title: "パーソナルジム", text: "トレーナー指名必須・ブース3室", slug: "demo-gym" },
  { industry: "rental_space", icon: Building, title: "レンタルスペース", text: "担当者なし・部屋単位の時間貸し", slug: "demo-space" },
];

const FEATURES = [
  { icon: CalendarCheck2, title: "予約カレンダー", text: "月・週・日・スタッフ別。ドラッグで日時変更。同じ時間の二重予約はデータベースが拒否します。" },
  { icon: Sparkles, title: "スマート空き枠提案", text: "勤務・休憩・設備・前後の準備時間を考えて、隙間を作りにくい予約枠を理由つきで提案します。" },
  { icon: ChartColumn, title: "無断キャンセル・リピート分析", text: "対象期間と母数を明示した計算で、曜日・時間帯・サービス別の傾向を実データから示します。" },
  { icon: Clock3, title: "公開予約ページ", text: "お客様はスマートフォンから24時間予約。変更・キャンセルは推測できない専用リンクで。" },
  { icon: ShieldCheck, title: "テナント分離と権限", text: "企業ごとのデータは RLS で分離。オーナー・マネージャー・スタッフの権限を画面・サーバー・DB で判定。" },
];

export default function Home() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Logo />
        <Button asChild variant="outline"><Link href="/login">ログイン</Link></Button>
      </header>
      <main>
        <section className="mx-auto max-w-6xl px-4 pt-10 pb-14 sm:px-6 sm:pt-16">
          <p className="text-sm font-semibold text-brand">中小店舗のためのクラウド予約・顧客管理</p>
          <h1 className="text-keep mt-3 text-3xl font-bold tracking-tight sm:text-5xl">
            予約管理をシンプルに。<br />店舗経営をスマートに。
          </h1>
          <p className="text-keep mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg">
            ReserveFlow は、美容室・整体院・パーソナルジム・レンタルスペースなど、業種を問わず使える予約管理システムです。
            業種ごとの違いは設定とデータで表すので、同じ仕組みでさまざまなお店に導入できます。
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <DemoStartButton label="登録なしでデモを試す" />
          </div>
        </section>

        <section id="demo" className="border-y bg-card">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
            <h2 className="text-xl font-bold sm:text-2xl">業種を選んでデモを始める</h2>
            <p className="text-keep mt-2 text-sm text-muted-foreground">
              あなた専用の4店舗（約6か月分の予約・顧客データ）を作ります。予約の作成・変更・キャンセルを自由に試せ、ほかの人には影響しません。データは24時間後に自動で削除されます。
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {DEMOS.map((d) => (
                <div key={d.industry} className="flex flex-col gap-3 rounded-xl border bg-background p-5">
                  <d.icon className="size-6 text-brand" aria-hidden />
                  <div>
                    <h3 className="font-semibold">{d.title}</h3>
                    <p className="text-keep mt-1 text-sm text-muted-foreground">{d.text}</p>
                  </div>
                  <div className="mt-auto grid gap-2">
                    <DemoStartButton industry={d.industry} label={`${d.title}で試す`} variant="outline" />
                    <Link href={`/book/${d.slug}`} className="text-center text-xs font-medium text-brand hover:underline">お客様側の予約ページを見る</Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="text-xl font-bold sm:text-2xl">主な機能</h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-brand"><f.icon className="size-5" aria-hidden /></span>
                <div>
                  <h3 className="font-semibold">{f.title}</h3>
                  <p className="text-keep mt-1 text-sm text-muted-foreground">{f.text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        ReserveFlow — ポートフォリオ作品。掲載している店舗・人物・予約はすべて架空のデータです。
      </footer>
    </div>
  );
}
