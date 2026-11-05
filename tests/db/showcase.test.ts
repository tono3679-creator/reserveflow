/**
 * 見本の企業の作り直し（毎日の定期処理と db:seed）。
 * 公開予約ページから入った予約が消えること、ログイン用の利用者を作り直さず使い回すこと、パスワードを渡さなければ保つこと。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { rebuildShowcase, SHOWCASE_USERS } from "../../src/lib/demo/showcase";
import { connect } from "../helpers/db";

let sql: Sql;

beforeAll(async () => {
  sql = connect();
  await rebuildShowcase(sql, { password: "showcase-test-password" });
});
afterAll(async () => {
  await sql.end();
});

const userIds = async () => (await sql<{ email: string; id: string }[]>`
  select email, id from auth.users where email in ${sql(Object.values(SHOWCASE_USERS))} order by email`);
const passwordOk = async (email: string, password: string) => (await sql<{ ok: boolean }[]>`
  select encrypted_password = extensions.crypt(${password}, encrypted_password) ok from auth.users where email = ${email}`)[0]?.ok;

describe("見本の企業の作り直し", () => {
  it("公開予約で入った予約は作り直しで消え、利用者とパスワードはそのまま使える", async () => {
    const before = await userIds();
    expect(before).toHaveLength(3);
    const [loc] = await sql<{ id: string; organization_id: string }[]>`
      select l.id, l.organization_id from public.locations l join public.organizations o on o.id = l.organization_id
       where o.is_showcase and l.slug = 'demo-salon'`;
    const [customer] = await sql<{ id: string }[]>`
      insert into public.customers (organization_id, name, phone, source) values (${loc.organization_id}, '公開 見本テスト', '080-0000-9999', 'public') returning id`;
    expect(customer.id).toBeTruthy();

    await rebuildShowcase(sql); // 定期処理と同じ（パスワードなし）
    const after = await userIds();
    expect(after).toEqual(before);
    expect(await passwordOk(SHOWCASE_USERS.owner, "showcase-test-password")).toBe(true);
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from public.customers where name = '公開 見本テスト'`;
    expect(n).toBe(0);
    const [{ orgs }] = await sql<{ orgs: number }[]>`select count(*)::int orgs from public.organizations where is_showcase`;
    expect(orgs).toBe(4);
  });
});
