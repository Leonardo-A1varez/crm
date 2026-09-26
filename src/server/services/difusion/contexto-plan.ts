import type {
  SaturacionMeta,
  SupresionActiva,
  CandidatoDifusion,
} from "@/lib/difusion/planificador";
import { POLITICA_POR_DEFECTO } from "@/lib/difusion/planificador";
import type {
  CandidatoResuelto,
  DifusionAudienciaRepository,
} from "@/server/repositories/difusion-audiencia.repo";
import type { DifusionEnviosRepository } from "@/server/repositories/difusion-envios.repo";
import type { DifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.repo";
import type { LecturaTope } from "./difusion.service";

/**
 * Lo que el planificador necesita saber además de la audiencia, leído una
 * sola vez. Lo usan el servicio (al armar y programar) y la re-evaluación de
 * una audiencia dinámica: un solo lugar decide de dónde sale cada entrada.
 */
export interface ContextoPlan {
  candidatos: CandidatoResuelto[];
  supresiones: SupresionActiva[];
  saturaciones: SaturacionMeta[];
  tope: LecturaTope;
  usado24h: number;
  maxSalientes: number;
}

export interface ContextoPlanDeps {
  audiencia: Pick<DifusionAudienciaRepository, "usoCupoDesde">;
  envios: Pick<DifusionEnviosRepository, "saturadosDesde">;
  supresiones: Pick<DifusionSupresionesRepository, "activasPorTelefonos">;
  leerTopeMensajeria: () => Promise<LecturaTope>;
  leerMaxSalientes24h: () => Promise<number>;
}

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;

export async function leerContextoPlan(
  deps: ContextoPlanDeps,
  candidatos: CandidatoResuelto[],
  ahora: Date,
): Promise<ContextoPlan> {
  const telefonos = candidatos.map((c) => c.telefono);
  const desdeSaturacion = new Date(
    ahora.getTime() - POLITICA_POR_DEFECTO.esperaSaturadoHoras * HORA_MS,
  );
  const [supresiones, saturados, tope, usado24h, maxSalientes] = await Promise.all([
    deps.supresiones.activasPorTelefonos(telefonos),
    deps.envios.saturadosDesde(telefonos, desdeSaturacion),
    deps.leerTopeMensajeria(),
    deps.audiencia.usoCupoDesde(new Date(ahora.getTime() - DIA_MS)),
    deps.leerMaxSalientes24h(),
  ]);
  return {
    candidatos,
    supresiones: supresiones.map((s) => ({ telefono: s.telefono, origen: s.origen })),
    saturaciones: [...saturados].map(([telefono, ultimoAt]) => ({ telefono, ultimoAt })),
    tope,
    usado24h,
    maxSalientes,
  };
}

export function aCandidato(c: CandidatoResuelto): CandidatoDifusion {
  return {
    leadId: c.leadId,
    telefono: c.telefono,
    etapa: c.etapaActiva,
    ultimoEntranteAt: c.ultimoEntranteAt,
    salientesAutomaticos24h: c.salientesAutomaticos24h,
  };
}
