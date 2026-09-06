// Transport abstraction for the Expo Push Service, so dispatch-notifications
// can be tested deterministically (no real push ever sent by an automated
// test) and so production code has exactly one place that knows the real
// Expo endpoints and current documented limits.
//
// Expo's documented limits (as of writing): send accepts up to 100 messages
// per request; getReceipts accepts up to 1000 ticket ids per request. Both
// are enforced by batchArray() in dispatch, not just assumed by callers.

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

export interface ExpoReceipt {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

export interface PushTransport {
  /** One ticket per input message, same order. Throws on transport-level failure (network/timeout). */
  sendBatch(messages: ExpoPushMessage[]): Promise<ExpoTicket[]>;
  /** Keyed by ticket id. A ticket id with no entry in the result means "not ready yet". */
  getReceipts(ticketIds: string[]): Promise<Record<string, ExpoReceipt>>;
}

const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
export const EXPO_MAX_MESSAGES_PER_SEND = 100;
export const EXPO_MAX_TICKETS_PER_RECEIPT_REQUEST = 1000;

/** A valid Expo push token looks like ExponentPushToken[xxxxxxxx] or ExpoPushToken[xxxxxxxx]. */
export function isValidExpoPushToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * The real Expo Push Service. Never logs a raw token, message body, or
 * response body — only counts and status codes. Timeouts and network
 * failures propagate as thrown errors, which the caller treats as a
 * retryable, not permanent, failure for every message in the batch.
 */
export function createExpoTransport(fetchImpl: typeof fetch = fetch): PushTransport {
  return {
    async sendBatch(messages) {
      if (messages.length === 0) return [];
      if (messages.length > EXPO_MAX_MESSAGES_PER_SEND) {
        throw new Error(`sendBatch called with ${messages.length} messages, over the ${EXPO_MAX_MESSAGES_PER_SEND} limit`);
      }
      const resp = await fetchImpl(EXPO_SEND_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "accept-encoding": "gzip, deflate",
        },
        body: JSON.stringify(messages),
      });
      if (!resp.ok) {
        throw new Error(`Expo push send failed with HTTP ${resp.status}`);
      }
      const body = await resp.json().catch(() => {
        throw new Error("Expo push send returned a malformed (non-JSON) response");
      });
      const tickets = body?.data;
      if (!Array.isArray(tickets) || tickets.length !== messages.length) {
        throw new Error("Expo push send returned an unexpected ticket shape");
      }
      return tickets;
    },
    async getReceipts(ticketIds) {
      if (ticketIds.length === 0) return {};
      if (ticketIds.length > EXPO_MAX_TICKETS_PER_RECEIPT_REQUEST) {
        throw new Error(`getReceipts called with ${ticketIds.length} ids, over the ${EXPO_MAX_TICKETS_PER_RECEIPT_REQUEST} limit`);
      }
      const resp = await fetchImpl(EXPO_RECEIPTS_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ ids: ticketIds }),
      });
      if (!resp.ok) {
        throw new Error(`Expo getReceipts failed with HTTP ${resp.status}`);
      }
      const body = await resp.json().catch(() => {
        throw new Error("Expo getReceipts returned a malformed (non-JSON) response");
      });
      if (typeof body?.data !== "object" || body.data === null) {
        throw new Error("Expo getReceipts returned an unexpected receipt shape");
      }
      return body.data;
    },
  };
}

/**
 * Error classification, shared by both ticket and receipt handling — Expo
 * uses the same `details.error` vocabulary in both. `DeviceNotRegistered`
 * is the one this project must act on (deactivate the token); everything
 * else recognized is either clearly permanent (bad request shape) or
 * clearly transient (rate limits, provider-side errors) by Expo's own
 * documentation. An unrecognized code is treated as retryable — safer to
 * retry an unknown error a bounded number of times than to silently drop
 * a real notification.
 */
export type ErrorClass = "device_not_registered" | "permanent" | "retryable";

export function classifyExpoError(errorCode: string | undefined): ErrorClass {
  switch (errorCode) {
    case "DeviceNotRegistered":
      return "device_not_registered";
    case "MessageTooBig":
    case "InvalidCredentials":
      return "permanent";
    case "MessageRateExceeded":
    case "ProviderError":
      return "retryable";
    default:
      return "retryable";
  }
}
