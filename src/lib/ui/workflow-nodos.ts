import type { CategoriaVisual } from "@/types/workflows";

/**
 * Sistema visual de los nodos del canvas de workflows.
 *
 * Existían tres fuentes de color en conflicto y esta es la reconciliación:
 *
 * 1. `src/app/globals.css` — los tokens REALES (surface/line/ink/brand,
 *    semánticos, 8 de etapa). Es la fuente de verdad y manda.
 * 2. `docs/design-system/workflow-nodes.md` — proponía una paleta propia
 *    (esmeralda/azul/violeta/ámbar/cyan/rosa/gris) en hex crudos de Tailwind
 *    que no salen de ningún token. Se descarta: su §10 pedía reconciliarla
 *    antes de implementar, no después.
 * 3. El prototipo `Workflows y Difusion.dc.html` — hecho sin acceso al repo,
 *    con tokens derivados (paleta cálida `#faf9f7`/`#191512` donde el sistema
 *    real usa neutros fríos `#f6f7f8`/`#14161b`). Su ESTRUCTURA y sus
 *    decisiones se conservan; sus valores de color no.
 *
 * ────────────────────────────────────────────────────────────────────────
 * LOS DOS CANALES: categoría y estado NO comparten geometría
 * ────────────────────────────────────────────────────────────────────────
 *
 * Un nodo tiene que comunicar dos cosas a la vez —qué ES (categoría) y qué le
 * PASA (estado)— y el sistema no tiene colores suficientes para que las dos
 * dimensiones sean disjuntas: 7 categorías + 5 estados = 12 tonos distintos, y
 * los tokens usables son 9. Medido, las colisiones son exactas, no parecidos:
 * `special`(IA) y `--stage-requiere-humano` son el mismo hex, igual que
 * `ok`/`--stage-cerrado` y `caution`/`--stage-negociando` en oscuro.
 *
 * Buscar un 13.º color sería inventar un hex fuera del sistema. La salida es
 * separar los canales por DÓNDE se dibujan, no por qué tono usan:
 *
 *   categoría → el chip del ícono. Nunca el borde.
 *   estado    → el borde de la tarjeta y una etiqueta con TEXTO. Nunca el chip.
 *
 * El chip es el único lugar donde aparece la categoría, y alcanza: ya la
 * codifica dos veces, en color y en glifo. Se probó agregarle además un riel
 * de color al borde izquierdo y se descartó — un tercer encoding del mismo
 * dato sólo suma ruido en un canvas con decenas de tarjetas.
 *
 * Por eso un nodo de mensajería (`info`) ejecutándose (`info`) se lee sin
 * ambigüedad: el azul del chip y el azul del borde ocupan lugares distintos, y
 * además el estado dice la palabra. Codificar un estado sólo con color es el
 * anti-patrón que WCAG SC 1.4.1 nombra; acá todo estado no-normal lleva texto.
 *
 * La selección refuerza esto siendo ACROMÁTICA (`ink-primary`, como en el
 * prototipo): no compite con ninguna categoría y compone con cualquier estado
 * —un nodo puede estar seleccionado Y fallado a la vez, y se ven las dos cosas.
 *
 * ────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL NOMBRE DEL NODO NO VA EN EL COLOR DE LA CATEGORÍA
 * ────────────────────────────────────────────────────────────────────────
 *
 * Se probó y no llega. Como texto de 11.5px sobre el tinte al 13% de su propio
 * color, 4 de las 7 categorías quedan por debajo de 4.5:1:
 *
 *   claro   trigger #d61f1f = 4.18 · crm #0f8f61 = 3.49 · logica #b45309 = 4.20
 *   oscuro  trigger #d61f1f = 3.40
 *
 * `brand` no se invierte entre temas (decisión de `globals.css`), así que sobre
 * una tarjeta casi negra es un rojo medio y no hay margen. El nombre va en
 * `ink-primary` —el prototipo también lo pinta así, `color:#191512`— y el color
 * de la categoría queda en el ícono y el riel, que son elementos gráficos y su
 * vara es 3:1 (WCAG SC 1.4.11). Ahí sí pasan los 7 en los dos temas.
 *
 * ────────────────────────────────────────────────────────────────────────
 * LA ASIGNACIÓN, Y POR QUÉ NO ES LA DEL PROTOTIPO
 * ────────────────────────────────────────────────────────────────────────
 *
 * El prototipo proponía: disparadores→brand, mensajería→info, CRM→ok,
 * IA→special, difusión→warn, lógica e internos→ink-3. Se conservan las cuatro
 * primeras y se corrigen dos cosas:
 *
 * - **"Lógica e internos → ink-3" colapsa dos categorías en un gris.** Lógica
 *   son 11 tipos (condición, switch, loop, esperas) y es el esqueleto del
 *   grafo: es lo último que debería ser gris. Internos son 4 (comentario,
 *   debug, avisos) y esos sí son cromo del sistema, no acción de negocio. El
 *   gris se queda sólo con internos.
 * - **"Difusión → warn" no existe acá.** Las 7 categorías del código
 *   (`CategoriaVisual`) no incluyen difusión; sí incluyen `integracion`, que el
 *   prototipo no mapeó.
 *
 * Cada color se gana el puesto por lo que el nodo HACE, no por gusto:
 *
 *   brand    trigger      empieza. Único sin entrada, uno por grafo.
 *   info     mensajeria   sale al cliente. Irreversible y visible.
 *   ok       crm          cambia nuestros datos. Interno y reversible.
 *   caution  logica       decide por dónde sigue.
 *   indigo   integracion  sale del edificio (HTTP, código, email, DB).
 *   special  ia           piensa.
 *   ink      interno      anota, no actúa.
 *
 * `danger` queda RESERVADO al estado de error: usarlo de categoría dejaría
 * invisible al nodo fallado de esa categoría.
 *
 * **`integracion` usa `--stage-identificando` y hay que decir por qué.** El set
 * semántico tiene 6 tonos (brand/info/ok/warn/caution/special) para 6
 * categorías cromáticas — alcanzaría justo, salvo que `warn` y `caution` son
 * indistinguibles en tema claro: separación OKLab 0.041, por debajo de la vara
 * 0.054 que el propio proyecto se puso. `globals.css` ya lo avisa ("los dos
 * tonos más apagados de la paleta clara y no hay margen"). O sea: **al sistema
 * le falta exactamente un tono para vestir 7 categorías.** Antes que inventar
 * un hex, se toma prestado un token real con los dos temas ya definidos y
 * contraste ya verificado. Es deuda anotada, no una decisión cómoda: si algún
 * día `globals.css` suma un token propio de nodos, este es el que cambia.
 *
 * ────────────────────────────────────────────────────────────────────────
 * NÚMEROS — reproducibles, no afirmados (AGENTS.md lección 8)
 * ────────────────────────────────────────────────────────────────────────
 *
 * Las dos varas son las mismas que `scripts/verificar-paleta-clara.mjs` le
 * aplica a las etapas del embudo: contraste sobre el tinte al 13% del propio
 * color, y separación OKLab >= 0.054 (la mínima que la paleta oscura de etapas
 * ya tiene en producción, o sea el parecido que el producto ya acepta).
 *
 *   claro   separación 0.095 (trigger/logica)     chip 13% mínimo 3.49 (crm)
 *   oscuro  separación 0.097 (mensajeria/interno) chip 13% mínimo 3.40 (trigger)
 *
 * Las dos separaciones superan 0.054 y los dos mínimos de contraste superan la
 * vara de 3:1 que corresponde a un elemento gráfico. Se reproducen con:
 *
 * ```sh
 * node -e 'const P={trigger:["#d61f1f","#d61f1f"],mensajeria:["#2563a8","#7fb3f5"],crm:["#0f8f61","#34d399"],logica:["#b45309","#fbbf24"],integracion:["#4f46e5","#818cf8"],ia:["#a21caf","#e879f9"],interno:["#565c68","#a9aeb7"]},C=["#ffffff","#0f1116"],rgb=h=>[0,2,4].map(i=>parseInt(h.slice(1).substr(i,2),16)),ln=v=>(v/=255,v<=.04045?v/12.92:((v+.055)/1.055)**2.4),L=c=>.2126*ln(c[0])+.7152*ln(c[1])+.0722*ln(c[2]),K=(a,b)=>(Math.max(L(a),L(b))+.05)/(Math.min(L(a),L(b))+.05),ok=h=>{const[r,g,b]=rgb(h).map(ln),l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b),m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b),s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);return[.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s]},d=(x,y)=>Math.hypot(...ok(x).map((v,i)=>v-ok(y)[i]));for(const t of[0,1]){const bg=rgb(C[t]),k=Object.keys(P);let mn=1/0,par="";for(let i=0;i<k.length;i++)for(let j=i+1;j<k.length;j++){const x=d(P[k[i]][t],P[k[j]][t]);if(x<mn){mn=x;par=k[i]+"/"+k[j]}}const ch=k.map(c=>K(rgb(P[c][t]),rgb(P[c][t]).map((v,i)=>v*.13+bg[i]*.87)));console.log((t?"oscuro":"claro ")+" separacion "+mn.toFixed(3)+" ("+par+")  chip13% min "+Math.min(...ch).toFixed(2))}'
 * ```
 *
 * Los hex del comando son copias de `globals.css`. Si allá cambian y acá no, el
 * comando miente: son los mismos valores que resuelven los `var()` de abajo.
 */

