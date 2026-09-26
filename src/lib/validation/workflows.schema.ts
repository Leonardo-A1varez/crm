import { z } from "zod";
import { ArbolCondicionSchema } from "@/lib/workflows/condiciones.schema";
import { NODO_TIPOS, esPuerto, type Puerto } from "@/types/workflows";

/**
 * Forma del grafo, no su sentido.
 *
 * Zod verifica que el JSON tenga la estructura correcta; que el grafo sea
 * *coherente* (alcanzable, sin ciclos sin espera) lo decide
 * `validarGrafo()` en `src/lib/workflows/validar-grafo.ts`. Un grafo puede
 * pasar este schema y ser inválido: son dos preguntas distintas y separarlas
 * permite testear las siete reglas sin armar JSON crudo.
 */

/** Un id vacío rompe la referencia de las aristas, que es todo el diseño. */
const NodoIdSchema = z.string().min(1).max(64);

export const NodoSchema = z.object({
  id: NodoIdSchema,
  tipo: z.enum(NODO_TIPOS),
  config: z.record(z.string(), z.unknown()),
  posicion: z.object({ x: z.number(), y: z.number() }),
});

export const AristaSchema = z.object({
  desde: NodoIdSchema,
  hasta: NodoIdSchema,
  // Los fijos (`salida`, `verdadero`, `falso`, `otro`) o el de un caso de
  // "Según el valor" (`caso:<id>`). Que el nodo tenga ese puerto lo decide
  // `validarGrafo`, que conoce los casos.
  puerto: z.custom<Puerto>(esPuerto, { error: "Puerto inválido" }),
});

/**
 * Lo que valida el ejecutor antes de evaluar una condición: el árbol Y/O o el
 * trío plano guardado antes del árbol. Vive en `lib/workflows/`, junto con el
 * evaluador; se re-exporta acá porque es donde lo busca el ejecutor.
 */
export { CondicionSchema } from "@/lib/workflows/condiciones.schema";

// Un flujo armado a mano en un canvas tiene decenas de nodos, no miles. 200
// nodos y 500 aristas dejan margen de sobra (una condición sola ya usa 2
// aristas) sin permitir que un payload patológico convierta lo que debería
// ser un ValidationError en un DFS gigante en el servidor.
const NODOS_MAX = 200;
const ARISTAS_MAX = 500;

export const GrafoSchema = z.object({
  nodos: z.array(NodoSchema).max(NODOS_MAX),
  aristas: z.array(AristaSchema).max(ARISTAS_MAX),
});

// =========================================================================
// Entrada de las Server Actions de la pantalla `/workflows`
// =========================================================================

/**
 * Toda action `'use server'` parsea con Zod en la primera línea (AGENTS.md
 * §0.9). Estos schemas son esa primera línea: lo que llega de un formulario es
 * `unknown` hasta que uno de estos lo dice.
 */

export const CrearWorkflowSchema = z.object({
  // Un nombre en blanco deja una fila que no se puede identificar en la lista.
  nombre: z.string().trim().min(1, "Poné un nombre.").max(80),
  descripcion: z.string().trim().max(500).nullable().default(null),
});
export type CrearWorkflowInput = z.infer<typeof CrearWorkflowSchema>;

/**
 * `maxPasos` es el freno del motor: cuántos nodos puede recorrer una corrida
 * antes de que se la corte. Sin tope, un ciclo con espera corre para siempre y
 * gasta mensajes reales contra un lead real.
 */
export const GuardarVersionSchema = z.object({
  workflowId: z.string().uuid(),
  grafo: GrafoSchema,
  maxPasos: z.number().int().min(1).max(500),
});
export type GuardarVersionActionInput = z.infer<typeof GuardarVersionSchema>;

/** "Probar": mismo grafo que Guardar, más el lead de prueba contra el que correr. */
export const ProbarWorkflowSchema = z.object({
  workflowId: z.string().uuid(),
  grafo: GrafoSchema,
  maxPasos: z.number().int().min(1).max(500),
  leadId: z.string().uuid(),
});
export type ProbarWorkflowActionInput = z.infer<typeof ProbarWorkflowSchema>;

