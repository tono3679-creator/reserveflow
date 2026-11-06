import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { asUser, type Tx } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { LOCATION_COOKIE } from "./cookies";
import { can, type MemberRole, type Permission } from "./roles";
import { readSession } from "./session";
import { supabaseUserId } from "./supabase";

export type LocationRef = {
  id: string;
  organizationId: string;
  organizationName: string;
  name: string;
  slug: string;
  industry: string;
  timezone: string;
  role: MemberRole;
  memberId: string;
  displayName: string;
  isDemo: boolean;
};

export type AppContext = {
  userId: string;
  isAnonymous: boolean;
  displayName: string;
  /** 利用できる店舗（所属する企業の店舗すべて） */
  locations: LocationRef[];
  /** 選択中の店舗 */
  location: LocationRef;
  role: MemberRole;
  organizationId: string;
  memberId: string;
  /** ログイン中の利用者に結び付いたスタッフ（staff の「自分の予約」の判定） */
  staffIds: string[];
  isDemo: boolean;
};

/** ログイン中の利用者 ID（アプリのセッション → Supabase Auth の順に確かめる） */
export const getAuthUser = cache(async (): Promise<{ id: string; isAnonymous: boolean } | null> => {
  const session = await readSession();
  if (session) return session;
  if (serverEnv.authProvider === "supabase") {
    const id = await supabaseUserId();
    if (id) return { id, isAnonymous: false };
  }
  return null;
});

async function loadLocations(tx: Tx, userId: string): Promise<{ locations: LocationRef[]; staffIds: string[] }> {
  const rows = await tx<{
    id: string; organization_id: string; organization_name: string; name: string; slug: string; industry: string;
    timezone: string; role: MemberRole; member_id: string; display_name: string; is_demo: boolean;
  }[]>`
    select l.id, l.organization_id, o.name organization_name, l.name, l.slug, l.industry, l.timezone,
           m.role, m.id member_id, m.display_name, o.is_demo
      from public.organization_members m
      join public.organizations o on o.id = m.organization_id
      join public.locations l on l.organization_id = o.id and l.is_active
     where m.user_id = ${userId} and m.is_active
     order by o.created_at, o.name, l.created_at, l.name`;
  const staff = await tx<{ id: string }[]>`select unnest(app_private.my_staff_ids()) id`;
  return {
    locations: rows.map((r) => ({
      id: r.id, organizationId: r.organization_id, organizationName: r.organization_name, name: r.name, slug: r.slug,
      industry: r.industry, timezone: r.timezone, role: r.role, memberId: r.member_id, displayName: r.display_name, isDemo: r.is_demo,
    })),
    staffIds: staff.map((s) => s.id),
  };
}

/** ログイン中の利用者と選択中の店舗（未ログイン・所属なしなら null） */
export const getContext = cache(async (): Promise<AppContext | null> => {
  const auth = await getAuthUser();
  if (!auth) return null;
  const { locations, staffIds } = await asUser(auth.id, (tx) => loadLocations(tx, auth.id));
  if (locations.length === 0) return null;
  const selected = (await cookies()).get(LOCATION_COOKIE)?.value;
  const location = locations.find((l) => l.id === selected) ?? locations[0];
  return {
    userId: auth.id,
    isAnonymous: auth.isAnonymous,
    displayName: location.displayName,
    locations,
    location,
    role: location.role,
    organizationId: location.organizationId,
    memberId: location.memberId,
    staffIds,
    isDemo: location.isDemo,
  };
});

/** 画面用：ログインしていなければログイン画面へ */
export async function requireContext(): Promise<AppContext> {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/** 画面用：権限がなければダッシュボードへ（URL を直接開いた場合も表示しない） */
export async function requirePermission(permission: Permission): Promise<AppContext> {
  const ctx = await requireContext();
  if (!can(ctx.role, permission)) redirect("/dashboard?denied=1");
  return ctx;
}

export class AuthError extends Error {
  constructor(message: string, readonly status: 401 | 403) {
    super(message);
  }
}

/** Server Actions・Route Handler 用：権限がなければ例外（画面遷移はしない） */
export async function authorize(permission?: Permission): Promise<AppContext> {
  const ctx = await getContext();
  if (!ctx) throw new AuthError("ログインしてください", 401);
  if (permission && !can(ctx.role, permission)) throw new AuthError("この操作を行う権限がありません", 403);
  return ctx;
}

/** 権限を確かめてから、ログイン利用者の権限（RLS）で DB を操作する */
export async function withAuth<T>(permission: Permission | undefined, fn: (tx: Tx, ctx: AppContext) => Promise<T>): Promise<T> {
  const ctx = await authorize(permission);
  return asUser(ctx.userId, (tx) => fn(tx, ctx));
}
