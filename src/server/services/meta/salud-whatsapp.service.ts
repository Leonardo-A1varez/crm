import type { Logger } from "@/lib/observability/logger";
import type {
  EntidadDeSaludCruda,
  MetaLecturaClient,
  NumeroCrudo,
  PlantillaCruda,
} from "@/server/services/meta/graph-api-lectura";

/**
 * Una lectura de Meta. Tres desenlaces y no dos, porque "no se pudo leer" y
 * "Meta no lo expone" piden cosas distintas a quien mira: lo primero se
 * reintenta recargando, lo segundo no se arregla desde acá nunca.
 */
export type LecturaMeta<T> =
  | { estado: "ok"; valor: T }
  | { estado: "error"; mensaje: string }
  | { estado: "no-expuesto"; motivo: string };

/** Un dato que Meta no expone por API. No hay desenlace "ok" posible. */
export interface NoExpuesto {
  estado: "no-expuesto";
  motivo: string;
}

export interface NumeroLeido {
  id: string;
  numero: string | null;
  nombreVerificado: string | null;
  /** Crudo, como lo manda Meta. La interpretación es de quien dibuja. */
  calidad: string | null;
  /** Es `META_WHATSAPP_PHONE_NUMBER_ID`: el número por el que manda este CRM. */
  esElConfigurado: boolean;
}

export interface NumerosLeidos {
  numeros: NumeroLeido[];
  hayMas: boolean;
  /**
   * Por qué se muestra sólo el número configurado y no la lista de la cuenta.
   * `null` cuando la lista de la WABA llegó.
   */
  motivoParcial: string | null;
}

export interface LimiteDeMensajeria {
  /** Tal cual: `TIER_2000`, `TIER_UNLIMITED`… */
  crudo: string;
  /**
   * Destinatarios únicos por 24 h. `"ilimitado"` para `TIER_UNLIMITED`;
   * `null` cuando el valor no se sabe leer (`TIER_NOT_SET`, o uno que Meta
   * agregue mañana). Nunca se adivina un número.
   */
  destinatarios: number | "ilimitado" | null;
}

export interface ErrorDeEntidad {
  codigo: number | null;
  descripcion: string | null;
  solucion: string | null;
}

export interface EntidadDeEnvio {
  tipo: string;
  id: string | null;
  puedeEnviar: string | null;
  errores: ErrorDeEntidad[];
  infoAdicional: string[];
}

/** El `health_status` del número configurado: si puede mandar y qué lo frena. */
export interface EstadoDeEnvio {
  puedeEnviar: string | null;
  entidades: EntidadDeEnvio[];
}

export interface PlantillaLeida {
  id: string;
  nombre: string;
  idioma: string | null;
  categoria: string | null;
  estado: string | null;
  motivoRechazo: string | null;
  calidad: string | null;
  /** Encabezado de texto; `null` si es de imagen o video, o no tiene. */
  encabezado: string | null;
  /** El cuerpo con las variables posicionales tal cual (`{{1}}`). */
  cuerpo: string | null;
  pie: string | null;
  /** Los botones de respuesta rápida, en orden. */
  respuestasRapidas: string[];
}

export interface PlantillasLeidas {
  plantillas: PlantillaLeida[];
  hayMas: boolean;
  /** Cuántas se pidieron: si `hayMas`, la lista está cortada en este número. */
  limite: number;
}

export interface SaludWhatsApp {
  consultadoAt: Date;
  versionApi: string;
  estadoDeEnvio: LecturaMeta<EstadoDeEnvio>;
  limite: LecturaMeta<LimiteDeMensajeria>;
  /** Ver `MOTIVO_USO`. */
  usoDelLimite: NoExpuesto;
  numeros: LecturaMeta<NumerosLeidos>;
  plantillas: LecturaMeta<PlantillasLeidas>;
  /** Ver `MOTIVO_SANCION`. */
  sancion: NoExpuesto;
}

export interface SaludWhatsAppService {
  /** Nunca lanza: cada dato que no llega vuelve con su motivo. */
  leer(): Promise<SaludWhatsApp>;
}

export interface SaludWhatsAppDeps {
  cliente: MetaLecturaClient;
  /** `META_WHATSAPP_PHONE_NUMBER_ID`. */
  phoneNumberId: string;
  /** `META_GRAPH_API_VERSION`, sólo para decir de dónde salió lo que se ve. */
  versionApi: string;
  logger: Logger;
  ahora?: () => Date;
  limitePlantillas?: number;
}

