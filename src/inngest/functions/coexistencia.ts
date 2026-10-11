import { createHash } from "node:crypto";
import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import {
  coexistenciaContactos,
  coexistenciaEco,
  coexistenciaReanudarIa,
  coexistenciaHistorial,
  coexistenciaHistorialError,
  whatsappNumeroConectado,
} from "@/inngest/events";
import { isNonRetriable } from "@/lib/errors";
import { deserializarLote, deserializarMensaje } from "@/lib/meta/parse-coexistencia";
import type { Logger } from "@/lib/observability/logger";
import type { CoexistenciaService } from "@/server/services/meta/coexistencia.service";

/**
 * Las funciones de coexistencia (docs/meta/conectar-whatsapp.md). Sólo
 * orquestan: la lógica y la idempotencia viven en `CoexistenciaService`
 * (reserva en la base para `smb_app_data`, dedup por wamid para los mensajes).
 *
 * Ninguna toca el agente ni el pipeline de entrantes: un mensaje del
 * historial o un eco de la app no es un turno y no se contesta. Un eco sí pausa
 * la IA de la conversación un rato (`PAUSA_POR_RESPUESTA_HUMANA_MIN`) y otra
 * función la reanuda al vencer.
 */
export interface CoexistenciaFnDeps {
  servicio: CoexistenciaService;
  logger?: Logger;
}

/** Un error de dominio no reintentable no se reintenta en Inngest. */
async function sinReintentoInutil<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isNonRetriable(error)) {
      throw new NonRetriableError((error as Error).message, { cause: error });
    }
    throw error;
  }
}

export function makeSincronizarCoexistenciaFn(deps: CoexistenciaFnDeps) {
  return inngest.createFunction(
    {
      id: "sincronizar-coexistencia",
      // Un número a la vez: dos conexiones seguidas del mismo número no piden
      // en paralelo (la reserva en la base igual lo impediría).
      concurrency: { key: "event.data.phoneNumberId", limit: 1 },
      triggers: [{ event: whatsappNumeroConectado }],
    },
    async ({ event, step }) => {
      const { phoneNumberId, conectadoAt } = event.data;
      // Clave explícita (AGENTS.md §0.9): función, día de la conexión, número.
      const clave = `sincronizar-coexistencia-${conectadoAt.slice(0, 10)}-${phoneNumberId}`;
      return step.run(clave, () =>
        sinReintentoInutil(() => deps.servicio.sincronizarAlConectar(phoneNumberId)),
      );
    },
  );
}

export function makeOnCoexistenciaHistorialFn(deps: CoexistenciaFnDeps) {
  return inngest.createFunction(
    {
      id: "on-coexistencia-historial",
      // Los lotes de un número de a uno: dos lotes con el mismo cliente
      // crearían su lead y su sesión en carrera.
      concurrency: { key: "event.data.lote.phone_number_id", limit: 1 },
      triggers: [{ event: coexistenciaHistorial }],
    },
    async ({ event, step }) => {
      const { lote } = event.data;
      const primero = lote.hilos[0]?.mensajes[0]?.meta_message_id ?? "vacio";
      const clave = `coexistencia-historial-${lote.phone_number_id}-${lote.fase ?? "x"}-${lote.chunk ?? "x"}-${primero}`;
      return step.run(clave, () =>
        sinReintentoInutil(() => deps.servicio.importarHistorial(deserializarLote(lote))),
      );
    },
  );
}

export function makeOnCoexistenciaHistorialErrorFn(deps: CoexistenciaFnDeps) {
  return inngest.createFunction(
    {
      id: "on-coexistencia-historial-error",
      triggers: [{ event: coexistenciaHistorialError }],
    },
    async ({ event, step }) => {
      const d = event.data;
      return step.run(`coexistencia-historial-error-${d.phone_number_id}-${d.codigo ?? "x"}`, () =>
        sinReintentoInutil(() => deps.servicio.historialRechazado(d)),
      );
    },
  );
}

