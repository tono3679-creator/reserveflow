/**
 * デモ・見本の店舗の設定（業種ごとの違いはすべてここのデータで表す。アプリの共通機能には業種の分岐を書かない）。
 * 店名・人名はすべて架空。
 */
import type { Industry } from "@/lib/domain/industry";

export type ServiceBlueprint = {
  key: string;
  name: string;
  category: string;
  description: string;
  price: number;
  duration: number;
  bufferBefore?: number;
  bufferAfter?: number;
  /** 予約での選ばれやすさ（相対値） */
  popularity: number;
  /** 対応するスタッフ（staff の key。省略時は全員） */
  staff?: string[];
  /** 必要な設備（このうちどれか1つ） */
  resources?: string[];
  isPublic?: boolean;
  color: string;
};

export type StaffBlueprint = {
  key: string;
  name: string;
  title: string;
  color: string;
  /** 勤務する曜日（0=日曜）と時間・休憩 */
  days: number[];
  start: string;
  end: string;
  breakStart?: string;
  breakEnd?: string;
};

export type LocationBlueprint = {
  industry: Industry;
  slug: string;
  organizationName: string;
  locationName: string;
  phone: string;
  email: string;
  address: string;
  /** 曜日（0=日曜）ごとの営業時間。無い曜日は定休日 */
  hours: Partial<Record<number, [string, string]>>;
  staffSelection: "required" | "optional" | "none";
  slotInterval: 15 | 30 | 60;
  cancellationPolicy: string;
  staff: StaffBlueprint[];
  resources: { key: string; name: string; kind: "room" | "equipment" | "seat" }[];
  services: ServiceBlueprint[];
  /** 生成する件数の目安 */
  customers: number;
  bookings: number;
  /** 曜日ごとの予約の入りやすさ（0=日曜） */
  weekdayWeights: number[];
  /** 時刻（時）ごとの予約の入りやすさ */
  hourWeights: Record<number, number>;
  /** 無断キャンセルの起こりやすさ（基準の率と、時間帯による倍率） */
  noShowBase: number;
  noShowByHour: Record<number, number>;
};

const SALON_HOURS = { 0: ["10:00", "19:00"], 2: ["10:00", "20:00"], 3: ["10:00", "20:00"], 4: ["10:00", "20:00"], 5: ["10:00", "20:00"], 6: ["09:30", "19:00"] } as const;