const LIMITE_PLANTILLAS = 100;

/**
 * La página de límites de Meta documenta un solo campo de lectura, el escalón.
 * Cuánto se usó no aparece; calcularlo con los salientes propios es posible
 * pero es otra cosa, y esta pantalla no lo hace. Leído el 2026-09-13.
 */
const MOTIVO_USO =
  "Meta expone por API sólo el escalón (whatsapp_business_manager_messaging_limit), no cuánto de él se usó en los últimos 7 días, y esta pantalla no lo calcula.";

/**
 * La página de policy enforcement de Meta no documenta ningún endpoint para
 * leer el escalón: lo avisa el webhook `account_update` y lo muestra el
 * Business Support Home. Ese campo del webhook figura como desuscrito en
 * `docs/meta-webhook-payloads.md` (2026-08-25), y `meta_operational_events`
 * no tiene ninguna fila. Leído el 2026-09-13.
 */
const MOTIVO_SANCION =
  "Meta no tiene un endpoint para leer el escalón: lo avisa por el webhook account_update, que no figura entre los suscritos (docs/meta-webhook-payloads.md), y lo muestra en el Business Support Home.";

const MOTIVO_SIN_WABA =
  "health_status del número no nombró la cuenta de WhatsApp (WABA), y sin ella no hay de dónde listar números ni plantillas.";

/**
 * El escalón de Meta a destinatarios. Acepta las dos grafías que aparecen en
 * la documentación: `TIER_2000` (campo de lectura) y `TIER_2K` (webhook).
 */
function interpretarEscalon(crudo: string): number | "ilimitado" | null {
  if (crudo === "TIER_UNLIMITED") return "ilimitado";
  const m = /^TIER_(\d+)(K)?$/.exec(crudo);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "K" ? n * 1000 : n;
}

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function motivoDe(
  lectura: { estado: "error"; mensaje: string } | { estado: "no-expuesto"; motivo: string },
): string {
  return lectura.estado === "error" ? lectura.mensaje : lectura.motivo;
}

function numeroLeido(n: NumeroCrudo, configurado: string): NumeroLeido {
  return {
    id: n.id,
    numero: n.display_phone_number,
    nombreVerificado: n.verified_name,
    calidad: n.quality_rating,
    esElConfigurado: n.id === configurado,
  };
}

function entidadDeEnvio(e: EntidadDeSaludCruda): EntidadDeEnvio {
  return {
    tipo: e.entity_type,
    id: e.id,
    puedeEnviar: e.can_send_message,
    errores: e.errors.map((x) => ({
      codigo: x.error_code,
      descripcion: x.error_description,
      solucion: x.possible_solution,
    })),
    infoAdicional: e.additional_info,
  };
}

function plantillaLeida(p: PlantillaCruda): PlantillaLeida {
  return {
    id: p.id,
    nombre: p.name,
    idioma: p.language,
    categoria: p.category,
    estado: p.status,
    motivoRechazo: p.rejected_reason,
    calidad: p.quality_score,
    encabezado: p.header_text,
    cuerpo: p.body_text,
    pie: p.footer_text,
    respuestasRapidas: [...p.quick_replies],
  };
}

/**
 * El estado de la cuenta de WhatsApp tal como lo expone Meta, para el panel
 * de salud de `/ajustes`.
 *
 * Cada dato se lee aparte y falla aparte: un campo que la versión de la API no
 * conozca, un permiso que el token no tenga o un timeout se quedan en SU
 * sección y las demás se dibujan igual. Por eso `leer()` no lanza nunca.
 *
 * La WABA no está en env: se toma de las entidades que devuelve el
 * `health_status` del número, que la nombra con su id. Si ese pedido falla, lo
 * que depende de la WABA (la lista de números, las plantillas) lo dice, y los
 * números caen al configurado, que se lee directo.
 */
export class DefaultSaludWhatsAppService implements SaludWhatsAppService {
  private readonly ahora: () => Date;
  private readonly limitePlantillas: number;

  constructor(private readonly deps: SaludWhatsAppDeps) {
    this.ahora = deps.ahora ?? (() => new Date());
    this.limitePlantillas = deps.limitePlantillas ?? LIMITE_PLANTILLAS;
  }

