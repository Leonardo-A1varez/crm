import { ValidationError } from "@/lib/errors";
import { env, GRAPH_API_BASE_URL_REAL } from "@/lib/env";
import { withSpan } from "@/lib/observability/tracing";
import { fetchOrInfra, throwMappedGraphError } from "@/server/services/meta/graph-api-client";

/**
 * Las llamadas a la Graph API del alta de un número con el registro insertado
 * (Embedded Signup) en modo coexistencia. Fuentes, leídas el 2026-10-11:
 *
 *   - Canje del código: `GET /oauth/access_token?client_id&client_secret&code`
 *     (embedded-signup/onboarding-customers-as-a-tech-provider, paso 1). El
 *     código vive 30 s (embedded-signup/implementation).
 *   - Suscribir la app a la WABA: `POST /{waba_id}/subscribed_apps` →
 *     `{ success: true }` (mismo documento, paso 2).
 *   - Coexistencia: NO se registra el número (ya está registrado en la app);
 *     `GET /{phone}?fields=is_on_biz_app,platform_type` y
 *     `POST /{phone}/smb_app_data` con `sync_type` `smb_app_state_sync` o
 *     `history` → `{ messaging_product, request_id }`
 *     (embedded-signup/custom-flows/onboarding-business-app-users).
 *
 * Todo server-to-server: el secreto de la app y el token del negocio no salen
 * de acá ni aparecen en mensajes de error.
 */

export type TipoSincronizacion = "smb_app_state_sync" | "history";

export interface NumeroDeWaba {
  id: string;
  display_phone_number: string | null;
  verified_name: string | null;
}

export interface NumeroLeido extends NumeroDeWaba {
  is_on_biz_app: boolean | null;
  platform_type: string | null;
}

export interface GraphApiOnboarding {
  canjearCodigo(code: string): Promise<string>;
  numerosDeWaba(wabaId: string, token: string): Promise<NumeroDeWaba[]>;
  leerNumero(phoneNumberId: string, token: string): Promise<NumeroLeido>;
  suscribirApp(wabaId: string, token: string): Promise<void>;
  pedirSincronizacion(
    phoneNumberId: string,
    token: string,
    tipo: TipoSincronizacion,
  ): Promise<string>;
}

export interface GraphApiOnboardingConfig {
  graphApiVersion: string;
  appId: string;
  appSecret: string;
  /** Default `META_GRAPH_API_BASE_URL` (graph.facebook.com salvo el mock local). */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** Un token de Meta: sin espacios ni comillas. La doc no fija el largo. */
const FORMA_TOKEN = /^[A-Za-z0-9._|-]{10,4096}$/;

export class GraphApiOnboardingClient implements GraphApiOnboarding {
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;

  constructor(private readonly cfg: GraphApiOnboardingConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    const raiz = (cfg.baseUrl ?? env.META_GRAPH_API_BASE_URL ?? GRAPH_API_BASE_URL_REAL).replace(
      /\/+$/,
      "",
    );
    this.base = `${raiz}/${cfg.graphApiVersion}`;
  }

  async canjearCodigo(code: string): Promise<string> {
    return withSpan("meta.onboarding.canjearCodigo", {}, async () => {
      const operation = "onboarding.canjearCodigo";
      const url = new URL(`${this.base}/oauth/access_token`);
      url.searchParams.set("client_id", this.cfg.appId);
      url.searchParams.set("client_secret", this.cfg.appSecret);
      url.searchParams.set("code", code);
      const res = await fetchOrInfra(this.fetchImpl, url.toString(), { method: "GET" }, operation);
      if (!res.ok) await throwMappedGraphError(res, operation);

      // La doc de Meta muestra la respuesta como `<BUSINESS_TOKEN>` a secas; la
      // Graph API en general responde `{ "access_token": ... }`. Se aceptan las
      // dos formas y nada más.
      const texto = (await res.text()).trim();
      let token: string | null = null;
      try {
        const json: unknown = JSON.parse(texto);
        if (json && typeof json === "object" && "access_token" in json) {
          const t = (json as { access_token: unknown }).access_token;
          token = typeof t === "string" ? t : null;
        }
      } catch {
        token = texto;
      }
      if (!token || !FORMA_TOKEN.test(token)) {
        throw new ValidationError(`Meta ${operation}: respuesta sin un token reconocible`);
      }
      return token;
    });
  }

  async numerosDeWaba(wabaId: string, token: string): Promise<NumeroDeWaba[]> {
    const json = await this.get(
      `${wabaId}/phone_numbers`,
      { fields: "id,display_phone_number,verified_name" },
      token,
      "onboarding.numerosDeWaba",
    );
    const data = Array.isArray(json.data) ? json.data : [];
    return data.flatMap((d: unknown): NumeroDeWaba[] => {
      if (!d || typeof d !== "object") return [];
      const r = d as Record<string, unknown>;
      return typeof r.id === "string"
        ? [
            {
              id: r.id,
              display_phone_number: texto(r.display_phone_number),
              verified_name: texto(r.verified_name),
            },
          ]
        : [];
    });
  }

  async leerNumero(phoneNumberId: string, token: string): Promise<NumeroLeido> {
    const r = await this.get(
      phoneNumberId,
      { fields: "id,display_phone_number,verified_name,is_on_biz_app,platform_type" },
      token,
      "onboarding.leerNumero",
    );
    return {
      id: typeof r.id === "string" ? r.id : phoneNumberId,
      display_phone_number: texto(r.display_phone_number),
      verified_name: texto(r.verified_name),
      is_on_biz_app: typeof r.is_on_biz_app === "boolean" ? r.is_on_biz_app : null,
      platform_type: texto(r.platform_type),
    };
  }

  async suscribirApp(wabaId: string, token: string): Promise<void> {
    const r = await this.post(
      `${wabaId}/subscribed_apps`,
      undefined,
      token,
      "onboarding.suscribirApp",
    );
    if (r.success !== true) {
      throw new ValidationError("Meta onboarding.suscribirApp: respuesta sin success=true");
    }
  }

  async pedirSincronizacion(
    phoneNumberId: string,
    token: string,
    tipo: TipoSincronizacion,
  ): Promise<string> {
    const r = await this.post(
      `${phoneNumberId}/smb_app_data`,
      { messaging_product: "whatsapp", sync_type: tipo },
      token,
      `onboarding.smb_app_data.${tipo}`,
    );
    const id = texto(r.request_id);
    if (!id) throw new ValidationError(`Meta smb_app_data ${tipo}: respuesta sin request_id`);
    return id;
  }

  private async get(
    ruta: string,
    query: Record<string, string>,
    token: string,
    operation: string,
  ): Promise<Record<string, unknown>> {
    return withSpan(`meta.${operation}`, {}, async () => {
      const url = new URL(`${this.base}/${ruta}`);
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
      const res = await fetchOrInfra(
        this.fetchImpl,
        url.toString(),
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
        operation,
      );
      if (!res.ok) await throwMappedGraphError(res, operation);
      return objeto(await res.json());
    });
  }

  private async post(
    ruta: string,
    cuerpo: Record<string, unknown> | undefined,
    token: string,
    operation: string,
  ): Promise<Record<string, unknown>> {
    return withSpan(`meta.${operation}`, {}, async () => {
      const res = await fetchOrInfra(
        this.fetchImpl,
        `${this.base}/${ruta}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            ...(cuerpo ? { "Content-Type": "application/json" } : {}),
          },
          ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
        },
        operation,
      );
      if (!res.ok) await throwMappedGraphError(res, operation);
      return objeto(await res.json());
    });
  }
}

function objeto(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
