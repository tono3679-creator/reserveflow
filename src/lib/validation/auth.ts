import { z } from "zod";

export const loginSchema = z.object({
  email: z.email("メールアドレスの形式で入力してください").max(254),
  password: z.string().min(1, "パスワードを入力してください").max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;
