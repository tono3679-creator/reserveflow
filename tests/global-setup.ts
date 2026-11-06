import { resetTestDatabase } from "./helpers/db";

/** DB のテストの前に1回だけ、テスト用データベースを作り直す */
export default async function setup() {
  if (process.env.SKIP_DB_TESTS) return;
  await resetTestDatabase();
}
