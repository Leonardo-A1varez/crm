import { env, GRAPH_API_BASE_URL_REAL } from "@/lib/env";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { withSpan } from "@/lib/observability/tracing";
import { fetchOrInfra, throwMappedGraphError } from "@/server/services/meta/graph-api-client";
import type { ResolverCredencialesWhatsApp } from "@/server/services/meta/credenciales-whatsapp.service";

/**
 * Media de la Cloud API de WhatsApp: pedir la URL de un archivo entrante,
 * bajarlo, y subir uno propio para mandarlo. Formas y límites de la doc de Meta
 * leída el 2026-10-11 (docs/meta/media.md §1):
 *
 *   GET  /{media-id}?phone_number_id=…   -> { url, mime_type, sha256, file_size, id }
 *   GET  {url}  con Bearer               -> bytes. La URL expira a los 5 minutos;
 *                                          404 = pedir otra.
 *   POST /{phone_number_id}/media        -> multipart messaging_product, type, file
 *                                          -> { id }
 *
 * Todas salen con el token del número de la conversación (`desde`) o, si no hay
 * número conectado, con el de env, igual que `GraphApiMetaClient`.
 */

export interface MediaRemota {
  /** Expira a los 5 minutos de emitida: usarla enseguida. */
  url: string;
  mime: string | null;
  bytes: number | null;
}

export interface OpcionesDescarga {
  desde?: string;
  /** Si el archivo pasa de acá, se corta y se lanza `MediaDemasiadoGrande`. */
  maxBytes: number;
}

export interface SubidaMedia {
  bytes: Uint8Array;
  mime: string;
  /** Nombre que ve Meta (ya saneado). */
  nombre: string;
  desde?: string;
}

export interface MetaMediaClient {
  obtenerMedia(mediaId: string, o?: { desde?: string }): Promise<MediaRemota>;
  descargar(url: string, o: OpcionesDescarga): Promise<Uint8Array>;
  subir(input: SubidaMedia): Promise<{ id: string }>;
}

/** El archivo supera lo que el CRM guarda. No es un fallo: se registra como omitido. */
export class MediaDemasiadoGrande extends ValidationError {
  constructor(public readonly maxBytes: number) {
    super(`el archivo supera el máximo de ${maxBytes} bytes`, "media_demasiado_grande");
  }
}

