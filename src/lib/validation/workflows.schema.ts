import { z } from "zod";
import { NODO_TIPOS, PUERTOS } from "@/types/workflows";
import { CAMPOS_CONDICION, OPERADORES } from "@/lib/workflows/condiciones";
import { ESTADOS_WORKFLOW_FILTRO, ORDENAR_WORKFLOWS } from "@/lib/ui/filtros-workflows";

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
  puerto: z.enum(PUERTOS),
});

export const CondicionSchema = z.object({
  campo: z.enum(CAMPOS_CONDICION),
  operador: z.enum(OPERADORES),
  valor: z.string().max(200).nullable(),
});

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

export const PublicarVersionSchema = z.object({
  versionId: z.string().uuid(),
});

/** Duplicar, pausar, reanudar y eliminar sólo necesitan saber cuál workflow. */
export const WorkflowIdSchema = z.object({
  workflowId: z.string().uuid(),
});
export type WorkflowIdInput = z.infer<typeof WorkflowIdSchema>;

/** Publicar con descripción opcional del cambio. */
export const PublicarVersionConDescripcionSchema = z.object({
  versionId: z.string().uuid(),
  descripcion: z.string().trim().max(500).optional(),
});
export type PublicarVersionConDescripcionInput = z.infer<
  typeof PublicarVersionConDescripcionSchema
>;

/** Crear nueva versión a partir de una existente. */
export const CrearVersionDesdeSchema = z.object({
  versionId: z.string().uuid(),
});
export type CrearVersionDesdeInput = z.infer<typeof CrearVersionDesdeSchema>;

/** Rollback: crear nueva versión desde una antigua y publicarla. */
export const RollbackVersionSchema = z.object({
  workflowId: z.string().uuid(),
  versionId: z.string().uuid(),
});
export type RollbackVersionInput = z.infer<typeof RollbackVersionSchema>;

/** Filtros del listado (`getWorkflowsAction`). Todo opcional: sin filtros llega la lista entera. */
export const FiltrosWorkflowsSchema = z.object({
  busqueda: z.string().trim().max(200).optional(),
  estado: z.enum(ESTADOS_WORKFLOW_FILTRO).optional(),
  ordenar: z.enum(ORDENAR_WORKFLOWS).optional(),
});
export type FiltrosWorkflowsInput = z.infer<typeof FiltrosWorkflowsSchema>;

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

export const ReejecutarDesdeErrorSchema = z.object({
  runId: z.string().uuid(),
  nodoId: z.string().min(1).max(64),
});
export type ReejecutarDesdeErrorInput = z.infer<typeof ReejecutarDesdeErrorSchema>;
