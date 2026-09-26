"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useEdgesState, useNodesState, type OnConnect } from "@xyflow/react";

import { Close } from "@/components/icons";
import { subirImagenDeFlujoAction } from "../../_actions/imagenes.actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ConfigCRM,
  ConfigIA,
  ConfigIntegracion,
  ConfigInterno,
  ConfigLogica,
  ConfigMensajeria,
  ConfigTrigger,
} from "@/components/workflows/canvas/config";
import { ProbarDialog } from "@/components/workflows/canvas/ProbarDialog";
import {
  VistaPreviaContraLead,
  type LeerVistaPreviaFn,
} from "@/components/workflows/canvas/config/VistaPreviaContraLead";
import { VersionesDelWorkflow } from "@/components/workflows/VersionesDelWorkflow";
import {
  DespuesDeEsto,
  EditorWorkflow,
  MEDIDAS,
  SIN_PROBLEMAS,
  compararGrafos,
  type AristaEditor,
  type CategoriaBloques,
  type NodoEditor,
  type ProblemaNodo,
} from "@/components/workflows/editor";
import { FOCO, TRANSICION_CONTROL } from "@/lib/ui/motion";
import { cn } from "@/lib/utils";
import {
  agregarNodo,
  aplicarArreglo,
  destinosPosibles,
  proximoIdNodo,
  type Arreglo,
} from "@/lib/workflows/arreglos";
import { arreglosDeResolver, problemasDelEditor } from "@/lib/workflows/problemas-editor";
import { puertosDe, puertosDeNodo } from "@/lib/workflows/validar-grafo";
import { CAMPOS_SWITCH } from "@/lib/workflows/condiciones";
import { editorDeConfig } from "@/lib/workflows/config-nodos";
import { campoHoraEnZona } from "@/lib/zona-horaria";
import {
  NODO_TIPOS,
  categoriaDeTipo,
  esCondicion,
  esPuerto,
  esTrigger,
  type Arista,
  type Grafo,
  type Nodo,
  type NodoTipo,
  type Puerto,
} from "@/types/workflows";
import { TOPE_PASOS, leerTopePasos } from "../_lib/max-pasos";
import {
  ETIQUETAS_CONFIG,
  categoriasDePaleta,
  etiquetaDePuertoEnLienzo,
  nombreDeTipo,
  presentacionDe,
  resumenDe,
  salidasDe,
} from "../_lib/presentacion-nodos";
import { camposDeCondicion } from "../_lib/campos-condicion";
import { CampoTopePasos } from "./CampoTopePasos";
import { FormularioCondicion } from "./FormularioCondicion";

import type { CatalogosDeCondicion } from "../_lib/campos-condicion";
import type { WorkflowRunDetalle, WorkflowVersion } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";
import type { LeadListItem } from "@/types/leads";
import type { OpcionSelect } from "../_lib/opciones-editor";

/**
 * El editor nuevo de `/workflows/[id]`, cableado al dominio.
 *
 * `EditorWorkflow` y sus nueve componentes son presentación pura: reciben nodos
 * de React Flow, callbacks y un mapa de problemas, y no saben que existe un
 * `Grafo`, ni una Server Action, ni el catálogo de los 57 tipos. Este archivo es
 * la única traducción entre esas dos mitades, y no dibuja nada del editor: sólo
 * la franja de aviso de las acciones, que es lo que el contrato del editor no
 * tiene dónde poner. Los dos contenidos del panel que dependen del dominio —el
 * formulario del bloque y el tope de pasos del flujo— los arma acá y se los
 * pasa hechos.
 *
 * ## Las tres reglas de rendimiento que ordenan este archivo
 *
 * `NodoConPuertos` está memoizado y React Flow le pasa `data` por identidad. Un
 * arrastre de nodo dispara `onNodosChange` en cada frame, así que **todo lo que
 * viaja hacia el lienzo tiene que sobrevivir a 60 cambios de estado por
 * segundo sin cambiar de referencia**:
 *
 *  1. **`data` se arma una vez por nodo** (`nodoEditorDe`) y se reescribe sólo
 *     para el nodo que realmente cambió. Nunca se deriva el array entero.
 *  2. **`problemasPorNodo` se memoiza contra una firma que ignora las
 *     posiciones** (`firmaSemantica`). Mover un nodo no cambia la firma, así que
 *     el mapa conserva su identidad y con él los arrays de `data.problemas`.
 *  3. **Los callbacks leen de refs, no de `nodos`/`aristas`.** `LienzoEditor`
 *     suscribe `onInsertarEnArista`, `onBorrarNodo` y `onPrevisualizarBorrado`
 *     en un `useEffect`; si cambiaran de identidad en cada frame, el lienzo se
 *     re-suscribiría 60 veces por segundo.
 */

// ──────────────────────────────────────────────────────────────────────────
// Dominio ⇄ React Flow
// ──────────────────────────────────────────────────────────────────────────

/**
 * `tipo` y `config` viajan adentro de `data`.
 *
 * `DatosNodoEditor` declara un índice `Record<string, unknown>` — es lo que
 * permite meterlos ahí — pero no los conoce por nombre, así que salen como
 * `unknown`. El cast queda encerrado en esta función: no hay otro lugar del
 * archivo que lea `data.tipo` o `data.config` a mano.
 */
function dominioDe(n: NodoEditor): { tipo: NodoTipo; config: Record<string, unknown> } {
  return {
    tipo: n.data.tipo as NodoTipo,
    config: (n.data.config as Record<string, unknown> | undefined) ?? {},
  };
}

/** Una arista que sólo existe para previsualizar la costura de un borrado. */
function esFantasma(a: AristaEditor): boolean {
  return a.data?.fantasma === true;
}

/**
 * Un nodo del dominio como nodo del editor.
 *
 * Nombre, color, ícono, resumen y salidas salen de `presentacionDe`, la misma
 * traducción que usan el diff de publicación y la corrida: el mismo nodo se
 * llama y se pinta igual en las tres pantallas.
 */
function nodoEditorDe(
  nodo: Nodo,
  opciones: {
    borrable: boolean;
    problemas: readonly ProblemaNodo[];
    /** Para que una condición nombre sus intents y etiquetas. Ver `resumenDe`. */
    catalogos?: CatalogosDeCondicion;
  },
): NodoEditor {
  const p = presentacionDe(nodo, opciones.catalogos);
  return {
    id: nodo.id,
    // Un solo tipo de React Flow para los 57: la diferencia vive entera en
    // `data`. Ver `TIPOS_NODO_EDITOR` en `NodoConPuertos`.
    type: "editor",
    position: nodo.posicion,
    data: {
      nombre: p.nombre,
      categoria: p.categoria,
      icono: p.icono,
      resumen: p.resumen,
      problemas: opciones.problemas,
      salidas: p.salidas,
      sinEntrada: p.sinEntrada,
      borrable: opciones.borrable,
      tipo: nodo.tipo,
      config: nodo.config,
    },
  };
}

