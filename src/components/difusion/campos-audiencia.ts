import { DEFINICION_CAMPO_AUDIENCIA, type CampoAudiencia } from "@/lib/difusion/audiencia";
import { canalLabel } from "@/lib/ui/canal";
import { MOTIVO_LABEL } from "@/lib/ui/motivo-perdida";
import { stageLabel } from "@/lib/ui/stage";
import { CANAL, CURRENT_STAGE, MOTIVO_PERDIDA } from "@/types/domain";
import type { CampoCondicion, OpcionCampo } from "@/lib/ui/condiciones";

/**
 * El catálogo de campos de una audiencia.
 *
 * Es la mitad de Difusión que no se comparte con el editor de workflows: el
 * árbol, los grupos Y/O y los editores de valor son los mismos
 * (`@/lib/ui/condiciones` + `@/components/shared/condiciones`); lo que cambia
 * es por qué se puede preguntar y con qué palabras.
 *
 * ## Tipo y comparadores los decide el backend
 *
 * Cada campo toma `tipo` y `comparadores` de `DEFINICION_CAMPO_AUDIENCIA`
 * (`lib/difusion/audiencia.ts`): la misma tabla con la que el servicio compila
 * la audiencia y la función SQL la resuelve. La pantalla pone la etiqueta, el
 * grupo, las opciones y cómo se lee cada comparador, y nada más, así que no
 * puede ofrecer una pregunta que la base rechace. `campos-audiencia.test.ts`
 * falla si se separan.
 *
 * ## Qué pregunta cada uno
 *
 * Etapa, motivo de pérdida, vendedor y pieza consultada son los de la sesión
 * más reciente del lead; canal, el canal por el que llegó; última actividad,
 * la conversación más reciente (o el alta); campaña previa, un envío de esa
 * difusión que llegó a Meta. "No es ninguna de" incluye a quien no tiene el
 * dato.
 *
 * No hay "respondió a una campaña": nada registra todavía qué respuesta vino
 * de qué difusión, y la pregunta devolvería cero sin decir por qué.
 */

/**
 * Las listas que no se pueden conocer en tiempo de compilación. Etapas, canales
 * y motivos son enums del dominio; etiquetas, vendedores y campañas son datos
 * que trae quien monta la pantalla. Un catálogo que se los inventa ofrece
 * opciones que no existen, y filtrar por una devuelve cero sin decir por qué.
 */
export interface CatalogosAudiencia {
  etiquetas?: readonly OpcionCampo[];
  vendedores?: readonly OpcionCampo[];
  campanias?: readonly OpcionCampo[];
}

const ETAPAS: readonly OpcionCampo[] = CURRENT_STAGE.map((e) => ({
  valor: e,
  etiqueta: stageLabel(e),
}));

const CANALES: readonly OpcionCampo[] = CANAL.map((c) => ({
  valor: c,
  etiqueta: canalLabel(c),
}));

const MOTIVOS: readonly OpcionCampo[] = MOTIVO_PERDIDA.map((m) => ({
  valor: m,
  etiqueta: MOTIVO_LABEL[m],
}));

/** Lo que no decide la pantalla: cómo lo resuelve la base. */
function comoLoResuelve(id: CampoAudiencia): Pick<CampoCondicion, "id" | "tipo" | "comparadores"> {
  const { tipo, comparadores } = DEFINICION_CAMPO_AUDIENCIA[id];
  return { id, tipo, comparadores };
}

/**
 * Los campos por los que se filtra una audiencia, con sus opciones reales.
 *
 * El agrupador (`grupo`) no es decorativo: son nueve campos, y un desplegable
 * plano obliga a leerlos todos para encontrar uno.
 */
export function camposAudiencia(catalogos: CatalogosAudiencia = {}): readonly CampoCondicion[] {
  const { etiquetas = [], vendedores = [], campanias = [] } = catalogos;

  return [
    {
      ...comoLoResuelve("etapa"),
      etiqueta: "Etapa del lead",
      grupo: "Lead",
      opciones: ETAPAS,
      etiquetas: { tiene: "es alguna de", no_tiene: "no es ninguna de" },
    },
    {
      ...comoLoResuelve("etiqueta"),
      etiqueta: "Etiqueta",
      grupo: "Lead",
      opciones: etiquetas,
      etiquetas: { tiene: "tiene alguna de", tiene_todas: "tiene todas", no_tiene: "no tiene" },
    },
    {
      ...comoLoResuelve("vendedor"),
      etiqueta: "Vendedor asignado",
      grupo: "Lead",
      opciones: vendedores,
      etiquetas: { tiene: "es alguno de", no_tiene: "no es ninguno de" },
    },
    {
      ...comoLoResuelve("canal"),
      etiqueta: "Canal",
      grupo: "Lead",
      opciones: CANALES,
      etiquetas: { tiene: "es alguno de", no_tiene: "no es ninguno de" },
    },
    {
      ...comoLoResuelve("motivo_perdida"),
      etiqueta: "Motivo de pérdida",
      grupo: "Sesión",
      opciones: MOTIVOS,
      etiquetas: { tiene: "es alguno de", no_tiene: "no es ninguno de" },
    },
    {
      ...comoLoResuelve("ultima_actividad"),
      etiqueta: "Última actividad",
      grupo: "Sesión",
      unidad: "días",
      etiquetas: { mayor_que: "hace más de", menor_que: "hace menos de" },
    },
    {
      ...comoLoResuelve("consulta"),
      etiqueta: "Pieza consultada",
      grupo: "Sesión",
    },
    {
      ...comoLoResuelve("vehiculo"),
      etiqueta: "Vehículo",
      grupo: "Vehículo",
    },
    {
      ...comoLoResuelve("campania_previa"),
      etiqueta: "Campaña previa",
      grupo: "Campañas",
      opciones: campanias,
      etiquetas: { tiene: "recibió alguna de", no_tiene: "no recibió ninguna de" },
    },
  ];
}