/**
 * Color de cada categoría, como referencia al token — nunca un hex.
 *
 * Se devuelve `var(...)` y no una clase de Tailwind por el mismo motivo que en
 * `src/lib/ui/stage.ts`: `@theme inline` de `globals.css` no expone los tokens
 * de etapa como colores de Tailwind (no hay `--color-stage-*`), así que
 * `integracion` no tiene clase utilitaria posible. Seis categorías con clase y
 * una con `var()` arbitrario sería peor que las siete iguales.
 */
const COLOR: Record<CategoriaVisual, string> = {
  trigger: "var(--brand)",
  mensajeria: "var(--info)",
  crm: "var(--ok)",
  logica: "var(--caution)",
  integracion: "var(--stage-identificando)",
  ia: "var(--special)",
  interno: "var(--ink-muted)",
  // El handoff: "Difusión → warn".
  difusion: "var(--warn)",
};

const LABEL: Record<CategoriaVisual, string> = {
  trigger: "Disparador",
  mensajeria: "Mensajería",
  crm: "CRM",
  logica: "Lógica",
  integracion: "Integración",
  ia: "IA",
  interno: "Interno",
  difusion: "Difusión",
};

/** Qué hace la categoría, en una línea. Para el `title` y el lector de pantalla. */
const DESCRIPCION: Record<CategoriaVisual, string> = {
  trigger: "Arranca el flujo",
  mensajeria: "Le habla al cliente",
  crm: "Cambia datos del lead",
  logica: "Decide por dónde sigue",
  integracion: "Llama a un sistema externo",
  ia: "Le pregunta al modelo",
  interno: "Anota o avisa, no actúa sobre el lead",
  difusion: "Le habla a un grupo de leads",
};

