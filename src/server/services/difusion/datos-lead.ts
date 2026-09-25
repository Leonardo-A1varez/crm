import type { CampoParametro } from "@/lib/difusion/parametros";
import type { DatosInterpolacion } from "@/lib/workflows/variables";
import type { UUID } from "@/types/entities";

/**
 * Los datos con que se resuelven las variables de la plantilla de una
 * difusión para un lead, en la forma de `interpolarVariables`: `lead.*` y
 * `sesion.*`, los mismos namespaces que los workflows.
 *
 * Se carga sólo lo que las variables piden: una difusión sin vehículos no
 * lee `lead_vehiculos` por cada destinatario.
 */
export interface DatosLeadDeps {
  leads: { findById(id: UUID): Promise<{ nombre: string; nombre_perfil: string | null } | null> };
  vehiculos: {
    listByLeadId(
      leadId: UUID,
    ): Promise<
      { marca: string | null; modelo: string | null; anio: number | null; principal: boolean }[]
    >;
  };
  sessions: { findActiveByLeadId(leadId: UUID): Promise<{ consulta: string } | null> };
}

const DE_VEHICULO: ReadonlySet<CampoParametro> = new Set([
  "vehiculo_marca",
  "vehiculo_modelo",
  "vehiculo_anio",
]);

export async function cargarDatosDelLeadParaDifusion(
  deps: DatosLeadDeps,
  leadId: UUID,
  campos: ReadonlySet<CampoParametro>,
): Promise<DatosInterpolacion> {
  const lead: Record<string, unknown> = {};
  if (campos.has("nombre") || campos.has("nombre_perfil")) {
    const l = await deps.leads.findById(leadId);
    lead.nombre = l?.nombre ?? null;
    lead.nombre_perfil = l?.nombre_perfil ?? null;
  }
  if ([...campos].some((c) => DE_VEHICULO.has(c))) {
    const vehiculos = await deps.vehiculos.listByLeadId(leadId);
    // El principal; si ninguno lo es, no se elige uno a ciegas.
    const v = vehiculos.find((x) => x.principal) ?? null;
    lead.vehiculo_marca = v?.marca ?? null;
    lead.vehiculo_modelo = v?.modelo ?? null;
    lead.vehiculo_anio = v?.anio === null || v?.anio === undefined ? null : String(v.anio);
  }

  const datos: DatosInterpolacion = {};
  if (Object.keys(lead).length > 0) datos.lead = lead;
  if (campos.has("consulta")) {
    // Sólo la sesión activa: una cerrada se purga a los 29 días y su consulta
    // es de otra conversación.
    const s = await deps.sessions.findActiveByLeadId(leadId);
    if (s) datos.sesion = { consulta: s.consulta };
  }
  return datos;
}