export interface GraphApiMediaClientConfig {
  graphApiVersion: string;
  whatsappPhoneNumberId: string;
  whatsappAccessToken: string;
  /** Override (tests, mock local). Default `META_GRAPH_API_BASE_URL` o graph.facebook.com. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  credenciales?: ResolverCredencialesWhatsApp;
}

/** Los ids de media son numéricos; la doc sólo dice «menos de 125 caracteres». */
const ID_MEDIA = /^[A-Za-z0-9_-]{1,124}$/;

/**
 * Hosts a los que se le manda el token al bajar. La URL la da Meta, pero el
 * token es del negocio: si una respuesta rara apuntara a otro lado, no se lo
 * entregamos. La lista sale de los dominios de Meta que muestra su doc y su CSP
 * (`lookaside.fbsbx.com`, `scontent.whatsapp.net`, CDN de fbcdn). **No es una
 * lista confirmada por Meta**: si un archivo real llega por otro dominio, la
 * descarga falla con «media_url_inesperada» y hay que sumarlo acá.
 */
const SUFIJOS_META = [
  ".fbsbx.com",
  ".facebook.com",
  ".fbcdn.net",
  ".whatsapp.net",
  ".whatsapp.com",
];

const MAX_REDIRECCIONES = 3;

function hostDeMeta(host: string): boolean {
  return SUFIJOS_META.some((s) => host.endsWith(s));
}

export class GraphApiMediaClient implements MetaMediaClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly cfg: GraphApiMediaClientConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.baseUrl = (cfg.baseUrl ?? env.META_GRAPH_API_BASE_URL ?? GRAPH_API_BASE_URL_REAL).replace(
      /\/+$/,
      "",
    );
  }

  private async origen(desde: string | undefined): Promise<{ phoneId: string; token: string }> {
    if (desde && desde !== this.cfg.whatsappPhoneNumberId && this.cfg.credenciales) {
      const c = await this.cfg.credenciales.para(desde);
      if (c) return { phoneId: c.phoneNumberId, token: c.accessToken };
    }
    return { phoneId: this.cfg.whatsappPhoneNumberId, token: this.cfg.whatsappAccessToken };
  }

  async obtenerMedia(mediaId: string, o: { desde?: string } = {}): Promise<MediaRemota> {
    return withSpan("meta.media.obtener", { canal: "wa" }, async () => {
      if (!ID_MEDIA.test(mediaId)) throw new ValidationError("id de media inválido", "media_id");
      const { phoneId, token } = await this.origen(o.desde);
      const operation = "wa.media.obtener";
      const url = `${this.baseUrl}/${this.cfg.graphApiVersion}/${mediaId}?phone_number_id=${encodeURIComponent(phoneId)}`;
      const res = await fetchOrInfra(
        this.fetchImpl,
        url,
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
        operation,
      );
      if (!res.ok) await throwMappedGraphError(res, operation);

      const cuerpo = (await res.json()) as {
        url?: unknown;
        mime_type?: unknown;
        file_size?: unknown;
      };
      if (typeof cuerpo.url !== "string" || cuerpo.url === "") {
        throw new ValidationError(`Meta ${operation}: respuesta sin url`, "media_sin_url");
      }
      return {
        url: cuerpo.url,
        mime: typeof cuerpo.mime_type === "string" ? cuerpo.mime_type : null,
        bytes: typeof cuerpo.file_size === "number" ? cuerpo.file_size : null,
      };
    });
  }

  async descargar(url: string, o: OpcionesDescarga): Promise<Uint8Array> {
    return withSpan("meta.media.descargar", { canal: "wa" }, async () => {
      const { token } = await this.origen(o.desde);
      const operation = "wa.media.descargar";
      let actual = url;

      // Las redirecciones se siguen a mano para validar cada salto: con
      // `redirect: "follow"` el Bearer viajaría a donde apunte el Location.
      for (let salto = 0; salto <= MAX_REDIRECCIONES; salto++) {
        this.validarUrl(actual);
        const res = await fetchOrInfra(
          this.fetchImpl,
          actual,
          { method: "GET", headers: { Authorization: `Bearer ${token}` }, redirect: "manual" },
          operation,
        );
        if (res.status >= 300 && res.status < 400) {
          const destino = res.headers.get("location");
          if (!destino) throw new ValidationError("redirección sin destino", "media_redireccion");
          actual = new URL(destino, actual).href;
          continue;
        }
        // 404: la URL venció (dura 5 minutos). Quien llama pide otra.
        if (res.status === 404) {
          throw new NotFoundError("la URL de la media venció", "media_url", actual);
        }
        if (!res.ok) await throwMappedGraphError(res, operation);
        return leerConTope(res, o.maxBytes);
      }
      throw new ValidationError("demasiadas redirecciones al bajar la media", "media_redireccion");
    });
  }

  async subir(input: SubidaMedia): Promise<{ id: string }> {
    return withSpan("meta.media.subir", { canal: "wa" }, async () => {
      const { phoneId, token } = await this.origen(input.desde);
      const operation = "wa.media.subir";
      const form = new FormData();
      form.set("messaging_product", "whatsapp");
      form.set("type", input.mime);
      // `Uint8Array` -> `ArrayBuffer` propio: el tipo de Blob no acepta vistas
      // sobre un buffer compartido.
      const copia = new Uint8Array(input.bytes);
      form.set("file", new File([copia], input.nombre, { type: input.mime }));

      const res = await fetchOrInfra(
        this.fetchImpl,
        `${this.baseUrl}/${this.cfg.graphApiVersion}/${phoneId}/media`,
        // Sin Content-Type: fetch pone `multipart/form-data; boundary=…`.
        { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form },
        operation,
      );
      if (!res.ok) await throwMappedGraphError(res, operation);

      const cuerpo = (await res.json()) as { id?: unknown };
      if (typeof cuerpo.id !== "string" || cuerpo.id === "") {
        throw new ValidationError(`Meta ${operation}: respuesta sin id`, "media_sin_id");
      }
      return { id: cuerpo.id };
    });
  }

  private validarUrl(crudo: string): void {
    let u: URL;
    try {
      u = new URL(crudo);
    } catch {
      throw new ValidationError("media_url_inesperada", "media_url");
    }
    const delMismoOrigen = u.origin === new URL(this.baseUrl).origin;
    const deMeta = u.protocol === "https:" && hostDeMeta(u.hostname);
    if (!delMismoOrigen && !deMeta) {
      // El host sí se nombra (no es dato personal); la URL entera trae un id de media.
      throw new ValidationError("media_url_inesperada", { host: u.hostname });
    }
  }
}

/** Lee el cuerpo sin pasar de `maxBytes` ni cargar en memoria lo que sobra. */
async function leerConTope(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declarado = Number(res.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > maxBytes) {
    await res.body?.cancel();
    throw new MediaDemasiadoGrande(maxBytes);
  }
  if (!res.body) return new Uint8Array(await res.arrayBuffer());

  const lector = res.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await lector.cancel();
      throw new MediaDemasiadoGrande(maxBytes);
    }
    partes.push(value);
  }
  const salida = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    salida.set(p, pos);
    pos += p.byteLength;
  }
  return salida;
}
