import { ConflictError, IllegalStateError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  ESTADOS_QUE_SALIERON,
  ESTADO_ENVIO,
  conteoVacio,
  transicionEnvioPermitida,
  type ContenidoEnvio,
  type ConteoEnvios,
  type DifusionEnvio,
  type EstadoEnvio,
  type MotivoExclusion,
  type RutaEnvio,
} from "@/lib/difusion/modelo";
import type { PlanDifusion } from "@/lib/difusion/planificador";
import { TELEFONO_WHATSAPP, normalizarTelefonoWhatsApp } from "@/lib/difusion/telefono";
import type { UUID } from "@/types/entities";
import { exigirPagina } from "./_paginacion";

/** Una fila del plan. Nace excluida o en cola: nunca ya enviada. */
export interface DifusionEnvioInsert {
  difusion_id: UUID;
  lead_id: UUID;
  /** Dígitos E.164 sin `+`; `null` sólo con `sin_telefono`. */
  telefono: string | null;
  estado: "excluido" | "en_cola";
  motivo_exclusion: MotivoExclusion | null;
  ruta: RutaEnvio | null;
  tanda: number | null;
  programado_para: Date | null;
}

/**
 * El plan del planificador como filas de `difusion_envios`: una por lead de la
 * audiencia inicial. Los destinatarios entran en cola con su ruta y su tanda;
 * los excluidos, con su motivo y sin plan.
 */
export function filasDesdePlan(
  difusionId: UUID,
  plan: Pick<PlanDifusion, "destinatarios" | "exclusiones">,
): DifusionEnvioInsert[] {
  return [
    ...plan.destinatarios.map(
      (d): DifusionEnvioInsert => ({
        difusion_id: difusionId,
        lead_id: d.leadId,
        telefono: d.telefono,
        estado: "en_cola",
        motivo_exclusion: null,
        ruta: d.ruta,
        tanda: d.tanda,
        programado_para: d.programadoPara,
      }),
    ),
    ...plan.exclusiones.map(
      (e): DifusionEnvioInsert => ({
        difusion_id: difusionId,
        lead_id: e.leadId,
        telefono: e.telefono,
        estado: "excluido",
        motivo_exclusion: e.motivo,
        ruta: null,
        tanda: null,
        programado_para: null,
      }),
    ),
  ];
}

/**
 * Cómo sale un envío, decidido al mandar: la ruta según la ventana de ese
 * momento (la del plan pudo cambiar en días) y el contenido. El texto libre
 * sólo sale con la ventana abierta (CHECK `difusion_envios_texto_libre_en_ventana`).
 */
export interface SalidaEnvio {
  ruta: RutaEnvio;
  contenido: ContenidoEnvio;
}

export interface ErrorMeta {
  /** Código de la Cloud API: "131026", "131049"… */
  codigo: string;
  detalle?: string | null;
}

/** El cap de marketing por persona de Meta (PRD §4.3). */
export const CODIGO_META_SATURADO = "131049";

/** Los envíos de una difusión contados por estado. */
export interface ResumenEnvios {
  total: number;
  porEstado: Record<EstadoEnvio, number>;
}

/** Una tanda del plan ya persistido. */
export interface TandaPersistida {
  tanda: number;
  /** El `programado_para` más temprano de la tanda. */
  desde: Date;
  total: number;
  enCola: number;
  porPlantilla: number;
}

/** La muestra de una difusión, contada por estado y código de error. */
export interface ConteoMuestra {
  estado: EstadoEnvio;
  /** Null en lo que no falló. */
  codigo: string | null;
  cantidad: number;
}

export interface FalloPorCodigo {
  /** Código de error de la Cloud API. */
  codigo: string;
  cantidad: number;
}

/** Difusiones por llamada a `difusion_envios_resumen`: el resultado nunca pasa el corte de PostgREST. */
export const LOTE_RESUMEN = 1000;