export const CATEGORIAS_NODO = [
  "trigger",
  "mensajeria",
  "crm",
  "logica",
  "integracion",
  "ia",
  "interno",
  "difusion",
] as const satisfies readonly CategoriaVisual[];

export function categoriaColor(categoria: CategoriaVisual): string {
  return COLOR[categoria];
}

export function categoriaLabel(categoria: CategoriaVisual): string {
  return LABEL[categoria];
}

export function categoriaDescripcion(categoria: CategoriaVisual): string {
  return DESCRIPCION[categoria];
}

/**
 * Fondo del chip del ícono: 13% del color de la categoría.
 *
 * Mismo 13% y mismo `color-mix` que `stageBadgeBackground()`, por la misma
 * razón técnica: `COLOR[...]` es un `var(...)`, y concatenarle un alpha en hex
 * produciría el literal `var(--ok)21`, que ningún navegador interpreta.
 *
 * `transparent` y no una superficie fija: así el chip compone sobre la tarjeta
 * que le toque —`surface-card` normalmente, la tarjeta atenuada cuando el nodo
 * está memoizado— en vez de pintar un parche opaco que se recorta contra ella.
 */
export function categoriaChipFondo(categoria: CategoriaVisual): string {
  return `color-mix(in srgb, ${COLOR[categoria]} 13%, transparent)`;
}

