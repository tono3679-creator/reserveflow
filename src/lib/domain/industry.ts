/** 業種（表示名だけを持つ。業種ごとの違いはデータと設定で表し、共通機能に業種の分岐を書かない） */
export const INDUSTRIES = {
  beauty_salon: "美容室",
  nail_salon: "ネイルサロン",
  chiropractic: "整体院",
  personal_gym: "パーソナルジム",
  school: "個人スクール",
  rental_space: "レンタルスペース",
  other: "その他",
} as const;

export type Industry = keyof typeof INDUSTRIES;

export function industryLabel(value: string): string {
  return INDUSTRIES[value as Industry] ?? "その他";
}
