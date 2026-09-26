import { describe, expect, it, vi } from "vitest";
import { IllegalStateError } from "@/lib/errors";
import { hasherBajasDesde } from "@/server/repositories/difusion-supresiones.hash";
import { InMemoryDifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.repo";
import { crearAccionEnviarMensaje } from "@/server/services/workflows/acciones/enviar-mensaje";

/**
 * Sin las claves HMAC la lista de bajas no se puede consultar, y un envío que
 * depende de ella no sale: falla cerrado. Acá, el `enviar_mensaje` de los
 * workflows con el repo real (in-memory) sin claves; el planificador de
 * difusión y la baja por palabra lo prueban en sus propios archivos.
 */

const entorno = { leadId: "l1", leadSessionId: "s1", runId: "r1", orden: 7, contexto: {} };
const nodo = {
  id: "env",
  tipo: "accion" as const,
  config: { accion: "enviar_mensaje", texto: "hola" },
  posicion: { x: 0, y: 0 },
};
const TODO_EL_DIA = [{ desde: "00:00", hasta: "23:59" }];

describe("bajas sin claves: falla cerrado", () => {
  it("enviar_mensaje no manda si no puede revisar la lista de bajas", async () => {
    const sendOutbound = vi.fn(async () => ({ id: "m1" }));
    const deps = {
      messages: { contarSalientesAutomaticos: vi.fn(async () => 0) },
      plantillasSinSesion: { contarNoAnotadasDesde: vi.fn(async () => 0) },
      metaApi: { sendOutbound },
      conversations: {
        findActivaByLead: vi.fn(async () => ({
          id: "c1",
          canal: "whatsapp",
          ultimo_entrante_at: new Date(),
        })),
      },
      leads: { findById: vi.fn(async () => ({ id: "l1", telefono: "+5215550001111" })) },
      sessions: {
        findById: vi.fn(async () => ({ id: "s1", current_stage: "considerando" })),
        findActiveByLeadId: vi.fn(async () => ({ id: "s1", current_stage: "considerando" })),
      },
      supresiones: new InMemoryDifusionSupresionesRepository({
        hasher: () => hasherBajasDesde({}),
      }),
      users: { findById: vi.fn(async () => ({ id: "u1", nombre: "Juan" })) },
      configProvider: {
        activa: vi.fn(async () => ({
          max_salientes_automaticos_24h: 3,
          horario: {
            lun: TODO_EL_DIA,
            mar: TODO_EL_DIA,
            mie: TODO_EL_DIA,
            jue: TODO_EL_DIA,
            vie: TODO_EL_DIA,
            sab: TODO_EL_DIA,
            dom: TODO_EL_DIA,
          },
          horario_timezone: "UTC",
        })),
      },
    } as never;

    await expect(crearAccionEnviarMensaje(deps)(nodo, entorno)).rejects.toBeInstanceOf(
      IllegalStateError,
    );
    expect(sendOutbound).not.toHaveBeenCalled();
  });
});
