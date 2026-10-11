import { createHash } from "node:crypto";
import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import {
  coexistenciaContactos,
  coexistenciaEco,
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
 * historial o un eco de la app no es un turno y no se contesta.
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
      return step.run(`coexistencia-eco-${eco.mensaje.meta_message_id}`, () =>
        sinReintentoInutil(() =>
          deps.servicio.registrarEco({ ...eco, mensaje: deserializarMensaje(eco.mensaje) }),
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
  ];
}
