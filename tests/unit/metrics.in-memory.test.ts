import { InMemoryMetricsRepository } from "@/server/repositories/metrics.repo";
import { runMetricsContract, type MetricsContractFixtures } from "../repositories/metrics.contract";

const AYER = new Date(Date.now() - 24 * 60 * 60 * 1000);

const fixtures: MetricsContractFixtures = {
  antesDeTodo: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  despuesDeTodo: new Date(Date.now() + 24 * 60 * 60 * 1000),
  // Literalmente el `started_at` de `sess-1`, no una fecha parecida: el test de
  // exclusividad necesita que la fila caiga EXACTO sobre el borde.
  justoEnUnaFila: AYER,
};

runMetricsContract(
  () =>
    new InMemoryMetricsRepository({
      sesiones: [
        {
          id: "sess-1",
          current_stage: "cotizado",
          resultado: null,
          motivo_perdida: null,
          started_at: AYER,
          precio_cotizado: null,
          codigo_interno: null,
          closed_at: null,
          cantidad: null,
        },
      ],
      mensajes: [
        {
          sender: "lead",
          created_at: AYER,
          canal: "wa",
          lead_session_id: "sess-1",
          sender_user_id: null,
        },
      ],
      leads: [{ created_at: AYER }],
    }),
  fixtures,
);
