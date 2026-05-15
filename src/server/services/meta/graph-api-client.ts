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
 * IG + FB Messenger: NOT implementados este commit. Env vars actuales solo
 * cubren WhatsApp. Throws `ValidationError` con mensaje claro hasta que se
 * agreguen `META_IG_ACCESS_TOKEN` + `META_FB_PAGE_ACCESS_TOKEN` al schema
 * env.ts + extiendan este client.
 *
 * Error mapping Graph API:
 * - 429 rate-limit → ConflictError "meta_rate_limited" (retryable)
 * - 400 invalid request → ValidationError (NonRetriable bug del caller)
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
    if (input.canal === "ig" || input.canal === "fb") {
      throw new ValidationError(
        `canal ${input.canal} no implementado: env vars Meta IG/FB no configuradas (META_IG_ACCESS_TOKEN / META_FB_PAGE_ACCESS_TOKEN ausentes). Agregar al schema env.ts + extender GraphApiMetaClient.`,
        { canal: input.canal },
      );
    }

    // WA branch.
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
