/** postgres.js の型変換（アプリとテストで共通） */
export const DB_TYPES = {
  // bigint（count の結果）は数値で受け取る（件数は Number の範囲に収まる）
  bigint: { to: 20, from: [20], serialize: (v: number) => String(v), parse: (v: string) => Number(v) },
  // numeric（平均などの計算結果）も数値で受け取る。金額は integer 列なので誤差は出ない
  numeric: { to: 1700, from: [1700], serialize: (v: number) => String(v), parse: (v: string) => Number(v) },
  // date は 'YYYY-MM-DD' の文字列のまま扱う（タイムゾーンのずれを防ぐ）
  date: { to: 1082, from: [1082], serialize: (v: string) => v, parse: (v: string) => v },
};
