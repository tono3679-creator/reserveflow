import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { BookingRulesForm } from "@/components/settings/booking-rules-form";
import { BusinessHoursForm } from "@/components/settings/business-hours-form";
import { LocationInfoForm } from "@/components/settings/location-info-form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requirePermission } from "@/lib/auth";
import { getLocationSettings } from "@/lib/data/settings";
import { asUser } from "@/lib/db";

export const metadata: Metadata = { title: "店舗設定" };

export default async function SettingsPage() {
  const ctx = await requirePermission("settings.manage");
  const settings = await asUser(ctx.userId, (tx) => getLocationSettings(tx, ctx.location.id));
  if (!settings) notFound();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="店舗設定" description={`${settings.location.name} の基本情報・営業時間・予約受付のルールを設定します。`} />
      <Tabs defaultValue="info">
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="info">店舗情報</TabsTrigger>
          <TabsTrigger value="hours">営業時間・定休日</TabsTrigger>
          <TabsTrigger value="rules">予約受付・キャンセル</TabsTrigger>
        </TabsList>
        <TabsContent value="info"><LocationInfoForm initial={settings.location} /></TabsContent>
        <TabsContent value="hours"><BusinessHoursForm initial={settings.hours} /></TabsContent>
        <TabsContent value="rules"><BookingRulesForm initial={settings.rules} /></TabsContent>
      </Tabs>
    </div>
  );
}
