/**
 * デモ・見本の店舗データを「今」を基準に作る（純粋な関数。DB への書き込みは insert.ts）。
 *
 * 再現する特徴
 *   * 約6か月の過去と3週間先までの予約。月ごとの増減（季節・緩やかな成長）と曜日・時間帯の偏り
 *   * 新規客と、来店間隔の違うリピーター（一度きり／通常／高頻度）
 *   * 無断キャンセル（夕方・早朝や初回の客で起きやすい）・顧客キャンセル・店舗キャンセル
 *   * スタッフの勤務時間・休憩・休暇、設備の数を守り、同じ人・設備の時間が重ならない
 *   * 先の日付ほど予約が埋まっていない（空き枠提案を試せる）
 */
import { randomUUID } from "node:crypto";
import type { LocationBlueprint, ServiceBlueprint, StaffBlueprint } from "./blueprints";
import { createRng, pick, randomInt, shuffle, weightedPick } from "./random";
import { addDays, localDate, toMinutes, weekdayOf, zonedDateTime } from "@/lib/time";

type BookingStatus = "confirmed" | "checked_in" | "completed" | "cancelled_customer" | "cancelled_store" | "no_show";

export type Dataset = {
  organization: { id: string; name: string };
  location: { id: string; name: string; slug: string; industry: string; phone: string; email: string; address: string; timezone: string };
  settings: { staffSelection: LocationBlueprint["staffSelection"]; slotInterval: number; cancellationPolicy: string };
  hours: { weekday: number; opens: string; closes: string }[];
  exceptions: { date: string; note: string }[];
  staff: { id: string; key: string; name: string; title: string; color: string; sortOrder: number; email: string }[];
  schedules: { staffId: string; weekday: number; start: string; end: string; breakStart: string | null; breakEnd: string | null }[];
  timeOff: { staffId: string; date: string; reason: string }[];
  services: { id: string; key: string; bp: ServiceBlueprint; sortOrder: number }[];
  serviceStaff: { serviceId: string; staffId: string }[];
  resources: { id: string; key: string; name: string; kind: string; sortOrder: number }[];
  serviceResources: { serviceId: string; resourceId: string }[];
  customers: { id: string; name: string; kana: string; phone: string; email: string; createdAt: Date; preferredStaffId: string | null }[];
  bookings: {
    id: string; customerId: string; serviceId: string; staffId: string | null; resourceId: string | null;
    startsAt: Date; endsAt: Date; bufferBefore: number; bufferAfter: number; price: number; status: BookingStatus;
    createdAt: Date; cancelledAt: Date | null; cancelReason: string | null; notes: string | null; source: "admin" | "public";
    history: { from: BookingStatus | null; to: BookingStatus; at: Date; reason: string | null }[];
  }[];
  notes: { customerId: string; body: string; createdAt: Date }[];
};

const SURNAMES: [string, string][] = [
  ["青木", "アオキ"], ["石川", "イシカワ"], ["上田", "ウエダ"], ["遠藤", "エンドウ"], ["大野", "オオノ"], ["岡田", "オカダ"],
  ["小川", "オガワ"], ["金子", "カネコ"], ["菊地", "キクチ"], ["工藤", "クドウ"], ["近藤", "コンドウ"], ["斉藤", "サイトウ"],
  ["坂本", "サカモト"], ["清水", "シミズ"], ["鈴木", "スズキ"], ["高木", "タカギ"], ["竹内", "タケウチ"], ["千葉", "チバ"],
  ["土屋", "ツチヤ"], ["中島", "ナカジマ"], ["西村", "ニシムラ"], ["野口", "ノグチ"], ["橋本", "ハシモト"], ["原田", "ハラダ"],
  ["福田", "フクダ"], ["藤井", "フジイ"], ["前田", "マエダ"], ["松井", "マツイ"], ["三浦", "ミウラ"], ["村上", "ムラカミ"],
  ["森", "モリ"], ["安田", "ヤスダ"], ["横山", "ヨコヤマ"], ["和田", "ワダ"], ["今井", "イマイ"], ["河野", "コウノ"],
  ["杉山", "スギヤマ"], ["平野", "ヒラノ"], ["宮崎", "ミヤザキ"], ["内田", "ウチダ"],
];
const GIVEN: [string, string][] = [
  ["陽菜", "ヒナ"], ["結衣", "ユイ"], ["美月", "ミヅキ"], ["葵", "アオイ"], ["花子", "ハナコ"], ["真央", "マオ"],
  ["彩花", "アヤカ"], ["奈々", "ナナ"], ["恵", "メグミ"], ["裕子", "ユウコ"], ["智美", "トモミ"], ["麻衣", "マイ"],
  ["由紀", "ユキ"], ["千尋", "チヒロ"], ["遥", "ハルカ"], ["舞", "マイ"], ["蓮", "レン"], ["悠真", "ユウマ"],
  ["大翔", "ヒロト"], ["湊", "ミナト"], ["翔太", "ショウタ"], ["健一", "ケンイチ"], ["直樹", "ナオキ"], ["拓海", "タクミ"],
  ["和也", "カズヤ"], ["亮介", "リョウスケ"], ["俊介", "シュンスケ"], ["隆", "タカシ"], ["浩二", "コウジ"], ["誠", "マコト"],
  ["さくら", "サクラ"], ["彩", "アヤ"], ["莉子", "リコ"], ["美咲", "ミサキ"], ["優奈", "ユウナ"], ["健太", "ケンタ"],
];

