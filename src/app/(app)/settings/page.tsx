import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { BookingRulesForm } from "@/components/settings/booking-rules-form";
import { BusinessHoursForm } from "@/components/settings/business-hours-form";
import { LocationInfoForm } from "@/components/settings/location-info-form";
import { SegmentRulesForm } from "@/components/settings/segment-rules-form";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requirePermission } from "@/lib/auth";
import { getSegmentRules } from "@/lib/data/customers";
import { getLocationSettings } from "@/lib/data/settings";
import { asUser } from "@/lib/db";
import { serverEnv } from "@/lib/env";

export const metadata: Metadata = { title: "店舗設定" };

export default async function SettingsPage() {
  const ctx = await requirePermission("settings.manage");
  const [settings, segments] = await asUser(ctx.userId, (tx) => Promise.all([getLocationSettings(tx, ctx.location.id), getSegmentRules(tx, ctx.location.id)]));
  if (!settings) notFound();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="店舗設定" description={`${settings.location.name} の基本情報・営業時間・予約受付のルール・顧客セグメントの基準を設定します。`} />
      <Tabs defaultValue="info">
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="info">店舗情報</TabsTrigger>
          <TabsTrigger value="hours">営業時間・定休日</TabsTrigger>
          <TabsTrigger value="rules">予約受付・キャンセル</TabsTrigger>
          <TabsTrigger value="segments">顧客セグメント</TabsTrigger>
        </TabsList>
        <TabsContent value="info"><LocationInfoForm initial={settings.location} /></TabsContent>
        <TabsContent value="hours"><BusinessHoursForm initial={settings.hours} /></TabsContent>
        <TabsContent value="rules" className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 text-sm">
            <div className="min-w-0">
              <p className="font-medium">公開予約ページの URL</p>
              <p className="mt-0.5 break-all text-muted-foreground tabular">{`${serverEnv.appUrl}/book/${ctx.location.slug}`}</p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/book/${ctx.location.slug}`} target="_blank" rel="noopener"><ExternalLink aria-hidden />開く</Link>
            </Button>
          </div>
          <BookingRulesForm initial={settings.rules} />
        </TabsContent>
        <TabsContent value="segments"><SegmentRulesForm initial={segments} /></TabsContent>
      </Tabs>
    </div>
  );
}
