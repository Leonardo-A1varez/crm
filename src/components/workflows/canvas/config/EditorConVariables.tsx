"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FOCO, PRESION_TACTIL, TRANSICION_CONTROL } from "@/lib/ui/motion";
import {
  esVariableConocida,
  parsearTexto,
  sanearTexto,
  serializarSegmentos,
  type Segmento,
} from "@/lib/workflows/texto-con-variables";
import { VARIABLES_DISPONIBLES } from "./VariableSelector";

/**
 * Un texto de mensaje con las variables como chips.
 *
 * Nota 01 del diseño: ningún campo acepta `{{ }}` escrito. Las variables se
 * eligen de «+ Variable» y se ven como chips que no se pueden editar por
 * dentro —se borran enteros—. Si alguien escribe llaves dobles, no se
 * convierten en variable: el texto se sanea (`texto-con-variables.ts`) y la
 * tecla que armaría la segunda llave no entra.
 *
 * Lo que sale por `onChange` es el formato del motor (`{{lead.nombre}}`): un
 * mensaje guardado antes se abre con sus variables ya como chips, y el backend
 * no cambió.
 *
 * ## Por qué `contentEditable` y el DOM sin controlar
 *
 * Un `<textarea>` no puede dibujar un chip. El contenido lo maneja el
 * navegador —así el cursor, la selección y el deshacer funcionan como en
 * cualquier campo— y React sólo reescribe el DOM cuando el valor cambia desde
 * afuera (otro nodo seleccionado, un arreglo). Lo que escribe la persona se
 * lee del DOM en cada `input`.
 */

const CERO_ANCHO = "​";

/** Una variable que el editor ofrece: la clave del motor y cómo se lee. */
export interface VariableDelEditor {
  /** `lead.nombre`: lo que se guarda como `{{lead.nombre}}`. */
  key: string;
  label: string;
  /** Lo que dice el chip dentro del texto. */
  corto: string;
}

/** Las variables que ofrece el editor, agrupadas como se muestran en «+ Variable». */
export interface CatalogoVariables {
  grupos: ReadonlyArray<{ id: string; nombre: string; variables: readonly VariableDelEditor[] }>;
}

const GRUPOS_WORKFLOW: ReadonlyArray<{ id: string; nombre: string }> = [
  { id: "lead", nombre: "Lead" },
  { id: "sesion", nombre: "Sesión" },
  { id: "vendedor", nombre: "Vendedor asignado" },
];

/** Las de los workflows: las que carga su motor (`VARIABLES_DE_TEXTO`). */
const CATALOGO_WORKFLOW: CatalogoVariables = {
  grupos: GRUPOS_WORKFLOW.map((g) => ({
    ...g,
    variables: VARIABLES_DISPONIBLES.filter((v) => v.key.startsWith(`${g.id}.`)),
  })),
};

/** Lo que el editor necesita saber de un catálogo, ya indexado. */
interface Indice {
  etiquetaDe: ReadonlyMap<string, { corto: string; label: string }>;
  conocida: (clave: string) => boolean;
}

function indexar(catalogo: CatalogoVariables, esDeWorkflow: boolean): Indice {
  const etiquetaDe = new Map(
    catalogo.grupos.flatMap((g) =>
      g.variables.map((v) => [v.key, { corto: v.corto, label: v.label }] as const),
    ),
  );
  return {
    etiquetaDe,
    // Los workflows usan la lista del motor (incluye las que el panel no
    // ofrece pero el motor carga); otro catálogo, sólo lo que ofrece.
    conocida: esDeWorkflow ? esVariableConocida : (clave) => etiquetaDe.has(clave),
  };
}

const INDICE_WORKFLOW = indexar(CATALOGO_WORKFLOW, true);

const CLASE_CHIP =
  "mx-px inline-flex items-baseline rounded-[4px] px-1 font-mono text-[11px] leading-[1.5] align-baseline select-all";
const CLASE_CHIP_CONOCIDA = "bg-info/12 text-info";
const CLASE_CHIP_DESCONOCIDA = "bg-caution/15 text-caution line-through decoration-caution/60";

