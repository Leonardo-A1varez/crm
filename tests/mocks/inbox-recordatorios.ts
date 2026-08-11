import { InMemorySessionRecordatoriosRepository } from "@/server/repositories/session-recordatorios.repo";

/**
 * Las dos dependencias de recordatorios de `DefaultInboxService`, listas para
 * las suites que no ejercitan el seguimiento: repo vacío —`listPorAvisar`
 * devuelve nada, así que el triage no cambia— y un `programarAviso` que no
 * arranca ningún workflow.
 *
 * Devuelve también el repo para las suites que sí quieren mirarlo adentro.
 */
export function depsRecordatorios(
  recordatorios: InMemorySessionRecordatoriosRepository = new InMemorySessionRecordatoriosRepository(),
) {
  return {
    recordatorios,
    programarAviso: async () => {},
  };
}