export function resumenVacio(): ResumenEnvios {
  return {
    total: 0,
    porEstado: Object.fromEntries(ESTADO_ENVIO.map((e) => [e, 0])) as Record<EstadoEnvio, number>,
  };
}

export interface DifusionEnviosRepository {
  /**
   * Persiste el plan: una fila por lead de la audiencia inicial. Idempotente
   * por (difusión, lead): repetirlo no duplica ni pisa lo que ya avanzó.
   * `ConflictError` si dos filas en cola comparten teléfono en la misma difusión.
   */
  registrarPlan(filas: readonly DifusionEnvioInsert[]): Promise<void>;
  findById(id: UUID): Promise<DifusionEnvio | null>;
  /** Por tanda y después por id: un orden estable para paginar. */
  listarPorDifusion(
    difusionId: UUID,
    pagina: { limite: number; desde?: number },
  ): Promise<DifusionEnvio[]>;
  contarPorDifusion(difusionId: UUID): Promise<ConteoEnvios>;
  /**
   * El 200 de la Cloud API: `aceptado`, nunca "enviado". Desde `en_cola`, o
   * desde `cancelado` si estaba en vuelo al detener. Idempotente con el mismo
   * wamid; `IllegalStateError` desde cualquier otro estado.
   */
  marcarAceptado(id: UUID, metaMessageId: string): Promise<DifusionEnvio>;
  /** La llamada a Meta falló. Idempotente con el mismo código. */
  marcarFallido(id: UUID, error: ErrorMeta): Promise<DifusionEnvio>;
  /**
   * El estado que informa el webhook de Meta, por wamid. Nunca retrocede:
   * un "entregado" que llega después del "leído" no hace nada. `null` si el
   * wamid no es de una difusión.
   */
  aplicarEstadoMeta(
    metaMessageId: string,
    estado: "entregado" | "leido" | "fallido",
    error?: ErrorMeta,
  ): Promise<DifusionEnvio | null>;
  /**
   * Detener: todo lo que está en cola pasa a `cancelado`. Devuelve cuántos se
   * frenaron y cuántos ya habían llegado a Meta, que no se recuperan (§8.5).
   */
  cancelarPendientes(difusionId: UUID): Promise<{ cancelados: number; yaSalieron: number }>;
  /**
   * El último 131049 por teléfono desde `desde`: la entrada `saturaciones` del
   * planificador. Los teléfonos se normalizan; los que no son de WhatsApp se ignoran.
   */
  saturadosDesde(telefonos: readonly string[], desde: Date): Promise<Map<string, Date>>;
  /**
   * Los envíos de cada difusión pedida, contados por estado. Las que no tienen
   * envíos no aparecen en el mapa. Cuenta la base: la app no trae la
   * audiencia entera para contarla.
   */
  resumenPorDifusiones(difusionIds: readonly UUID[]): Promise<Map<UUID, ResumenEnvios>>;
  /** El plan persistido de una difusión, por tanda y en orden. */
  tandasPorDifusion(difusionId: UUID): Promise<TandaPersistida[]>;
  /** Los fallidos agrupados por código de Meta, el más frecuente primero. */
  fallosPorCodigo(difusionId: UUID): Promise<FalloPorCodigo[]>;

  // ---- Lo que usa el motor que drena la cola -----------------------------