function idArista(a: Arista): string {
  return `${a.desde}|${a.puerto}|${a.hasta}`;
}

/**
 * `origen` es el nodo del que sale la línea: el rótulo de un caso de "Según el
 * valor" es su valor, que vive en la config del nodo y no en la arista.
 */
function aristaEditorDe(
  a: Arista,
  origen?: Pick<Nodo, "tipo" | "config">,
  catalogos?: CatalogosDeCondicion,
): AristaEditor {
  const rotulo = origen ? etiquetaDePuertoEnLienzo(origen, a.puerto, catalogos) : "";
  return {
    id: idArista(a),
    source: a.desde,
    target: a.hasta,
    // El handle de salida única se llama `salida` en `NodoBase`, así que el
    // puerto del dominio y el `sourceHandle` son literalmente el mismo string.
    sourceHandle: a.puerto,
    type: "insertable",
    data: { puerto: rotulo || undefined },
  };
}

function puertoDe(a: AristaEditor): Puerto {
  const p = a.sourceHandle ?? "salida";
  return esPuerto(p) ? p : "salida";
}

/** El nodo de dominio de un id del lienzo, para rotular las líneas que salen de él. */
function origenEn(
  nodos: readonly NodoEditor[],
  id: string,
): Pick<Nodo, "tipo" | "config"> | undefined {
  const n = nodos.find((x) => x.id === id);
  return n ? dominioDe(n) : undefined;
}

function aGrafo(nodos: readonly NodoEditor[], aristas: readonly AristaEditor[]): Grafo {
  return {
    nodos: nodos.map((n) => {
      const { tipo, config } = dominioDe(n);
      return { id: n.id, tipo, config, posicion: n.position };
    }),
    // Las fantasma son dibujo, no grafo: si entraran acá, pasar el mouse por
    // el botón de borrar cambiaría la validación y el conteo de cambios.
    aristas: aristas
      .filter((a) => !esFantasma(a))
      .map((a) => ({ desde: a.source, hasta: a.target, puerto: puertoDe(a) })),
  };
}

/**
 * Si dos listas de problemas dicen lo mismo.
 *
 * Existe para poder conservar la referencia vieja cuando el contenido no
 * cambió: `data.problemas` viaja adentro de `data`, y `data` es lo que React
 * Flow compara por identidad para decidir si repinta un nodo memoizado.
 * Los `arreglos` se comparan por etiqueta y no por identidad: sus
 * `onAplicar` se rearman en cada derivación, pero llaman a una función estable
 * con el arreglo que describe la etiqueta, así que el viejo sigue sirviendo.
 */
