/**
 * Difusión: el listado, el asistente de tres pasos (audiencia, mensaje y
 * pre-vuelo) y el envío de una difusión programada.
 *
 * El árbol de condiciones NO vive acá. Es el mismo componente que usa el nodo
 * Condición de un workflow (`@/components/shared/condiciones`, modelo en
 * `@/lib/ui/condiciones`); esta carpeta aporta lo que es propio del dominio:
 * el catálogo de campos (`camposAudiencia`, atado a lo que resuelve la base),
 * el contador sobre el padrón (`AlcanceEnVivo`) y las exclusiones con motivo.
 *
 * Ninguna cifra se calcula acá: cuántos, a quién y en qué tanda llegan hechos
 * del servicio y del planificador (`lib/difusion/planificador.ts`).
 */

export { ListadoDifusiones } from "./ListadoDifusiones";
export { ConstructorAudiencia } from "./ConstructorAudiencia";
export { ConstructorMensaje } from "./ConstructorMensaje";
export { PreVuelo } from "./PreVuelo";
export { EnvioEnCurso } from "./EnvioEnCurso";

export { CabeceraDifusion, PasosDifusion, PASOS_DIFUSION } from "./CabeceraDifusion";
export { camposAudiencia, type CatalogosAudiencia } from "./campos-audiencia";
export { AlcanceEnVivo } from "./AlcanceEnVivo";
export { SelectorModo } from "./SelectorModo";
export { ExclusionesAudiencia } from "./ExclusionesAudiencia";
export { EXCLUSION, exclusionesVisibles } from "./exclusiones";
export { ESTADO_DIFUSION } from "./estado-difusion";
export { BadgeCategoria, SelectorPlantilla } from "./SelectorPlantilla";
export { VariablesPlantilla } from "./VariablesPlantilla";
export { ACCION_BOTON, AccionesBotones } from "./AccionesBotones";
export { VistaPreviaMensaje } from "./VistaPreviaMensaje";
export { CAMPOS_VARIABLE, etiquetaCampo } from "./campos-mensaje";
export { ListaDestinatarios } from "./ListaDestinatarios";
export { MedidorCupo } from "./MedidorCupo";
export { PlanDeReparto } from "./PlanDeReparto";
export { VerdictoEnvio } from "./VerdictoEnvio";
export { CostoEstimado } from "./CostoEstimado";
export { SaludDelNumero } from "./SaludDelNumero";
export { BloqueCanary } from "./BloqueCanary";
export { ProgresoEnvio } from "./ProgresoEnvio";
export { FallidosPorMotivo } from "./FallidosPorMotivo";
export { PanelDetener } from "./PanelDetener";
export { RespuestasEntrantes } from "./RespuestasEntrantes";
export { DesgloseEntrega, EstadoEntregaPill } from "./EstadosEntrega";
export { Cifra, CodigoMeta, FilaDato, Nota, Panel, Punto } from "./primitivas";

export { anchoTramo, evaluarEnvio, rielDeCupo } from "./cupo";
export {
  camposFaltantes,
  componerTexto,
  configInicial,
  contarSinDato,
  describirPendiente,
  disponibilidad,
  lineasCostoMensaje,
  pendientesMensaje,
  resolverVariable,
  segmentar,
  totalCosto,
  variablesDe,
} from "./mensaje";
export {
  CATEGORIA_PLANTILLA,
  COLOR_CUPO,
  COLOR_RUTA,
  ESTADO_ENTREGA,
  ETIQUETA_GRUPO,
  ETIQUETA_RUTA,
  ORDEN_ESTADOS,
  colorDeFallo,
  rayado,
  tinte,
} from "./paleta";
export {
  formatearEntero,
  formatearEscalon,
  formatearPorcentaje,
  formatearResta,
  formatearUsd,
} from "./formato";

export type { AccionEnvio } from "./EnvioEnCurso";
export type { CalculoPreVuelo, EstadoPreVuelo } from "./PreVuelo";
export type { EntradaVerdicto, NivelVerdicto, RielCupo, Verdicto } from "./cupo";
export type { DescriptorExclusion } from "./exclusiones";
export type { Disponibilidad, Pendiente, PiezaMensaje, Resolucion, Segmento } from "./mensaje";
export type { TamanoCifra } from "./primitivas";
export type { TramoCupo } from "./paleta";
export type * from "./tipos";