export const BLUEPRINTS: LocationBlueprint[] = [
  {
    industry: "beauty_salon",
    slug: "demo-salon",
    organizationName: "株式会社ルミエール（デモ）",
    locationName: "Hair Salon LUMIÈRE 表参道",
    phone: "03-0000-1001",
    email: "salon@reserveflow.example",
    address: "東京都渋谷区神宮前0-0-1（架空）",
    hours: SALON_HOURS as unknown as LocationBlueprint["hours"],
    staffSelection: "optional",
    slotInterval: 30,
    cancellationPolicy: "ご予約の変更・キャンセルは前日までにお願いいたします。当日のキャンセルはキャンセル料（施術料金の50%）を頂戴する場合がございます。",
    staff: [
      { key: "s1", name: "佐藤 美咲", title: "トップスタイリスト", color: "#2563eb", days: [0, 2, 3, 4, 6], start: "10:00", end: "19:00", breakStart: "13:00", breakEnd: "14:00" },
      { key: "s2", name: "高橋 健太", title: "スタイリスト", color: "#16a34a", days: [0, 2, 4, 5, 6], start: "10:00", end: "20:00", breakStart: "14:00", breakEnd: "15:00" },
      { key: "s3", name: "田中 彩", title: "スタイリスト", color: "#db2777", days: [2, 3, 5, 6, 0], start: "11:00", end: "20:00", breakStart: "15:00", breakEnd: "16:00" },
      { key: "s4", name: "伊藤 翔", title: "カラーリスト", color: "#d97706", days: [3, 4, 5, 6, 0], start: "10:00", end: "19:00", breakStart: "13:30", breakEnd: "14:30" },
      { key: "s5", name: "渡辺 さくら", title: "アシスタント", color: "#7c3aed", days: [2, 3, 4, 5, 6], start: "10:00", end: "18:00", breakStart: "13:00", breakEnd: "14:00" },
    ],
    resources: [],
    services: [
      { key: "cut", name: "カット", category: "カット", description: "シャンプー・ブロー込み", price: 4950, duration: 60, bufferAfter: 10, popularity: 30, staff: ["s1", "s2", "s3"], color: "#2563eb" },
      { key: "color", name: "カラー", category: "カラー", description: "根元〜全体染め。ブロー込み", price: 7700, duration: 90, bufferAfter: 10, popularity: 14, color: "#d97706" },
      { key: "cutcolor", name: "カット＋カラー", category: "セット", description: "人気のセットメニュー", price: 11000, duration: 120, bufferAfter: 10, popularity: 18, staff: ["s1", "s2", "s3", "s4"], color: "#ea580c" },
      { key: "perm", name: "パーマ", category: "パーマ", description: "カット込み。デジタルパーマは＋2,200円", price: 9900, duration: 120, bufferAfter: 10, popularity: 7, staff: ["s1", "s2", "s3"], color: "#16a34a" },
      { key: "straight", name: "縮毛矯正", category: "パーマ", description: "カット込み", price: 16500, duration: 180, bufferAfter: 10, popularity: 4, staff: ["s1", "s2"], color: "#0d9488" },
      { key: "treatment", name: "トリートメント", category: "ケア", description: "髪質に合わせた集中補修", price: 3300, duration: 30, popularity: 9, color: "#db2777" },
      { key: "spa", name: "ヘッドスパ", category: "ケア", description: "炭酸泉でじっくりほぐします", price: 4400, duration: 45, popularity: 8, staff: ["s3", "s4", "s5"], color: "#7c3aed" },
      { key: "bang", name: "前髪カット", category: "カット", description: "前髪のみ（15分）", price: 1100, duration: 15, popularity: 6, color: "#64748b" },
    ],
    customers: 140,
    bookings: 560,
    weekdayWeights: [1.5, 0, 0.8, 0.8, 0.9, 1.2, 1.7],
    hourWeights: { 9: 0.4, 10: 1, 11: 1.3, 12: 1.1, 13: 1.2, 14: 1.3, 15: 1.2, 16: 1, 17: 0.9, 18: 0.6 },
    noShowBase: 0.035,
    noShowByHour: { 17: 1.6, 18: 2 },
  },
  {
    industry: "chiropractic",
    slug: "demo-seitai",
    organizationName: "ほぐし堂株式会社（デモ）",
    locationName: "からだ整体院 ほぐし堂 中野",
    phone: "03-0000-2002",
    email: "seitai@reserveflow.example",
    address: "東京都中野区中野0-0-2（架空）",
    hours: { 1: ["09:00", "20:00"], 2: ["09:00", "20:00"], 3: ["09:00", "20:00"], 4: ["09:00", "20:00"], 5: ["09:00", "20:00"], 6: ["09:00", "17:00"] },
    staffSelection: "optional",
    slotInterval: 30,
    cancellationPolicy: "ご都合が悪くなった場合は、前日の19時までにご連絡ください。無断キャンセルが続く場合、次回以降のご予約をお断りすることがあります。",
    staff: [
      { key: "t1", name: "山本 大輔", title: "院長・柔道整復師", color: "#2563eb", days: [1, 2, 3, 5, 6], start: "09:00", end: "20:00", breakStart: "13:00", breakEnd: "14:30" },
      { key: "t2", name: "中村 優子", title: "整体師", color: "#db2777", days: [1, 2, 4, 5, 6], start: "09:00", end: "18:00", breakStart: "12:30", breakEnd: "13:30" },
      { key: "t3", name: "小林 誠", title: "整体師", color: "#16a34a", days: [2, 3, 4, 5, 6], start: "11:00", end: "20:00", breakStart: "15:00", breakEnd: "16:00" },
    ],
    resources: [
      { key: "bedA", name: "施術ベッドA", kind: "equipment" },
      { key: "bedB", name: "施術ベッドB", kind: "equipment" },
    ],
    services: [
      { key: "first", name: "初回カウンセリング＋施術", category: "初回", description: "問診・姿勢チェックのあと施術します（初めての方）", price: 7700, duration: 90, bufferAfter: 10, popularity: 10, resources: ["bedA", "bedB"], color: "#2563eb" },
      { key: "full", name: "全身整体 60分", category: "整体", description: "全身のバランスを整えます", price: 6600, duration: 60, bufferAfter: 10, popularity: 34, resources: ["bedA", "bedB"], color: "#16a34a" },
      { key: "part", name: "部分施術（肩・首・腰）", category: "整体", description: "気になる部位を集中的に", price: 3850, duration: 30, bufferAfter: 10, popularity: 18, resources: ["bedA", "bedB"], color: "#d97706" },
      { key: "pelvis", name: "骨盤矯正", category: "矯正", description: "産後の方にもおすすめ", price: 5500, duration: 45, bufferAfter: 10, popularity: 12, staff: ["t1", "t2"], resources: ["bedA", "bedB"], color: "#db2777" },
      { key: "long", name: "全身整体 90分", category: "整体", description: "じっくりほぐしたい方に", price: 9350, duration: 90, bufferAfter: 10, popularity: 8, resources: ["bedA", "bedB"], color: "#0d9488" },
      { key: "online", name: "セルフケア相談（来院）", category: "相談", description: "ストレッチ・生活習慣のアドバイス", price: 2200, duration: 30, popularity: 4, staff: ["t1"], color: "#7c3aed" },
    ],
    customers: 110,
    bookings: 480,
    weekdayWeights: [0, 1.4, 1, 0.9, 1, 1.1, 1.5],
    hourWeights: { 9: 0.9, 10: 1.1, 11: 1, 12: 0.7, 13: 0.6, 14: 0.8, 15: 0.9, 16: 1, 17: 1.3, 18: 1.4, 19: 0.6 },
    noShowBase: 0.04,
    noShowByHour: { 9: 1.4, 18: 1.5, 19: 1.8 },
  },
  {
    industry: "personal_gym",
    slug: "demo-gym",
    organizationName: "ボディクラフト合同会社（デモ）",
    locationName: "BODY CRAFT GYM 恵比寿",
    phone: "03-0000-3003",
    email: "gym@reserveflow.example",
    address: "東京都渋谷区恵比寿0-0-3（架空）",
    hours: { 0: ["08:00", "20:00"], 1: ["07:00", "22:00"], 2: ["07:00", "22:00"], 3: ["07:00", "22:00"], 5: ["07:00", "22:00"], 6: ["08:00", "20:00"] },
    staffSelection: "required",
    slotInterval: 30,
    cancellationPolicy: "セッションの変更・キャンセルは24時間前までにお願いします。それ以降のキャンセルは1回分の消化となります。",
    staff: [
      { key: "g1", name: "加藤 拓也", title: "ヘッドトレーナー", color: "#2563eb", days: [1, 2, 3, 5, 6], start: "07:00", end: "16:00", breakStart: "11:00", breakEnd: "12:00" },
      { key: "g2", name: "吉田 真由", title: "トレーナー", color: "#db2777", days: [0, 1, 2, 5, 6], start: "08:00", end: "17:00", breakStart: "12:00", breakEnd: "13:00" },
      { key: "g3", name: "山田 隼人", title: "トレーナー", color: "#16a34a", days: [1, 2, 3, 5, 0], start: "13:00", end: "22:00", breakStart: "16:30", breakEnd: "17:30" },
      { key: "g4", name: "松本 玲奈", title: "トレーナー・管理栄養士", color: "#d97706", days: [1, 3, 5, 6, 0], start: "12:00", end: "21:00", breakStart: "15:00", breakEnd: "16:00" },
    ],
    resources: [
      { key: "boothA", name: "トレーニングブース1", kind: "room" },
      { key: "boothB", name: "トレーニングブース2", kind: "room" },
      { key: "boothC", name: "トレーニングブース3", kind: "room" },
    ],
    services: [
      { key: "trial", name: "体験トレーニング", category: "体験", description: "カウンセリング＋体験（初めての方）", price: 3300, duration: 60, bufferAfter: 15, popularity: 9, resources: ["boothA", "boothB", "boothC"], color: "#2563eb" },
      { key: "pt60", name: "パーソナルトレーニング 60分", category: "トレーニング", description: "目的に合わせたマンツーマン指導", price: 8800, duration: 60, bufferAfter: 15, popularity: 40, resources: ["boothA", "boothB", "boothC"], color: "#16a34a" },
      { key: "pt90", name: "パーソナルトレーニング 90分", category: "トレーニング", description: "ストレッチまでじっくり", price: 12100, duration: 90, bufferAfter: 15, popularity: 10, resources: ["boothA", "boothB", "boothC"], color: "#0d9488" },
      { key: "counsel", name: "カウンセリング", category: "相談", description: "目標設定・プランのご相談（無料）", price: 0, duration: 30, popularity: 6, color: "#7c3aed" },
      { key: "food", name: "食事指導", category: "相談", description: "管理栄養士が食事を見直します", price: 3300, duration: 30, popularity: 5, staff: ["g4"], color: "#d97706" },
      { key: "stretch", name: "ストレッチ 45分", category: "ケア", description: "トレーナーによるパートナーストレッチ", price: 4950, duration: 45, bufferAfter: 15, popularity: 8, resources: ["boothA", "boothB", "boothC"], color: "#db2777" },
    ],
    customers: 90,
    bookings: 520,
    weekdayWeights: [0.9, 1.2, 1.1, 1, 0, 1, 1.2],
    hourWeights: { 7: 1.4, 8: 1.2, 9: 0.6, 10: 0.5, 11: 0.5, 12: 0.7, 13: 0.5, 14: 0.5, 15: 0.6, 16: 0.8, 17: 1.1, 18: 1.6, 19: 1.7, 20: 1.2 },
    noShowBase: 0.03,
    noShowByHour: { 7: 1.8, 20: 1.5 },
  },
  {
    industry: "rental_space",
    slug: "demo-space",
    organizationName: "ソラスペース株式会社（デモ）",
    locationName: "シェアスペース ソラ 渋谷",
    phone: "03-0000-4004",
    email: "space@reserveflow.example",
    address: "東京都渋谷区道玄坂0-0-4（架空）",
    hours: { 0: ["08:00", "23:00"], 1: ["08:00", "23:00"], 2: ["08:00", "23:00"], 3: ["08:00", "23:00"], 4: ["08:00", "23:00"], 5: ["08:00", "23:00"], 6: ["08:00", "23:00"] },
    staffSelection: "none",
    slotInterval: 30,
    cancellationPolicy: "利用開始の3日前まではキャンセル無料です。前日・当日のキャンセルは利用料金の100%を頂戴します。",
    staff: [
      { key: "r1", name: "井上 智子", title: "受付・清掃", color: "#2563eb", days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00", breakStart: "12:00", breakEnd: "13:00" },
      { key: "r2", name: "木村 亮", title: "受付・清掃", color: "#16a34a", days: [0, 4, 5, 6], start: "13:00", end: "22:00", breakStart: "17:00", breakEnd: "18:00" },
      { key: "r3", name: "林 由美", title: "店長", color: "#db2777", days: [0, 1, 2, 3, 6], start: "10:00", end: "19:00", breakStart: "13:00", breakEnd: "14:00" },
    ],
    resources: [
      { key: "roomA", name: "会議室A（6名）", kind: "room" },
      { key: "roomB", name: "会議室B（12名）", kind: "room" },
      { key: "studio", name: "多目的スタジオ", kind: "room" },
    ],
    services: [
      { key: "h1", name: "60分利用", category: "時間貸し", description: "会議・打ち合わせに", price: 3300, duration: 60, bufferAfter: 15, popularity: 30, resources: ["roomA", "roomB", "studio"], color: "#2563eb" },
      { key: "h2", name: "120分利用", category: "時間貸し", description: "セミナー・撮影に", price: 6050, duration: 120, bufferAfter: 15, popularity: 25, resources: ["roomA", "roomB", "studio"], color: "#16a34a" },
      { key: "h3", name: "180分利用", category: "時間貸し", description: "ワークショップ・パーティーに", price: 8580, duration: 180, bufferAfter: 15, popularity: 14, resources: ["roomA", "roomB", "studio"], color: "#d97706" },
      { key: "studio2", name: "スタジオ 120分（撮影プラン）", category: "スタジオ", description: "照明機材つき", price: 9900, duration: 120, bufferAfter: 30, popularity: 8, resources: ["studio"], color: "#db2777" },
      { key: "night", name: "夜間パック（19時〜23時）", category: "パック", description: "4時間たっぷり使えるお得なパック", price: 9900, duration: 240, bufferAfter: 15, popularity: 5, resources: ["roomA", "roomB", "studio"], color: "#7c3aed" },
    ],
    customers: 120,
    bookings: 430,
    weekdayWeights: [1.6, 0.8, 0.8, 0.9, 0.9, 1.1, 1.8],
    hourWeights: { 8: 0.3, 9: 0.8, 10: 1.2, 11: 1, 12: 0.6, 13: 1.2, 14: 1.3, 15: 1.1, 16: 1, 17: 0.8, 18: 1, 19: 1.1, 20: 0.5 },
    noShowBase: 0.02,
    noShowByHour: { 8: 1.5, 19: 1.4 },
  },
];