  /**
   * En cola, sin reservar y con `programado_para <= hasta`, en orden de
   * salida. Hasta `limite` filas.
   */
  pendientesParaEnviar(difusionId: UUID, hasta: Date, limite: number): Promise<DifusionEnvio[]>;
  /**
   * En cola pero reservadas antes de `antesDe`: el proceso murió entre la
   * reserva y el desenlace. Nadie sabe si Meta lo recibió.
   */
  reservadosSinDesenlace(difusionId: UUID, antesDe: Date, limite: number): Promise<DifusionEnvio[]>;
  /**
   * Reserva el envío para mandarlo: sólo si sigue en cola y nadie lo reservó.
   * `false` = otro lo tomó, o ya no está en cola. Es lo que impide mandar dos
   * veces: se reserva ANTES de llamar a Meta.
   */
  reservar(id: UUID, at: Date, salida?: SalidaEnvio): Promise<boolean>;
  /**
   * Devuelve a la cola una reserva que Meta rechazó sin mandar (429, 131056).
   * Sólo si sigue en cola: lo que ya tiene desenlace no se toca. Borra
   * también `salio_como`: no salió nada.
   */
  liberarReserva(id: UUID): Promise<void>;
  /**
   * Re-evaluado al salir (§8.6): en cola y sin reservar → excluido con su
   * motivo. `false` si ya no estaba en esas condiciones.
   */
  marcarExcluido(id: UUID, motivo: MotivoExclusion): Promise<boolean>;
  /**
   * De esos leads, los que recibieron algo desde `desde`: cualquier saliente
   * del hilo o un envío reservado de cualquier difusión. Meta limita a un
   * mensaje cada 6 s por destinatario (131056).
   */
  leadsConSalienteDesde(leadIds: readonly UUID[], desde: Date): Promise<Set<UUID>>;

  // ---- Lo que usa el pipeline cuando el lead responde ---------------------

  /**
   * El último envío a este lead que llegó a Meta (aceptado, entregado o
   * leído) y se mandó desde `desde` (por `intento_at`, la hora de envío).
   * `null` si no hay. Es la difusión a la que responde un entrante.
   */
  ultimoSalidoParaLead(leadId: UUID, desde: Date): Promise<DifusionEnvio | null>;
  /**
   * Marca el envío como respondido por el entrante `wamid`. `true` si esta es
   * la primera respuesta: la marcó ahora, o ya estaba marcada con ESE mismo
   * entrante (el reintento de un step). `false` si la marcó otro entrante.
   */
  marcarRespondido(id: UUID, wamid: string, at: Date): Promise<boolean>;
  /** Los envíos respondidos de una difusión, lo más nuevo primero. */
  respondidos(difusionId: UUID, limite: number): Promise<DifusionEnvio[]>;
  contarRespondidos(difusionId: UUID): Promise<number>;
  /** Cuántos envíos se reservaron para salir desde `desde`: el ritmo real. */
  contarReservadosDesde(difusionId: UUID, desde: Date): Promise<number>;
  /** Lo reservado hasta `hasta` (la muestra), por estado y código. */
  conteoMuestra(difusionId: UUID, hasta: Date): Promise<ConteoMuestra[]>;

  // ---- Audiencia dinámica ---------------------------------------------------

  /**
   * Suma a una difusión dinámica los leads que empezaron a coincidir, marcados
   * como alta. Un lead que ya está no se toca; un alta en cola con el teléfono
   * de un envío vivo entra excluida por `duplicado_telefono`. Devuelve cuántas
   * filas escribió. La base sólo lo deja con una difusión dinámica que no
   * terminó (`difusion_sumar_altas()`).
   */
  sumarAltas(filas: readonly DifusionEnvioInsert[]): Promise<number>;
  /** Los leads que ya tiene la difusión, en cualquier estado. */
  leadsDeLaDifusion(difusionId: UUID): Promise<Set<UUID>>;
  /** Cuántos entraron después de programar. */
  contarAltas(difusionId: UUID): Promise<number>;
}

const SALIERON: ReadonlySet<EstadoEnvio> = new Set<EstadoEnvio>(ESTADOS_QUE_SALIERON);

/**
 * Los CHECK y el trigger de `difusion_envios` para una fila nueva, en
 * TypeScript: el in-memory falla donde falla la base. Los mensajes no llevan
 * el teléfono (§0.9: un teléfono no va a un mensaje que puede terminar en un log).
 */