const NOTE_TEMPLATES: Record<string, string[]> = {
  beauty_salon: ["明るめのアッシュ系が好み。前回は8トーン。", "頭皮が敏感なのでカラー剤は低刺激のものを使用。", "前髪は眉上で短めが希望。", "会話は少なめが落ち着くとのこと。", "結婚式の前に来店予定（来月）。"],
  chiropractic: ["デスクワークで右肩の張りが強い。", "腰痛（L4付近）。強い圧は避ける。", "産後3か月。骨盤矯正を継続希望。", "ゴルフを再開したいとのこと。", "次回は首まわりを重点的に。"],
  personal_gym: ["目標：3か月で−5kg。食事記録アプリ利用中。", "膝に古傷あり。スクワットは浅めから。", "朝の時間帯を希望することが多い。", "ベンチプレス 40kg×8回（前回）。", "大会出場を検討中。"],
  rental_space: ["毎月第2土曜にワークショップで利用。", "プロジェクターの利用あり。", "撮影で利用。機材の搬入は15分前から。", "法人利用。請求書払いを希望。", "子ども連れの利用が多い。"],
};

const TIMEZONE = "Asia/Tokyo";
const PAST_DAYS = 185;
const FUTURE_DAYS = 21;

function seasonality(month: number): number {
  // 1〜12月の増減（年末・春に多く、2月と8月に少ない）
  return [0.85, 0.78, 1.05, 1.08, 1, 0.95, 1, 0.82, 0.95, 1, 1.05, 1.25][month - 1];
}

type Interval = [number, number];
const overlaps = (list: Interval[] | undefined, [s, e]: Interval) => !!list?.some(([a, b]) => s < b && a < e);

function staffWorks(staff: StaffBlueprint, weekday: number, startMin: number, endMin: number): boolean {
  if (!staff.days.includes(weekday)) return false;
  if (startMin < toMinutes(staff.start) || endMin > toMinutes(staff.end)) return false;
  if (staff.breakStart && staff.breakEnd && startMin < toMinutes(staff.breakEnd) && toMinutes(staff.breakStart) < endMin) return false;
  return true;
}

type CustomerState = {
  index: number;
  kind: "once" | "regular" | "frequent";
  visits: number;
  nextEligible: string | null;
  staffCount: Map<string, number>;
  firstAt: Date | null;
};

