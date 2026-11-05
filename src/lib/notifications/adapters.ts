import "server-only";
import { serverEnv } from "@/lib/env";

/**
 * 通知の送信手段。メールサービスを替えるときはこの形の実装を追加して pickAdapter で選ぶ。
 */
export type OutgoingMessage = { to: string; subject: string; text: string };
export type SendResult = { status: "sent" | "demo" | "failed"; provider: string; error?: string };
export interface NotificationAdapter {
  readonly name: string;
  send(message: OutgoingMessage): Promise<SendResult>;
}

/** 送信しない（内容は通知管理の画面で確認できる） */
export const demoAdapter: NotificationAdapter = {
  name: "demo",
  async send() {
    return { status: "demo", provider: "demo" };
  },
};

/** Resend（https://resend.com）の HTTP API。RESEND_API_KEY と NOTIFY_FROM_EMAIL があるときだけ使う */
export function resendAdapter(apiKey: string, from: string): NotificationAdapter {
  return {
    name: "resend",
    async send(message) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return { status: "failed", provider: "resend", error: `HTTP ${res.status}` };
        return { status: "sent", provider: "resend" };
      } catch (e) {
        return { status: "failed", provider: "resend", error: e instanceof Error ? e.name : "送信エラー" };
      }
    },
  };
}

/** デモ・見本の企業は架空の宛先なので、設定があっても送信しない */
export function pickAdapter(org: { isDemo: boolean; isShowcase: boolean }): NotificationAdapter {
  if (org.isDemo || org.isShowcase) return demoAdapter;
  const key = serverEnv.resendApiKey;
  const from = serverEnv.notifyFromEmail;
  return key && from ? resendAdapter(key, from) : demoAdapter;
}

export function emailConfigured(): boolean {
  return !!(serverEnv.resendApiKey && serverEnv.notifyFromEmail);
}
