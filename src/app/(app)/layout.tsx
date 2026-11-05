import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { DemoBanner } from "@/components/layout/demo-banner";
import { requireContext } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { formatDateLong } from "@/lib/format";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  return (
    <div className="min-h-dvh">
      <Sidebar role={ctx.role} organizationName={ctx.location.organizationName} />
      <div className="flex min-h-dvh flex-col lg:pl-64">
        {ctx.isDemo && <DemoBanner role={ctx.role} />}
        <Header
          role={ctx.role}
          displayName={ctx.displayName}
          organizationName={ctx.location.organizationName}
          isDemo={ctx.isDemo}
          currentLocationId={ctx.location.id}
          today={formatDateLong(new Date(), ctx.location.timezone)}
          locations={ctx.locations.map((l) => ({
            id: l.id, name: l.name, industry: l.industry, organizationName: l.organizationName, roleLabel: ROLE_LABELS[l.role],
          }))}
        />
        <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-5 sm:px-6 sm:py-6">{children}</main>
      </div>
    </div>
  );
}
