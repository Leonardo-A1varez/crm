import { UUIDSchema } from "@/lib/validation/schemas";
import { CANAL, CURRENT_STAGE, MOTIVO_PERDIDA, RESULTADO } from "@/types/domain";
import { VENTANA_ACTIVIDAD } from "@/types/leads";
import type { Canal, CurrentStage, MotivoPerdida, Resultado } from "@/types/domain";
import type { UUID } from "@/types/entities";
import type { VentanaActividad } from "@/types/leads";

/**
 * Los filtros de `/leads` viven en la URL y nada más.
 *
 * No hay estado de filtro en cliente: la pantalla es un server component y
 * `searchParams` es su única entrada, así que un filtro puesto se comparte por
 * link y sobrevive al refresh. Este módulo es el único traductor entre esa URL
 * y la forma que espera `LeadsService.listLeads`, para que la pantalla y los
 * chips no puedan discrepar sobre qué significa `?sesion=activa`.
 */

/** Nombre de cada filtro en la URL. Fuente única: los chips y la página leen de acá. */
export const PARAM = {
  q: "q",
  duplicados: "duplicados",
  canal: "canal",
  etapa: "etapa",
  etiqueta: "etiqueta",
  sesion: "sesion",
  resultado: "resultado",
  motivo: "motivo",
  actividad: "actividad",
  sinResponder: "sin_responder",
  marca: "marca",
  modelo: "modelo",
} as const;

/** Lo que Next entrega en `searchParams`: repetido llega como array. */
export type ValorParam = string | string[] | undefined;

/**
 * Estructuralmente compatible con `LeadsListInput` (menos `ahora`, que lo pone
 * el servicio). No importa el tipo del service porque `lib/` no puede depender
 * de `server/services/`; el compilador igual verifica la compatibilidad en el
 * punto donde la página llama a `listLeads`.
 */
export interface FiltrosLeads {
  q?: string;
  soloDuplicados?: boolean;
  canal?: Canal;
  etapa?: CurrentStage;
  etiquetaId?: UUID;
  conSesionActiva?: boolean;
  resultado?: Resultado;
  motivoPerdida?: MotivoPerdida;
  actividad?: VentanaActividad;
  sinResponder?: boolean;
  vehiculoMarca?: string;
  vehiculoModelo?: string;
}

/** Tope del texto libre de marca/modelo: la URL no es un campo de datos. */
const TEXTO_MAX = 80;

function texto(valor: ValorParam): string | undefined {
  if (typeof valor !== "string") return undefined;
  const limpio = valor.trim().slice(0, TEXTO_MAX);
  return limpio === "" ? undefined : limpio;
}

/**
 * Un valor de la lista o nada. Un param repetido, viejo o corrupto equivale a
 * "sin filtro" y nunca a un error: una URL compartida que envejeció tiene que
 * seguir abriendo la pantalla (mismo criterio que `parseCanalFilter`).
 */
function opcion<T extends string>(valor: ValorParam, validos: readonly T[]): T | undefined {
  const s = texto(valor);
  return s !== undefined && (validos as readonly string[]).includes(s) ? (s as T) : undefined;
}

function bandera(valor: ValorParam): true | undefined {
  return texto(valor) === "1" ? true : undefined;
}

export function parseFiltrosLeads(params: Record<string, ValorParam>): FiltrosLeads {
  const sesion = opcion(params[PARAM.sesion], ["activa", "cerrada"] as const);
  const etiqueta = texto(params[PARAM.etiqueta]);

  return {
    q: texto(params[PARAM.q]),
    soloDuplicados: bandera(params[PARAM.duplicados]),
    canal: opcion(params[PARAM.canal], CANAL),
    etapa: opcion(params[PARAM.etapa], CURRENT_STAGE),
    // Un id que no es UUID no se manda a la consulta: PostgREST lo rechaza con
    // un 400 que la pantalla leería como caída, y es un valor que cualquiera
    // puede escribir a mano en la barra de direcciones.
    etiquetaId:
      etiqueta !== undefined && UUIDSchema.safeParse(etiqueta).success ? etiqueta : undefined,
    conSesionActiva: sesion === undefined ? undefined : sesion === "activa",
    resultado: opcion(params[PARAM.resultado], RESULTADO),
    motivoPerdida: opcion(params[PARAM.motivo], MOTIVO_PERDIDA),
    actividad: opcion(params[PARAM.actividad], VENTANA_ACTIVIDAD),
    sinResponder: bandera(params[PARAM.sinResponder]),
    vehiculoMarca: texto(params[PARAM.marca]),
    vehiculoModelo: texto(params[PARAM.modelo]),
  };
}

/**
 * Cuántos filtros hay puestos. `q` no cuenta: tiene su propia caja en el
 * encabezado y su propio estado vacío, y sumarlo haría que el contador de los
 * chips mintiera sobre cuántos chips hay encendidos.
 */
export function contarFiltrosActivos(filtros: FiltrosLeads): number {
  const { q: _q, ...chips } = filtros;
  return Object.values(chips).filter((v) => v !== undefined).length;
}

const LABEL_ACTIVIDAD: Record<VentanaActividad, string> = {
  hoy: "Hoy",
  semana: "Esta semana",
  mas_30: "Hace más de 30 días",
};

const LABEL_RESULTADO: Record<Resultado, string> = {
  exito: "Ganado",
  perdido: "Perdido",
};

export function actividadLabel(ventana: VentanaActividad): string {
  return LABEL_ACTIVIDAD[ventana];
}

export function resultadoLabel(resultado: Resultado): string {
  return LABEL_RESULTADO[resultado];
}

// `motivoPerdidaLabel` vivía acá con su propia copia de los rótulos, que ya
// había derivado ("Tiempo de entrega" contra "Tiempos de entrega" del diálogo
// de cierre). Ahora está en `lib/ui/motivo-perdida`, junto al resto de lo que
// significa un motivo de pérdida, y los filtros lo importan de ahí.