/**
 * "Ejecutar hasta acá": Probar, frenando al llegar a `hastaNodo` sin correrlo.
 * Que el nodo esté en el grafo lo revisa el servicio, que tiene el grafo.
 */
export const ProbarHastaAcaSchema = ProbarWorkflowSchema.extend({
  hastaNodo: z.string().min(1).max(64),
});
export type ProbarHastaAcaActionInput = z.infer<typeof ProbarHastaAcaSchema>;

export const PublicarVersionSchema = z.object({
  versionId: z.string().uuid(),
});

/** Duplicar, pausar, reanudar y eliminar sólo necesitan saber cuál workflow. */
export const WorkflowIdSchema = z.object({
  workflowId: z.string().uuid(),
});
export type WorkflowIdInput = z.infer<typeof WorkflowIdSchema>;

/**
 * La nota de una versión: por qué se hizo el cambio, en prosa para quien la
 * revise después. En blanco es lo mismo que sin nota. El tope es el del CHECK
 * `workflow_versiones_nota_largo`.
 */
const NotaDeVersionSchema = z
  .string()
  .trim()
  .max(500, "La nota no puede pasar de 500 caracteres.")
  .optional();

/** Publicar con la nota de la versión (la pantalla DiffPublicacion). */
export const PublicarVersionConDescripcionSchema = z.object({
  versionId: z.string().uuid(),
  nota: NotaDeVersionSchema,
});
export type PublicarVersionConDescripcionInput = z.infer<
  typeof PublicarVersionConDescripcionSchema
>;

/** Crear nueva versión a partir de una existente. */
export const CrearVersionDesdeSchema = z.object({
  versionId: z.string().uuid(),
});
export type CrearVersionDesdeInput = z.infer<typeof CrearVersionDesdeSchema>;

/** Restaurar: copiar una versión vieja a una versión nueva y publicarla. */
export const RollbackVersionSchema = z.object({
  workflowId: z.string().uuid(),
  versionId: z.string().uuid(),
  nota: NotaDeVersionSchema,
});
export type RollbackVersionInput = z.infer<typeof RollbackVersionSchema>;

// =========================================================================
// Historial de ejecuciones (panel lateral I)
// =========================================================================

const ESTADOS_RUN = ["corriendo", "esperando", "terminado", "fallado", "cancelado"] as const;

export const FiltrosHistorialSchema = z.object({
  estado: z
    .enum([...ESTADOS_RUN, "todos"])
    .optional()
    .default("todos"),
  fechaDesde: z.coerce.date().optional(),
  fechaHasta: z.coerce.date().optional(),
  leadId: z.string().uuid().optional(),
  busqueda: z.string().trim().max(200).optional(),
});
export type FiltrosHistorialInput = z.infer<typeof FiltrosHistorialSchema>;

export const ObtenerHistorialSchema = z.object({
  workflowId: z.string().uuid(),
  filtros: FiltrosHistorialSchema.optional().default({ estado: "todos" }),
  cursor: z.string().optional(),
});
export type ObtenerHistorialInput = z.infer<typeof ObtenerHistorialSchema>;

export const ObtenerDetalleRunSchema = z.object({
  runId: z.string().uuid(),
});
export type ObtenerDetalleRunInput = z.infer<typeof ObtenerDetalleRunSchema>;

/**
 * Una corrida: la pantalla "corrida en vivo", reanudarla o relanzarla. Sólo el
 * id, a propósito: desde dónde se reanuda lo decide el servidor (el nodo del
 * paso que falló), nunca un nodo que mande el cliente.
 */
export const CorridaIdSchema = z.object({
  runId: z.string().uuid(),
});
export type CorridaIdInput = z.infer<typeof CorridaIdSchema>;

/**
 * El contador del panel de Condición: el árbol como lo arma el constructor y
 * cuántos leads traer para "Ver la lista". La forma la valida
 * `ArbolCondicionSchema`; que esté completa, el servicio.
 */
export const CoincidenciasCondicionSchema = z.object({
  arbol: ArbolCondicionSchema,
  muestra: z.number().int().min(0).max(200).default(0),
});
export type CoincidenciasCondicionInput = z.infer<typeof CoincidenciasCondicionSchema>;
