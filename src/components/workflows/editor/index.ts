/**
 * Editor de workflows: las cuatro pantallas.
 *
 *   `EditorWorkflow`      paleta + lienzo + configuración
 *   `ConstructorCondicion` campo → operador → valor, con grupos como cajas
 *   `DiffPublicacion`     el diff dibujado sobre el propio lienzo
 *   `CorridaEnVivo`       la corrida, con la memoización visible antes de reanudar
 *
 * Los cuatro son **presentación pura**: reciben datos y callbacks, no leen la
 * base, no importan servicios y no conocen el catálogo de los 57 tipos de nodo
 * —lo reciben como `ResolverNodo`. Se pueden montar con datos armados a mano.
 *
 * El sistema de color de los nodos NO vive acá: es de `@/lib/ui/workflow-nodos`
 * y `../canvas/nodos/NodoBase`, y esta carpeta lo consume por un solo archivo,
 * `contrato-nodos.ts`.
 *
 * El **árbol de condiciones tampoco**: el modelo está en `@/lib/ui/condiciones`
 * y la caja recursiva en `@/components/shared/condiciones`, compartidos con el
 * constructor de audiencia de Difusión. Acá queda sólo lo que es del workflow:
 * el panel, la tabla de ayuda por tipo y el contador de leads alcanzados. No se
 * re-exportan desde este barril a propósito — dos caminos de import al mismo
 * modelo es exactamente como las dos pantallas volverían a divergir.
 */

export { EditorWorkflow, puedePublicar, type EditorWorkflowProps } from "./EditorWorkflow";
export {
  ConstructorCondicion,
  CuerpoCondicion,
  PieCondicion,
  type ConstructorCondicionProps,
  type CuerpoCondicionProps,
  type Coincidencias,
} from "./ConstructorCondicion";
export {
  DiffPublicacion,
  type DiffPublicacionProps,
  type CorridasDeVersion,
  type ProblemaNombrado,
} from "./DiffPublicacion";
export { CorridaEnVivo, type CorridaEnVivoProps, type EstadoConexion } from "./CorridaEnVivo";

export { BarraEditor, ChipEstado, ChipVersion } from "./BarraEditor";
export { PaletaBloques, PaletaFlotante } from "./PaletaBloques";
export type { BloqueDisponible, CategoriaBloques, PaletaBloquesProps } from "./PaletaBloques";
export { PanelConfig, type PanelConfigProps } from "./PanelConfig";
export { LienzoEditor, LienzoConProveedor, type LienzoEditorProps } from "./LienzoEditor";
export { PreviaReanudacion, CartelPlan } from "./PreviaReanudacion";
export { GloboProblema, MarcaSeveridad, ResumenValidacion } from "./Validacion";

export {
  NodoConPuertos,
  TIPOS_NODO_EDITOR,
  SIN_PROBLEMAS,
  EVENTO_BORRAR_NODO,
  EVENTO_PREVISUALIZAR_BORRADO,
  type DatosNodoEditor,
  type NodoEditor,
} from "./NodoConPuertos";
export {
  AristaInsertable,
  EVENTO_INSERTAR_EN_ARISTA,
  type AristaEditor,
  type DatosArista,
} from "./AristaInsertable";
export { NodoDiff, TIPOS_NODO_DIFF, type NodoDiffFlow } from "./NodoDiff";
export { NodoCorrida, TIPOS_NODO_CORRIDA, type NodoCorridaFlow } from "./NodoCorrida";

export * from "./severidad";
export * from "./diff";
export * from "./corrida";
export {
  MEDIDAS,
  CURVA,
  DURACION,
  FOCO,
  PRESION_TACTIL,
  TRANSICION_CONTROL,
} from "./tokens-editor";
export { Dato, type PresentacionNodo, type ResolverNodo } from "./contrato-nodos";
