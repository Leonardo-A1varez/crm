"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  ReactFlowProvider,
  useReactFlow,
  type EdgeChange,
  type NodeChange,
  type OnConnect,
} from "@xyflow/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { BarraEditor, ChipEstado, ChipVersion } from "./BarraEditor";
import { esAtajoBuscar, esCampoEditable, siguienteNodo } from "./atajos";
import { GloboEnLienzo } from "./GloboEnLienzo";
import { BotonLienzo, LienzoEditor, useEncuadrarNodo } from "./LienzoEditor";
import { PaletaBloques, PaletaFlotante, type CategoriaBloques } from "./PaletaBloques";
import { PanelConfig } from "./PanelConfig";
import { ResumenValidacion } from "./Validacion";
import { PRESION_TACTIL, TRANSICION_CONTROL } from "./tokens-editor";
import { bloqueaPublicar, type ProblemaNodo, type Severidad } from "./severidad";
import type { AristaEditor } from "./AristaInsertable";
import type { NodoEditor } from "./NodoConPuertos";
import type { CategoriaVisual, IconoNodo } from "./contrato-nodos";

export interface EditorWorkflowProps {
  nombreFlujo: string;
  /**
   * Número de la versión publicada, o `null` si el flujo nunca publicó
   * ninguna.
   *
   * Era `number` a secas, y quien lo montaba no tenía más remedio que mandar
   * `0` para el caso "todavía no hay ninguna": el chip mostraba entonces
   * "v0 publicada", que nombra una versión que no existe y afirma un estado
   * —publicada— que es justamente el que falta. Con `null` el chip no se
   * dibuja, que es lo único cierto que se puede hacer.
   */
  versionPublicada: number | null;
  /** Cuántos cambios tiene el borrador respecto de la publicada. 0 = sin cambios. */
  cambiosSinPublicar: number;
  /** Hora del último guardado, formateada ("14:07"). Va en mono. */
  guardadoA?: string;

  nodos: NodoEditor[];
  aristas: AristaEditor[];
  onNodosChange: (c: NodeChange<NodoEditor>[]) => void;
  onAristasChange: (c: EdgeChange<AristaEditor>[]) => void;
  onConectar: OnConnect;

  categorias: readonly CategoriaBloques[];
  /** Nombre del disparador del flujo, para explicar el atenuado de la paleta. */
  disparadorActual?: string;

  /** Problemas por id de nodo. Alimenta el resumen de la barra y el panel. */
  problemasPorNodo: ReadonlyMap<string, readonly ProblemaNodo[]>;

  nodoSeleccionado: {
    id: string;
    tipo: string;
    nombre: string;
    categoria: CategoriaVisual;
    icono?: IconoNodo;
  } | null;
  onSeleccionar: (id: string | null) => void;
  /** El formulario del nodo seleccionado. Lo arma quien conoce ese tipo. */
  formularioNodo?: ReactNode;
  /**
   * Los ajustes del flujo entero, que el panel muestra cuando no hay ningún
   * bloque seleccionado. Los arma quien conoce el flujo; ver `PanelConfig`.
   */
  ajustesFlujo?: ReactNode;
  /** Ancho del panel de configuración. Ver `PanelConfig.ancho`. */
  anchoPanelConfig?: number;
  /** «Después de esto» del bloque seleccionado. Ver `PanelConfig.despuesDeEsto`. */
  despuesDeEsto?: ReactNode;
  /** «Resolver» del bloque seleccionado. Ver `PanelConfig.onResolver`. */
  onResolver?: () => void;
  resolverDescripcion?: string;

  /**
   * Agrega un bloque. Con `desde`, queda conectado al puerto del que salió el
   * cable que se soltó en el vacío.
   */
  onAgregarBloque: (
    tipo: string,
    posicion?: { x: number; y: number },
    desde?: { nodoId: string; puerto: string },
  ) => void;
  onInsertarEnArista: (tipo: string, aristaId: string) => void;
  onBorrarNodo: (nodoId: string) => void;
  onPrevisualizarBorrado: (nodoId: string | null) => void;
  onIrANodo?: (nodoId: string) => void;

  onProbar: () => void;
  /**
   * "Ejecutar hasta acá" del panel, con el id del bloque seleccionado. Sin
   * esto el botón no aparece: abrir el Probar completo con ese rótulo corría
   * el flujo entero.
   */
  onProbarHastaAca?: (nodoId: string) => void;
  onGuardar: () => void;
  onPublicar: () => void;
  onVolver: () => void;
  onCambiarVersion?: () => void;

