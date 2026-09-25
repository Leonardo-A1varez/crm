"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useEdgesState, useNodesState, type OnConnect } from "@xyflow/react";

import { Close } from "@/components/icons";
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
import { ProbarDialog } from "@/components/workflows/canvas";
import { VersionesDelWorkflow } from "@/components/workflows/VersionesDelWorkflow";
import {
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
import { puertosDe, validarGrafo } from "@/lib/workflows/validar-grafo";
import {
  NODO_TIPOS,
  PUERTOS,
  categoriaDeTipo,
  esCondicion,
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
  ETIQUETA_PUERTO,
  categoriasDePaleta,
  nombreDeTipo,
  presentacionDe,
  resumenDe,
} from "../_lib/presentacion-nodos";
import { CampoTopePasos } from "./CampoTopePasos";
import { FormularioCondicion } from "./FormularioCondicion";

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
  opciones: { borrable: boolean; problemas: readonly ProblemaNodo[] },
): NodoEditor {
  const p = presentacionDe(nodo);
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

function aristaEditorDe(a: Arista): AristaEditor {
  return {
    id: idArista(a),
    source: a.desde,
    target: a.hasta,
    // El handle de salida única se llama `salida` en `NodoBase`, así que el
    // puerto del dominio y el `sourceHandle` son literalmente el mismo string.
    sourceHandle: a.puerto,
    type: "insertable",
    data: { puerto: ETIQUETA_PUERTO[a.puerto] || undefined },
  };
}

function puertoDe(a: AristaEditor): Puerto {
  const p = a.sourceHandle ?? "salida";
  return (PUERTOS as readonly string[]).includes(p) ? (p as Puerto) : "salida";
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
 * `arreglos` no entra en la comparación porque hoy nadie los produce.
 */
function mismosProblemas(a: readonly ProblemaNodo[], b: readonly ProblemaNodo[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((p, i) => {
    const q = b[i];
    return q !== undefined && p.severidad === q.severidad && p.mensaje === q.mensaje;
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Derivación: problemas y cambios
// ──────────────────────────────────────────────────────────────────────────

interface Derivado {
  problemasPorNodo: ReadonlyMap<string, readonly ProblemaNodo[]>;
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
 *  - **`error`** ← `validarGrafo`, la misma función que corre el servicio antes
 *    de dejar entrar un grafo a la base. Que el rojo del lienzo y el rechazo de
 *    "Guardar" salgan del mismo lugar es lo que evita que uno diga que está
 *    bien y el otro lo rebote.
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
function derivar(grafo: Grafo, publicado: Grafo | null, guardado: Grafo | null): Derivado {
  const mapa = new Map<string, ProblemaNodo[]>();

  for (const p of validarGrafo(grafo)) {
    for (const nodoId of p.nodos) {
      const previos = mapa.get(nodoId);
      const problema: ProblemaNodo = { severidad: "error", mensaje: p.mensaje, regla: p.regla };
      if (previos) previos.push(problema);
      else mapa.set(nodoId, [problema]);
    }
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
    cambiosSinPublicar: diff?.total ?? 0,
    hayCambiosSinGuardar: guardado
      ? compararGrafos(guardado, grafo).total > 0
      : grafo.nodos.length > 0,
  };
}

/** Primer id libre de la forma `n1`, `n2`… Corto porque el panel lo muestra en mono. */
function proximoId(existentes: ReadonlySet<string>): string {
  let n = 1;
  while (existentes.has(`n${n}`)) n += 1;
  return `n${n}`;
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
  /** Las opciones de los selectores del panel. El `id` es lo que se guarda en `config`. */
  tags: ReadonlyArray<OpcionSelect>;
  etapas: ReadonlyArray<OpcionSelect>;
  vendedores: ReadonlyArray<OpcionSelect>;
  intents: ReadonlyArray<OpcionSelect>;
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
  onBuscarLeads: (
    raw: unknown,
  ) => Promise<{ ok: true; items: LeadListItem[] } | { ok: false; error: string }>;
  onObtenerDetalleRun: (
    raw: unknown,
  ) => Promise<{ ok: true; data: WorkflowRunDetalle | null } | { ok: false; error: string }>;
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
  tags,
  etapas,
  vendedores,
  intents,
  onGuardar,
  onProbar,
  onBuscarLeads,
  onObtenerDetalleRun,
}: EditorWorkflowClienteProps) {
  const router = useRouter();

  const [nodos, setNodos, alCambiarNodos] = useNodesState<NodoEditor>(
    grafoInicial.nodos.map((n) =>
      nodoEditorDe(n, { borrable: puedeEditar, problemas: SIN_PROBLEMAS }),
    ),
  );
  const [aristas, setAristas, alCambiarAristas] = useEdgesState<AristaEditor>(
    grafoInicial.aristas.map(aristaEditorDe),
  );

  const [seleccionId, setSeleccionId] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);
  const [guardadoA, setGuardadoA] = useState<string | undefined>(undefined);
  const [probarAbierto, setProbarAbierto] = useState(false);
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
  const { problemasPorNodo, cambiosSinPublicar, hayCambiosSinGuardar } = useMemo(
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

  const rechazarSinPermiso = useCallback((): boolean => {
    if (puedeEditar) return false;
    setAviso({ tono: "error", texto: SIN_PERMISO });
    return true;
  }, [puedeEditar]);

  const agregarBloque = useCallback(
    (tipo: string, posicion?: { x: number; y: number }) => {
      if (rechazarSinPermiso()) return;
      if (!(NODO_TIPOS as readonly string[]).includes(tipo)) return;
      const t = tipo as NodoTipo;
      setNodos((prev) => {
        const id = proximoId(new Set(prev.map((n) => n.id)));
        const nodo: Nodo = { id, tipo: t, config: {}, posicion: posicion ?? posicionLibre(prev) };
        return [...prev, nodoEditorDe(nodo, { borrable: true, problemas: SIN_PROBLEMAS })];
      });
    },
    [rechazarSinPermiso, setNodos],
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

      const id = proximoId(new Set(nodosRef.current.map((n) => n.id)));
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
  const borrarNodo = useCallback(
    (nodoId: string) => {
      if (rechazarSinPermiso()) return;

      setAristas((prev) => {
        const reales = prev.filter((a) => !esFantasma(a));
        const sucesor = reales.find((a) => a.source === nodoId)?.target;
        const cosidas =
          sucesor === undefined
            ? []
            : reales
                .filter((a) => a.target === nodoId && a.source !== sucesor)
                .map((a) =>
                  aristaEditorDe({ desde: a.source, hasta: sucesor, puerto: puertoDe(a) }),
                );
        const quedan = reales.filter((a) => a.source !== nodoId && a.target !== nodoId);
        const porId = new Map(quedan.map((a) => [a.id, a]));
        for (const a of cosidas) if (!porId.has(a.id)) porId.set(a.id, a);
        return [...porId.values()];
      });
      setNodos((prev) => prev.filter((n) => n.id !== nodoId));
      setSeleccionId((actual) => (actual === nodoId ? null : actual));
    },
    [rechazarSinPermiso, setNodos, setAristas],
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
      if (!(PUERTOS as readonly string[]).includes(puerto)) return;
      const nueva = aristaEditorDe({
        desde: conexion.source,
        hasta: conexion.target,
        puerto: puerto as Puerto,
      });
      setAristas((prev) => {
        const reales = prev.filter((a) => !esFantasma(a));
        if (reales.some((a) => a.id === nueva.id)) return reales;
        return [...reales, nueva];
      });
    },
    [rechazarSinPermiso, setAristas],
  );

  const cambiarConfig = useCallback(
    (nodoId: string, config: Record<string, unknown>) => {
      if (rechazarSinPermiso()) return;
      setNodos((prev) =>
        prev.map((n) =>
          n.id === nodoId
            ? {
                ...n,
                // El resumen de una condición es la frase de su árbol: se
                // recalcula con la config o el lienzo mostraría la vieja.
                data: {
                  ...n.data,
                  config,
                  resumen: resumenDe({ tipo: dominioDe(n).tipo, config }),
                },
              }
            : n,
        ),
      );
    },
    [rechazarSinPermiso, setNodos],
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
    () => ({ tags, etapas, vendedores, intents }),
    [tags, etapas, vendedores, intents],
  );

  /**
   * Memoizado contra el nodo y no contra el render: `EditorWorkflow` se vuelve
   * a renderizar en cada frame de un arrastre, y sin esto el formulario abierto
   * se re-renderizaría con él mientras alguien escribe adentro.
   */
  const formularioNodo = useMemo(
    () =>
      seleccionado ? formularioDe(seleccionado, catalogos, !puedeEditar, cambiarConfig) : undefined,
    [seleccionado, catalogos, puedeEditar, cambiarConfig],
  );

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
      setGuardadoA(
        new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", hour12: false }),
      );
      setAviso({ tono: "ok", texto: "Versión guardada. Publicala para que empiece a correr." });
      // Trae la versión nueva: es la que va a publicar el botón de al lado.
      router.refresh();
    })();
  }, [rechazarSinPermiso, topeValido, avisarTopeInvalido, onGuardar, workflowId, router]);

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
    setProbarAbierto(true);
  }, [rechazarSinPermiso, topeValido, avisarTopeInvalido]);

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
          onAgregarBloque={agregarBloque}
          onInsertarEnArista={insertarEnArista}
          onBorrarNodo={borrarNodo}
          onPrevisualizarBorrado={previsualizarBorrado}
          onProbar={probar}
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
  onCambiar: (nodoId: string, config: Record<string, unknown>) => void,
): ReactNode {
  const { tipo, config } = dominioDe(nodo);
  const onChange = (siguiente: Record<string, unknown>) => onCambiar(nodo.id, siguiente);

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
          readonly={readonly}
        />
      );
    case "mensajeria":
      return (
        <ConfigMensajeria tipo={tipo} config={config} onChange={onChange} readonly={readonly} />
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
          campos={[]}
          readonly={readonly}
        />
      );
    case "logica":
      return <ConfigLogica tipo={tipo} config={config} onChange={onChange} readonly={readonly} />;
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