function crearChip(clave: string, indice: Indice): HTMLSpanElement {
  const chip = document.createElement("span");
  const conocida = indice.conocida(clave);
  const info = indice.etiquetaDe.get(clave);
  chip.setAttribute("contenteditable", "false");
  chip.dataset.variable = clave;
  chip.className = cn(CLASE_CHIP, conocida ? CLASE_CHIP_CONOCIDA : CLASE_CHIP_DESCONOCIDA);
  chip.textContent = info?.corto ?? clave;
  const descripcion = conocida
    ? `Variable: ${info?.label ?? clave}`
    : `Variable ${clave}: el motor no la carga y saldría vacía. Borrala y elegí otra.`;
  chip.title = descripcion;
  chip.setAttribute("aria-label", descripcion);
  return chip;
}

/** Los segmentos como nodos del DOM. Un salto de línea es un `<br>`. */
function nodosDe(segmentos: readonly Segmento[], indice: Indice): Node[] {
  const nodos: Node[] = [];
  for (const s of segmentos) {
    if (s.tipo === "variable") {
      nodos.push(crearChip(s.clave, indice));
      continue;
    }
    s.texto.split("\n").forEach((linea, i) => {
      if (i > 0) nodos.push(document.createElement("br"));
      if (linea) nodos.push(document.createTextNode(linea));
    });
  }
  return nodos;
}

/**
 * Reescribe el contenido. Si termina en salto de línea se agrega un `<br>` de
 * relleno: el navegador no dibuja una línea vacía al final sin él.
 */
function pintar(raiz: HTMLElement, valor: string, indice: Indice): void {
  const nodos = nodosDe(parsearTexto(valor), indice);
  if (valor.endsWith("\n")) {
    const relleno = document.createElement("br");
    relleno.dataset.relleno = "";
    nodos.push(relleno);
  }
  raiz.replaceChildren(...nodos);
}

/** Lee el DOM como segmentos. El último `<br>` es relleno del navegador y no cuenta. */
function leer(raiz: HTMLElement, indice: Indice): Segmento[] {
  const segmentos: Segmento[] = [];
  const texto = (t: string) => {
    const limpio = t.replaceAll(CERO_ANCHO, "");
    if (!limpio) return;
    const ultimo = segmentos[segmentos.length - 1];
    if (ultimo?.tipo === "texto") ultimo.texto += limpio;
    else segmentos.push({ tipo: "texto", texto: limpio });
  };
  const recorrer = (nodo: Node, esUltimoDeLaRaiz: boolean) => {
    if (nodo.nodeType === Node.TEXT_NODE) {
      texto(nodo.textContent ?? "");
      return;
    }
    if (!(nodo instanceof HTMLElement)) return;
    const clave = nodo.dataset.variable;
    if (clave) {
      segmentos.push({ tipo: "variable", clave, conocida: indice.conocida(clave) });
      return;
    }
    if (nodo.tagName === "BR") {
      if (!esUltimoDeLaRaiz) texto("\n");
      return;
    }
    // Un bloque (`<div>`) que haya metido el navegador es una línea nueva.
    if (nodo.tagName === "DIV" || nodo.tagName === "P") {
      if (segmentos.length > 0) texto("\n");
    }
    const hijos = [...nodo.childNodes];
    hijos.forEach((h, i) => recorrer(h, esUltimoDeLaRaiz && i === hijos.length - 1));
  };
  const hijos = [...raiz.childNodes];
  hijos.forEach((h, i) => recorrer(h, i === hijos.length - 1));
  return segmentos;
}

/** El carácter pegado al cursor, del lado pedido, dentro del mismo nodo de texto. */
function caracterJunto(lado: "antes" | "despues"): string {
  const sel = globalThis.getSelection?.();
  if (!sel || sel.rangeCount === 0) return "";
  const r = sel.getRangeAt(0);
  const nodo = lado === "antes" ? r.startContainer : r.endContainer;
  if (nodo.nodeType !== Node.TEXT_NODE) return "";
  const t = nodo.textContent ?? "";
  return lado === "antes" ? (t[r.startOffset - 1] ?? "") : (t[r.endOffset] ?? "");
}