  /**
   * `false` deja el lienzo de sólo lectura: los nodos no se arrastran, no se
   * conectan y la tecla Supr no borra.
   *
   * Existe porque un vendedor ve esta pantalla y no puede guardar. Sin esto el
   * lienzo lo dejaba mover y borrar nodos igual, y el trabajo se perdía sin
   * aviso al salir: la pantalla decía que no podía editar y a la vez lo
   * dejaba. Las acciones que escriben ya las corta quien monta el editor; esto
   * cierra el gesto directo sobre el lienzo, que es el que no pasa por ellas.
   */
  editable?: boolean;
}

const SIN_PROBLEMAS: readonly ProblemaNodo[] = [];

/**
 * El editor de un workflow: paleta, lienzo y configuración.
 *
 * El modelo de interacción es el de n8n y Make —paleta a la izquierda, lienzo
 * al medio, panel a la derecha— porque es el que la gente ya vio. Lo que cambia
 * es el vocabulario: no hay un solo campo donde escribir código, los bloques se
 * llaman por lo que hacen ("Poner etiqueta", no "Set variable") y los que no
 * aplican al flujo se ven atenuados con el motivo a la vista.
 *
 * ## Los tres gestos que la interfaz enseña sin explicar
 *
 *  1. **Soltar un bloque sobre una línea lo inserta ahí.** Cada línea tiene un
 *     chip `+` en el medio que aparece apenas empieza un arrastre.
 *  2. **Borrar un nodo del medio cose la línea.** Apuntar el botón de borrar
 *     pinta en verde punteado la línea que va a quedar y en rojo la que se va,
 *     antes de tocar nada.
 *  3. **Arrastrar un cable al vacío abre la paleta filtrada**, en el punto
 *     exacto donde se soltó.
 *
 * ## La validación nunca vive en un panel aparte
 *
 * Rojo bloquea publicar, ámbar avisa que algo cambió por debajo, azul dice que
 * está editado y sin publicar. Las tres se pintan **sobre el nodo culpable**.
 * Lo único que sale del lienzo es el conteo de la barra, y es un botón: lleva
 * al primer nodo de esa severidad —lo selecciona y centra la cámara en él—,
 * que es lo que hace usable un flujo de 80 nodos donde uno está roto.
 */
export function EditorWorkflow(props: EditorWorkflowProps) {
  // El proveedor envuelve el editor entero y no sólo el lienzo: el contador de
  // la barra mueve la cámara, y eso sólo se puede desde adentro del proveedor.
  // Uno solo: dos darían dos stores, y la cámara de uno no movería el lienzo
  // del otro.
  return (
    <ReactFlowProvider>
      <EditorConLienzo {...props} />
    </ReactFlowProvider>
  );
}

