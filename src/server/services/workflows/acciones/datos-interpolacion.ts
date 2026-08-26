import type { DatosInterpolacion } from "@/lib/workflows/variables";
import type { UUID } from "@/types/entities";
import type { ContextoRun } from "@/types/workflows";

// Tipos permisivos que aceptan tanto los tipos reales como los mocks del test
export interface DatosInterpolacionDeps {
  leads: {
    findById: (id: UUID) => Promise<unknown>;
  };
  sessions: {
    findById: (id: UUID) => Promise<unknown>;
  };
  users: {
    findById: (id: UUID) => Promise<unknown>;
  };
}

export interface DatosInterpolacionEntorno {
  leadId: UUID;
  leadSessionId?: UUID | null;
  contexto: ContextoRun;
}

export async function cargarDatosInterpolacion(
  deps: DatosInterpolacionDeps,
  entorno: DatosInterpolacionEntorno,
): Promise<DatosInterpolacion> {
  const lead = (await deps.leads.findById(entorno.leadId)) as Record<string, unknown> | null;

  const sesion = entorno.leadSessionId
    ? ((await deps.sessions.findById(entorno.leadSessionId)) as Record<string, unknown> | null)
    : null;

  return {
    lead: lead
      ? {
          nombre: lead.nombre as string,
          telefono: lead.telefono as string,
          canal: lead.canal_origen as string,
        }
      : undefined,
    sesion: sesion
      ? {
          current_stage: sesion.current_stage as string,
        }
      : undefined,
    contexto: entorno.contexto,
  };
}