/**
 * Estado del nodo en el canvas.
 *
 * `seleccionado` NO está acá: es un eje aparte —una afordancia de la UI, no algo
 * que le pasó al nodo— y se combina con cualquiera de estos. Meterlo en el mismo
 * enum obligaría a inventar estados imposibles tipo `error_seleccionado`.
 *
 * `memoizado` y `stale` son un par: el primero dice "no se ejecutó, se reusó el
 * resultado guardado"; el segundo, "ese resultado guardado ya no corresponde
 * porque la config cambió". Por eso comparten el tratamiento hundido y con
 * borde punteado, y sólo se diferencian en el tono y en la etiqueta.
 */
export const ESTADOS_NODO = ["normal", "error", "ejecutando", "memoizado", "stale"] as const;

export type EstadoNodo = (typeof ESTADOS_NODO)[number];

/**
 * Texto de la etiqueta de estado, partido en prosa y dato.
 *
 * El corte no es cosmético: **todo dato que se compara o se escanea va en Geist
 * Mono** (regla del sistema, y decisión 04 del prototipo). La hora de la que se
 * reusa un resultado y la duración de una ejecución son datos que se escanean;
 * "se reusa el resultado de las" es prosa. Devolverlos separados evita que cada
 * componente vuelva a decidir qué parte va en mono — y que uno se olvide.
 */
export interface EtiquetaEstado {
  /** Prosa. Geist Sans. */
  texto: string;
  /** Dato escaneable. Geist Mono. `null` si el estado no lleva ninguno. */
  dato: string | null;
}

/**
 * @param dato Hora para `memoizado` ("14:32"), duración para `ejecutando`
 *   ("36s"). Se ignora en el resto.
 */
export function etiquetaEstado(estado: EstadoNodo, dato?: string): EtiquetaEstado | null {
  switch (estado) {
    case "normal":
      return null;
    case "error":
      return { texto: "Error", dato: null };
    case "ejecutando":
      return { texto: "Ejecutando", dato: dato ?? null };
    case "memoizado":
      return dato === undefined
        ? { texto: "Se reusa el resultado guardado", dato: null }
        : { texto: "Se reusa el resultado de las", dato };
    case "stale":
      return { texto: "La config cambió desde la última corrida", dato: null };
  }
}

/**
 * Clases de la tarjeta según el estado del nodo.
 *
 * Acá sí son clases de Tailwind y no `var()`: los cinco tokens que usan
 * (`line-card`, `danger`, `info`, `line-control`, `caution`) SÍ están en
 * `@theme inline`, a diferencia del de `integracion`.
 *
 * El borde se queda en 1px en todos los estados y el énfasis lo pone un `ring`,
 * que se dibuja por fuera de la caja. Engrosar el borde a 1.5px como hace el
 * prototipo correría el contenido un cuarto de píxel cada vez que un nodo entra
 * en ejecución, y sobre un canvas con decenas de nodos eso se ve como un
 * temblor.
 */
const CLASES_ESTADO: Record<EstadoNodo, string> = {
  normal: "border-line-card",
  error: "border-danger/40 ring-1 ring-danger/25",
  ejecutando: "border-info ring-1 ring-info/30",
  memoizado: "border-dashed border-line-control opacity-70",
  stale: "border-dashed border-caution/60",
};

