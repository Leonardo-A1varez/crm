import { cupoParaPlanificar } from "@/lib/difusion/cupo";
import {
  motivoDeSupresion,
  type Difusion,
  type DifusionEnvio,
  type EstadoDifusion,
} from "@/lib/difusion/modelo";
import { camposUsados, resolverParametros, type CampoParametro } from "@/lib/difusion/parametros";
import { reaccionAFallo, type OrigenFallo } from "@/lib/difusion/reacciones";
import { errorDeGraph } from "@/lib/meta/error-graph";
import type { Logger } from "@/lib/observability/logger";
import type { DatosInterpolacion } from "@/lib/workflows/variables";
import type { DifusionEnviosRepository } from "@/server/repositories/difusion-envios.repo";
import type { DifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.repo";
import type { DifusionesRepository } from "@/server/repositories/difusiones.repo";
import type { MetaApiClient } from "@/server/services/meta-api.service";
import type { UUID } from "@/types/entities";
import type { LecturaTope } from "./difusion.service";

/**
 * El motor que drena la cola de una difusión programada
 * (docs/prd-workflows.md §7, docs/prd-workflows-difusion.md §4.4, §7.3, §8.5-8.6).
 *
 * El plan ya está escrito en `difusion_envios` (lo escribió `programar`): una
 * fila en cola por destinatario, con su fecha de salida. Cada llamada a
 * `drenarLote` toma la primera difusión que tenga algo vencido y manda un lote
 * chico. La función de Inngest la llama en un step por lote, así que entre
 * lote y lote el estado se vuelve a leer: pausar o detener frena el lote
 * siguiente.
 *
 * ────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO PASA POR `MetaApiService.sendTemplate`
 * ────────────────────────────────────────────────────────────────────────
 *
 * Ese servicio escribe el saliente en `mensajes`, que exige una sesión
 * (`lead_session_id` NOT NULL), y las sesiones cerradas se purgan a los 29
 * días: el destinatario típico de una difusión —un lead que dejó de hablar— no
 * tiene ninguna. La idempotencia es la misma idea con otra fila: se reserva el
 * envío en `difusion_envios.intento_at` ANTES de llamar a Meta, con un UPDATE
 * condicional. Un reintento ve la reserva y no manda otra vez; si el desenlace
 * quedó desconocido, la fila se cierra como fallida y no se reenvía, porque un
 * WhatsApp duplicado no se puede retirar.
 *
 * ────────────────────────────────────────────────────────────────────────
 * ANTES DE CADA ENVÍO
 * ────────────────────────────────────────────────────────────────────────
 *
 * 1. Las bajas se vuelven a leer: una baja registrada entre la programación y
 *    el envío gana, y la fila pasa a excluida con su motivo. Sin claves HMAC
 *    la lectura lanza y no sale nada (falla cerrado).
 * 2. Una persona que rebotó con 131049 hace menos de 24 h no recibe marketing.
 * 3. Nadie recibe dos mensajes en menos de 6 s (131056): quien recibió algo
 *    del agente, de un vendedor o de un workflow espera al lote siguiente.
 * 4. El cupo se lee de Meta en cada lote (el escalón) y lo usado se cuenta con
 *    los envíos de este CRM; la reserva para conversaciones vivas no se toca.
 */

export interface PoliticaMotor {
  /** Envíos por lote. Cada lote es un step de Inngest. */
  loteMaximo: number;
  /** Entre envío y envío. 50 ms = hasta 20 por segundo, un cuarto de los 80/s de Meta. */
  intervaloEnvioMs: number;
  /** Meta: 1 mensaje cada 6 s al mismo destinatario (PRD §4.2). */
  separacionDestinatarioMs: number;
  /** Una reserva sin desenlace más vieja que esto quedó huérfana. */
  reservaVencidaMs: number;
  /** Cuánto se respeta un 131049 antes de volver a intentar marketing (PRD §4.3). */
  esperaSaturadoMs: number;
}

/**
 * Decisión propia, sin fuente que la fije: 25 por lote y 20 por segundo. El
 * PRD pide "por debajo de 80/s con margen"; 20/s deja tres cuartos libres para
 * el agente y los workflows, que comparten el mismo número.
 */
export const POLITICA_MOTOR: Readonly<PoliticaMotor> = Object.freeze({
  loteMaximo: 25,
  intervaloEnvioMs: 50,
  separacionDestinatarioMs: 6_000,
  reservaVencidaMs: 10 * 60_000,
  esperaSaturadoMs: 24 * 3_600_000,
});

export interface MotorDifusionDeps {
  difusiones: DifusionesRepository;
  envios: DifusionEnviosRepository;
  supresiones: Pick<DifusionSupresionesRepository, "activasPorTelefonos" | "registrar">;
  /** Destinatarios únicos a los que este CRM les mandó plantilla desde `desde`. */
  usoCupoDesde: (desde: Date) => Promise<number>;
  meta: Pick<MetaApiClient, "sendTemplate">;
  /** El escalón de mensajería que devuelve Meta por API. */
  leerTopeMensajeria: () => Promise<LecturaTope>;
  /** Los datos con que se resuelven las variables de la plantilla para un lead. */
  datosDelLead: (leadId: UUID, campos: ReadonlySet<CampoParametro>) => Promise<DatosInterpolacion>;
  esperar: (ms: number) => Promise<void>;
  logger: Logger;
  ahora?: () => Date;
  politica?: Partial<PoliticaMotor>;
}

export type ResultadoLote =
  | { tipo: "sin_trabajo" }
  | {
      tipo: "enviado";
      difusionId: UUID;
      aceptados: number;
      fallidos: number;
      excluidos: number;
      /** Se dejaron para otro lote: 6 s por persona, o Meta pidió reintentar. */
      diferidos: number;
    }
  /** Hay filas vencidas pero no hay cupo hoy, o no se pudo leer el escalón de Meta. */
  | { tipo: "esperando_cupo"; difusionId: UUID }
  /** Meta pidió bajar el ritmo (429 / 130429). */
  | { tipo: "ritmo"; difusionId: UUID }
  /** Se pausó o se detuvo en este lote: la muestra salió, o Meta frenó. */
  | { tipo: "frenada"; difusionId: UUID; motivo: string };

export interface EstadoWebhook {
  wamid: string;
  estado: "enviado" | "entregado" | "leido" | "fallido";
  codigo?: string | null;
  detalle?: string | null;
}

export interface PlanEsperado {
  difusionId: UUID;
  audienciaInicial: number;
  destinatarios: number;
}

export interface MotorDifusionService {
  drenarLote(): Promise<ResultadoLote>;
  /** Estado de entrega de un envío por wamid. `false` si el wamid no es de una difusión. */
  aplicarEstadoWebhook(input: EstadoWebhook): Promise<boolean>;
  /**
   * La invariante M ≤ N del PRD §7.4, contra el plan persistido: si no es el
   * que se programó, la difusión se detiene antes de la primera llamada a Meta.
   * `true` si el plan cuadra (o si la difusión ya arrancó y no hay qué verificar).
   */
  verificarPlan(esperado: PlanEsperado): Promise<boolean>;
}

const NO_TERMINADAS: readonly EstadoDifusion[] = ["programada", "enviando", "en_revision"];
const LARGO_DETALLE = 1000;

type Resultado =
  | { tipo: "aceptado" }
  | { tipo: "fallido" }
  | { tipo: "diferido" }
  | { tipo: "cortar"; resultado: ResultadoLote };

export class DefaultMotorDifusionService implements MotorDifusionService {
  private readonly ahora: () => Date;
  private readonly politica: PoliticaMotor;

  constructor(private readonly deps: MotorDifusionDeps) {
    this.ahora = deps.ahora ?? (() => new Date());
    this.politica = { ...POLITICA_MOTOR, ...deps.politica };
  }

  async drenarLote(): Promise<ResultadoLote> {
    const ahora = this.ahora();
    for (const candidata of await this.deps.difusiones.listarConCola()) {
      if (candidata.programada_para !== null && candidata.programada_para > ahora) continue;
      const d = await this.arrancar(candidata, ahora);
      if (!d) continue;
      const r = await this.drenarDifusion(d, ahora);
      if (r) return r;
    }
    return { tipo: "sin_trabajo" };
  }

  async verificarPlan(esperado: PlanEsperado): Promise<boolean> {
    const d = await this.deps.difusiones.findById(esperado.difusionId);
    if (!d || d.estado !== "programada") return true;
    const conteo = await this.deps.envios.contarPorDifusion(d.id);
    const destinatarios = conteo.total - conteo.porEstado.excluido;
    const cuadra =
      conteo.total === esperado.audienciaInicial &&
      destinatarios === esperado.destinatarios &&
      destinatarios <= conteo.total;
    if (cuadra) return true;

    const motivo =
      `El plan persistido no es el que se programó (se programaron ${esperado.destinatarios} ` +
      `de ${esperado.audienciaInicial}; hay ${destinatarios} de ${conteo.total}). ` +
      `Se detuvo antes de la primera llamada a Meta.`;
    this.deps.logger.error("difusion.invariante_rota", {
      difusionId: d.id,
      esperadoDestinatarios: esperado.destinatarios,
      esperadoAudiencia: esperado.audienciaInicial,
      destinatarios,
      audiencia: conteo.total,
    });
    await this.detener(d.id, motivo);
    return false;
  }

  async aplicarEstadoWebhook(input: EstadoWebhook): Promise<boolean> {
    // `enviado` es el 200 que ya se anotó como aceptado al mandar: no mueve nada.
    if (input.estado === "enviado") return false;
    if (input.estado !== "fallido") {
      const fila = await this.deps.envios.aplicarEstadoMeta(input.wamid, input.estado);
      return fila !== null;
    }

    const codigo = input.codigo?.trim() || "sin_codigo";
    const fila = await this.deps.envios.aplicarEstadoMeta(input.wamid, "fallido", {
      codigo,
      detalle: recortar(input.detalle ?? null),
    });
    if (!fila) return false;
    // Un fallido tardío sobre una fila que ya estaba en otro estado final no
    // cambia nada; la reacción igual se evalúa: registrar una baja y frenar
    // una difusión son idempotentes.
    await this.reaccionar(fila, codigo, "webhook");
    return true;
  }

  // -----------------------------------------------------------------------

  /** programada → enviando la primera vez. `null` si una persona la cambió en el medio. */
  private async arrancar(d: Difusion, ahora: Date): Promise<Difusion | null> {
    if (d.estado === "enviando") return d;
    return this.deps.difusiones.actualizarSiEstado(d.id, ["programada"], {
      estado: "enviando",
      iniciada_at: ahora,
    });
  }

  /** `null` = esta difusión no tiene nada vencido: se pasa a la siguiente. */
  private async drenarDifusion(d: Difusion, ahora: Date): Promise<ResultadoLote | null> {
    await this.cerrarReservasHuerfanas(d.id, ahora);

    const conteo = await this.deps.envios.contarPorDifusion(d.id);
    let limite = this.politica.loteMaximo;
    if (d.canary_tamano !== null && d.canary_revisado_at === null) {
      const salidos =
        conteo.porEstado.aceptado +
        conteo.porEstado.entregado +
        conteo.porEstado.leido +
        conteo.porEstado.fallido;
      if (salidos >= d.canary_tamano) {
        const motivo =
          `Salió la muestra de ${d.canary_tamano}: revisá bloqueos, fallidos y la calidad del ` +
          `número antes de seguir con el resto.`;
        const pausada = await this.deps.difusiones.actualizarSiEstado(d.id, ["enviando"], {
          estado: "en_revision",
          motivo_revision: motivo,
          canary_revisado_at: ahora,
        });
        if (pausada) this.deps.logger.info("difusion.muestra_enviada", { difusionId: d.id });
        return { tipo: "frenada", difusionId: d.id, motivo };
      }
      limite = Math.min(limite, d.canary_tamano - salidos);
    }

    const vencidas = await this.deps.envios.pendientesParaEnviar(d.id, ahora, limite);
    if (vencidas.length === 0) {
      if (conteo.porEstado.en_cola === 0) {
        await this.deps.difusiones.actualizarSiEstado(d.id, ["enviando"], {
          estado: "completada",
          finalizada_at: ahora,
        });
      }
      return null;
    }

    const excluidos = await this.excluirPorBajasYSaturacion(d, vencidas, ahora);
    const vigentes = vencidas.filter((e) => !excluidos.ids.has(e.id));

    const conSaliente = await this.deps.envios.leadsConSalienteDesde(
      vigentes.flatMap((e) => (e.lead_id === null ? [] : [e.lead_id])),
      new Date(ahora.getTime() - this.politica.separacionDestinatarioMs),
    );
    let diferidos = 0;
    const listos = vigentes.filter((e) => {
      const esperar = e.lead_id !== null && conSaliente.has(e.lead_id);
      if (esperar) diferidos += 1;
      return !esperar;
    });

    const aMandar = await this.limitarPorCupo(listos, ahora);
    if (aMandar === null || (aMandar.length === 0 && listos.length > 0)) {
      return { tipo: "esperando_cupo", difusionId: d.id };
    }

    // Se relee justo antes de mandar: una pausa que llegó mientras se
    // preparaba el lote gana.
    const actual = await this.deps.difusiones.findById(d.id);
    if (!actual || actual.estado !== "enviando") return { tipo: "sin_trabajo" };

    let aceptados = 0;
    let fallidos = 0;
    for (const [i, envio] of aMandar.entries()) {
      if (i > 0) await this.deps.esperar(this.politica.intervaloEnvioMs);
      const r = await this.enviarUno(actual, envio);
      if (r.tipo === "aceptado") aceptados += 1;
      else if (r.tipo === "fallido") fallidos += 1;
      else if (r.tipo === "diferido") diferidos += 1;
      else return r.resultado;
    }
    return {
      tipo: "enviado",
      difusionId: d.id,
      aceptados,
      fallidos,
      excluidos: excluidos.ids.size,
      diferidos,
    };
  }

  private async cerrarReservasHuerfanas(difusionId: UUID, ahora: Date): Promise<void> {
    const antesDe = new Date(ahora.getTime() - this.politica.reservaVencidaMs);
    const huerfanas = await this.deps.envios.reservadosSinDesenlace(
      difusionId,
      antesDe,
      this.politica.loteMaximo,
    );
    for (const e of huerfanas) {
      await this.deps.envios.marcarFallido(e.id, {
        codigo: "desenlace_desconocido",
        detalle:
          "Se reservó para mandarse y el proceso se cortó antes de saber si Meta lo recibió. " +
          "No se reintenta para no mandarlo dos veces.",
      });
      this.deps.logger.warn("difusion.envio_sin_desenlace", { difusionId, envioId: e.id });
    }
  }

  private async excluirPorBajasYSaturacion(
    d: Difusion,
    filas: readonly DifusionEnvio[],
    ahora: Date,
  ): Promise<{ ids: Set<UUID> }> {
    const telefonos = filas.flatMap((e) => (e.telefono === null ? [] : [e.telefono]));
    // Sin claves HMAC esto lanza: no se manda nada que dependa de la lista.
    const bajas = await this.deps.supresiones.activasPorTelefonos(telefonos);
    const motivoPorTelefono = new Map<string, "baja_propia" | "baja_meta">();
    for (const b of bajas) {
      const motivo = motivoDeSupresion(b.origen);
      // La propia gana sobre la de Meta: es la que tiene precedencia en el plan.
      if (motivoPorTelefono.get(b.telefono) !== "baja_propia") {
        motivoPorTelefono.set(b.telefono, motivo);
      }
    }
    const saturados =
      d.plantilla_categoria === "marketing"
        ? await this.deps.envios.saturadosDesde(
            telefonos,
            new Date(ahora.getTime() - this.politica.esperaSaturadoMs),
          )
        : new Map<string, Date>();

    const ids = new Set<UUID>();
    for (const e of filas) {
      if (e.telefono === null) continue;
      const motivo =
        motivoPorTelefono.get(e.telefono) ??
        (saturados.has(e.telefono) ? ("saturado_meta" as const) : null);
      if (motivo === null) continue;
      if (await this.deps.envios.marcarExcluido(e.id, motivo)) ids.add(e.id);
    }
    return { ids };
  }

  /**
   * Las filas que entran en el cupo de hoy. `null` = no se sabe el escalón, y
   * sin él no sale ninguna plantilla.
   *
   * Todas las filas salen con la plantilla (ver `enviarUno`), pero sólo las de
   * ruta `plantilla` consumen cupo: a quien tiene la ventana de servicio
   * abierta, Meta no se lo cuenta contra el límite de destinatarios.
   */
  private async limitarPorCupo(
    filas: readonly DifusionEnvio[],
    ahora: Date,
  ): Promise<DifusionEnvio[] | null> {
    const conCupo = filas.filter((e) => e.ruta === "plantilla");
    if (conCupo.length === 0) return [...filas];

    const tope = await this.deps.leerTopeMensajeria();
    if (tope.estado !== "ok") {
      this.deps.logger.warn("difusion.sin_escalon_de_meta", { motivo: tope.motivo });
      const sinCupo = filas.filter((e) => e.ruta !== "plantilla");
      return sinCupo.length > 0 ? sinCupo : null;
    }
    const usado24h = await this.deps.usoCupoDesde(new Date(ahora.getTime() - 24 * 3_600_000));
    const cupo = cupoParaPlanificar({ tope: tope.tope, usado24h });
    let disponible = Math.max(0, cupo.restante - cupo.reserva);
    return filas.filter((e) => {
      if (e.ruta !== "plantilla") return true;
      if (disponible <= 0) return false;
      disponible -= 1;
      return true;
    });
  }

  private async enviarUno(d: Difusion, envio: DifusionEnvio): Promise<Resultado> {
    if (envio.telefono === null || envio.lead_id === null) {
      // El plan no deja filas en cola sin teléfono; un lead borrado después sí
      // deja `lead_id` nulo. No hay a quién resolverle las variables.
      await this.deps.envios.marcarFallido(envio.id, {
        codigo: "sin_destinatario",
        detalle: "El lead se borró después de programar la difusión.",
      });
      return { tipo: "fallido" };
    }
    if (d.plantilla_nombre === null || d.plantilla_idioma === null) {
      // La base impide programar sin plantilla ni idioma; si igual pasa, no se
      // manda nada con una plantilla adivinada.
      const motivo = "La difusión no tiene plantilla o idioma: no hay con qué mandar.";
      await this.detener(d.id, motivo);
      return { tipo: "cortar", resultado: { tipo: "frenada", difusionId: d.id, motivo } };
    }

    let parametrosCuerpo: string[] = [];
    if (d.plantilla_parametros.length > 0) {
      const datos = await this.deps.datosDelLead(
        envio.lead_id,
        camposUsados(d.plantilla_parametros),
      );
      const r = resolverParametros(d.plantilla_parametros, datos);
      if (!r.ok) {
        await this.deps.envios.marcarFallido(envio.id, {
          codigo: "parametro_vacio",
          detalle: `La variable {{${r.numero}}} quedó vacía para este lead y no tiene respaldo: Meta rechaza un parámetro vacío.`,
        });
        return { tipo: "fallido" };
      }
      parametrosCuerpo = r.valores;
    }

    if (!(await this.deps.envios.reservar(envio.id, this.ahora()))) {
      // Otro proceso la tomó, o salió de la cola en el medio.
      return { tipo: "diferido" };
    }

    let wamid: string;
    try {
      const r = await this.deps.meta.sendTemplate({
        to: envio.telefono,
        plantilla: { nombre: d.plantilla_nombre, idioma: d.plantilla_idioma, parametrosCuerpo },
      });
      wamid = r.meta_message_id;
    } catch (e) {
      return this.fallaAlMandar(d, envio, e);
    }
    // Fuera del try: si anotar falla, la reserva queda y el reintento no reenvía.
    await this.deps.envios.marcarAceptado(envio.id, wamid);
    return { tipo: "aceptado" };
  }

  private async fallaAlMandar(d: Difusion, envio: DifusionEnvio, e: unknown): Promise<Resultado> {
    const g = errorDeGraph(e);
    const detalle = recortar(e instanceof Error ? e.message : String(e));

    if (g.clase === "ritmo") {
      await this.deps.envios.liberarReserva(envio.id);
      this.deps.logger.warn("difusion.meta_pidio_bajar_el_ritmo", { difusionId: d.id });
      return { tipo: "cortar", resultado: { tipo: "ritmo", difusionId: d.id } };
    }
    if (g.clase === "credencial") {
      // No es culpa del destinatario: la fila vuelve a la cola y el error sube
      // para que la corrida falle a la vista.
      await this.deps.envios.liberarReserva(envio.id);
      throw e;
    }
    if (g.clase === "desconocido") {
      // Pudo haber salido. No se reintenta.
      await this.deps.envios.marcarFallido(envio.id, {
        codigo: g.codigo ?? "desenlace_desconocido",
        detalle,
      });
      this.deps.logger.warn("difusion.envio_sin_respuesta", {
        difusionId: d.id,
        envioId: envio.id,
        codigo: g.codigo,
        status: g.status,
      });
      return { tipo: "fallido" };
    }

    const codigo = g.codigo ?? "rechazo_sin_codigo";
    const reaccion = reaccionAFallo(codigo, "envio");
    if (reaccion.tipo === "reintentar_despues") {
      await this.deps.envios.liberarReserva(envio.id);
      return { tipo: "diferido" };
    }
    if (reaccion.tipo === "frenar_lote") {
      await this.deps.envios.liberarReserva(envio.id);
      return { tipo: "cortar", resultado: { tipo: "ritmo", difusionId: d.id } };
    }
    const fila = await this.deps.envios.marcarFallido(envio.id, { codigo, detalle });
    const frenada = await this.reaccionar(fila, codigo, "envio");
    return frenada ? { tipo: "cortar", resultado: frenada } : { tipo: "fallido" };
  }

  /**
   * Lo que un código le hace a la difusión, más allá de la fila. Devuelve el
   * resultado del lote si la difusión quedó frenada.
   */
  private async reaccionar(
    fila: DifusionEnvio,
    codigo: string,
    origen: OrigenFallo,
  ): Promise<ResultadoLote | null> {
    const reaccion = reaccionAFallo(codigo, origen);
    switch (reaccion.tipo) {
      case "baja_meta":
        if (fila.telefono !== null) {
          // Irreversible por escritura automática: sólo una persona admin la levanta.
          await this.deps.supresiones.registrar({
            telefono: fila.telefono,
            origen: "meta_131050",
            detalle: "131050",
            lead_id: fila.lead_id,
            difusion_id: fila.difusion_id,
          });
        }
        return null;
      case "pausar": {
        const pausada = await this.deps.difusiones.actualizarSiEstado(
          fila.difusion_id,
          ["enviando"],
          { estado: "en_revision", motivo_revision: reaccion.motivo },
        );
        if (pausada) {
          this.deps.logger.error("difusion.pausada_por_meta", {
            difusionId: fila.difusion_id,
            codigo,
            origen,
          });
        }
        return { tipo: "frenada", difusionId: fila.difusion_id, motivo: reaccion.motivo };
      }
      case "detener":
        await this.detener(fila.difusion_id, reaccion.motivo, codigo, origen);
        return { tipo: "frenada", difusionId: fila.difusion_id, motivo: reaccion.motivo };
      default:
        return null;
    }
  }

  /** La frena el sistema: sin persona, con motivo, y lo pendiente se cancela. */
  private async detener(
    difusionId: UUID,
    motivo: string,
    codigo?: string,
    origen?: OrigenFallo,
  ): Promise<void> {
    const detenida = await this.deps.difusiones.actualizarSiEstado(difusionId, NO_TERMINADAS, {
      estado: "detenida",
      motivo_detencion: motivo,
      detenida_por: null,
      motivo_revision: null,
      finalizada_at: this.ahora(),
    });
    const { cancelados, yaSalieron } = await this.deps.envios.cancelarPendientes(difusionId);
    if (detenida) {
      this.deps.logger.error("difusion.detenida_por_el_sistema", {
        difusionId,
        codigo,
        origen,
        cancelados,
        yaSalieron,
      });
    }
  }
}

function recortar(texto: string | null): string | null {
  if (texto === null) return null;
  return texto.length > LARGO_DETALLE ? texto.slice(0, LARGO_DETALLE) : texto;
}
