import "server-only";

import twilio from "twilio";

import { getServerEnv } from "@/lib/env";
import { log } from "@/lib/logger";

export interface NotificationMessage { to: string; subject?: string; body: string; idempotencyKey: string }
export interface NotificationGateway { sendEmail(message: NotificationMessage, signal?: AbortSignal): Promise<void>; sendSms(message: NotificationMessage, signal?: AbortSignal): Promise<void> }

class FakeNotificationGateway implements NotificationGateway {
  constructor(private readonly behavior: "success" | "failure" | "timeout") {}
  private async simulate(signal?: AbortSignal) {
    if (this.behavior === "failure") throw new Error("FAKE_NOTIFICATION_FAILURE");
    if (this.behavior === "timeout") {
      await new Promise<never>((_, reject) => {
        const abort = () => reject(new Error("FAKE_NOTIFICATION_ABORTED"));
        if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
      });
    }
  }
  async sendEmail(message: NotificationMessage, signal?: AbortSignal) { await this.simulate(signal); log("info", "notification.fake_email", { destinationHash: message.idempotencyKey, template: message.subject }); }
  async sendSms(message: NotificationMessage, signal?: AbortSignal) { await this.simulate(signal); log("info", "notification.fake_sms", { destinationHash: message.idempotencyKey }); }
}

class RealNotificationGateway implements NotificationGateway {
  private readonly twilioClient;
  constructor(private readonly fromEmail: string, private readonly fromPhone: string, private readonly resendKey: string, sid: string, token: string, timeoutMs: number) {
    this.twilioClient = twilio(sid, token, { timeout: timeoutMs, autoRetry: false });
  }
  async sendEmail(message: NotificationMessage, signal?: AbortSignal) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal,
      headers: {
        authorization: `Bearer ${this.resendKey}`,
        "content-type": "application/json",
        "idempotency-key": message.idempotencyKey,
      },
      body: JSON.stringify({ from: this.fromEmail, to: [message.to], subject: message.subject ?? "Drainly update", text: message.body }),
    });
    if (!response.ok) throw new Error(`EMAIL_PROVIDER_FAILED_${response.status}`);
  }
  async sendSms(message: NotificationMessage) {
    await this.twilioClient.messages.create({ from: this.fromPhone, to: message.to, body: message.body });
  }
}

let gateway: NotificationGateway | undefined;
export function getNotificationGateway(): NotificationGateway {
  const env = getServerEnv();
  if (!gateway) {
    gateway = env.PROVIDER_MODE === "real" && env.RESEND_API_KEY && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER
      ? new RealNotificationGateway(env.EMAIL_FROM, env.TWILIO_FROM_NUMBER, env.RESEND_API_KEY, env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.OUTBOUND_PROVIDER_TIMEOUT_MS)
      : new FakeNotificationGateway(env.FAKE_NOTIFICATION_BEHAVIOR);
  }
  return gateway;
}
