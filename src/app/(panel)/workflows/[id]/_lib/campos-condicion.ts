import { canalLabel } from "@/lib/ui/canal";
import {
  COMPARADOR_LABEL,
  comparadorSinValor,
  type CampoCondicion as CampoDelConstructor,
  type Grupo,
  type NodoCondicion,
  type OpcionCampo,
  type Regla,
  type ValorCondicion,
} from "@/lib/ui/condiciones";
import { stageLabel } from "@/lib/ui/stage";
import {
  CAMPOS_CONDICION,
  OPCIONES_DE_CAMPO_CONDICION,
  TIPO_DE_CAMPO_CONDICION,
  esCampoCondicion,
  type CampoCondicion,
} from "@/lib/workflows/condiciones";
import { arbolDeConfig } from "@/lib/workflows/condiciones.schema";
import { CANAL, CURRENT_STAGE, type Canal, type CurrentStage } from "@/types/domain";

/**
 * Los campos de una condición de workflow, como los muestra el constructor.
 *
 * La lista blanca, el tipo y los valores posibles de cada campo son del motor
 * (`lib/workflows/condiciones.ts`) y se toman de ahí tal cual: acá sólo se les
 * pone nombre. `condiciones.ts` lo deja dicho —"las etiquetas que se leen en
 * pantalla las pone la pantalla"—, y ésta es esa pantalla.
 *
 * Los nombres salen de lo que el contexto de la corrida realmente guarda
 * (`lib/workflows/contexto.ts`): `lead.etapa` es la etapa de la sesión, porque
 * el lead no tiene etapa propia, y `sesion.respondio` sólo existe cuando el
 * flujo lo disparó un mensaje.
 */
const PRESENTACION: Record<CampoCondicion, { etiqueta: string; grupo: string; unidad?: string }> = {
  "lead.etapa": { etiqueta: "Etapa", grupo: "Lead" },
  "lead.nombre": { etiqueta: "Nombre", grupo: "Lead" },
  "lead.canal": { etiqueta: "Canal", grupo: "Lead" },
  "lead.etiquetas": { etiqueta: "Etiquetas del lead", grupo: "Lead" },
  // "Hace más de N días": la unidad sale al lado del número.
  "lead.alta": { etiqueta: "Alta del lead", grupo: "Lead", unidad: "días" },
  "lead.ultimo_mensaje": { etiqueta: "Último mensaje del lead", grupo: "Lead", unidad: "días" },
  "sesion.respondio": { etiqueta: "Respondió", grupo: "Sesión" },
  "sesion.tiene_cotizacion": { etiqueta: "Tiene cotización", grupo: "Sesión" },
  "sesion.intent": { etiqueta: "Intent detectado", grupo: "Sesión" },
  "sesion.precio_cotizado": { etiqueta: "Precio cotizado", grupo: "Sesión" },
  "vehiculo.marca": { etiqueta: "Marca del vehículo", grupo: "Vehículo" },
};

/**
 * Las filas de la base que son valores de los campos cerrados: los intents y
 * las etiquetas. La condición guarda sus ids —sobreviven a un cambio de
 * nombre— y la pantalla les pone el nombre.
 */
export interface CatalogosDeCondicion {
  intents: readonly { id: string; nombre: string; activo?: boolean }[];
  etiquetas: readonly { id: string; nombre: string; color?: string }[];
}

const SIN_CATALOGOS: CatalogosDeCondicion = { intents: [], etiquetas: [] };

function opcionesDeLaBase(
  campo: CampoCondicion,
  catalogos: CatalogosDeCondicion,
): OpcionCampo[] | undefined {
  if (campo === "sesion.intent") {
    return catalogos.intents.map((i) => ({
      valor: i.id,
      etiqueta: i.activo === false ? `${i.nombre} (inactivo)` : i.nombre,
    }));
  }
  if (campo === "lead.etiquetas") {
    return catalogos.etiquetas.map((t) => ({
      valor: t.id,
      etiqueta: t.nombre,
      ...(t.color ? { color: t.color } : {}),
    }));
  }
  return undefined;
}

function esEtapa(valor: string): valor is CurrentStage {
  return (CURRENT_STAGE as readonly string[]).includes(valor);
}

function esCanal(valor: string): valor is Canal {
  return (CANAL as readonly string[]).includes(valor);
}

/** El valor guardado es el del dominio (`cotizado`, `wa`); el que se lee, su nombre. */
function etiquetaDeOpcion(campo: CampoCondicion, valor: string): string {
  if (campo === "lead.etapa" && esEtapa(valor)) return stageLabel(valor);
  if (campo === "lead.canal" && esCanal(valor)) return canalLabel(valor);
  return valor;
}

/**
 * Lo que recibe el constructor compartido. Intent y etiquetas toman sus
 * opciones de `catalogos`; sin ellos quedan con la lista vacía —no se puede
 * elegir nada todavía—, nunca con opciones inventadas.
 */
export function camposDeCondicion(
  catalogos: CatalogosDeCondicion = SIN_CATALOGOS,
): readonly CampoDelConstructor[] {
  return CAMPOS_CONDICION.map((id) => ({
    id,
    ...PRESENTACION[id],
    tipo: TIPO_DE_CAMPO_CONDICION[id],
    opciones:
      opcionesDeLaBase(id, catalogos) ??
      OPCIONES_DE_CAMPO_CONDICION[id]?.map(
        (valor): OpcionCampo => ({ valor, etiqueta: etiquetaDeOpcion(id, valor) }),
      ),
  }));
}

