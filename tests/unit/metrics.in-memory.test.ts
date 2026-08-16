import { InMemoryMetricsRepository } from "@/server/repositories/metrics.repo";
import { runMetricsContract, type MetricsContractFixtures } from "../repositories/metrics.contract";

const AYER = new Date(Date.now() - 24 * 60 * 60 * 1000);

const fixtures: MetricsContractFixtures = {
  antesDeTodo: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  despuesDeTodo: new Date(Date.now() + 24 * 60 * 60 * 1000),
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