export function incoherenciaEnvio(f: DifusionEnvioInsert): string | null {
  if (f.estado !== "excluido" && f.estado !== "en_cola") {
    return `un envío nace excluido o en cola, nunca como ${String(f.estado)}`;
  }
  if (!f.lead_id) return "un envío se planifica para un lead";
  if ((f.estado === "excluido") !== (f.motivo_exclusion !== null)) {
    return "un excluido lleva motivo, y sólo un excluido";
  }
  if (
    f.estado === "en_cola" &&
    (f.telefono === null || f.ruta === null || f.tanda === null || f.programado_para === null)
  ) {
    return "un envío en cola lleva teléfono, ruta, tanda y fecha";
  }
  if ((f.telefono === null) !== (f.motivo_exclusion === "sin_telefono")) {
    return "sólo un excluido por sin_telefono va sin teléfono";
  }
  if (f.telefono !== null && !TELEFONO_WHATSAPP.test(f.telefono)) {
    return "el teléfono tiene que venir normalizado: dígitos E.164 sin +";
  }
  if (f.tanda !== null && (!Number.isInteger(f.tanda) || f.tanda < 0)) {
    return "la tanda es un entero ≥ 0";
  }
  if ((f.tanda === null) !== (f.programado_para === null)) {
    return "la tanda va con su fecha, y la fecha con su tanda";
  }
  return null;
}

export function exigirErrorMeta(error: ErrorMeta | undefined): Required<ErrorMeta> {
  const codigo = error?.codigo?.trim() ?? "";
  if (codigo.length < 1 || codigo.length > 40) {
    throw new ValidationError("un fallido lleva el código de Meta (1 a 40 caracteres)");
  }
  const detalle = error?.detalle ?? null;
  if (detalle !== null && detalle.length > 1000) {
    throw new ValidationError("el detalle del error admite hasta 1.000 caracteres");
  }
  return { codigo, detalle };
}

export function exigirWamid(metaMessageId: string): void {
  if (metaMessageId.length < 1 || metaMessageId.length > 200) {
    throw new ValidationError("el wamid de Meta tiene entre 1 y 200 caracteres");
  }
}

export function exigirSalida(salida: SalidaEnvio): void {
  if (salida.contenido === "texto_libre" && salida.ruta !== "ventana_abierta") {
    throw new ValidationError("el texto libre sólo sale con la ventana de 24 h abierta");
  }
}

/** Teléfonos normalizados y sin repetir; los que no son de WhatsApp quedan afuera. */
export function telefonosNormalizados(telefonos: readonly string[]): string[] {
  const unicos = new Set<string>();
  for (const t of telefonos) {
    const n = normalizarTelefonoWhatsApp(t);
    if (n !== null) unicos.add(n);
  }
  return [...unicos];
}

export function yaSalieron(conteo: ConteoEnvios): number {
  return ESTADOS_QUE_SALIERON.reduce((total, e) => total + conteo.porEstado[e], 0);
}

