import { z } from "zod";
import {
  parsearPagina,
  type CursorBodega,
  type PaginaBodega,
  type TablaBodega,
} from "@/lib/catalogo/bodega-contrato";
import {
  IllegalStateError,
  InfraError,
  PermissionDeniedError,
  RateLimitError,
  ValidationError,
} from "@/lib/errors";

/**
 * Lectura del catálogo de Bodega Web (otro proyecto de Supabase) por la RPC
 * `public.crm_catalogo_cambios`. Contrato: `crm_lectura_catalogo_contrato.md`.
 *
 * ============================ SOLO LEE ============================
 *
 * Un único `fetch`, un único endpoint, un único método (POST, porque PostgREST llama
 * a las funciones por POST): no hay ningún camino que escriba en Bodega Web.
 *
 * ============================ LAS CLAVES ============================
 *
 * `clave` (la de lectura del CRM, `p_clave`) viaja en el CUERPO y `anonKey` en los
 * headers: jamás en la URL, que termina en logs de acceso y en trazas. Ningún mensaje
 * de error las repite (`sanear`), ni siquiera si el servidor las devolviera en su texto.
 * Esta clase no loguea cuerpos de respuesta ni de pedido.
 */

export interface PedidoBodega {
  cursor: CursorBodega;
  /** 1..5000 según el contrato. */
  limite: number;
}

export interface BodegaCatalogoClient {
  cambios<T extends TablaBodega>(tabla: T, pedido: PedidoBodega): Promise<PaginaBodega<T>>;
}

/**
 * `57014`: la llamada se pasó de los 3 s del rol `anon` de Bodega Web. Es
 * reintentable, pero no igual: se vuelve a pedir con un `p_limite` menor.
 */
export class BodegaTimeoutError extends InfraError {
  constructor(message: string, cause?: unknown) {
    super(message, "bodega-web", cause);
  }
}

export interface HttpBodegaCatalogoConfig {
  /** `BODEGA_SUPABASE_URL`: el Project URL del Supabase de Bodega Web. */
  url: string;
  /** `BODEGA_SUPABASE_ANON_KEY`. Sola no lee nada: las tablas no tienen grants para anon. */
  anonKey: string;
  /** `BODEGA_CATALOGO_CLAVE`: la clave de lectura del CRM (`p_clave`). */
  clave: string;
  fetchImpl?: typeof fetch;
  /** Tope por pedido. Bodega Web corta a los 3 s; esto es por si la red se cuelga. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const LARGO_MAXIMO_DETALLE = 200;

const CuerpoDeErrorSchema = z.object({
  code: z.string().nullish(),
  message: z.string().nullish(),
});

export class HttpBodegaCatalogoClient implements BodegaCatalogoClient {
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(private readonly cfg: HttpBodegaCatalogoConfig) {
    let url: URL;
    try {
      url = new URL(cfg.url);
    } catch (causa) {
      throw new ValidationError("BODEGA_SUPABASE_URL no es una URL", undefined, causa);
    }
    // La clave de lectura viaja en cada pedido: fuera de loopback se exige https.
    if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) {
      throw new ValidationError("BODEGA_SUPABASE_URL exige https (salvo loopback)");
    }
    this.endpoint = `${url.origin}/rest/v1/rpc/crm_catalogo_cambios`;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async cambios<T extends TablaBodega>(tabla: T, pedido: PedidoBodega): Promise<PaginaBodega<T>> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          apikey: this.cfg.anonKey,
          Authorization: `Bearer ${this.cfg.anonKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          p_clave: this.cfg.clave,
          p_tabla: tabla,
          p_desde: pedido.cursor.desde,
          p_despues: pedido.cursor.despues,
          p_limite: pedido.limite,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (causa) {
      throw this.errorDeRed(causa);
    }

    if (!res.ok) throw await this.errorDeRespuesta(res);

    let crudo: unknown;
    try {
      crudo = (await res.json()) as unknown;
    } catch (causa) {
      throw new ValidationError("Bodega Web respondió algo que no es JSON", undefined, causa);
    }
    try {
      return parsearPagina(tabla, crudo);
    } catch (causa) {
      // Solo la ruta y el motivo de cada issue: nunca el valor de la fila.
      const issues =
        causa instanceof z.ZodError
          ? causa.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message }))
          : undefined;
      throw new ValidationError(
        `Bodega Web respondió con una forma inesperada para ${tabla}`,
        issues,
        causa,
      );
    }
  }

  private async errorDeRespuesta(res: Response): Promise<Error> {
    let code: string | null = null;
    let mensaje = `HTTP ${res.status}`;
    try {
      const cuerpo = CuerpoDeErrorSchema.parse(await res.json());
      code = cuerpo.code ?? null;
      if (cuerpo.message) mensaje = cuerpo.message;
    } catch {
      // Cuerpo ausente o no parseable: alcanza con el status.
    }
    const detalle = this.sanear(mensaje);

    // Se decide por `code` y no por el status HTTP (contrato §7).
    switch (code) {
      case "42501":
        return new PermissionDeniedError(
          `Bodega Web rechazó la clave de lectura (42501): ${detalle}`,
        );
      case "22023":
      case "54000":
        return new ValidationError(`Bodega Web rechazó el pedido (${code}): ${detalle}`);
      case "PGRST202":
        return new IllegalStateError(
          `La función crm_catalogo_cambios no existe en Bodega Web o los parámetros no coinciden: ${detalle}`,
          "bodega-web",
        );
      case "57014":
        return new BodegaTimeoutError(
          `Bodega Web se pasó del tiempo de espera (57014): ${detalle}`,
        );
      default:
        break;
    }

    if (res.status === 401 || res.status === 403) {
      return new PermissionDeniedError(
        `Bodega Web rechazó las credenciales (HTTP ${res.status}): ${detalle}`,
      );
    }
    if (res.status === 429) {
      const espera = Number(res.headers.get("retry-after"));
      return new RateLimitError(
        `Bodega Web pidió bajar el ritmo: ${detalle}`,
        "bodega-web",
        Number.isFinite(espera) && espera > 0 ? espera : undefined,
      );
    }
    if (res.status === 408 || res.status >= 500) {
      return new InfraError(`Bodega Web falló (HTTP ${res.status}): ${detalle}`, "bodega-web");
    }
    return new ValidationError(`Bodega Web rechazó el pedido (HTTP ${res.status}): ${detalle}`);
  }

  private errorDeRed(causa: unknown): InfraError {
    const nombre = causa instanceof Error ? causa.name : "";
    if (nombre === "TimeoutError" || nombre === "AbortError") {
      const s = Math.round(this.timeoutMs / 1000);
      return new InfraError(`Bodega Web tardó más de ${s} s en responder`, "bodega-web", causa);
    }
    const detalle = causa instanceof Error ? causa.message : String(causa);
    return new InfraError(`Bodega Web no respondió: ${this.sanear(detalle)}`, "bodega-web", causa);
  }

  /** Quita las dos credenciales del texto y lo acota. Nada de lo que vuelve del servidor sale tal cual. */
  private sanear(texto: string): string {
    let limpio = texto;
    for (const secreto of [this.cfg.clave, this.cfg.anonKey]) {
      if (secreto) limpio = limpio.split(secreto).join("[REDACTADO]");
    }
    return limpio.length > LARGO_MAXIMO_DETALLE
      ? `${limpio.slice(0, LARGO_MAXIMO_DETALLE)}…`
      : limpio;
  }
}
