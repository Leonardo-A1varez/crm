import { z } from "zod";
import { NODO_TIPOS, PUERTOS } from "@/types/workflows";

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