/** Como sale: por fecha programada y después por id. */
function porOrdenDeSalida(a: DifusionEnvio, b: DifusionEnvio): number {
  const ta = a.programado_para?.getTime() ?? Number.POSITIVE_INFINITY;
  const tb = b.programado_para?.getTime() ?? Number.POSITIVE_INFINITY;
  if (ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function porOrdenDeLista(a: DifusionEnvio, b: DifusionEnvio): number {
  const ta = a.tanda ?? Number.POSITIVE_INFINITY;
  const tb = b.tanda ?? Number.POSITIVE_INFINITY;
  if (ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export class InMemoryDifusionEnviosRepository implements DifusionEnviosRepository {
  private readonly store = new Map<UUID, DifusionEnvio>();
  private ultimo = 0;

  private reloj(): Date {
    this.ultimo = Math.max(Date.now(), this.ultimo + 1);
    return new Date(this.ultimo);
  }

  async registrarPlan(filas: readonly DifusionEnvioInsert[]): Promise<void> {
    await this.insertar(filas, false);
  }

  async sumarAltas(filas: readonly DifusionEnvioInsert[]): Promise<number> {
    // Como la función de la base: un alta en cola cuyo teléfono ya tiene un
    // envío vivo en la difusión entra excluida por duplicado.
    const vivos = new Set(
      [...this.store.values()]
        .filter((e) => e.estado !== "excluido")
        .map((e) => `${e.difusion_id}|${e.telefono}`),
    );
    const ajustadas = filas.map(
      (f): DifusionEnvioInsert =>
        f.estado === "en_cola" && vivos.has(`${f.difusion_id}|${f.telefono}`)
          ? {
              ...f,
              estado: "excluido",
              motivo_exclusion: "duplicado_telefono",
              ruta: null,
              tanda: null,
              programado_para: null,
            }
          : f,
    );
    return this.insertar(ajustadas, true);
  }

  async leadsDeLaDifusion(difusionId: UUID): Promise<Set<UUID>> {
    const leads = new Set<UUID>();
    for (const e of this.store.values()) {
      if (e.difusion_id === difusionId && e.lead_id !== null) leads.add(e.lead_id);
    }
    return leads;
  }

  async contarAltas(difusionId: UUID): Promise<number> {
    return [...this.store.values()].filter((e) => e.difusion_id === difusionId && e.alta_dinamica)
      .length;
  }

  private async insertar(filas: readonly DifusionEnvioInsert[], alta: boolean): Promise<number> {
    for (const f of filas) {
      const problema = incoherenciaEnvio(f);
      if (problema) throw new ValidationError(problema);
    }

    const leads = new Set<string>();
    const telefonosEnCurso = new Set<string>();
    for (const e of this.store.values()) {
      leads.add(`${e.difusion_id}|${e.lead_id}`);
      if (e.estado !== "excluido") telefonosEnCurso.add(`${e.difusion_id}|${e.telefono}`);
    }

    // Todo el lote o nada, como un INSERT de un solo statement.
    const nuevas: DifusionEnvio[] = [];
    for (const f of filas) {
      const claveLead = `${f.difusion_id}|${f.lead_id}`;
      // ON CONFLICT (difusion_id, lead_id) DO NOTHING.
      if (leads.has(claveLead)) continue;
      if (f.estado !== "excluido") {
        const claveTelefono = `${f.difusion_id}|${f.telefono}`;
        if (telefonosEnCurso.has(claveTelefono)) {
          throw new ConflictError(
            "dos envíos al mismo teléfono en la misma difusión",
            "unique_violation",
          );
        }
        telefonosEnCurso.add(claveTelefono);
      }
      leads.add(claveLead);
      const ahora = this.reloj();
      nuevas.push({
        id: crypto.randomUUID(),
        difusion_id: f.difusion_id,
        lead_id: f.lead_id,
        telefono: f.telefono,
        estado: f.estado,
        motivo_exclusion: f.motivo_exclusion,
        ruta: f.ruta,
        tanda: f.tanda,
        programado_para: f.programado_para === null ? null : new Date(f.programado_para),
        meta_message_id: null,
        error_codigo: null,
        error_detalle: null,
        intento_at: null,
        created_at: ahora,
        estado_at: ahora,
        respondido_at: null,
        respuesta_meta_message_id: null,
        salio_como: null,
        alta_dinamica: alta,
      });
    }
    for (const n of nuevas) this.store.set(n.id, n);
    return nuevas.length;
  }

  async findById(id: UUID): Promise<DifusionEnvio | null> {
    const e = this.store.get(id);
    return e ? structuredClone(e) : null;
  }

  async listarPorDifusion(
    difusionId: UUID,
    { limite, desde = 0 }: { limite: number; desde?: number },
  ): Promise<DifusionEnvio[]> {
    exigirPagina(limite, desde);
    return [...this.store.values()]
      .filter((e) => e.difusion_id === difusionId)
      .sort(porOrdenDeLista)
      .slice(desde, desde + limite)
      .map((e) => structuredClone(e));
  }

  async contarPorDifusion(difusionId: UUID): Promise<ConteoEnvios> {
    const conteo = conteoVacio();
    for (const e of this.store.values()) {
      if (e.difusion_id !== difusionId) continue;
      conteo.total += 1;
      conteo.porEstado[e.estado] += 1;
      if (e.motivo_exclusion !== null) conteo.porMotivo[e.motivo_exclusion] += 1;
    }
    return conteo;
  }

  async marcarAceptado(id: UUID, metaMessageId: string): Promise<DifusionEnvio> {
    exigirWamid(metaMessageId);
    const actual = this.exigir(id);
    if (transicionEnvioPermitida(actual.estado, "aceptado")) {
      const otro = [...this.store.values()].find(
        (e) => e.meta_message_id === metaMessageId && e.id !== id,
      );
      if (otro) throw new ConflictError("ese wamid ya es de otro envío", "unique_violation");
      return this.guardar({
        ...actual,
        estado: "aceptado",
        meta_message_id: metaMessageId,
        estado_at: this.reloj(),
      });
    }
    if (actual.meta_message_id === metaMessageId && SALIERON.has(actual.estado)) {
      return structuredClone(actual);
    }
    throw new IllegalStateError(
      `el envío ${id} está ${actual.estado}: no puede pasar a aceptado`,
      "transicion_envio",
    );
  }

  async marcarFallido(id: UUID, error: ErrorMeta): Promise<DifusionEnvio> {
    const { codigo, detalle } = exigirErrorMeta(error);
    const actual = this.exigir(id);
    if (transicionEnvioPermitida(actual.estado, "fallido")) {
      return this.guardar({
        ...actual,
        estado: "fallido",
        error_codigo: codigo,
        error_detalle: detalle,
        estado_at: this.reloj(),
      });
    }
    if (actual.estado === "fallido" && actual.error_codigo === codigo)
      return structuredClone(actual);
    throw new IllegalStateError(
      `el envío ${id} está ${actual.estado}: no puede pasar a fallido`,
      "transicion_envio",
    );
  }

  async aplicarEstadoMeta(
    metaMessageId: string,
    estado: "entregado" | "leido" | "fallido",
    error?: ErrorMeta,
  ): Promise<DifusionEnvio | null> {
    const errorMeta = estado === "fallido" ? exigirErrorMeta(error) : null;
    const actual = [...this.store.values()].find((e) => e.meta_message_id === metaMessageId);
    if (!actual) return null;
    if (!transicionEnvioPermitida(actual.estado, estado)) return structuredClone(actual);
    return this.guardar({
      ...actual,
      estado,
      error_codigo: errorMeta?.codigo ?? actual.error_codigo,
      error_detalle: errorMeta?.detalle ?? actual.error_detalle,
      estado_at: this.reloj(),
    });
  }

  async cancelarPendientes(difusionId: UUID): Promise<{ cancelados: number; yaSalieron: number }> {
    let cancelados = 0;
    for (const e of this.store.values()) {
      if (e.difusion_id !== difusionId || e.estado !== "en_cola") continue;
      this.store.set(e.id, { ...e, estado: "cancelado", estado_at: this.reloj() });
      cancelados += 1;
    }
    return { cancelados, yaSalieron: yaSalieron(await this.contarPorDifusion(difusionId)) };
  }

  async saturadosDesde(telefonos: readonly string[], desde: Date): Promise<Map<string, Date>> {
    const buscados = new Set(telefonosNormalizados(telefonos));
    const saturados = new Map<string, Date>();
    for (const e of this.store.values()) {
      if (
        e.estado !== "fallido" ||
        e.error_codigo !== CODIGO_META_SATURADO ||
        e.telefono === null ||
        !buscados.has(e.telefono) ||
        e.estado_at.getTime() < desde.getTime()
      ) {
        continue;
      }
      const previo = saturados.get(e.telefono);
      if (!previo || previo < e.estado_at) saturados.set(e.telefono, new Date(e.estado_at));
    }
    return saturados;
  }

  async resumenPorDifusiones(difusionIds: readonly UUID[]): Promise<Map<UUID, ResumenEnvios>> {
    const pedidas = new Set(difusionIds);
    const resumen = new Map<UUID, ResumenEnvios>();
    for (const e of this.store.values()) {
      if (!pedidas.has(e.difusion_id)) continue;
      const r = resumen.get(e.difusion_id) ?? resumenVacio();
      r.total += 1;
      r.porEstado[e.estado] += 1;
      resumen.set(e.difusion_id, r);
    }
    return resumen;
  }

  async tandasPorDifusion(difusionId: UUID): Promise<TandaPersistida[]> {
    const porTanda = new Map<number, TandaPersistida>();
    for (const e of this.store.values()) {
      if (e.difusion_id !== difusionId || e.tanda === null || e.programado_para === null) continue;
      const t = porTanda.get(e.tanda) ?? {
        tanda: e.tanda,
        desde: new Date(e.programado_para),
        total: 0,
        enCola: 0,
        porPlantilla: 0,
      };
      if (e.programado_para < t.desde) t.desde = new Date(e.programado_para);
      t.total += 1;
      if (e.estado === "en_cola") t.enCola += 1;
      if (e.ruta === "plantilla") t.porPlantilla += 1;
      porTanda.set(e.tanda, t);
    }
    return [...porTanda.values()].sort((a, b) => a.tanda - b.tanda);
  }

  async fallosPorCodigo(difusionId: UUID): Promise<FalloPorCodigo[]> {
    const porCodigo = new Map<string, number>();
    for (const e of this.store.values()) {
      if (e.difusion_id !== difusionId || e.estado !== "fallido" || e.error_codigo === null)
        continue;
      porCodigo.set(e.error_codigo, (porCodigo.get(e.error_codigo) ?? 0) + 1);
    }
    return [...porCodigo.entries()]
      .map(([codigo, cantidad]) => ({ codigo, cantidad }))
      .sort(
        (a, b) =>
          b.cantidad - a.cantidad || (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0),
      );
  }

  async pendientesParaEnviar(
    difusionId: UUID,
    hasta: Date,
    limite: number,
  ): Promise<DifusionEnvio[]> {
    exigirPagina(limite);
    return [...this.store.values()]
      .filter(
        (e) =>
          e.difusion_id === difusionId &&
          e.estado === "en_cola" &&
          e.intento_at === null &&
          e.programado_para !== null &&
          e.programado_para.getTime() <= hasta.getTime(),
      )
      .sort(porOrdenDeSalida)
      .slice(0, limite)
      .map((e) => structuredClone(e));
  }

  async reservadosSinDesenlace(
    difusionId: UUID,
    antesDe: Date,
    limite: number,
  ): Promise<DifusionEnvio[]> {
    exigirPagina(limite);
    return [...this.store.values()]
      .filter(
        (e) =>
          e.difusion_id === difusionId &&
          e.estado === "en_cola" &&
          e.intento_at !== null &&
          e.intento_at.getTime() <= antesDe.getTime(),
      )
      .sort(porOrdenDeSalida)
      .slice(0, limite)
      .map((e) => structuredClone(e));
  }

  async reservar(id: UUID, at: Date, salida?: SalidaEnvio): Promise<boolean> {
    if (salida) exigirSalida(salida);
    const e = this.store.get(id);
    if (!e || e.estado !== "en_cola" || e.intento_at !== null) return false;
    this.store.set(id, {
      ...e,
      intento_at: new Date(at),
      ...(salida ? { ruta: salida.ruta, salio_como: salida.contenido } : {}),
    });
    return true;
  }

  async liberarReserva(id: UUID): Promise<void> {
    const e = this.store.get(id);
    if (!e || e.estado !== "en_cola") return;
    this.store.set(id, { ...e, intento_at: null, salio_como: null });
  }

  async marcarExcluido(id: UUID, motivo: MotivoExclusion): Promise<boolean> {
    const e = this.store.get(id);
    if (!e || e.estado !== "en_cola" || e.intento_at !== null) return false;
    this.store.set(id, {
      ...e,
      estado: "excluido",
      motivo_exclusion: motivo,
      estado_at: this.reloj(),
    });
    return true;
  }

  /** Salientes que no pasan por una difusión (el agente, un vendedor): los carga el test. */
  private readonly salientesExternos: { leadId: UUID; at: Date }[] = [];

  registrarSalienteExterno(leadId: UUID, at: Date): void {
    this.salientesExternos.push({ leadId, at: new Date(at) });
  }

  async leadsConSalienteDesde(leadIds: readonly UUID[], desde: Date): Promise<Set<UUID>> {
    const buscados = new Set(leadIds);
    const con = new Set<UUID>();
    for (const s of this.salientesExternos) {
      if (buscados.has(s.leadId) && s.at.getTime() >= desde.getTime()) con.add(s.leadId);
    }
    for (const e of this.store.values()) {
      if (
        e.lead_id !== null &&
        buscados.has(e.lead_id) &&
        e.intento_at !== null &&
        e.intento_at.getTime() >= desde.getTime()
      ) {
        con.add(e.lead_id);
      }
    }
    return con;
  }

  async ultimoSalidoParaLead(leadId: UUID, desde: Date): Promise<DifusionEnvio | null> {
    let mejor: DifusionEnvio | null = null;
    for (const e of this.store.values()) {
      if (e.lead_id !== leadId || !SALIERON.has(e.estado) || e.intento_at === null) continue;
      if (e.intento_at.getTime() < desde.getTime()) continue;
      if (mejor === null || e.intento_at.getTime() > (mejor.intento_at?.getTime() ?? 0)) mejor = e;
    }
    return mejor ? structuredClone(mejor) : null;
  }

  async marcarRespondido(id: UUID, wamid: string, at: Date): Promise<boolean> {
    const e = this.exigir(id);
    if (e.respuesta_meta_message_id !== null) return e.respuesta_meta_message_id === wamid;
    this.store.set(id, { ...e, respondido_at: at, respuesta_meta_message_id: wamid });
    return true;
  }

  async respondidos(difusionId: UUID, limite: number): Promise<DifusionEnvio[]> {
    return [...this.store.values()]
      .filter((e) => e.difusion_id === difusionId && e.respondido_at !== null)
      .sort((a, b) => (b.respondido_at?.getTime() ?? 0) - (a.respondido_at?.getTime() ?? 0))
      .slice(0, limite)
      .map((e) => structuredClone(e));
  }

  async contarRespondidos(difusionId: UUID): Promise<number> {
    return [...this.store.values()].filter(
      (e) => e.difusion_id === difusionId && e.respondido_at !== null,
    ).length;
  }

  async contarReservadosDesde(difusionId: UUID, desde: Date): Promise<number> {
    return [...this.store.values()].filter(
      (e) =>
        e.difusion_id === difusionId &&
        e.intento_at !== null &&
        e.intento_at.getTime() >= desde.getTime(),
    ).length;
  }

  async conteoMuestra(difusionId: UUID, hasta: Date): Promise<ConteoMuestra[]> {
    const porClave = new Map<string, ConteoMuestra>();
    for (const e of this.store.values()) {
      if (e.difusion_id !== difusionId || e.intento_at === null) continue;
      if (e.intento_at.getTime() > hasta.getTime()) continue;
      const clave = `${e.estado}|${e.error_codigo ?? ""}`;
      const previo = porClave.get(clave);
      if (previo) previo.cantidad += 1;
      else porClave.set(clave, { estado: e.estado, codigo: e.error_codigo, cantidad: 1 });
    }
    return [...porClave.values()];
  }

  private exigir(id: UUID): DifusionEnvio {
    const e = this.store.get(id);
    if (!e) throw new NotFoundError(`envío no encontrado: ${id}`, "difusion_envio", id);
    return e;
  }

  private guardar(e: DifusionEnvio): DifusionEnvio {
    this.store.set(e.id, e);
    return structuredClone(e);
  }
}