  async leer(): Promise<SaludWhatsApp> {
    const { cliente, phoneNumberId } = this.deps;
    const consultadoAt = this.ahora();

    const [numero, limiteCrudo, salud] = await Promise.all([
      this.intentar("numero", () => cliente.leerNumero(phoneNumberId)),
      this.intentar("limite", () => cliente.leerLimiteDeMensajeria(phoneNumberId)),
      this.intentar("salud", () => cliente.leerSalud(phoneNumberId)),
    ]);

    const waba = this.wabaDe(salud);

    let lista: LecturaMeta<{ numeros: NumeroCrudo[]; hayMas: boolean }>;
    let plantillas: LecturaMeta<{ plantillas: PlantillaCruda[]; hayMas: boolean }>;
    if (waba.estado === "ok") {
      [lista, plantillas] = await Promise.all([
        this.intentar("numeros", () => cliente.listarNumeros(waba.valor)),
        this.intentar("plantillas", () =>
          cliente.listarPlantillas(waba.valor, this.limitePlantillas),
        ),
      ]);
    } else {
      lista = waba;
      plantillas = waba;
    }

    return {
      consultadoAt,
      versionApi: this.deps.versionApi,
      estadoDeEnvio:
        salud.estado === "ok"
          ? {
              estado: "ok",
              valor: {
                puedeEnviar: salud.valor.can_send_message,
                entidades: salud.valor.entities.map(entidadDeEnvio),
              },
            }
          : salud,
      limite: this.limiteDe(limiteCrudo),
      usoDelLimite: { estado: "no-expuesto", motivo: MOTIVO_USO },
      numeros: this.numerosDe(numero, lista),
      plantillas:
        plantillas.estado === "ok"
          ? {
              estado: "ok",
              valor: {
                plantillas: plantillas.valor.plantillas.map(plantillaLeida),
                hayMas: plantillas.valor.hayMas,
                limite: this.limitePlantillas,
              },
            }
          : plantillas,
      sancion: { estado: "no-expuesto", motivo: MOTIVO_SANCION },
    };
  }

  private wabaDe(salud: LecturaMeta<{ entities: EntidadDeSaludCruda[] }>): LecturaMeta<string> {
    if (salud.estado === "error") {
      return {
        estado: "error",
        mensaje: `Para leer la cuenta (WABA) hace falta health_status, y no respondió: ${salud.mensaje}`,
      };
    }
    if (salud.estado === "no-expuesto") return salud;

    const id = salud.valor.entities.find((e) => e.entity_type === "WABA" && e.id !== null)?.id;
    return id ? { estado: "ok", valor: id } : { estado: "no-expuesto", motivo: MOTIVO_SIN_WABA };
  }

  private limiteDe(crudo: LecturaMeta<string | null>): LecturaMeta<LimiteDeMensajeria> {
    if (crudo.estado !== "ok") return crudo;
    if (crudo.valor === null) {
      return {
        estado: "no-expuesto",
        motivo: "Meta respondió sin el campo whatsapp_business_manager_messaging_limit.",
      };
    }
    return {
      estado: "ok",
      valor: { crudo: crudo.valor, destinatarios: interpretarEscalon(crudo.valor) },
    };
  }

  private numerosDe(
    numero: LecturaMeta<NumeroCrudo>,
    lista: LecturaMeta<{ numeros: NumeroCrudo[]; hayMas: boolean }>,
  ): LecturaMeta<NumerosLeidos> {
    const configurado = this.deps.phoneNumberId;
    if (lista.estado === "ok") {
      return {
        estado: "ok",
        valor: {
          numeros: lista.valor.numeros.map((n) => numeroLeido(n, configurado)),
          hayMas: lista.valor.hayMas,
          motivoParcial: null,
        },
      };
    }
    if (numero.estado !== "ok") return numero;
    return {
      estado: "ok",
      valor: {
        numeros: [numeroLeido(numero.valor, configurado)],
        hayMas: false,
        motivoParcial: motivoDe(lista),
      },
    };
  }

  private async intentar<T>(operacion: string, fn: () => Promise<T>): Promise<LecturaMeta<T>> {
    try {
      return { estado: "ok", valor: await fn() };
    } catch (error) {
      const mensaje = mensajeDe(error);
      // `detalle` y no `mensaje`: `redactPii` tacha la clave `mensaje` (es la
      // del cuerpo de un WhatsApp) y el aviso llegaría vacío. El texto ya salió
      // saneado del cliente: no trae el token.
      this.deps.logger.warn("meta.salud.lectura_fallida", {
        operacion,
        tipo: error instanceof Error ? error.name : typeof error,
        detalle: mensaje,
      });
      return { estado: "error", mensaje };
    }
  }
}
