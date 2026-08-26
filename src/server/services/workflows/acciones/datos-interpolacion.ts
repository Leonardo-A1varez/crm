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

  const [sesion, vendedor] = await Promise.all([
    entorno.leadSessionId
      ? (deps.sessions.findById(entorno.leadSessionId) as Promise<Record<string, unknown> | null>)
      : Promise.resolve(null),
    lead?.vendedor_id
      ? (deps.users.findById(lead.vendedor_id as string) as Promise<Record<string, unknown> | null>)
      : Promise.resolve(null),
  ]);

  return {
    lead: lead
      ? {
          nombre: lead.nombre,
          telefono: lead.telefono,
          etapa: lead.etapa,
          canal: lead.canal,
        }
      : undefined,
    sesion: (sesion as Record<string, unknown> | null)
      ? {
          auto_marca: (sesion as Record<string, unknown>)?.auto_marca,
          auto_modelo: (sesion as Record<string, unknown>)?.auto_modelo,
          auto_anio: (sesion as Record<string, unknown>)?.auto_anio,
          current_stage: (sesion as Record<string, unknown>)?.current_stage,
        }
      : undefined,
    vendedor: vendedor
      ? {
          nombre: (vendedor as Record<string, unknown>).nombre,
          email: (vendedor as Record<string, unknown>).email,
        }
      : undefined,
    contexto: entorno.contexto,
  };
}