function colocarCursorDespues(nodo: Node): void {
  const sel = globalThis.getSelection?.();
  if (!sel) return;
  const r = document.createRange();
  r.setStartAfter(nodo);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

export interface EditorConVariablesProps {
  value: string;
  onChange: (valor: string) => void;
  /** Nombre accesible del campo: "Mensaje", "Valor de la variable 1". */
  etiqueta: string;
  placeholder?: string;
  /** Tope del texto guardado. Se muestra el contador; no se corta lo escrito. */
  maxLength?: number;
  /** Una sola línea: Enter no parte el texto (las variables de una plantilla). */
  unaLinea?: boolean;
  readonly?: boolean;
  className?: string;
  /**
   * Qué variables ofrece. Por defecto, las de los workflows. Otro motor (la
   * difusión) pasa las suyas: un chip que su motor no carga saldría vacío.
   */
  catalogo?: CatalogoVariables;
}

export function EditorConVariables({
  value,
  onChange,
  etiqueta,
  placeholder,
  maxLength,
  unaLinea = false,
  readonly = false,
  className,
  catalogo,
}: EditorConVariablesProps) {
  const indice = useMemo(
    () => (catalogo === undefined ? INDICE_WORKFLOW : indexar(catalogo, false)),
    [catalogo],
  );
  const grupos = (catalogo ?? CATALOGO_WORKFLOW).grupos;
  const raizRef = useRef<HTMLDivElement>(null);
  /** El último valor que salió de acá: si `value` vuelve igual, el DOM ya lo tiene. */
  const emitidoRef = useRef<string | null>(null);
  /** Dónde estaba el cursor al salir del campo: ahí entra la variable elegida. */
  const rangoRef = useRef<Range | null>(null);

  useLayoutEffect(() => {
    const raiz = raizRef.current;
    if (!raiz || value === emitidoRef.current) return;
    pintar(raiz, value, indice);
    emitidoRef.current = value;
  }, [value, indice]);

  useEffect(() => {
    const alCambiarSeleccion = () => {
      const raiz = raizRef.current;
      const sel = globalThis.getSelection?.();
      if (!raiz || !sel || sel.rangeCount === 0) return;
      const r = sel.getRangeAt(0);
      if (raiz.contains(r.commonAncestorContainer)) rangoRef.current = r.cloneRange();
    };
    document.addEventListener("selectionchange", alCambiarSeleccion);
    return () => document.removeEventListener("selectionchange", alCambiarSeleccion);
  }, []);

  const emitir = useCallback(() => {
    const raiz = raizRef.current;
    if (!raiz) return;
    const segmentos = leer(raiz, indice);
    const valor = serializarSegmentos(segmentos);
    // Llaves dobles que llegaron por un camino que `beforeinput` no ve
    // (autocompletar, dictado): se sanean y el campo muestra lo que se guarda.
    const crudo = segmentos.map((s) => (s.tipo === "texto" ? s.texto : "")).join("");
    if (crudo !== sanearTexto(crudo)) pintar(raiz, valor, indice);
    emitidoRef.current = valor;
    onChange(valor);
  }, [onChange, indice]);

  /** Mete nodos donde está el cursor (o donde estaba), y deja el cursor detrás. */
  const insertar = useCallback(
    (nodos: Node[], desdeAfuera: boolean) => {
      const raiz = raizRef.current;
      if (!raiz || nodos.length === 0) return;
      const sel = globalThis.getSelection?.();
      let r: Range | null = null;
      if (!desdeAfuera && sel && sel.rangeCount > 0) r = sel.getRangeAt(0);
      else if (rangoRef.current && raiz.contains(rangoRef.current.commonAncestorContainer)) {
        r = rangoRef.current;
      }
      if (!r) {
        r = document.createRange();
        r.selectNodeContents(raiz);
        r.collapse(false);
      }
      r.deleteContents();
      const fragmento = document.createDocumentFragment();
      for (const n of nodos) fragmento.append(n);
      // Detrás de un chip el navegador no siempre acepta el cursor: un nodo de
      // texto invisible le da dónde pararse. `leer` lo descarta.
      const ancla = document.createTextNode(CERO_ANCHO);
      fragmento.append(ancla);
      r.insertNode(fragmento);
      raiz.focus();
      colocarCursorDespues(ancla);
      emitir();
    },
    [emitir],
  );

  const elegirVariable = useCallback(
    (clave: string) => {
      insertar([crearChip(clave, indice)], true);
      // El menú devuelve el foco a su botón al cerrarse: se recupera el campo
      // en el ciclo siguiente, con el cursor detrás del chip.
      setTimeout(() => {
        const raiz = raizRef.current;
        const r = rangoRef.current;
        if (!raiz) return;
        raiz.focus();
        if (r) {
          const sel = globalThis.getSelection?.();
          sel?.removeAllRanges();
          sel?.addRange(r);
        }
      }, 0);
    },
    [insertar, indice],
  );

  const alAntesDeEscribir = (e: FormEvent<HTMLDivElement>) => {
    const dato = (e.nativeEvent as InputEvent).data ?? "";
    if (!dato) return;
    const arma = (llave: "{" | "}") =>
      dato.includes(llave + llave) ||
      (dato.startsWith(llave) && caracterJunto("antes") === llave) ||
      (dato.endsWith(llave) && caracterJunto("despues") === llave);
    if (arma("{") || arma("}")) e.preventDefault();
  };

  const alTeclear = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (unaLinea) return;
    const br = document.createElement("br");
    insertar([br], false);
    // Un `<br>` al final no se dibuja sin otro detrás: el de relleno.
    const raiz = raizRef.current;
    if (raiz && raiz.lastChild?.nodeName !== "BR") {
      const relleno = document.createElement("br");
      relleno.dataset.relleno = "";
      raiz.append(relleno);
    }
  };

  const alPegar = (e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const pegado = e.clipboardData.getData("text/plain");
    const texto = unaLinea ? pegado.replaceAll(/\s*\n\s*/g, " ") : pegado;
    // Las variables conocidas de un texto copiado de otro bloque entran como
    // chips; cualquier otra llave doble entra saneada, como texto.
    const segmentos = parsearTexto(texto).map(
      (s): Segmento =>
        s.tipo === "variable" && !indice.conocida(s.clave)
          ? { tipo: "texto", texto: `{${s.clave}}` }
          : s,
    );
    insertar(nodosDe(segmentos, indice), false);
  };

  const vacio = value === "";

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center gap-2">
        <span className="text-ink-secondary flex-1 text-[11px]">{etiqueta}</span>
        {!readonly ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "border-line-control text-info hover:bg-surface-hover h-6 rounded-md border px-2 text-[11px] font-medium",
                TRANSICION_CONTROL,
                PRESION_TACTIL,
                FOCO,
              )}
              aria-label={`Insertar una variable en ${etiqueta}`}
            >
              + Variable
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {grupos.map((g) => {
                const vars = g.variables;
                if (vars.length === 0) return null;
                return (
                  <DropdownMenuGroup key={g.id}>
                    <DropdownMenuLabel className="text-[10.5px]">{g.nombre}</DropdownMenuLabel>
                    {vars.map((v) => (
                      <DropdownMenuItem
                        key={v.key}
                        onClick={() => elegirVariable(v.key)}
                        className="justify-between text-[12px]"
                      >
                        {v.label}
                        <span className="text-ink-ghost font-mono text-[10.5px]">{v.corto}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <div
        ref={raizRef}
        role="textbox"
        aria-multiline={!unaLinea}
        aria-label={etiqueta}
        aria-readonly={readonly || undefined}
        contentEditable={!readonly}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        data-vacio={vacio || undefined}
        onBeforeInput={alAntesDeEscribir}
        onInput={emitir}
        onKeyDown={alTeclear}
        onPaste={alPegar}
        className={cn(
          "border-line-control bg-surface-root text-ink-primary w-full rounded-lg border px-2.5 py-2 text-[12px] leading-[1.6] break-words whitespace-pre-wrap",
          unaLinea ? "min-h-8" : "min-h-[88px]",
          "focus-visible:border-ring focus-visible:ring-ring/50 outline-none focus-visible:ring-3",
          // El placeholder de un `contentEditable`: no tiene uno propio.
          "data-[vacio]:before:text-ink-ghost data-[vacio]:before:pointer-events-none data-[vacio]:before:content-[attr(data-placeholder)]",
          readonly && "text-ink-secondary cursor-default",
        )}
      />

      {maxLength ? (
        <span
          className={cn(
            "self-end font-mono text-[10px] tabular-nums",
            value.length > maxLength ? "text-danger" : "text-ink-faint",
          )}
        >
          {value.length}/{maxLength}
        </span>
      ) : null}
    </div>
  );
}