function mismosProblemas(a: readonly ProblemaNodo[], b: readonly ProblemaNodo[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((p, i) => {
    const q = b[i];
    return (
      q !== undefined &&
      p.severidad === q.severidad &&
      p.mensaje === q.mensaje &&
      p.regla === q.regla &&
      p.ayuda === q.ayuda &&
      (p.arreglos ?? []).map((x) => x.etiqueta).join("|") ===
        (q.arreglos ?? []).map((x) => x.etiqueta).join("|")
    );
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Derivación: problemas y cambios
// ──────────────────────────────────────────────────────────────────────────

interface Derivado {
  problemasPorNodo: ReadonlyMap<string, readonly ProblemaNodo[]>;
  /** Los mismos problemas en la forma del dominio: de acá sale «Resolver». */
  problemasEditor: ReturnType<typeof problemasDelEditor>["porNodo"];
  /** Cambios del borrador contra la versión **publicada**. */
  cambiosSinPublicar: number;
  /** Si el lienzo tiene algo que todavía no está en ninguna versión guardada. */
  hayCambiosSinGuardar: boolean;
}

/**
 * Los problemas que van sobre cada nodo.
 *
 * Dos fuentes, y sólo dos, porque son las dos que se pueden calcular con datos
 * que están acá:
 *
 *  - **`error`** ← `problemasDelEditor`, que traduce a la pantalla lo que
 *    detectan `validarGrafo` (la puerta de "Guardar") y la revisión de config
 *    de `validar-workflow.ts` (la de "Publicar"). Que el rojo del lienzo y el
 *    rechazo del servidor salgan del mismo lugar es lo que evita que uno diga
 *    que está bien y el otro lo rebote. Cada problema trae su solución y, si
 *    hay uno correcto, su arreglo de un clic.
 *  - **`sin_publicar`** ← `compararGrafos` contra el grafo de la versión
 *    publicada. Sólo se puede cuando hay una publicada; sin ella, "sin
 *    publicar" no tiene contra qué compararse y no se marca nada.
 *
 * **No se produce ni un `stale`.** `stale` es "este nodo apunta a algo que
 * cambió por debajo" — una etiqueta borrada, una plantilla que Meta pausó — y
 * eso exige cotejar cada `config` contra el catálogo real de etiquetas,
 * plantillas e intents. Ese cotejo no existe en el repo; inventarlo acá sería
 * pintar de ámbar cosas que nadie verificó.
 */
/**
 * Pide aplicar arreglos al editor montado.
 *
 * Es un evento del documento y no un callback con el estado adentro por la
 * misma razón que los gestos del nodo (`EVENTO_BORRAR_NODO`): los `onAplicar`
 * viajan dentro de `data` de cada nodo, y una función que lea el estado —o sus
 * refs— no puede armarse durante el render. El editor escucha el evento en un
 * efecto, que sí puede leer el grafo de ese momento.
 */
const EVENTO_APLICAR_ARREGLOS = "workflow:aplicar-arreglos";

function pedirArreglos(arreglos: readonly Arreglo[]): void {
  document.dispatchEvent(
    new CustomEvent<readonly Arreglo[]>(EVENTO_APLICAR_ARREGLOS, { detail: arreglos }),
  );
}

function derivar(grafo: Grafo, publicado: Grafo | null, guardado: Grafo | null): Derivado {
  const mapa = new Map<string, ProblemaNodo[]>();

  const problemasEditor = problemasDelEditor(grafo).porNodo;
  for (const p of problemasEditor) {
    const previos = mapa.get(p.nodoId);
    const problema: ProblemaNodo = {
      severidad: "error",
      mensaje: p.mensaje,
      regla: p.regla,
      ayuda: p.ayuda,
      arreglos: p.arreglos.map((a) => ({
        etiqueta: a.etiqueta,
        onAplicar: () => pedirArreglos([a.arreglo]),
      })),
    };
    if (previos) previos.push(problema);
    else mapa.set(p.nodoId, [problema]);
  }

  const diff = publicado
    ? compararGrafos(publicado, grafo, { etiquetasConfig: ETIQUETAS_CONFIG })
    : null;
  if (diff) {
    for (const c of diff.cambios) {
      // Los eliminados no están en el lienzo: no hay nodo donde colgar la marca.
      if (c.clase === "eliminado") continue;
      const mensaje =
        c.clase === "agregado"
          ? "Este paso no existe en la versión publicada."
          : `Cambió respecto de la publicada: ${c.parametros.map((p) => p.etiqueta).join(", ")}.`;
      const previos = mapa.get(c.nodoId);
      const problema: ProblemaNodo = { severidad: "sin_publicar", mensaje };
      if (previos) previos.push(problema);
      else mapa.set(c.nodoId, [problema]);
    }
  }

  // El caso vacío comparte la referencia exportada por el editor: un `[]`
  // literal por nodo rompería el memo de los 80.
  const congelado = new Map<string, readonly ProblemaNodo[]>(mapa);

  return {
    problemasPorNodo: congelado,
    problemasEditor,
    cambiosSinPublicar: diff?.total ?? 0,
    hayCambiosSinGuardar: guardado
      ? compararGrafos(guardado, grafo).total > 0
      : grafo.nodos.length > 0,
  };
}

/** Dónde cae un bloque que se agregó con doble clic, sin posición del arrastre. */
function posicionLibre(nodos: readonly NodoEditor[]): { x: number; y: number } {
  if (nodos.length === 0) return { x: 0, y: 0 };
  const abajo = Math.max(...nodos.map((n) => n.position.y));
  return { x: 0, y: abajo + 128 };
}

// ──────────────────────────────────────────────────────────────────────────

const SIN_PERMISO =
  "Sólo un administrador puede guardar, publicar o probar un flujo. Podés mirarlo y moverlo, pero los cambios no se van a guardar.";

const TOPE_INVALIDO = `El tope de pasos por corrida tiene que ser un número entero entre ${TOPE_PASOS.MIN} y ${TOPE_PASOS.MAX}.`;

export interface EditorWorkflowClienteProps {
  workflowId: string;
  nombre: string;
  grafoInicial: Grafo;
  /** El tope de pasos por corrida de la última versión guardada. */
  maxPasos: number;
  /**
   * El tope de la versión publicada, o `null` si no hay ninguna. El tope no es
   * parte del grafo —`compararGrafos` no lo ve—, así que su cambio respecto de
   * la publicada se cuenta aparte.
   */
  maxPasosPublicado: number | null;
  /** Número de la versión publicada; `null` cuando el flujo nunca publicó ninguna. */
  versionPublicada: number | null;
  /** El grafo de la publicada, para el diff. `null` si no hay publicada. */
  grafoPublicado: Grafo | null;
  /** La última versión guardada: es la que publica el botón Publicar. */
  ultimaVersionId: string | null;
  ultimaVersionNumero: number | null;
  grafoUltimaGuardada: Grafo | null;
  versiones: readonly WorkflowVersion[];
  puedeEditar: boolean;
  /**
   * La zona del negocio (`agente_config.horario_timezone`). La hora de
   * "guardado a las…" se escribe en ella y no en la del navegador, igual que
   * todas las horas de Flujos.
   */
  zona: string;
  /** Las opciones de los selectores del panel. El `id` es lo que se guarda en `config`. */
  tags: ReadonlyArray<OpcionSelect>;
  etapas: ReadonlyArray<OpcionSelect>;
  vendedores: ReadonlyArray<OpcionSelect>;
  intents: ReadonlyArray<OpcionSelect>;
  /** Las difusiones que "Difusión respondida" puede elegir. */
  difusiones: ReadonlyArray<OpcionSelect>;
  onGuardar: (input: {
    workflowId: string;
    grafo: Grafo;
    maxPasos: number;
  }) => Promise<ActionResult>;
  onProbar: (
    raw: unknown,
  ) => Promise<
    | { ok: true; runId: string; tipo: "completado" | "esperando" | "fallado"; error?: string }
    | { ok: false; error: string }
  >;
  /** "Ejecutar hasta acá": `probarHastaAcaAction`. */
  onProbarHastaAca: NonNullable<ComponentProps<typeof ProbarDialog>["onProbarHastaAca"]>;
  onBuscarLeads: (
    raw: unknown,
  ) => Promise<{ ok: true; items: LeadListItem[] } | { ok: false; error: string }>;
  onObtenerDetalleRun: (
    raw: unknown,
  ) => Promise<{ ok: true; data: WorkflowRunDetalle | null } | { ok: false; error: string }>;
  /** La vista previa de «Enviar mensaje»: los datos del lead y su ventana de 24 h. */
  onLeerVistaPrevia: LeerVistaPreviaFn;
}

export function EditorWorkflowCliente({
  workflowId,
  nombre,
  grafoInicial,
  maxPasos,
  maxPasosPublicado,
  versionPublicada,
  grafoPublicado,
  ultimaVersionId,
  ultimaVersionNumero,
  grafoUltimaGuardada,
  versiones,
  puedeEditar,
  zona,
  tags,
  etapas,
  vendedores,
  intents,
  difusiones,
  onGuardar,
  onProbar,
  onProbarHastaAca,
  onBuscarLeads,
  onObtenerDetalleRun,
  onLeerVistaPrevia,
}: EditorWorkflowClienteProps) {
  const router = useRouter();

  /**
   * Los nombres que la condición dibuja en el nodo. El árbol guarda ids: sin
   * esto el nodo decía "Intent detectado es un intent". Salen de las mismas
   * listas que la página ya carga para los selectores del panel.
   */
  const catalogosCondicion = useMemo<CatalogosDeCondicion>(
    () => ({
      intents: intents.map((i) => ({ id: i.id, nombre: i.nombre })),
      etiquetas: tags.map((t) => ({ id: t.id, nombre: t.nombre })),
    }),
    [intents, tags],
  );

  const [nodos, setNodos, alCambiarNodos] = useNodesState<NodoEditor>(
    grafoInicial.nodos.map((n) =>
      nodoEditorDe(n, {
        borrable: puedeEditar,
        problemas: SIN_PROBLEMAS,
        catalogos: catalogosCondicion,
      }),
    ),
  );
  const [aristas, setAristas, alCambiarAristas] = useEdgesState<AristaEditor>(
    grafoInicial.aristas.map((a) =>
      aristaEditorDe(
        a,
        grafoInicial.nodos.find((n) => n.id === a.desde),
        catalogosCondicion,
      ),
    ),
  );

  const [seleccionId, setSeleccionId] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);
  const [guardadoA, setGuardadoA] = useState<string | undefined>(undefined);
  const [probarAbierto, setProbarAbierto] = useState(false);
  /** Con un bloque, el modal de Probar corre "hasta acá" y abre la corrida. */
  const [hastaNodo, setHastaNodo] = useState<{ id: string; nombre: string } | null>(null);
  const [versionesAbierto, setVersionesAbierto] = useState(false);

  /**
   * El tope de pasos como texto, tal cual está en el campo. Se guarda el texto
   * y no el número porque a mitad de escribir no hay número: borrar "500" para
   * poner "50" pasa por "".
   */
  const [topeTexto, setTopeTexto] = useState(() => String(maxPasos));
  /** Si el campo tiene que mostrar su error aunque nadie lo haya tocado. */
  const [revelarErrorTope, setRevelarErrorTope] = useState(false);
  const lecturaTope = useMemo(() => leerTopePasos(topeTexto), [topeTexto]);
  const topeValido = lecturaTope.ok ? lecturaTope.valor : null;

  /**
   * Espejos de lectura para los callbacks.
   *
   * Los tres gestos del lienzo (insertar, borrar, previsualizar) se suscriben
   * en un `useEffect` de `LienzoEditor`. Si esos callbacks dependieran de
   * `nodos`/`aristas` se recrearían en cada frame de un arrastre y el lienzo se
   * re-suscribiría con ellos. Leyendo de un ref son estables para siempre y
   * siguen viendo el estado más nuevo: los efectos corren antes de que llegue
   * el evento siguiente, y estos refs sólo se leen desde manejadores.
   */
  const nodosRef = useRef(nodos);
  const aristasRef = useRef(aristas);

  const grafo = useMemo(() => aGrafo(nodos, aristas), [nodos, aristas]);

  useEffect(() => {
    nodosRef.current = nodos;
    aristasRef.current = aristas;
  }, [nodos, aristas]);

  /**
   * Problemas y conteo de cambios contra la publicada.
   *
   * Se recalculan con cada `grafo`, o sea también en cada frame de un arrastre,
   * aunque ni `validarGrafo` ni `compararGrafos` miren `posicion`. Es a
   * propósito: las dos son lineales sobre estructuras de decenas de elementos, y
   * esquivarlo pedía o un ref leído en render o un `setState` adentro de un
   * efecto, que son las dos cosas que `react-hooks` rechaza. Lo que sí había que
   * evitar a toda costa es que los 80 nodos se repinten, y de eso se ocupa el
   * efecto de abajo comparando por contenido.
   */
  const rechazarSinPermiso = useCallback((): boolean => {
    if (puedeEditar) return false;
    setAviso({ tono: "error", texto: SIN_PERMISO });
    return true;
  }, [puedeEditar]);

  /**
   * Vuelca un grafo del dominio al lienzo. Los nodos que ya estaban conservan
   * su objeto —y con él su memo y su selección—; sólo se crean los nuevos. La
   * selección se suelta si el nodo seleccionado dejó de existir.
   */
  const volcarGrafo = useCallback(
    (g: Grafo) => {
      const ids = new Set(g.nodos.map((n) => n.id));
      setNodos((prev) => {
        const previos = new Set(prev.map((n) => n.id));
        return [
          ...prev.filter((n) => ids.has(n.id)),
          ...g.nodos
            .filter((n) => !previos.has(n.id))
            .map((n) =>
              nodoEditorDe(n, {
                borrable: true,
                problemas: SIN_PROBLEMAS,
                catalogos: catalogosCondicion,
              }),
            ),
        ];
      });
      setAristas(
        g.aristas.map((a) =>
          aristaEditorDe(
            a,
            g.nodos.find((n) => n.id === a.desde),
            catalogosCondicion,
          ),
        ),
      );
      setSeleccionId((actual) => (actual !== null && !ids.has(actual) ? null : actual));
    },
    [setNodos, setAristas, catalogosCondicion],
  );

  /**
   * Aplica uno o varios arreglos de un clic, en orden, sobre el grafo de
   * ahora. Lo llaman el efecto de `EVENTO_APLICAR_ARREGLOS` y el borrado; lee
   * de los refs, igual que los demás gestos del lienzo.
   */
  const aplicarArreglos = useCallback(
    (arreglos: readonly Arreglo[]) => {
      if (rechazarSinPermiso() || arreglos.length === 0) return;
      let g = aGrafo(nodosRef.current, aristasRef.current);
      for (const a of arreglos) g = aplicarArreglo(g, a).grafo;
      volcarGrafo(g);
    },
    [rechazarSinPermiso, volcarGrafo],
  );

  useEffect(() => {
    const alPedir = (e: Event) => aplicarArreglos((e as CustomEvent<readonly Arreglo[]>).detail);
    document.addEventListener(EVENTO_APLICAR_ARREGLOS, alPedir);
    return () => document.removeEventListener(EVENTO_APLICAR_ARREGLOS, alPedir);
  }, [aplicarArreglos]);

  const { problemasPorNodo, problemasEditor, cambiosSinPublicar, hayCambiosSinGuardar } = useMemo(
    () => derivar(grafo, grafoPublicado, grafoUltimaGuardada),
    [grafo, grafoPublicado, grafoUltimaGuardada],
  );

  // El tope no es parte del grafo y `compararGrafos` no lo ve: sus dos cuentas
  // se hacen acá. Un tope inválido cuenta como "sin guardar", porque lo que se
  // ve en el campo no es lo que está en ninguna versión.
  const haySinGuardar =
    hayCambiosSinGuardar || (ultimaVersionId !== null && topeValido !== maxPasos);
  const cambiosEnBarra =
    cambiosSinPublicar +
    (maxPasosPublicado !== null && topeValido !== null && topeValido !== maxPasosPublicado ? 1 : 0);

  /**
   * Baja los problemas al `data` de cada nodo, y sólo al de los que cambiaron.
   *
   * Se escribe en el estado en vez de derivarse en el render porque `data` es
   * lo que React Flow le pasa al nodo memoizado: si el array se armara en cada
   * render, los 80 nodos se repintarían con el viewport.
   */
  useEffect(() => {
    setNodos((prev) => {
      let cambio = false;
      const next = prev.map((n) => {
        const nuevos = problemasPorNodo.get(n.id) ?? SIN_PROBLEMAS;
        // Por contenido y no por identidad: el mapa se rearma en cada frame de
        // un arrastre, y comparar referencias reescribiría el `data` de los 80
        // nodos sesenta veces por segundo. Conservar el array viejo cuando dice
        // lo mismo es lo que mantiene vivo el memo de cada nodo.
        if (mismosProblemas(n.data.problemas ?? SIN_PROBLEMAS, nuevos)) return n;
        cambio = true;
        return { ...n, data: { ...n.data, problemas: nuevos } };
      });
      // Devolver `prev` cuando no cambió nada corta el ciclo: sin esto, el
      // efecto se re-dispara con cada array nuevo y no para nunca.
      return cambio ? next : prev;
    });
  }, [problemasPorNodo, setNodos]);

  // ── Paleta ───────────────────────────────────────────────────────────────

  /**
   * El nombre del disparador del flujo, cuando hay exactamente uno.
   *
   * Con cero no hay nada que explicar; con dos el problema ya lo grita
   * `validarGrafo` en rojo y atenuar la paleta encima sería ruido.
   */
  const disparadorActual = useMemo(() => {
    const triggers = nodos.filter((n) => esTrigger(dominioDe(n).tipo));
    const unico = triggers.length === 1 ? triggers[0] : undefined;
    if (!unico) return undefined;
    return nombreDeTipo(dominioDe(unico).tipo);
  }, [nodos]);

  /**
   * Dos atenuados, los dos con un hecho detrás: el bloque que el motor no
   * ejecuta, y con un disparador puesto, los otros diez (`disparador_unico`).
   * Nada más se atenúa — un motivo inventado es peor que no atenuar.
   */
  const categorias = useMemo<readonly CategoriaBloques[]>(
    () => categoriasDePaleta(disparadorActual),
    [disparadorActual],
  );

  // ── Gestos del lienzo ────────────────────────────────────────────────────

  const agregarBloque = useCallback(
    (
      tipo: string,
      posicion?: { x: number; y: number },
      desde?: { nodoId: string; puerto: string },
    ) => {
      if (rechazarSinPermiso()) return;
      if (!(NODO_TIPOS as readonly string[]).includes(tipo)) return;
      const t = tipo as NodoTipo;
      // Desde un cable soltado en el vacío: el bloque nace conectado al
      // puerto del que salió el cable. Antes quedaba suelto en el lienzo.
      if (desde && esPuerto(desde.puerto)) {
        const { grafo: g } = agregarNodo(aGrafo(nodosRef.current, aristasRef.current), {
          tipo: t,
          posicion: posicion ?? posicionLibre(nodosRef.current),
          desde: { nodoId: desde.nodoId, puerto: desde.puerto as Puerto },
        });
        volcarGrafo(g);
        return;
      }
      setNodos((prev) => {
        const id = proximoIdNodo(prev.map((n) => n.id));
        const nodo: Nodo = { id, tipo: t, config: {}, posicion: posicion ?? posicionLibre(prev) };
        return [...prev, nodoEditorDe(nodo, { borrable: true, problemas: SIN_PROBLEMAS })];
      });
    },
    [rechazarSinPermiso, setNodos, volcarGrafo],
  );

  /**
   * Soltar un bloque sobre una línea lo mete entre esos dos pasos.
   *
   * La línea vieja se va y aparecen dos: la de arriba conserva el puerto que
   * tenía (para que insertar sobre la rama «No» de una condición siga saliendo
   * por «No») y de abajo sale una por cada puerto del bloque nuevo. Un bloque
   * terminal no tiene ninguno y deja lo que venía después sin alcanzar: el
   * validador lo marca en rojo, que es exactamente lo que pasó.
   */
  const insertarEnArista = useCallback(
    (tipo: string, aristaId: string) => {
      if (rechazarSinPermiso()) return;
      if (!(NODO_TIPOS as readonly string[]).includes(tipo)) return;
      const t = tipo as NodoTipo;

      const arista = aristasRef.current.find((a) => a.id === aristaId);
      if (!arista) return;

      const origen = nodosRef.current.find((n) => n.id === arista.source);
      const destino = nodosRef.current.find((n) => n.id === arista.target);
      const posicion =
        origen && destino
          ? {
              x: Math.round((origen.position.x + destino.position.x) / 2),
              y: Math.round((origen.position.y + destino.position.y) / 2),
            }
          : posicionLibre(nodosRef.current);

      const id = proximoIdNodo(nodosRef.current.map((n) => n.id));
      const puertoEntrante = puertoDe(arista);
      const salientes = puertosDe(t);

      setNodos((prev) => [
        ...prev,
        nodoEditorDe(
          { id, tipo: t, config: {}, posicion },
          {
            borrable: true,
            problemas: SIN_PROBLEMAS,
          },
        ),
      ]);
      setAristas((prev) => [
        ...prev.filter((a) => a.id !== aristaId && !esFantasma(a)),
        aristaEditorDe({ desde: arista.source, hasta: id, puerto: puertoEntrante }),
        ...salientes.map((p) => aristaEditorDe({ desde: id, hasta: arista.target, puerto: p })),
      ]);
    },
    [rechazarSinPermiso, setNodos, setAristas],
  );

  /**
   * Borrar un nodo del medio cose la línea.
   *
   * Cada línea que entraba pasa a apuntar al primer sucesor, conservando su
   * puerto de origen. Con varios sucesores (una condición) se elige el primero:
   * es lo mismo que muestra la previsualización, así que lo que se ve antes de
   * clickear es lo que pasa después.
   */
  // La costura es `quitarNodoCosiendo` (`lib/workflows/arreglos.ts`), la
  // misma que aplica el arreglo «Quitar el bloque»: el botón de borrar y el
  // arreglo no pueden coser distinto.
  const borrarNodo = useCallback(
    (nodoId: string) => aplicarArreglos([{ tipo: "quitar_nodo", nodoId }]),
    [aplicarArreglos],
  );

  /**
   * Pinta la costura antes de coser: verde punteado lo que va a quedar, rojo
   * tenue lo que se va. La línea verde todavía no existe, así que se agrega una
   * arista fantasma —marcada, y excluida del grafo— que se borra al salir.
   */
  const previsualizarBorrado = useCallback(
    (nodoId: string | null) => {
      setAristas((prev) => {
        const reales = prev.filter((a) => !esFantasma(a));

        if (nodoId === null) {
          const sucia =
            prev.length !== reales.length || reales.some((a) => a.data?.previsualizacion);
          if (!sucia) return prev;
          return reales.map((a) =>
            a.data?.previsualizacion
              ? { ...a, data: { ...a.data, previsualizacion: undefined } }
              : a,
          );
        }

        const sucesor = reales.find((a) => a.source === nodoId)?.target;
        const marcadas = reales.map((a) =>
          a.source === nodoId || a.target === nodoId
            ? { ...a, data: { ...a.data, previsualizacion: "cortada" as const } }
            : a.data?.previsualizacion
              ? { ...a, data: { ...a.data, previsualizacion: undefined } }
              : a,
        );

        const entrante = reales.find((a) => a.target === nodoId && a.source !== sucesor);
        if (sucesor === undefined || entrante === undefined) return marcadas;

        return [
          ...marcadas,
          {
            ...aristaEditorDe({
              desde: entrante.source,
              hasta: sucesor,
              puerto: puertoDe(entrante),
            }),
            id: `fantasma|${entrante.source}|${sucesor}`,
            data: { previsualizacion: "cosida" as const, fantasma: true },
          },
        ];
      });
    },
    [setAristas],
  );

  const conectar = useCallback<OnConnect>(
    (conexion) => {
      if (rechazarSinPermiso()) return;
      if (!conexion.source || !conexion.target) return;
      const puerto = conexion.sourceHandle ?? "salida";
      if (!esPuerto(puerto)) return;
      const nueva = aristaEditorDe(
        { desde: conexion.source, hasta: conexion.target, puerto },
        origenEn(nodosRef.current, conexion.source),
        catalogosCondicion,
      );
      setAristas((prev) => {
        const reales = prev.filter((a) => !esFantasma(a));
        if (reales.some((a) => a.id === nueva.id)) return reales;
        return [...reales, nueva];
      });
    },
    [rechazarSinPermiso, setAristas, catalogosCondicion],
  );

  const cambiarConfig = useCallback(
    (nodoId: string, tipo: NodoTipo, config: Record<string, unknown>) => {
      if (rechazarSinPermiso()) return;
      setNodos((prev) =>
        prev.map((n) =>
          n.id === nodoId
            ? {
                ...n,
                // El resumen de una condición es la frase de su árbol: se
                // recalcula con la config o el lienzo mostraría la vieja.
                // Las salidas también: en "Según el valor" hay una por caso.
                data: {
                  ...n.data,
                  config,
                  resumen: resumenDe({ tipo: dominioDe(n).tipo, config }, catalogosCondicion),
                  salidas: salidasDe({ tipo: dominioDe(n).tipo, config }, catalogosCondicion),
                },
              }
            : n,
        ),
      );
      // Una línea que sale por un puerto que el nodo ya no tiene (un caso
      // borrado) se suelta: ninguna corrida la tomaría. Las que quedan se
      // vuelven a rotular, por si cambió el valor del caso.
      const nodo = { tipo, config };
      const puertos = puertosDeNodo(nodo);
      setAristas((prev) =>
        prev
          .filter((a) => a.source !== nodoId || esFantasma(a) || puertos.includes(puertoDe(a)))
          .map((a) =>
            a.source === nodoId && !esFantasma(a)
              ? {
                  ...a,
                  data: {
                    ...a.data,
                    puerto:
                      etiquetaDePuertoEnLienzo(nodo, puertoDe(a), catalogosCondicion) || undefined,
                  },
                }
              : a,
          ),
      );
    },
    [rechazarSinPermiso, setNodos, setAristas, catalogosCondicion],
  );

  // ── Panel de configuración ───────────────────────────────────────────────

  const seleccionado = useMemo(
    () => nodos.find((n) => n.id === seleccionId) ?? null,
    [nodos, seleccionId],
  );

  const nodoSeleccionado = useMemo(() => {
    if (!seleccionado) return null;
    const { tipo } = dominioDe(seleccionado);
    return {
      id: seleccionado.id,
      tipo,
      nombre: seleccionado.data.nombre,
      categoria: seleccionado.data.categoria,
      icono: seleccionado.data.icono,
    };
  }, [seleccionado]);

  /** Las listas de los selectores, juntas para que el memo de abajo dependa de una sola cosa. */
  const catalogos = useMemo<Catalogos>(
    () => ({ tags, etapas, vendedores, intents, difusiones }),
    [tags, etapas, vendedores, intents, difusiones],
  );

  /**
   * Memoizado contra el nodo y no contra el render: `EditorWorkflow` se vuelve
   * a renderizar en cada frame de un arrastre, y sin esto el formulario abierto
   * se re-renderizaría con él mientras alguien escribe adentro.
   */
  /**
   * Los pasos a los que puede saltar un "Ir a", como texto: un arrastre cambia
   * `nodos` en cada frame pero no esto, así que el formulario no se re-renderiza
   * mientras se mueve un bloque.
   */
  const pasosDelFlujo = useMemo(
    () =>
      JSON.stringify(
        nodos
          .filter((n) => !esTrigger(dominioDe(n).tipo))
          .map((n) => ({ id: n.id, nombre: n.data.nombre })),
      ),
    [nodos],
  );

  /** Los campos que puede mirar "Según el valor", con nombre y opciones como en la condición. */
  const camposSwitch = useMemo(
    () =>
      camposDeCondicion(catalogosCondicion).filter((c) =>
        (CAMPOS_SWITCH as readonly string[]).includes(c.id),
      ),
    [catalogosCondicion],
  );

  const formularioNodo = useMemo(
    () =>
      seleccionado
        ? formularioDe(
            seleccionado,
            catalogos,
            !puedeEditar,
            cambiarConfig,
            {
              buscarLeads: onBuscarLeads,
              leer: onLeerVistaPrevia,
            },
            {
              camposSwitch,
              pasos: (JSON.parse(pasosDelFlujo) as { id: string; nombre: string }[]).filter(
                (p) => p.id !== seleccionado.id,
              ),
            },
          )
        : undefined,
    [
      seleccionado,
      catalogos,
      puedeEditar,
      cambiarConfig,
      onBuscarLeads,
      onLeerVistaPrevia,
      camposSwitch,
      pasosDelFlujo,
    ],
  );

  /**
   * «Después de esto» del bloque seleccionado: a dónde lleva cada salida, y
   * para las sueltas, conectarla a un paso existente o cerrarla con un
   * «Detener». Los nombres son los del lienzo, con el id al lado porque dos
   * bloques pueden llamarse igual.
   */
  const despuesDeEsto = useMemo(() => {
    if (!seleccionado) return undefined;
    const id = seleccionado.id;
    const dominio = dominioDe(seleccionado);
    const puertos = puertosDeNodo(dominio);
    if (puertos.length === 0) return undefined;
    const nombres = new Map(nodos.map((n) => [n.id, n.data.nombre]));
    const salidas = puertos.map((p) => {
      const a = grafo.aristas.find((x) => x.desde === id && x.puerto === p);
      return {
        puerto: p,
        etiqueta: etiquetaDePuertoEnLienzo(dominio, p, catalogosCondicion),
        destino: a ? { id: a.hasta, nombre: nombres.get(a.hasta) ?? a.hasta } : null,
      };
    });
    const destinos = destinosPosibles(grafo, id).map((n) => ({
      id: n.id,
      nombre: nombres.get(n.id) ?? n.id,
    }));
    return (
      <DespuesDeEsto
        salidas={salidas}
        destinos={destinos}
        readonly={!puedeEditar}
        onConectar={(p, hasta) => {
          if (esPuerto(p)) pedirArreglos([{ tipo: "conectar", desde: id, puerto: p, hasta }]);
        }}
        onAgregarDetener={(p) => {
          if (esPuerto(p)) pedirArreglos([{ tipo: "agregar_detener", desde: id, puerto: p }]);
        }}
      />
    );
  }, [seleccionado, nodos, grafo, puedeEditar, catalogosCondicion]);

  /** «Resolver»: los arreglos automáticos del bloque seleccionado, todos juntos. */
  const resolver = useMemo(() => {
    if (!seleccionId || !puedeEditar) return null;
    const ofrecidos = arreglosDeResolver(problemasEditor, seleccionId);
    if (ofrecidos.length === 0) return null;
    return {
      aplicar: () => pedirArreglos(ofrecidos.map((o) => o.arreglo)),
      descripcion: ofrecidos.map((o) => o.etiqueta).join(" · "),
    };
  }, [seleccionId, puedeEditar, problemasEditor]);

  /** Los ajustes del flujo, que el panel muestra sin bloque seleccionado. Mismo memo que arriba. */
  const ajustesFlujo = useMemo(
    () => (
      <CampoTopePasos
        valor={topeTexto}
        onCambiar={setTopeTexto}
        error={lecturaTope.ok ? null : lecturaTope.error}
        revelarError={revelarErrorTope}
        soloLectura={!puedeEditar}
      />
    ),
    [topeTexto, lecturaTope, revelarErrorTope, puedeEditar],
  );

  // ── Acciones ─────────────────────────────────────────────────────────────

  /**
   * Un tope que no se puede guardar lleva al campo: se suelta la selección para
   * que el panel muestre los ajustes del flujo, y el campo muestra su error
   * aunque no se haya tocado. Decir "revisá el tope" con el campo escondido
   * detrás del formulario de un bloque es mandar a buscarlo.
   */
  const avisarTopeInvalido = useCallback(() => {
    setSeleccionId(null);
    setRevelarErrorTope(true);
    setAviso({ tono: "error", texto: TOPE_INVALIDO });
  }, []);

  const guardar = useCallback(() => {
    if (rechazarSinPermiso()) return;
    if (topeValido === null) {
      avisarTopeInvalido();
      return;
    }
    const tope = topeValido;
    setAviso(null);
    void (async () => {
      const r = await onGuardar({
        workflowId,
        grafo: aGrafo(nodosRef.current, aristasRef.current),
        maxPasos: tope,
      });
      if (!r.ok) {
        setAviso({ tono: "error", texto: r.error });
        return;
      }
      setGuardadoA(campoHoraEnZona(zona, new Date()));
      setAviso({ tono: "ok", texto: "Versión guardada. Publicala para que empiece a correr." });
      // Trae la versión nueva: es la que va a publicar el botón de al lado.
      router.refresh();
    })();
  }, [rechazarSinPermiso, topeValido, avisarTopeInvalido, onGuardar, workflowId, zona, router]);

  /**
   * Publicar lleva al diff de **la última versión guardada** contra la
   * publicada: ahí se ve qué cambia, cuántas corridas siguen vivas y se
   * escribe la nota. Lo que está en pantalla todavía no es ninguna versión, así
   * que si difiere de la última guardada —en el lienzo o en el tope de pasos—
   * se frena y lo dice, en vez de mostrar el diff de algo distinto de lo que
   * se está mirando.
   */
  const publicar = useCallback(() => {
    if (rechazarSinPermiso()) return;
    if (ultimaVersionId === null) {
      setAviso({
        tono: "error",
        texto: "Todavía no hay ninguna versión guardada. Guardá el flujo y después publicalo.",
      });
      return;
    }
    if (haySinGuardar) {
      setAviso({
        tono: "error",
        texto: `Publicar sube la última versión guardada (v${ultimaVersionNumero}), y hay cambios que todavía no están en ninguna. Guardá primero.`,
      });
      return;
    }
    setAviso(null);
    router.push(`/workflows/${workflowId}/publicar/${ultimaVersionId}`);
  }, [rechazarSinPermiso, ultimaVersionId, ultimaVersionNumero, haySinGuardar, router, workflowId]);

  const probar = useCallback(() => {
    if (rechazarSinPermiso()) return;
    // "Probar" corre con el tope del campo: sin uno válido no hay con qué correr.
    if (topeValido === null) {
      avisarTopeInvalido();
      return;
    }
    setAviso(null);
    setHastaNodo(null);
    setProbarAbierto(true);
  }, [rechazarSinPermiso, topeValido, avisarTopeInvalido]);

  /** Mismos cortes que Probar: sin permiso o sin tope válido no corre. */
  const probarHastaAca = useCallback(
    (nodoId: string) => {
      if (rechazarSinPermiso()) return;
      if (topeValido === null) {
        avisarTopeInvalido();
        return;
      }
      const nodo = nodosRef.current.find((n) => n.id === nodoId);
      if (!nodo) return;
      setAviso(null);
      setHastaNodo({ id: nodoId, nombre: nodo.data.nombre });
      setProbarAbierto(true);
    },
    [rechazarSinPermiso, topeValido, avisarTopeInvalido],
  );

  const volver = useCallback(() => router.push("/workflows"), [router]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {aviso ? (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "flex shrink-0 items-center gap-2 border-b px-4 py-1.5 text-[11.5px] leading-snug",
            aviso.tono === "ok"
              ? "border-ok/30 bg-ok/10 text-ok"
              : "border-danger/30 bg-danger/10 text-danger",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              aviso.tono === "ok" ? "bg-ok" : "bg-danger",
            )}
          />
          <p className="min-w-0 flex-1 text-pretty">{aviso.texto}</p>
          <button
            type="button"
            onClick={() => setAviso(null)}
            aria-label="Cerrar el aviso"
            className={cn(
              "hover:bg-surface-hover grid size-6 shrink-0 place-items-center rounded-md",
              TRANSICION_CONTROL,
              FOCO,
            )}
          >
            <Close aria-hidden className="size-3.5" />
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        <EditorWorkflow
          nombreFlujo={nombre}
          versionPublicada={versionPublicada}
          // Un vendedor ve el lienzo y no puede guardar: sin esto lo dejaba
          // arrastrar y borrar nodos igual, y el trabajo se perdía al salir.
          editable={puedeEditar}
          cambiosSinPublicar={cambiosEnBarra}
          guardadoA={guardadoA}
          nodos={nodos}
          aristas={aristas}
          onNodosChange={alCambiarNodos}
          onAristasChange={alCambiarAristas}
          onConectar={conectar}
          categorias={categorias}
          disparadorActual={disparadorActual}
          problemasPorNodo={problemasPorNodo}
          nodoSeleccionado={nodoSeleccionado}
          onSeleccionar={setSeleccionId}
          formularioNodo={formularioNodo}
          ajustesFlujo={ajustesFlujo}
          anchoPanelConfig={
            nodoSeleccionado && esCondicion(nodoSeleccionado.tipo)
              ? MEDIDAS.PANEL_CONDICION
              : undefined
          }
          despuesDeEsto={despuesDeEsto}
          onResolver={resolver?.aplicar}
          resolverDescripcion={resolver?.descripcion}
          onAgregarBloque={agregarBloque}
          onInsertarEnArista={insertarEnArista}
          onBorrarNodo={borrarNodo}
          onPrevisualizarBorrado={previsualizarBorrado}
          onProbar={probar}
          onProbarHastaAca={puedeEditar ? probarHastaAca : undefined}
          onGuardar={guardar}
          onPublicar={publicar}
          onVolver={volver}
          onCambiarVersion={() => setVersionesAbierto(true)}
        />
      </div>

      <ProbarDialog
        open={probarAbierto}
        onOpenChange={setProbarAbierto}
        workflowId={workflowId}
        grafo={grafo}
        maxPasos={topeValido ?? maxPasos}
        onBuscarLeads={onBuscarLeads}
        onProbar={onProbar}
        onObtenerDetalleRun={onObtenerDetalleRun}
        hastaNodo={hastaNodo}
        onProbarHastaAca={onProbarHastaAca}
        onIrACorrida={(runId) => router.push(`/workflows/${workflowId}/corridas/${runId}`)}
      />

      <Dialog open={versionesAbierto} onOpenChange={setVersionesAbierto}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Versiones de {nombre}</DialogTitle>
            <DialogDescription>
              Cada guardado crea una versión. La publicada es la que corre.
            </DialogDescription>
          </DialogHeader>
          <VersionesDelWorkflow
            versiones={versiones}
            puedeEditar={puedeEditar}
            hrefPublicar={(versionId) => `/workflows/${workflowId}/publicar/${versionId}`}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Las opciones de los selectores de `canvas/config/`, que llegan desde la página. */
interface Catalogos {
  tags: ReadonlyArray<OpcionSelect>;
  etapas: ReadonlyArray<OpcionSelect>;
  vendedores: ReadonlyArray<OpcionSelect>;
  intents: ReadonlyArray<OpcionSelect>;
  difusiones: ReadonlyArray<OpcionSelect>;
}

/**
 * El formulario del nodo seleccionado.
 *
 * **No es un componente nuevo: es un despacho a los siete que ya existen** en
 * `canvas/config/`, que son justamente los formularios sin marco. El panel
 * completo, `canvas/PanelConfigNodo`, no se puede reusar acá: trae su propia
 * tarjeta de 320 px con encabezado, botón de cerrar y pie, y meterlo dentro de
 * `PanelConfig` daría dos paneles anidados con dos encabezados.
 *
 * Los cinco tipos legacy caen en el `default` y quedan sin formulario. Es
 * correcto: no están en el catálogo de los 57 y ningún `Config*` los conoce.
 */
function formularioDe(
  nodo: NodoEditor,
  catalogos: Catalogos,
  readonly: boolean,
  onCambiar: (nodoId: string, tipo: NodoTipo, config: Record<string, unknown>) => void,
  vistaPrevia: {
    buscarLeads: EditorWorkflowClienteProps["onBuscarLeads"];
    leer: LeerVistaPreviaFn;
  },
  logica: {
    camposSwitch: ComponentProps<typeof ConfigLogica>["camposSwitch"];
    pasos: ComponentProps<typeof ConfigLogica>["pasos"];
  },
): ReactNode {
  const { tipo, config } = dominioDe(nodo);
  const onChange = (siguiente: Record<string, unknown>) => onCambiar(nodo.id, tipo, siguiente);

  // La condición (y su par legacy) tiene su propio constructor: el árbol Y/O.
  // Va antes del `switch` porque `condicion` legacy no tiene categoría.
  if (esCondicion(tipo)) {
    return <FormularioCondicion config={config} onChange={onChange} readonly={readonly} />;
  }

  switch (categoriaDeTipo(tipo)) {
    case "trigger":
      return (
        <ConfigTrigger
          tipo={tipo}
          config={config}
          onChange={onChange}
          tags={catalogos.tags}
          etapas={catalogos.etapas}
          difusiones={catalogos.difusiones}
          readonly={readonly}
        />
      );
    case "mensajeria":
      // «Enviar mensaje» lleva debajo la vista previa contra un lead real,
      // con el mismo texto que se está escribiendo.
      if (tipo === "msg_texto") {
        const mensaje = String(editorDeConfig("msg_texto", config).valores.mensaje ?? "");
        return (
          <div className="flex flex-col gap-5">
            <ConfigMensajeria tipo={tipo} config={config} onChange={onChange} readonly={readonly} />
            <VistaPreviaContraLead
              mensaje={mensaje}
              onBuscarLeads={vistaPrevia.buscarLeads}
              onLeer={vistaPrevia.leer}
            />
          </div>
        );
      }
      return (
        <ConfigMensajeria
          tipo={tipo}
          config={config}
          onChange={onChange}
          readonly={readonly}
          onSubirImagen={subirImagenDeFlujoAction}
        />
      );
    case "crm":
      return (
        <ConfigCRM
          tipo={tipo}
          config={config}
          onChange={onChange}
          tags={catalogos.tags}
          etapas={catalogos.etapas}
          vendedores={catalogos.vendedores}
          readonly={readonly}
        />
      );
    case "logica":
      return (
        <ConfigLogica
          tipo={tipo}
          config={config}
          onChange={onChange}
          camposSwitch={logica.camposSwitch}
          pasos={logica.pasos}
          readonly={readonly}
        />
      );
    case "integracion":
      return (
        <ConfigIntegracion tipo={tipo} config={config} onChange={onChange} readonly={readonly} />
      );
    case "ia":
      return (
        <ConfigIA
          tipo={tipo}
          config={config}
          onChange={onChange}
          intents={catalogos.intents}
          readonly={readonly}
        />
      );
    case "interno":
      return (
        <ConfigInterno
          tipo={tipo}
          config={config}
          onChange={onChange}
          vendedores={catalogos.vendedores}
          canales={[]}
          readonly={readonly}
        />
      );
    default:
      return null;
  }
}