/**
 * Clases de la selección. Acromática a propósito (ver el bloque de arriba): no
 * compite con ninguna categoría y se apila con cualquier estado.
 */
const CLASES_SELECCION = "border-ink-primary ring-1 ring-ink-primary";

/**
 * Todas las clases de la tarjeta, ya compuestas.
 *
 * `seleccionado` gana el borde y el ring cuando los dos ejes quieren pintarlos,
 * pero no borra al estado: la etiqueta de texto sigue ahí, que es lo que
 * realmente comunica el estado. Un nodo fallado y seleccionado se lee fallado.
 */
export function clasesTarjetaNodo(estado: EstadoNodo, seleccionado: boolean): string {
  const base = "rounded-lg border bg-surface-card transition-shadow duration-150";
  const sombra = seleccionado ? "shadow-md" : "shadow-sm";
  const foco = seleccionado ? CLASES_SELECCION : CLASES_ESTADO[estado];
  // El estado hundido de memoizado/stale sobrevive a la selección: su opacidad
  // dice "este nodo no corrió", y eso es cierto aunque esté seleccionado.
  const hundido = seleccionado && estado === "memoizado" ? " opacity-70" : "";
  return `${base} ${sombra} ${foco}${hundido}`;
}

/** Clases de la etiqueta de estado. `null` cuando el estado no lleva etiqueta. */
export function clasesEtiquetaEstado(estado: EstadoNodo): string | null {
  switch (estado) {
    case "normal":
      return null;
    case "error":
      return "bg-danger/10 text-danger";
    case "ejecutando":
      return "bg-info/10 text-info";
    case "memoizado":
      return "bg-surface-input text-ink-faint";
    case "stale":
      return "bg-caution/10 text-caution";
  }
}

/**
 * Tono de un puerto de salida.
 *
 * `neutro` existe y es importante: en una condición, la rama "No" NO es un
 * error — es la mitad esperada de una decisión. El prototipo la pinta gris a
 * propósito y acá se conserva. Pintarla roja enseña a leer como falla algo que
 * pasa en la mitad de las corridas.
 */
export const TONOS_PUERTO = ["ok", "neutro", "alerta", "falla"] as const;

export type TonoPuerto = (typeof TONOS_PUERTO)[number];

const CLASES_PUERTO: Record<TonoPuerto, string> = {
  ok: "bg-ok/10 text-ok",
  neutro: "bg-surface-input text-ink-faint",
  alerta: "bg-caution/10 text-caution",
  falla: "bg-danger/10 text-danger",
};

export function clasesPuerto(tono: TonoPuerto): string {
  return CLASES_PUERTO[tono];
}

/**
 * Tono por convención de nombre de puerto, para no repetir el mapeo en los 7
 * componentes de nodo. Lo que no reconoce es `neutro`, no `falla`: un puerto
 * desconocido es una rama más, no un error.
 */
export function tonoDePuerto(id: string): TonoPuerto {
  if (id === "si" || id === "ok" || id === "verdadero" || id === "respuesta" || id === "evento") {
    return "ok";
  }
  if (id === "error" || id === "falla") return "falla";
  if (id === "timeout" || id === "humano") return "alerta";
  return "neutro";
}

/**
 * Posición horizontal del puerto `i` de `total`, en porcentaje.
 *
 * Reparte en centros de franjas iguales —`(i + 0.5) / total`— y no en
 * `(i + 1) / (total + 1)`. Con la segunda fórmula los puertos quedan más juntos
 * que los chips que los rotulan, porque los chips SÍ se reparten en franjas
 * iguales (`flex-1`), y el handle deja de caer bajo su propia etiqueta apenas
 * hay tres o más salidas.
 */
export function posicionPuerto(indice: number, total: number): string {
  return `${(((indice + 0.5) / total) * 100).toFixed(4)}%`;
}