/** Los campos sin catálogos cargados todavía. */
export const CAMPOS_DE_CONDICION: readonly CampoDelConstructor[] = camposDeCondicion();

// ──────────────────────────────────────────────────────────────────────────
// La condición en una frase
// ──────────────────────────────────────────────────────────────────────────

/** Lo que falta en una fila a medias. Se ve como hueco, no se rellena con un valor inventado. */
const FALTA = "…";

/**
 * El nombre de un intent o una etiqueta por su id. Sin catálogo no se muestra
 * el id —un uuid en el nodo no le dice nada a nadie—: se dice qué es.
 */
function nombreDeLaBase(
  campo: CampoCondicion,
  id: string,
  catalogos: CatalogosDeCondicion | undefined,
): string | null {
  if (campo === "sesion.intent") {
    return catalogos?.intents.find((i) => i.id === id)?.nombre ?? null;
  }
  if (campo === "lead.etiquetas") {
    return catalogos?.etiquetas.find((t) => t.id === id)?.nombre ?? null;
  }
  return null;
}

function textoDeValor(
  campo: CampoCondicion | null,
  valor: ValorCondicion,
  catalogos?: CatalogosDeCondicion,
): string | null {
  switch (valor.tipo) {
    case "ninguno":
      return null;
    case "opcion":
      if (valor.valor === null) return null;
      if (campo === "sesion.intent") {
        return nombreDeLaBase(campo, valor.valor, catalogos) ?? "un intent";
      }
      return campo ? etiquetaDeOpcion(campo, valor.valor) : valor.valor;
    case "opciones":
      if (valor.valores.length === 0) return null;
      if (campo === "lead.etiquetas") {
        const nombres = valor.valores.map((v) => nombreDeLaBase(campo, v, catalogos));
        if (nombres.every((n): n is string => n !== null)) return nombres.join(", ");
        const n = valor.valores.length;
        return n === 1 ? "1 etiqueta" : `${n} etiquetas`;
      }
      return valor.valores.map((v) => (campo ? etiquetaDeOpcion(campo, v) : v)).join(", ");
    case "texto":
      return valor.valor.trim() === "" ? null : `«${valor.valor}»`;
    case "numero":
      return valor.valor === null ? null : String(valor.valor);
    case "fecha":
      return valor.valor;
    case "rango":
    case "rangoFecha":
      return valor.desde === null || valor.hasta === null
        ? null
        : `${String(valor.desde)} y ${String(valor.hasta)}`;
    case "booleano":
      return valor.valor ? "sí" : "no";
  }
}

function resumenDeRegla(regla: Regla, catalogos?: CatalogosDeCondicion): string {
  const campo = regla.campoId !== null && esCampoCondicion(regla.campoId) ? regla.campoId : null;
  // Un campo que el motor no conoce se nombra con su id: inventarle un nombre
  // escondería justamente lo que está mal.
  const nombre = campo ? PRESENTACION[campo].etiqueta : regla.campoId;
  if (nombre === null || regla.comparador === null) return FALTA;
  if (comparadorSinValor(regla.comparador)) {
    return `${nombre} ${COMPARADOR_LABEL[regla.comparador]}`;
  }
  // "Respondió: sí" y no "Respondió es sí".
  if (regla.valor.tipo === "booleano") return `${nombre}: ${regla.valor.valor ? "sí" : "no"}`;
  const unidad = regla.comparador === "hace_mas_de" ? " días" : "";
  return `${nombre} ${COMPARADOR_LABEL[regla.comparador]} ${textoDeValor(campo, regla.valor, catalogos) ?? FALTA}${unidad}`;
}

function resumenDeNodo(
  nodo: NodoCondicion,
  anidado: boolean,
  catalogos?: CatalogosDeCondicion,
): string {
  if (nodo.clase === "regla") return resumenDeRegla(nodo, catalogos);
  const texto = nodo.hijos
    .map((h) => resumenDeNodo(h, true, catalogos))
    .join(nodo.operador === "y" ? " y " : " o ");
  // El paréntesis es la caja del constructor puesta en una línea: sin él,
  // "A y B o C" se lee distinto de lo que dice el árbol.
  return anidado && nodo.hijos.length > 1 ? `(${texto})` : texto;
}

/** "Etapa es Cotizado y (Canal es WhatsApp o Respondió: sí)". Prosa, nunca JSON. */
export function resumenDeCondicion(arbol: Grupo, catalogos?: CatalogosDeCondicion): string {
  return resumenDeNodo(arbol, false, catalogos);
}

function algunCampoElegido(nodo: NodoCondicion): boolean {
  if (nodo.clase === "regla") return nodo.campoId !== null;
  return nodo.hijos.some(algunCampoElegido);
}

/**
 * La frase de la condición guardada en la config de un nodo, o `null` si no
 * hay nada que decir: la config está rota o la condición todavía no eligió
 * ningún campo. Con `null`, quien pinta el nodo cae a la descripción del
 * catálogo, que es lo que el nodo mostraba antes de configurarse.
 */
export function resumenDeConfigCondicion(
  config: Record<string, unknown>,
  catalogos?: CatalogosDeCondicion,
): string | null {
  const arbol = arbolDeConfig(config);
  if (arbol === null || !algunCampoElegido(arbol)) return null;
  return resumenDeCondicion(arbol, catalogos);
}
