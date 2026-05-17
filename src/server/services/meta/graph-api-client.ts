import { ConflictError, ValidationError } from "@/lib/errors";
import type {
  MetaApiClient,
  MetaSendResult,
  MetaSendTextInput,
} from "@/server/services/meta-api.service";

export interface GraphApiMetaClientConfig {
  /** Meta Graph API version, e.g. "v21.0". Reads from env `META_GRAPH_API_VERSION`. */
  graphApiVersion: string;
  /** WhatsApp Business phone_number_id (from env `META_WHATSAPP_PHONE_NUMBER_ID`). */
  whatsappPhoneNumberId: string;
  /** WhatsApp Business access token (from env `META_WHATSAPP_ACCESS_TOKEN`). */
  whatsappAccessToken: string;
  /** IG Business Account ID (from env `META_IG_PAGE_ID`). Opcional pilot WA-only. */
  igPageId?: string;
  /** IG Page Access Token (from env `META_IG_ACCESS_TOKEN`). Opcional pilot WA-only. */
  igAccessToken?: string;
  /** FB Page ID (from env `META_FB_PAGE_ID`). Opcional pilot WA-only. */
  fbPageId?: string;
  /** FB Page Access Token (from env `META_FB_PAGE_ACCESS_TOKEN`). Opcional pilot WA-only. */
  fbAccessToken?: string;
  /** Override base URL (tests). Default `https://graph.facebook.com`. */
  baseUrl?: string;
  /** Inyectable para tests. Default global `fetch`. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://graph.facebook.com";

interface WaSendTextResponse {
  messaging_product?: string;
  messages?: Array<{ id?: string }>;
}

interface MessengerSendTextResponse {
  recipient_id?: string;
  message_id?: string;
}

interface GraphErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

/**
 * Graph API real impl `MetaApiClient`. Slice 1 sub-paso 7.6.
 *
 * WA: send text via Graph API `POST {base}/{version}/{phone_number_id}/messages`
 * con Bearer access token. Response `messages[0].id` → meta_message_id.
 *
 * IG + FB Messenger: send via `POST {base}/{version}/{page_id}/messages`
 * Messenger Platform body `{ recipient: { id }, message: { text } }`.
 * Response `message_id` → meta_message_id.
 * Si config (pageId+accessToken) missing → throws ValidationError fail-fast
 * (pilot WA-only puede arrancar; agregar env vars cuando cliente conecte IG/FB).
 *
 * Error mapping Graph API (todos los canales):
 * - 429 rate-limit → ConflictError "meta_rate_limited" (retryable)
 * - 400 invalid request → ValidationError (NonRetriable bug del caller o
 *   IG/FB 24h messaging window cerrada)
 * - 401/403 auth → ValidationError "meta_unauthorized" (token expirado/scope)
 * - 5xx server → generic Error (Inngest retry handles)
 */
export class GraphApiMetaClient implements MetaApiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly cfg: GraphApiMetaClientConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.baseUrl = (cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  async sendText(input: MetaSendTextInput): Promise<MetaSendResult> {
    if (input.canal === "wa") return this.sendWa(input);
    if (input.canal === "ig") return this.sendMessenger(input, "ig");
    if (input.canal === "fb") return this.sendMessenger(input, "fb");
    // Exhaustiveness check (Canal enum: 'wa'|'ig'|'fb').
    const _exhaustive: never = input.canal;
    throw new ValidationError(`canal desconocido: ${String(_exhaustive)}`);
  }

  private async sendWa(input: MetaSendTextInput): Promise<MetaSendResult> {
    const url = `${this.baseUrl}/${this.cfg.graphApiVersion}/${this.cfg.whatsappPhoneNumberId}/messages`;
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: "text",
      text: { body: input.text, preview_url: false },
    };

    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.cfg.whatsappAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      await throwMappedGraphError(res, "wa.sendText");
    }

    const parsed = (await res.json()) as WaSendTextResponse;
    const id = parsed.messages?.[0]?.id;
    if (!id) {
      throw new ValidationError("Meta WA sendText: response sin messages[0].id", {
        raw: parsed as unknown as Record<string, unknown>,
      });
    }
    return { meta_message_id: id };
  }

  private async sendMessenger(
    input: MetaSendTextInput,
    canal: "ig" | "fb",
  ): Promise<MetaSendResult> {
    const pageId = canal === "ig" ? this.cfg.igPageId : this.cfg.fbPageId;
    const accessToken = canal === "ig" ? this.cfg.igAccessToken : this.cfg.fbAccessToken;
    const envHint =
      canal === "ig"
        ? "META_IG_PAGE_ID + META_IG_ACCESS_TOKEN"
        : "META_FB_PAGE_ID + META_FB_PAGE_ACCESS_TOKEN";

    if (!pageId || !accessToken) {
      throw new ValidationError(
        `canal ${canal} no configurado: ${envHint} ausentes en env. Agregar al .env.local + Vercel Project Settings.`,
        { canal, missing: { pageId: !pageId, accessToken: !accessToken } },
      );
    }

    const url = `${this.baseUrl}/${this.cfg.graphApiVersion}/${pageId}/messages`;
    const body = {
      recipient: { id: input.to },
      message: { text: input.text },
    };

    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      await throwMappedGraphError(res, `${canal}.sendText`);
    }

    const parsed = (await res.json()) as MessengerSendTextResponse;
    const id = parsed.message_id;
    if (!id) {
      throw new ValidationError(`Meta ${canal} sendText: response sin message_id`, {
        raw: parsed as unknown as Record<string, unknown>,
      });
    }
    return { meta_message_id: id };
  }
}

async function throwMappedGraphError(res: Response, operation: string): Promise<never> {
  let body: GraphErrorBody = {};
  try {
    body = (await res.json()) as GraphErrorBody;
  } catch {
    // Body no parseable — usar status.
  }
  const errMsg = body.error?.message ?? `HTTP ${res.status}`;
  const errCode = body.error?.code;
  const trace = body.error?.fbtrace_id;
  const ctx = { operation, status: res.status, code: errCode, trace };

  if (res.status === 429) {
    throw new ConflictError(
      `Meta rate-limited (${operation}): ${errMsg}`,
      "meta_rate_limited",
      ctx,
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new ValidationError(`Meta auth error (${operation}): ${errMsg}`, ctx);
  }
  if (res.status === 400) {
    throw new ValidationError(`Meta invalid request (${operation}): ${errMsg}`, ctx);
  }
  // 5xx + otros: generic Error → Inngest retry.
  throw new Error(`Meta ${operation} HTTP ${res.status}: ${errMsg}`);
}