export function makeOnCoexistenciaContactosFn(deps: CoexistenciaFnDeps) {
  return inngest.createFunction(
    {
      id: "on-coexistencia-contactos",
      concurrency: { limit: 1 },
      triggers: [{ event: coexistenciaContactos }],
    },
    async ({ event, step }) => {
      // `importarContactos` es idempotente por teléfono. La clave sale del
      // contenido (hash: los teléfonos no van en el nombre del step, que se ve
      // en el panel de Inngest).
      const huella = createHash("sha256")
        .update(JSON.stringify(event.data.contactos))
        .digest("hex")
        .slice(0, 16);
      return step.run(`coexistencia-contactos-${huella}`, () =>
        sinReintentoInutil(() => deps.servicio.importarContactos(event.data.contactos)),
      );
    },
  );
}

export function makeOnCoexistenciaEcoFn(deps: CoexistenciaFnDeps) {
  return inngest.createFunction(
    {
      id: "on-coexistencia-eco",
      concurrency: { key: "event.data.eco.telefono_cliente", limit: 1 },
      triggers: [{ event: coexistenciaEco }],
    },
    async ({ event, step }) => {
      const { eco } = event.data;
      const wamid = eco.mensaje.meta_message_id;
      const ecoCompleto = () => ({ ...eco, mensaje: deserializarMensaje(eco.mensaje) });

      const estado = await step.run(`coexistencia-eco-${wamid}`, () =>
        sinReintentoInutil(() => deps.servicio.registrarEco(ecoCompleto())),
      );

      // Corre también con "repetido": si el reintento llega después de que el
      // eco se guardó pero antes de pausar, esta es la única oportunidad. Es
      // idempotente (la pausa lleva la clave del eco), y un eco reentregado
      // después de "Reactivar IA" no vuelve a pausar.
      const pausa = await step.run(`coexistencia-eco-pausa-${wamid}`, () =>
        sinReintentoInutil(() => deps.servicio.pausarPorRespuestaDelNegocio(ecoCompleto())),
      );
      if (pausa) {
        // El vencimiento es otra función: dormir acá dos horas ocuparía la
        // concurrencia por cliente y demoraría el siguiente eco.
        await step.sendEvent(`coexistencia-eco-reanudar-${wamid}`, {
          name: coexistenciaReanudarIa.name,
          // Un evento por eco: la reentrega del mismo eco no programa dos.
          id: `coexistencia-reanudar-ia:${wamid}`,
          data: {
            sesionId: pausa.sesionId,
            ecoMetaMessageId: pausa.ecoMetaMessageId,
            ecoAt: new Date(pausa.ecoAt).toISOString(),
            venceAt: new Date(pausa.venceAt).toISOString(),
          },
        });
      }
      return estado;
    },
  );
}

export function makeCoexistenciaReanudarIaFn(deps: CoexistenciaFnDeps) {
  return inngest.createFunction(
    {
      id: "coexistencia-reanudar-ia",
      triggers: [{ event: coexistenciaReanudarIa }],
    },
    async ({ event, step }) => {
      const d = event.data;
      // `sleepUntil` y no un cron que barre sesiones pausadas: la hora exacta
      // sale del eco. El sleep es un step aparte del que reanuda (un sleep no
      // se puede anidar en un `step.run`).
      await step.sleepUntil(`esperar-${d.ecoMetaMessageId}`, new Date(d.venceAt));
      return step.run(`coexistencia-reanudar-ia-${d.ecoMetaMessageId}`, () =>
        sinReintentoInutil(() =>
          deps.servicio.reanudarTrasRespuestaDelNegocio({
            sesionId: d.sesionId,
            ecoMetaMessageId: d.ecoMetaMessageId,
            ecoAt: new Date(d.ecoAt),
            venceAt: new Date(d.venceAt),
          }),
        ),
      );
    },
  );
}

export function makeCoexistenciaFns(deps: CoexistenciaFnDeps) {
  return [
    makeSincronizarCoexistenciaFn(deps),
    makeOnCoexistenciaHistorialFn(deps),
    makeOnCoexistenciaHistorialErrorFn(deps),
    makeOnCoexistenciaContactosFn(deps),
    makeOnCoexistenciaEcoFn(deps),
    makeCoexistenciaReanudarIaFn(deps),
  ];
}
