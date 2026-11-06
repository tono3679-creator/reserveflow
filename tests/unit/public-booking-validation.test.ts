import { describe, expect, it } from "vitest";
import { customerInfoSchema, manageActionSchema, publicBookingSchema } from "@/lib/validation/public-booking";

const base = {
  serviceId: "7d4b7a1e-1111-4a2b-9c3d-000000000001", staffId: null, startsAt: "2026-11-08T01:00:00.000Z", agreed: true,
};

describe("公開予約の入力チェック", () => {
  it("画面でチェック済みの値（任意項目が null）をそのまま受け付ける", () => {
    const customer = customerInfoSchema.parse({ name: "山田 花子", nameKana: "", phone: "090-1111-2222", email: "a@example.com", message: "" });
    expect(customer.nameKana).toBeNull();
    const parsed = publicBookingSchema.parse({ ...base, customer });
    expect(parsed.customer.message).toBeNull();
  });

  it("必須項目・形式・同意を確認する", () => {
    const bad = publicBookingSchema.safeParse({ ...base, agreed: false, customer: { name: " ", phone: "abc", email: "x" } });
    expect(bad.success).toBe(false);
    const paths = bad.error!.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["agreed", "customer.name", "customer.phone", "customer.email"]));
  });

  it("変更・キャンセルの操作は決まった形だけ", () => {
    expect(manageActionSchema.parse({ action: "cancel", reason: "  " })).toEqual({ action: "cancel", reason: null });
    expect(manageActionSchema.safeParse({ action: "delete" }).success).toBe(false);
  });
});