function EditorConLienzo(props: EditorWorkflowProps) {
  const {
    nombreFlujo,
    versionPublicada,
    cambiosSinPublicar,
    guardadoA,
    nodos,
    aristas,
    onNodosChange,
    onAristasChange,
    onConectar,
    categorias,
    disparadorActual,
    problemasPorNodo,
    nodoSeleccionado,
    onSeleccionar,
    formularioNodo,
    ajustesFlujo,
    anchoPanelConfig,
    despuesDeEsto,
    onResolver,
    resolverDescripcion,
    onAgregarBloque,
    onInsertarEnArista,
    onBorrarNodo,
    onPrevisualizarBorrado,
    onIrANodo,
    onProbar,
    onProbarHastaAca,
    onGuardar,
    onPublicar,
    onVolver,
    onCambiarVersion,
    editable = true,
  } = props;

  const encuadrarNodo = useEncuadrarNodo();
  const { getNodes, screenToFlowPosition } = useReactFlow<NodoEditor, AristaEditor>();
  const busquedaRef = useRef<HTMLInputElement>(null);
  const lienzoRef = useRef<HTMLDivElement>(null);
  const esMac = useSyncExternalStore(sinSuscripcion, leerEsMac, () => false);

  /**
   * De dónde salió el cable que se soltó en el vacío, y en qué punto de la
   * pantalla. `null` = no hay paleta flotante abierta.
   */
  const [cableSuelto, setCableSuelto] = useState<{
    origen: { nodoId: string; puerto: string };
    punto: { x: number; y: number };
  } | null>(null);

  const conteos = useMemo(() => {
    const acc: Record<Severidad, number> = { error: 0, stale: 0, sin_publicar: 0 };
    for (const problemas of problemasPorNodo.values()) {
      const vistas = new Set(problemas.map((p) => p.severidad));
      for (const s of vistas) acc[s] += 1;
    }
    return acc;
  }, [problemasPorNodo]);

  const hayError = conteos.error > 0;

  const agregarAlFinal = useCallback((tipo: string) => onAgregarBloque(tipo), [onAgregarBloque]);

  /**
   * Marca el nodo como seleccionado también en el lienzo, y no sólo en el
   * panel. Sin esto el anillo de selección se quedaba en el nodo que se había
   * clickeado antes, mientras el panel ya mostraba otro.
   *
   * Pasa por `onNodosChange` y no por un `setNodes`: es el mismo camino que
   * toma un clic sobre el nodo, así que el estado de quien monta el editor
   * sigue siendo la única fuente de verdad.
   */
  const seleccionarEnLienzo = useCallback(
    (nodoId: string) => {
      const cambios: NodeChange<NodoEditor>[] = [];
      for (const n of getNodes()) {
        const debe = n.id === nodoId;
        if (Boolean(n.selected) !== debe)
          cambios.push({ type: "select", id: n.id, selected: debe });
      }
      if (cambios.length > 0) onNodosChange(cambios);
    },
    [getNodes, onNodosChange],
  );

  const irAPrimero = useCallback(
    (severidad: Severidad) => {
      for (const [nodoId, problemas] of problemasPorNodo) {
        if (problemas.some((p) => p.severidad === severidad)) {
          // Seleccionar sin mover la cámara abría el panel sobre un nodo que,
          // en un flujo largo, estaba fuera de vista.
          encuadrarNodo(nodoId);
          seleccionarEnLienzo(nodoId);
          onIrANodo?.(nodoId);
          onSeleccionar(nodoId);
          return;
        }
      }
    },
    [problemasPorNodo, encuadrarNodo, seleccionarEnLienzo, onIrANodo, onSeleccionar],
  );

  /** Selecciona un bloque en el lienzo y en el panel, y lo trae a la vista. */
  const irANodo = useCallback(
    (nodoId: string) => {
      encuadrarNodo(nodoId);
      seleccionarEnLienzo(nodoId);
      onSeleccionar(nodoId);
      // El foco va al nodo: el Tab siguiente sigue desde acá, y el lector de
      // pantalla anuncia a dónde se llegó.
      lienzoRef.current
        ?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(nodoId)}"]`)
        ?.focus({ preventScroll: true });
    },
    [encuadrarNodo, seleccionarEnLienzo, onSeleccionar],
  );

  /** Pasa al bloque siguiente o anterior. `false` = no había más: que siga el Tab normal. */
  const pasarDeBloque = useCallback(
    (atras: boolean): boolean => {
      const siguiente = siguienteNodo(getNodes(), nodoSeleccionado?.id ?? null, atras);
      if (siguiente === null) return false;
      irANodo(siguiente);
      return true;
    },
    [getNodes, nodoSeleccionado, irANodo],
  );

  const irABusqueda = useCallback(() => {
    busquedaRef.current?.focus();
    busquedaRef.current?.select();
  }, []);

  /**
   * ⌘K / Ctrl+K y Tab. Se escucha en `document` porque ⌘K vale con el foco en
   * cualquier parte del editor. Ninguno actúa con el foco en un campo de
   * texto: ahí las teclas son del campo. Tab, además, sólo con el foco dentro
   * del lienzo, y deja pasar la tecla al llegar al último bloque para no
   * atrapar el teclado (WCAG 2.1.2).
   */
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.defaultPrevented || esCampoEditable(e.target)) return;
      if (esAtajoBuscar(e)) {
        e.preventDefault();
        irABusqueda();
        return;
      }
      if (e.key !== "Tab" || e.ctrlKey || e.metaKey || e.altKey) return;
      const lienzo = lienzoRef.current;
      if (!lienzo || !(e.target instanceof Node) || !lienzo.contains(e.target)) return;
      if (pasarDeBloque(e.shiftKey)) e.preventDefault();
    };
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [irABusqueda, pasarDeBloque]);

  const problemasSeleccionado = nodoSeleccionado
    ? (problemasPorNodo.get(nodoSeleccionado.id) ?? SIN_PROBLEMAS)
    : SIN_PROBLEMAS;

  return (
    <div className="bg-surface-root flex h-full flex-col">
      <BarraEditor
        titulo={nombreFlujo}
        onVolver={onVolver}
        contexto={
          <>
            {versionPublicada !== null ? (
              <ChipVersion
                version={versionPublicada}
                estado="publicada"
                onClick={onCambiarVersion}
              />
            ) : (
              <ChipEstado tono="aviso">sin versión publicada</ChipEstado>
            )}
            {cambiosSinPublicar > 0 ? (
              <ChipEstado tono="info">
                borrador con <span className="font-mono tabular-nums">{cambiosSinPublicar}</span>{" "}
                {cambiosSinPublicar === 1 ? "cambio" : "cambios"}
              </ChipEstado>
            ) : null}
            {guardadoA ? (
              <span className="text-ink-ghost shrink-0 font-mono text-[11px] tabular-nums">
                guardado {guardadoA}
              </span>
            ) : null}
          </>
        }
        acciones={
          <>
            <ResumenValidacion conteos={conteos} onIrA={irAPrimero} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onProbar}
              className={cn(TRANSICION_CONTROL, PRESION_TACTIL)}
            >
              Probar
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onGuardar}
              className={cn(TRANSICION_CONTROL, PRESION_TACTIL)}
            >
              Guardar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={onPublicar}
              disabled={hayError}
              // El botón deshabilitado no explica solo. Lo explica el chip rojo
              // que tiene al lado, que además lleva al nodo culpable de un clic:
              // un `title` en un botón deshabilitado no lo lee ni el teclado ni
              // el táctil.
              title={hayError ? "Resolvé los errores antes de publicar" : undefined}
              className={cn(TRANSICION_CONTROL, PRESION_TACTIL)}
            >
              Publicar
            </Button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1">
        <PaletaBloques
          categorias={categorias}
          disparadorActual={disparadorActual}
          // `useCallback` y no una flecha inline: `ItemPaleta` está memoizado y
          // su doc lo dice — con una función nueva en cada render, los 57
          // bloques se repintan en cada frame de un arrastre y el memo no
          // sirve de nada.
          onAgregar={agregarAlFinal}
          busquedaRef={busquedaRef}
          atajoBusqueda={esMac ? "⌘K" : "Ctrl K"}
        />

        <div ref={lienzoRef} className="flex min-w-0 flex-1">
          <LienzoEditor
            nodos={nodos}
            aristas={aristas}
            onNodosChange={onNodosChange}
            onAristasChange={onAristasChange}
            onConectar={onConectar}
            onSoltarBloque={(tipo, pos) => onAgregarBloque(tipo, pos)}
            onInsertarEnArista={onInsertarEnArista}
            onConectarAlVacio={(origen, punto) => setCableSuelto({ origen, punto })}
            onBorrarNodo={onBorrarNodo}
            onPrevisualizarBorrado={onPrevisualizarBorrado}
            onSeleccionar={onSeleccionar}
            editable={editable}
            herramientas={
              <>
                <BotonLienzo
                  etiqueta={`Buscar un bloque (${esMac ? "⌘K" : "Ctrl+K"})`}
                  atajo="Control+K Meta+K"
                  onClick={irABusqueda}
                >
                  {esMac ? "⌘K" : "Ctrl K"}
                </BotonLienzo>
                <BotonLienzo
                  etiqueta="Ir al bloque siguiente (Tab, con el foco en el lienzo)"
                  atajo="Tab"
                  onClick={() => pasarDeBloque(false)}
                >
                  Tab
                </BotonLienzo>
              </>
            }
          >
            {nodoSeleccionado ? (
              <GloboEnLienzo nodoId={nodoSeleccionado.id} problemas={problemasSeleccionado} />
            ) : null}
          </LienzoEditor>
        </div>

        <PanelConfig
          nodo={nodoSeleccionado}
          problemas={problemasSeleccionado}
          ajustesFlujo={ajustesFlujo}
          ancho={anchoPanelConfig}
          onEliminar={nodoSeleccionado ? () => onBorrarNodo(nodoSeleccionado.id) : undefined}
          despuesDeEsto={nodoSeleccionado ? despuesDeEsto : undefined}
          onResolver={nodoSeleccionado ? onResolver : undefined}
          resolverDescripcion={resolverDescripcion}
          onProbarHastaAca={
            nodoSeleccionado && onProbarHastaAca
              ? () => onProbarHastaAca(nodoSeleccionado.id)
              : undefined
          }
        >
          {formularioNodo}
        </PanelConfig>
      </div>

      {cableSuelto ? (
        <PaletaFlotante
          categorias={categorias}
          posicion={cableSuelto.punto}
          titulo={`Qué sigue después de la salida «${cableSuelto.origen.puerto}»`}
          onElegir={(tipo) => {
            // El punto llega en píxeles de pantalla y el bloque se ubica en
            // coordenadas del lienzo: sin convertir, con zoom o desplazamiento
            // el bloque caía lejos de donde se soltó el cable.
            onAgregarBloque(tipo, screenToFlowPosition(cableSuelto.punto), cableSuelto.origen);
            setCableSuelto(null);
          }}
          onCerrar={() => setCableSuelto(null)}
        />
      ) : null}
    </div>
  );
}

function sinSuscripcion(): () => void {
  return () => {};
}

/** Si es una Mac, para rotular el atajo como ⌘K en vez de Ctrl K. */
function leerEsMac(): boolean {
  return /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "");
}

/**
 * Si el flujo se puede publicar. Se exporta para que la pantalla que envuelve
 * al editor pueda deshabilitar su propio botón sin volver a recorrer el mapa.
 */
export function puedePublicar(
  problemasPorNodo: ReadonlyMap<string, readonly ProblemaNodo[]>,
): boolean {
  for (const problemas of problemasPorNodo.values()) {
    if (bloqueaPublicar(problemas)) return false;
  }
  return true;
}
