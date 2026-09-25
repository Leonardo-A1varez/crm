import type { CamposDeVariable } from "@/lib/workflows/config-nodos";
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

/**
 * Los datos con que `interpolarVariables` resuelve las variables de un texto.
 *
 * Carga exactamente los campos de `VARIABLES_DE_TEXTO` (`config-nodos.ts`),
 * que es también la lista que ofrece el selector del panel. Los dos
 * `satisfies` lo garantizan: un campo de más o de menos no compila, así que
 * el panel no puede ofrecer una variable que acá no se carga.
 * `tests/unit/workflows/variables-disponibles.test.ts` lo verifica corriendo
 * el interpolador con lo que devuelve esta función.
 */
export async function cargarDatosInterpolacion(
  deps: DatosInterpolacionDeps,
  entorno: DatosInterpolacionEntorno,
): Promise<DatosInterpolacion> {
  const lead = (await deps.leads.findById(entorno.leadId)) as Record<string, unknown> | null;

  const sesion = entorno.leadSessionId
    ? ((await deps.sessions.findById(entorno.leadSessionId)) as Record<string, unknown> | null)
    : null;

  // El vendedor es el de la sesión (`lead_session.vendedor_asignado_id`): la
  // asignación vive en la sesión, no en el lead. Sin vendedor no se busca nada
  // y sus variables salen vacías.
  const vendedorId =
    typeof sesion?.vendedor_asignado_id === "string" ? sesion.vendedor_asignado_id : null;
  const vendedor = vendedorId
    ? ((await deps.users.findById(vendedorId)) as Record<string, unknown> | null)
    : null;

  return {
    lead: lead
      ? ({
          nombre: lead.nombre as string,
          telefono: lead.telefono as string,
          canal: lead.canal_origen as string,
          email: lead.email as string | null,
          // El lead no tiene etapa propia: es la de la sesión, igual que en
          // las condiciones (`contextoDeDisparo`).
          etapa: sesion ? (sesion.current_stage as string) : null,
        } satisfies Record<CamposDeVariable<"lead">, unknown>)
      : undefined,
    sesion: sesion
      ? ({
          current_stage: sesion.current_stage as string,
        } satisfies Record<CamposDeVariable<"sesion">, unknown>)
      : undefined,
    vendedor: vendedor
      ? ({
          nombre: vendedor.nombre as string,
          email: vendedor.email as string,
        } satisfies Record<CamposDeVariable<"vendedor">, unknown>)
      : undefined,
    contexto: entorno.contexto,
  };
}
