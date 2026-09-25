import { WORKFLOW_LLM } from "@/types/domain";
import type { Comparado } from "@/types/metricas";

/**
 * Nombre en castellano de cada tipo de llamada al modelo. La columna de la base
 * guarda el identificador técnico —tiene que sobrevivir a renombres— y la
 * traducción vive acá. Un workflow que no esté en el mapa se muestra crudo en
 * vez de desaparecer: preferimos un nombre feo antes que gasto invisible.
 */
const LABEL_WORKFLOW: Record<string, string> = {
  [WORKFLOW_LLM.agente]: "Agente vendedor",
  [WORKFLOW_LLM.agentePreview]: "Pruebas desde la consola",
  [WORKFLOW_LLM.clasificador]: "Clasificador de intents",
  [WORKFLOW_LLM.extractorTwin]: "Extractor del Twin",
  [WORKFLOW_LLM.resumidor]: "Resumidor de conversación",
  [WORKFLOW_LLM.detectorBatch]: "Detector de intents (semanal)",
};

export function etiquetaWorkflow(workflow: string): string {
  return LABEL_WORKFLOW[workflow] ?? workflow;
}

const ENTERO = new Intl.NumberFormat("es-AR");
const DECIMAL = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatearEntero(n: number): string {
  return ENTERO.format(n);
}

export function formatearEspera(segundos: number | null): string {
  if (segundos === null) return "—";
  if (segundos < 60) return `${segundos} s`;
  const minutos = Math.floor(segundos / 60);
  const resto = segundos % 60;
  return resto === 0 ? `${minutos} m` : `${minutos} m ${resto} s`;
}

export function cantidad(n: number, singular: string, plural = `${singular}s`): string {
  return `${formatearEntero(n)} ${n === 1 ? singular : plural}`;
}

/**
 * USD con la precisión que el número necesita. Un turno con un modelo nano
 * cuesta del orden de una milésima de dólar: con dos decimales fijos, todo el
 * gasto por lead se leería "$0,00" y la pantalla no serviría para nada. Por eso
 * los montos chicos muestran cuatro decimales y los grandes dos.
 */
export function formatearUsd(n: number): string {
  const decimales = n !== 0 && Math.abs(n) < 1 ? 4 : 2;
  return `$${n.toLocaleString("es-AR", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })}`;
}

/** Miles con sufijo `k`, para los conteos de tokens del handoff §3.2 (412k). */
export function formatearTokens(n: number): string {
  if (n < 1000) return ENTERO.format(n);
  return `${DECIMAL.format(n / 1000)}k`;
}

/** Porcentaje con un decimal: `23,4%`. */
export function formatearPorcentaje(n: number): string {
  return `${DECIMAL.format(n)}%`;
}

/** Parte sobre total en porcentaje. Total en cero devuelve 0, no NaN. */
export function porcentajeDe(parte: number, total: number): number {
  return total > 0 ? Math.round((parte / total) * 1000) / 10 : 0;
}

/**
 * Dirección del cambio contra la ventana anterior. La pantalla la pinta
 * asumiendo que subir es bueno, que es cierto para las dos métricas que hoy
 * llevan delta (leads nuevos y tasa de cierre).
 */
export type SentidoDelta = "sube" | "baja" | "igual";

export interface Delta {
  texto: string;
  sentido: SentidoDelta;
}

function sentidoDe(diferencia: number): SentidoDelta {
  if (diferencia > 0) return "sube";
  if (diferencia < 0) return "baja";
  return "igual";
}

/** El menos tipográfico del handoff (−41%), no el guion del teclado. */
function conSigno(valor: number, unidad: string): string {
  const signo = valor > 0 ? "+" : "−";
  return `${signo}${DECIMAL.format(Math.abs(valor))}${unidad}`;
}

/**
 * Variación relativa contra la ventana anterior. `null` cuando no hay con qué
 * comparar: sin ventana anterior, o con la anterior en cero, donde el porcentaje
 * de cambio es una división por cero y no un "+100%".
 */
export function deltaRelativo({ valor, anterior }: Comparado): Delta | null {
  if (anterior === null || anterior === 0) return null;
  const variacion = ((valor - anterior) / anterior) * 100;
  const redondeada = Math.round(variacion * 10) / 10;
  if (redondeada === 0) return { texto: "sin cambio", sentido: "igual" };
  return { texto: conSigno(redondeada, "%"), sentido: sentidoDe(redondeada) };
}

/**
 * Diferencia en puntos porcentuales, para métricas que ya son un porcentaje:
 * restar dos porcentajes da puntos, no un porcentaje de porcentaje.
 */
