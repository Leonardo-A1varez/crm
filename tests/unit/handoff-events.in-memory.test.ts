import { beforeEach } from "vitest";
import { InMemoryHandoffEventsRepository } from "@/server/repositories/handoff-events.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import {
  runHandoffEventsContract,
  type HandoffEventsContractFixtures,
} from "../repositories/handoff-events.contract";

/**
 * La impl in-memory transiciona sobre un repo de sesiones real, así que las dos
 * sesiones tienen que existir antes de cada test.
 *
 * Este `beforeEach` es de nivel de archivo y corre **antes** que el del
 * `describe` que arma el contrato, que es donde se llama a `makeRepo`. Se
 * recrean por corrida para que un `pause` de un test no deje pausada la sesión
 * del siguiente.
 */
let sessions: InMemoryLeadSessionRepository;
let fixtures: HandoffEventsContractFixtures;

beforeEach(async () => {
  sessions = new InMemoryLeadSessionRepository();
  const [s1, s2] = await Promise.all([nuevaSesion(), nuevaSesion()]);
  fixtures = { sessionIds: { s1, s2 }, desconocida: crypto.randomUUID() };
});

async function nuevaSesion(): Promise<string> {
  const s = await sessions.create({
    lead_id: crypto.randomUUID(),
    current_stage: "nuevo",
    urgencia: "media",
    consulta: "handoff fixture",
    producto_cotizado_id: null,
    codigo_interno: null,
    precio_cotizado: null,
    cantidad: null,
    bloqueador: null,
    comprobante_pago_url: null,
    metodo_pago: null,
    resultado: null,
    motivo_perdida: null,
    ia_pausada: false,
  });
  return s.id;
}

runHandoffEventsContract(
  () => new InMemoryHandoffEventsRepository(sessions),
  () => fixtures,
);