export function generateDataset(bp: LocationBlueprint, options: { now: Date; seed: number; slug: string; organizationName?: string }): Dataset {
  const rng = createRng(options.seed);
  const now = options.now;
  const today = localDate(now, TIMEZONE);
  const id = () => randomUUID();

  const organization = { id: id(), name: options.organizationName ?? bp.organizationName };
  const location = {
    id: id(), name: bp.locationName, slug: options.slug, industry: bp.industry, phone: bp.phone, email: bp.email,
    address: bp.address, timezone: TIMEZONE,
  };
  const hours = Object.entries(bp.hours).map(([weekday, range]) => ({ weekday: Number(weekday), opens: range![0], closes: range![1] }));

  const staff = bp.staff.map((s, i) => ({
    id: id(), key: s.key, name: s.name, title: s.title, color: s.color, sortOrder: i,
    email: `${s.key}.${options.slug}@reserveflow.example`,
  }));
  const staffIdByKey = new Map(staff.map((s) => [s.key, s.id]));
  const schedules = bp.staff.flatMap((s) =>
    s.days.map((weekday) => ({
      staffId: staffIdByKey.get(s.key)!, weekday, start: s.start, end: s.end,
      breakStart: s.breakStart ?? null, breakEnd: s.breakEnd ?? null,
    })),
  );

  // 休暇：過去と先の日付に、各スタッフ数日ずつ
  const timeOff: Dataset["timeOff"] = [];
  const offSet = new Set<string>();
  for (const s of bp.staff) {
    for (let n = 0; n < 4; n++) {
      const offset = n === 0 ? randomInt(rng, 3, FUTURE_DAYS - 2) : randomInt(rng, -PAST_DAYS + 5, -2);
      const date = addDays(today, offset);
      if (!s.days.includes(weekdayOf(date)) || offSet.has(`${s.key}:${date}`)) continue;
      offSet.add(`${s.key}:${date}`);
      timeOff.push({ staffId: staffIdByKey.get(s.key)!, date, reason: pick(rng, ["私用のため休み", "研修", "通院", "有給休暇"]) });
    }
  }

  // 臨時休業：約2週間後の営業日に1日（見本として。予約は入れない）
  const exceptions: Dataset["exceptions"] = [];
  for (let offset = 12; offset < FUTURE_DAYS; offset++) {
    const date = addDays(today, offset);
    if (bp.hours[weekdayOf(date)]) {
      exceptions.push({ date, note: "設備点検のため臨時休業" });
      break;
    }
  }
  const closed = new Set(exceptions.map((e) => e.date));

  const services = bp.services.map((s, i) => ({ id: id(), key: s.key, bp: s, sortOrder: i }));
  const resources = bp.resources.map((r, i) => ({ id: id(), key: r.key, name: r.name, kind: r.kind, sortOrder: i }));
  const resourceIdByKey = new Map(resources.map((r) => [r.key, r.id]));
  const serviceStaff = bp.staffSelection === "none" ? [] : services.flatMap((s) =>
    (s.bp.staff ?? bp.staff.map((st) => st.key)).map((key) => ({ serviceId: s.id, staffId: staffIdByKey.get(key)! })),
  );
  const serviceResources = services.flatMap((s) => (s.bp.resources ?? []).map((key) => ({ serviceId: s.id, resourceId: resourceIdByKey.get(key)! })));

  // 顧客
  const customers: Dataset["customers"] = [];
  const usedNames = new Set<string>();
  while (customers.length < bp.customers) {
    const [sn, snk] = pick(rng, SURNAMES);
    const [gn, gnk] = pick(rng, GIVEN);
    const name = `${sn} ${gn}`;
    if (usedNames.has(name)) continue;
    usedNames.add(name);
    const n = customers.length;
    customers.push({
      id: id(), name, kana: `${snk} ${gnk}`,
      phone: `090-0000-${String(1000 + n + (options.seed % 7) * 1000).slice(-4)}`,
      email: `guest${String(n + 1).padStart(3, "0")}.${bp.industry.replace("_", "")}@example.com`,
      createdAt: now, preferredStaffId: null,
    });
  }
  const states: CustomerState[] = customers.map((_, index) => {
    const r = rng();
    return { index, kind: r < 0.3 ? "once" : r < 0.78 ? "regular" : "frequent", visits: 0, nextEligible: null, staffCount: new Map(), firstAt: null };
  });
  let nextNew = 0;
  // 一部の顧客は登録だけで来店がない（問い合わせ・キャンセルのみ）
  const reservedNoVisit = Math.round(bp.customers * 0.04);
  const newLimit = bp.customers - reservedNoVisit;

  const pickCustomer = (date: string, isFuture: boolean): CustomerState => {
    const eligible = states.filter((s) => s.visits > 0 && s.nextEligible !== null && s.nextEligible <= date && !(s.kind === "once" && s.visits >= 1));
    const wantNew = rng() < (isFuture ? 0.18 : 0.27) || eligible.length === 0;
    if (wantNew && nextNew < newLimit) return states[nextNew++];
    if (eligible.length > 0) return weightedPick(rng, eligible, (s) => (s.kind === "frequent" ? 3 : 1.5))!;
    return states[randomInt(rng, 0, Math.max(0, nextNew - 1))];
  };

  // 日ごとの予約数の目安
  const days: { date: string; offset: number; weight: number }[] = [];
  for (let offset = -PAST_DAYS; offset <= FUTURE_DAYS; offset++) {
    const date = addDays(today, offset);
    const weekday = weekdayOf(date);
    if (!bp.hours[weekday] || closed.has(date)) continue;
    const month = Number(date.slice(5, 7));
    const trend = 0.85 + 0.3 * ((offset + PAST_DAYS) / (PAST_DAYS + FUTURE_DAYS)); // 緩やかに伸びている
    const ahead = offset > 0 ? Math.max(0.12, 1 - offset / (FUTURE_DAYS + 4)) : 1; // 先ほど埋まっていない
    days.push({ date, offset, weight: bp.weekdayWeights[weekday] * seasonality(month) * trend * ahead });
  }
  const totalWeight = days.reduce((s, d) => s + d.weight, 0);

  const bookings: Dataset["bookings"] = [];
  const hourKeys = Object.keys(bp.hourWeights).map(Number);
  for (const day of days) {
    const weekday = weekdayOf(day.date);
    const [open, close] = bp.hours[weekday]!;
    const openMin = toMinutes(open);
    const closeMin = toMinutes(close);
    const mean = (bp.bookings * day.weight) / totalWeight;
    const count = Math.max(0, Math.round(mean + (rng() - 0.5) * Math.min(3, mean)));
    const staffBusy = new Map<string, Interval[]>();
    const resourceBusy = new Map<string, Interval[]>();

    for (let n = 0; n < count; n++) {
      for (let attempt = 0; attempt < 12; attempt++) {
        const service = weightedPick(rng, services, (s) => s.bp.popularity)!;
        const hour = weightedPick(rng, hourKeys, (h) => bp.hourWeights[h])!;
        const minute = bp.slotInterval === 60 ? 0 : pick(rng, bp.slotInterval === 15 ? [0, 15, 30, 45] : [0, 30]);
        const startMin = hour * 60 + minute;
        const endMin = startMin + service.bp.duration;
        const before = service.bp.bufferBefore ?? 0;
        const after = service.bp.bufferAfter ?? 0;
        if (startMin < openMin || endMin > closeMin) continue;
        const occupied: Interval = [startMin - before, endMin + after];

        let staffKey: string | null = null;
        if (bp.staffSelection !== "none") {
          const candidates = shuffle(rng, bp.staff.filter((s) => !service.bp.staff || service.bp.staff.includes(s.key)));
          const free = candidates.find((s) =>
            staffWorks(s, weekday, startMin, endMin) && !offSet.has(`${s.key}:${day.date}`) && !overlaps(staffBusy.get(s.key), occupied));
          if (!free) continue;
          staffKey = free.key;
        }
        let resourceKey: string | null = null;
        if (service.bp.resources?.length) {
          const free = shuffle(rng, service.bp.resources).find((key) => !overlaps(resourceBusy.get(key), occupied));
          if (!free) continue;
          resourceKey = free;
        }

        const startsAt = zonedDateTime(day.date, `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, TIMEZONE);
        const endsAt = new Date(startsAt.getTime() + service.bp.duration * 60_000);
        const isFuture = startsAt > now;
        const customer = pickCustomer(day.date, isFuture);
        const firstVisit = customer.visits === 0;

        // 予約を受けた日時：過去の予約は 0〜21 日前、先の予約は今日まで
        const leadDays = randomInt(rng, 0, 21);
        let createdAt = new Date(startsAt.getTime() - leadDays * 86_400_000 - randomInt(rng, 1, 600) * 60_000);
        if (createdAt > now) createdAt = new Date(now.getTime() - randomInt(rng, 5, 60 * 24 * 10) * 60_000);
        if (createdAt >= startsAt) createdAt = new Date(startsAt.getTime() - 3_600_000);

        // 結果のステータス
        let status: BookingStatus;
        const r = rng();
        if (endsAt <= now) {
          const noShow = bp.noShowBase * (bp.noShowByHour[hour] ?? 1) * (firstVisit ? 1.7 : 1) * (weekday === 1 ? 1.2 : 1);
          status = r < noShow ? "no_show" : r < noShow + 0.065 ? "cancelled_customer" : r < noShow + 0.073 ? "cancelled_store" : "completed";
        } else if (startsAt <= now) {
          status = "checked_in";
        } else {
          status = r < 0.045 ? "cancelled_customer" : "confirmed";
        }
        const cancelled = status === "cancelled_customer" || status === "cancelled_store";
        const cancelledAt = cancelled
          ? new Date(Math.min(now.getTime() - 60_000, createdAt.getTime() + rng() * (startsAt.getTime() - createdAt.getTime())))
          : null;
        if (cancelledAt && cancelledAt <= createdAt) cancelledAt.setTime(createdAt.getTime() + 60_000);
        const cancelReason = status === "cancelled_customer"
          ? pick(rng, ["体調不良のため", "仕事の都合", "日程変更のため", "家族の用事"])
          : status === "cancelled_store" ? pick(rng, ["担当スタッフの急病", "設備の不具合"]) : null;

        const history: Dataset["bookings"][number]["history"] = [{ from: null, to: "confirmed", at: createdAt, reason: null }];
        if (status === "checked_in") history.push({ from: "confirmed", to: "checked_in", at: new Date(startsAt.getTime() - 5 * 60_000), reason: null });
        if (status === "completed") {
          history.push({ from: "confirmed", to: "checked_in", at: new Date(startsAt.getTime() - randomInt(rng, 0, 10) * 60_000), reason: null });
          history.push({ from: "checked_in", to: "completed", at: endsAt, reason: null });
        }
        if (status === "no_show") history.push({ from: "confirmed", to: "no_show", at: new Date(startsAt.getTime() + 30 * 60_000), reason: "連絡なし" });
        if (cancelled) history.push({ from: "confirmed", to: status, at: cancelledAt!, reason: cancelReason });

        bookings.push({
          id: id(), customerId: customers[customer.index].id, serviceId: service.id,
          staffId: staffKey ? staffIdByKey.get(staffKey)! : null, resourceId: resourceKey ? resourceIdByKey.get(resourceKey)! : null,
          startsAt, endsAt, bufferBefore: before, bufferAfter: after, price: service.bp.price, status, createdAt,
          cancelledAt, cancelReason, notes: rng() < 0.06 ? pick(rng, ["前回と同じ内容で", "駐車場利用あり", "少し遅れる可能性あり"]) : null,
          source: rng() < 0.55 ? "public" : "admin", history,
        });

        if (!cancelled) {
          if (staffKey) staffBusy.set(staffKey, [...(staffBusy.get(staffKey) ?? []), occupied]);
          if (resourceKey) resourceBusy.set(resourceKey, [...(resourceBusy.get(resourceKey) ?? []), occupied]);
        }
        customer.visits++;
        if (!customer.firstAt || createdAt < customer.firstAt) customer.firstAt = createdAt;
        if (staffKey) customer.staffCount.set(staffKey, (customer.staffCount.get(staffKey) ?? 0) + 1);
        const interval = customer.kind === "frequent" ? randomInt(rng, 10, 28) : randomInt(rng, 28, 70);
        customer.nextEligible = addDays(day.date, interval);
        break;
      }
    }
  }

  // 顧客の登録日（初回の予約を受けた日。来店のない顧客は過去のどこか）と担当スタッフ（最も多く担当した人）
  for (const state of states) {
    const c = customers[state.index];
    c.createdAt = state.firstAt ?? new Date(now.getTime() - randomInt(rng, 1, PAST_DAYS) * 86_400_000);
    let best: string | null = null;
    let bestCount = 1;
    for (const [key, count] of state.staffCount) if (count > bestCount) [best, bestCount] = [key, count];
    c.preferredStaffId = best ? staffIdByKey.get(best)! : null;
  }

  // 顧客メモ（来店の多い顧客の一部に）
  const notes: Dataset["notes"] = [];
  const templates = NOTE_TEMPLATES[bp.industry] ?? [];
  for (const state of states) {
    if (state.visits >= 3 && rng() < 0.35 && templates.length) {
      const c = customers[state.index];
      notes.push({ customerId: c.id, body: pick(rng, templates), createdAt: new Date(Math.min(now.getTime(), c.createdAt.getTime() + 86_400_000 * randomInt(rng, 1, 30))) });
    }
  }

  return {
    organization, location,
    settings: { staffSelection: bp.staffSelection, slotInterval: bp.slotInterval, cancellationPolicy: bp.cancellationPolicy },
    hours, exceptions, staff, schedules, timeOff, services, serviceStaff, resources, serviceResources, customers, bookings, notes,
  };
}