export function deltaPuntos({ valor, anterior }: Comparado): Delta | null {
  if (anterior === null) return null;
  const diferencia = Math.round((valor - anterior) * 10) / 10;
  if (diferencia === 0) return { texto: "sin cambio", sentido: "igual" };
  return { texto: conSigno(diferencia, " pts"), sentido: sentidoDe(diferencia) };
}

// =========================================================================
// Escalas de color de los repartos (§3.1-§3.3)
// =========================================================================

/**
 * Los tres colores del reparto de la atención.
 *
 * Reemplazan a `[--color-brand, --color-info, stageColor("requiere_humano")]`,
 * que mezclaba en una misma barra apilada tres paletas distintas: la marca, los
 * semánticos y las etapas del embudo. Las tres están congeladas de a una —la
 * marca por decisión de producto, las etapas por estar ya calibradas— así que
 * ningún ajuste de token podía arreglar la colisión; había que sacarlas de la
 * escala. Medido con `node scripts/verificar-paleta-clara.mjs`:
 *
 *   info <-> stage-requiere-humano   ΔE 22.0 normal pero 3.5 en CVD
 *   (el piso del validador es 6 y el objetivo 8)
 *
 * O sea: "las tomó una persona" y "esperando a una persona" eran el mismo color
 * para quien no distingue rojo de verde, y son justo las dos franjas cuya
 * diferencia es el punto del gráfico.
 *
 * Con `ok / info / caution` el peor par baja a ΔE 16.6 normal y 8.3 CVD en
 * claro, y 16.9 / 11.6 en oscuro: por encima del objetivo en los dos temas.
 *
 * La lectura además mejora. La barra no responde "quién actuó" sino "en qué
 * terminó la cola": resuelta sin gente (`ok`), resuelta por gente (`info`,
 * neutro) y sin resolver (`caution`, mirá esto). `--color-brand` sigue siendo
 * "el agente" en las barras de autoría de `PanelTotal` y `PanelAgente`, donde
 * la pregunta SÍ es quién actuó y donde los pares miden bien.
 */
export const COLORES_ATENCION = {
  resueltoPorAgente: "var(--color-ok)",
  tomadoPorPersona: "var(--color-info)",
  sinAtender: "var(--color-caution)",
} as const;

/**
 * Cuántos tramos admite una rampa antes de que dos contiguos se confundan.
 *
 * A 5 tramos el peor escalón mide ΔE 8.6 normal y 8.2 en CVD sobre el track de
 * la barra en tema claro, que es el caso más hostil de los cuatro (dos temas x
 * dos superficies). A 6 cae a 7.1 y queda por debajo del objetivo. El número
 * sale de `scripts/verificar-paleta-clara.mjs`, que lo vuelve a medir en cada
 * corrida en vez de dejarlo escrito acá y nada más.
 */
export const TRAMOS_RAMPA = 5;

/**
 * Rampa secuencial de un solo tono, del más fuerte al más suave.
 *
 * Para repartos ORDENADOS por magnitud, no categóricos. Los motivos de escalado
 * no son categorías con color propio —ningún motivo es "el rojo"— y pintarlos
 * con una escala categórica le da significado a un color que no lo tiene. Peor:
 * los tokens semánticos no dan para una escala categórica larga. Medido, la
 * subescala más grande en la que TODOS los pares llegan a ΔE 15 normal y 8 CVD
 * en los dos temas es de **tres** colores (`ok`, `warn`, `info`); la constante
 * que esto reemplaza tenía seis, así que era imposible de leer por construcción.
 *
 * Una rampa de un tono no tiene ese techo porque los escalones son de
 * luminosidad, y la luminosidad sobrevive a la simulación de daltonismo casi
 * intacta.
 *
 * El alfa baja hasta 28% y no menos: más abajo los escalones se juntan. Y como
 * a ese alfa el punto de la leyenda queda lavado contra el fondo (contraste
 * 1,5:1), la leyenda de una barra así **numera** en vez de poner un punto de
 * color — ver la prop `numerada` de `BarraReparto`. La identidad de cada tramo
 * la lleva el número y el orden, no el color.
 */
export function escalaSecuencial(tramos: number, tono = "var(--color-info)"): string[] {
  const n = Math.max(1, Math.min(tramos, TRAMOS_RAMPA));
  if (n === 1) return [tono];
  const MINIMO = 28;
  return Array.from({ length: n }, (_, i) => {
    const alfa = Math.round(100 - i * ((100 - MINIMO) / (n - 1)));
    return `color-mix(in srgb, ${tono} ${alfa}%, transparent)`;
  });
}
