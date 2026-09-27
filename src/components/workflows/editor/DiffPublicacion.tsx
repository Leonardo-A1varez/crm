"use client";

import { useMemo } from "react";
import {
  BaseEdge,
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { useColorModeLienzo } from "./color-mode-lienzo";
import { EncuadreInicial } from "./EncuadreInicial";
import { BarraEditor } from "./BarraEditor";
import { MEDIDAS, PRESION_TACTIL, TRANSICION_CONTROL } from "./tokens-editor";
import { TIPOS_NODO_DIFF, type NodoDiffFlow } from "./NodoDiff";
import {
  CLASE_LABEL,
  CLASE_PUNTO,
  CLASE_TEXTO,
  insigniaDe,
  type CambioParametro,
  type ClaseCambio,
  type DiffGrafo,
} from "./diff";
import type { ResolverNodo } from "./contrato-nodos";

interface DatosAristaDiff extends Record<string, unknown> {
  clase: Extract<ClaseCambio, "agregado" | "eliminado" | "igual">;
}
type AristaDiffFlow = Edge<DatosAristaDiff>;

/**
 * La arista del diff.
 *
 * Tres trazos y ninguna leyenda hace falta: la que quedó igual es la línea
 * habitual; la nueva es verde y sólida —incluida **la que se cosió** cuando se
 * borró un nodo del medio—; la que se fue es roja y punteada, y sigue pasando
 * por donde estaba el nodo borrado. Las dos últimas juntas cuentan la historia
 * completa: por acá pasaba, ahora pasa por allá.
 */
function AristaDiff({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<AristaDiffFlow>) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 10,
  });
  const clase = data?.clase ?? "igual";
  return (
    <BaseEdge
      path={path}
      className={cn(
        "!stroke-[1.6]",
        clase === "agregado" && "!stroke-ok",
        clase === "eliminado" && "!stroke-danger/45 [stroke-dasharray:4_4]",
        clase === "igual" && "!stroke-line-control",
      )}
    />
  );
}

const TIPOS_ARISTA_DIFF = { diff: AristaDiff } as const;

/** Corridas vivas de una versión. Publicar no las mueve. */
export interface CorridasDeVersion {
  version: number;
  cantidad: number;
}

/** Un error que impide publicar, con el nodo nombrado como se lee en el lienzo. */
export interface ProblemaNombrado {
  nodo: string;
  mensaje: string;
}

export interface DiffPublicacionProps {
  nombreFlujo: string;
  /** La publicada hoy. `null` si el flujo nunca publicó ninguna: el diff es todo agregado. */
  versionActual: number | null;
  versionNueva: number;
  diff: DiffGrafo;
  /**
   * Lo que cambió fuera del grafo y vale para todo el flujo, como el tope de
   * pasos por corrida. `compararGrafos` no lo ve; sin esto, una versión que
   * sólo cambia el tope diría "no hay ningún cambio" y no se podría publicar.
   */
  cambiosDelFlujo?: readonly CambioParametro[];
  resolver: ResolverNodo;
  /** Nota de la versión. Texto libre: es prosa para humanos, no configuración. */
  nota: string;
  onNotaChange: (v: string) => void;
  /**
   * Las corridas vivas, por versión. No todas están en la publicada: una
   * corrida termina en la versión donde arrancó, que puede ser una más vieja.
   */
  corridasVivas?: { total: number; porVersion: readonly CorridasDeVersion[] };
  /** Tope de caracteres de la nota. Se cuenta a la vista cuando se acerca. */
  maxNota?: number;
  /** Texto del botón principal. Por defecto "Publicar vN". */
  etiquetaPublicar?: string;
  /** Hay una publicación en vuelo: el botón se apaga y lo dice. */
  publicando?: boolean;
  /** Lo que devolvió la acción cuando no se pudo publicar. */
  error?: string | null;
  /** Por qué no se puede publicar aunque haya cambios. Apaga el botón y se lee arriba de él. */
  bloqueo?: string | null;
  /**
   * Los errores del flujo que impiden publicarlo, cada uno con el nodo que lo
   * tiene. Con alguno, el botón se apaga: el servidor lo rechazaría igual.
   */
  problemas?: readonly ProblemaNombrado[];
  onVolver: () => void;
  onPublicar: () => void;
}

/**
 * Ver el diff antes de publicar.
 *
 * ## Lo que esta pantalla hace distinto
 *
 * **El diff se dibuja sobre el propio lienzo.** Todas las herramientas del
 * mercado muestran dos columnas de JSON o una lista de campos. Las dos formas
 * obligan a reconstruir el flujo de memoria para entender el impacto, y con 30
 * nodos eso no se puede hacer. Acá el flujo está dibujado, y encima está
 * pintado qué cambió: verde lo nuevo, ámbar lo modificado, rojo punteado lo que
 * se va —**en su posición original**, para que el hueco se vea donde estaba.
 *
 * La lista lateral existe igual, pero es índice y no explicación: sirve para
 * contar y para saltar, y dice explícitamente que lo importante está a la
 * izquierda.
 *
 * ## Las dos cosas que se dicen en voz alta
 *
 *  1. **Mover un nodo no es un cambio.** Si no se dice, un nodo que aparece en
 *     otro lugar sin marca se lee como un bug del diff.
 *  2. **Publicar no toca las corridas en marcha.** Es la pregunta que todo el
 *     mundo se hace antes de apretar el botón, y responderla ahí mismo es lo
 *     que hace que el botón se apriete.
 */
export function DiffPublicacion({
  nombreFlujo,
  versionActual,
  versionNueva,
  diff,
  cambiosDelFlujo = [],
  resolver,
  nota,
  onNotaChange,
  corridasVivas,
  maxNota,
  etiquetaPublicar,
  publicando = false,
  error = null,
  bloqueo = null,
  problemas = [],
  onVolver,
  onPublicar,
}: DiffPublicacionProps) {
  const colorMode = useColorModeLienzo();
  const total = diff.total + cambiosDelFlujo.length;
  const sinCambios = total === 0;
  const notaLarga = maxNota !== undefined && nota.length > maxNota;
  const apagado = sinCambios || publicando || bloqueo !== null || notaLarga || problemas.length > 0;
  const porNodo = useMemo(() => new Map(diff.cambios.map((c) => [c.nodoId, c])), [diff.cambios]);

  const nodos = useMemo<NodoDiffFlow[]>(
    () =>
      diff.nodos.map((n) => {
        const p = resolver(n);
        const cambio = porNodo.get(n.id);
        return {
          id: n.id,
          type: "diff",
          position: n.posicion,
          draggable: false,
          data: {
            nombre: p.nombre,
            categoria: p.categoria,
            icono: p.icono,
            resumen: p.resumen,
            salidas: p.salidas,
            sinEntrada: p.sinEntrada,
            clase: n.clase,
            insignia: insigniaDe(cambio, n.clase),
            parametros: cambio?.parametros,
          },
        };
      }),
    [diff.nodos, porNodo, resolver],
  );

  const aristas = useMemo<AristaDiffFlow[]>(
    () =>
      diff.aristas.map((a) => ({
        id: a.aristaId,
        type: "diff",
        source: a.desde,
        target: a.hasta,
        sourceHandle: a.puerto === "salida" ? undefined : a.puerto,
        data: { clase: a.clase },
      })),
    [diff.aristas],
  );

  return (
    <div className="bg-surface-root flex h-full flex-col">
      <BarraEditor
        titulo={nombreFlujo}
        onVolver={onVolver}
        volverEtiqueta="Editor"
        contexto={
          <span className="border-line-control bg-surface-input text-ink-secondary shrink-0 rounded-md border px-2 py-1 font-mono text-[11.5px] tabular-nums">
            {versionActual === null ? "sin publicar" : `v${versionActual}`} → v{versionNueva}
          </span>
        }
        acciones={<LeyendaDiff />}
      />

      <div className="flex min-h-0 flex-1">
        <div className="bg-surface-root relative min-w-0 flex-1">
          <ReactFlowProvider>
            <ReactFlow<NodoDiffFlow, AristaDiffFlow>
              colorMode={colorMode}
              nodes={nodos}
              edges={aristas}
              nodeTypes={TIPOS_NODO_DIFF}
              edgeTypes={TIPOS_ARISTA_DIFF}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              onlyRenderVisibleElements
              minZoom={0.3}
              maxZoom={1.5}
              // El encuadre al abrir lo hace `<EncuadreInicial>`: la prop
              // `fitView` sólo cuenta los nodos ya medidos.
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
              <EncuadreInicial />
            </ReactFlow>
          </ReactFlowProvider>
        </div>

        <aside
          style={{ width: MEDIDAS.PANEL_LATERAL }}
          aria-label={`Cambios de la versión ${versionNueva}`}
          className="border-line-layout bg-surface-panel flex shrink-0 flex-col border-l"
        >
          <div className="border-line-layout flex shrink-0 flex-col gap-1.5 border-b px-4.5 py-4">
            <h2 className="text-ink-primary text-[14px] leading-tight font-semibold">
              Publicar la versión {versionNueva}
            </h2>
            <p className="text-ink-dim text-[11.5px] leading-relaxed text-pretty">
              {sinCambios
                ? "No hay ningún cambio respecto de la versión publicada. Publicar no cambiaría nada."
                : versionActual === null
                  ? `Es la primera versión que se publica: ${diff.total} ${diff.total === 1 ? "bloque nuevo" : "bloques nuevos"}. Desde que se publique, el flujo empieza a correr.`
                  : `${total} ${total === 1 ? "cambio" : "cambios"} respecto de v${versionActual}. El diff está dibujado sobre el lienzo, a la izquierda.`}
            </p>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-4 px-4.5 py-4">
              {problemas.length > 0 ? (
                <section
                  aria-labelledby="problemas-publicacion"
                  className="border-danger/30 bg-danger/10 flex flex-col gap-2 rounded-lg border p-2.5"
                >
                  <h3
                    id="problemas-publicacion"
                    className="text-danger text-[11.5px] leading-tight font-semibold"
                  >
                    {problemas.length === 1
                      ? "Hay un error que impide publicar"
                      : `Hay ${problemas.length} errores que impiden publicar`}
                  </h3>
                  <ul
                    aria-label="Errores que impiden publicar"
                    className="flex flex-col gap-1.5 text-[11px] leading-snug text-pretty"
                  >
                    {problemas.map((p, i) => (
                      <li key={`${p.nodo}-${i}`} className="text-ink-body">
                        <span className="text-ink-primary font-semibold">{p.nodo}</span>
                        {": "}
                        {p.mensaje}
                      </li>
                    ))}
                  </ul>
                  <p className="text-ink-dim text-[10.5px] leading-relaxed text-pretty">
                    Corregilos en el editor, guardá y volvé a publicar.
                  </p>
                </section>
              ) : null}

              <div className="flex flex-col gap-1.5">
                {cambiosDelFlujo.length > 0 ? (
                  <div className="border-line-card bg-surface-card flex flex-col gap-1.5 rounded-lg border p-2.5">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className={cn("size-1.5 shrink-0 rounded-full", CLASE_PUNTO.cambiado)}
                      />
                      <span className="text-ink-primary min-w-0 flex-1 truncate text-[11.5px] leading-tight font-semibold">
                        Ajustes del flujo
                      </span>
                      <span
                        className={cn(
                          "shrink-0 font-mono text-[9.5px] font-semibold",
                          CLASE_TEXTO.cambiado,
                        )}
                      >
                        {CLASE_LABEL.cambiado}
                      </span>
                    </div>
                    <ul className="flex flex-col gap-1 pl-3.5">
                      {cambiosDelFlujo.map((p) => (
                        <li
                          key={p.etiqueta}
                          className="text-ink-dim flex flex-wrap items-baseline gap-1.5 text-[10.5px]"
                        >
                          <span>{p.etiqueta}</span>
                          <span className="text-ink-ghost font-mono line-through">
                            {p.antes ?? "sin definir"}
                          </span>
                          <span aria-hidden className="text-ink-ghost">
                            →
                          </span>
                          <span className="text-ok font-mono">{p.despues ?? "sin definir"}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {diff.cambios.map((c) => (
                  <div
                    key={c.nodoId}
                    className="border-line-card bg-surface-card flex flex-col gap-1.5 rounded-lg border p-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className={cn("size-1.5 shrink-0 rounded-full", CLASE_PUNTO[c.clase])}
                      />
                      <span className="text-ink-primary min-w-0 flex-1 truncate text-[11.5px] leading-tight font-semibold">
                        {c.nombre}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 font-mono text-[9.5px] font-semibold",
                          CLASE_TEXTO[c.clase],
                        )}
                      >
                        {CLASE_LABEL[c.clase]}
                      </span>
                    </div>
                    {c.parametros.length > 0 ? (
                      <ul className="flex flex-col gap-1 pl-3.5">
                        {c.parametros.map((p) => (
                          <li
                            key={p.etiqueta}
                            className="text-ink-dim flex flex-wrap items-baseline gap-1.5 text-[10.5px]"
                          >
                            <span>{p.etiqueta}</span>
                            <span className="text-ink-ghost font-mono line-through">
                              {p.antes ?? "sin definir"}
                            </span>
                            <span aria-hidden className="text-ink-ghost">
                              →
                            </span>
                            <span className="text-ok font-mono">{p.despues ?? "sin definir"}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>

              <p className="text-ink-ghost text-[10.5px] leading-relaxed text-pretty">
                Mover un nodo de lugar no cuenta como cambio: acomodar el lienzo para que se
                entienda mejor es justamente lo que conviene hacer, y marcarlo en ámbar al lado de
                un cambio de plantilla enseña a ignorar el ámbar.
              </p>

              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <label htmlFor="nota-version">
                    <Eyebrow>Nota de la versión</Eyebrow>
                  </label>
                  {maxNota !== undefined && nota.length > maxNota * 0.8 ? (
                    <span
                      className={cn(
                        "font-mono text-[10px] tabular-nums",
                        notaLarga ? "text-danger" : "text-ink-ghost",
                      )}
                    >
                      {nota.length}/{maxNota}
                    </span>
                  ) : null}
                </div>
                <Textarea
                  id="nota-version"
                  aria-invalid={notaLarga || undefined}
                  value={nota}
                  onChange={(e) => onNotaChange(e.target.value)}
                  rows={3}
                  placeholder="Por qué se hizo este cambio. Lo va a leer quien revise esta versión dentro de seis meses."
                  className="min-h-16 text-[11.5px]"
                />
              </div>

              {corridasVivas ? (
                <AvisoCorridasVivas corridas={corridasVivas} nueva={versionNueva} />
              ) : null}
            </div>
          </ScrollArea>

          {bloqueo || error ? (
            <p
              role={error ? "alert" : undefined}
              className={cn(
                "border-line-layout shrink-0 border-t px-4.5 pt-3 text-[11px] leading-relaxed text-pretty",
                error ? "text-danger" : "text-ink-dim",
              )}
            >
              {error ?? bloqueo}
            </p>
          ) : null}

          <div className="border-line-layout flex shrink-0 gap-2 border-t px-4.5 py-3.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onVolver}
              className={cn("shrink-0", TRANSICION_CONTROL, PRESION_TACTIL)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={onPublicar}
              disabled={apagado}
              aria-busy={publicando || undefined}
              title={sinCambios ? "No hay nada que publicar" : undefined}
              className={cn("flex-1", TRANSICION_CONTROL, PRESION_TACTIL)}
            >
              {publicando ? "Publicando…" : (etiquetaPublicar ?? `Publicar v${versionNueva}`)}
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}

/**
 * Las corridas vivas y en qué versión está cada tanda.
 *
 * Responde la pregunta que todo el mundo se hace antes de apretar: "¿se me
 * rompen las que están andando?". Se dice por versión porque no todas están en
 * la publicada —una corrida termina en la versión donde arrancó— y afirmar que
 * "siguen en v3" cuando algunas están en la v2 sería falso. Con cero corridas
 * vivas también se dice: que falte el aviso no se lee como "cero".
 */
function AvisoCorridasVivas({
  corridas,
  nueva,
}: {
  corridas: { total: number; porVersion: readonly CorridasDeVersion[] };
  nueva: number;
}) {
  if (corridas.total === 0) {
    return (
      <p className="text-ink-dim text-[11px] leading-relaxed text-pretty">
        No hay ninguna corrida en marcha. v{nueva} se aplica a las que arranquen desde ahora.
      </p>
    );
  }
  const unaSola = corridas.porVersion.length === 1 ? corridas.porVersion[0] : undefined;
  const cuantas =
    corridas.total === 1
      ? "La corrida en marcha sigue"
      : `Las ${corridas.total.toLocaleString("es-AR")} corridas en marcha siguen`;
  return (
    <div className="border-ok/30 bg-ok/10 flex flex-col gap-1.5 rounded-lg border p-3">
      <p className="text-ok text-[11.5px] leading-snug font-semibold text-pretty">
        {unaSola
          ? `${cuantas} en v${unaSola.version}`
          : `${cuantas} en la versión donde arrancaron`}
      </p>
      {unaSola ? null : (
        <ul className="flex flex-col gap-0.5">
          {corridas.porVersion.map((c) => (
            <li
              key={c.version}
              className="text-ink-body flex justify-between gap-2 font-mono text-[10.5px] tabular-nums"
            >
              <span>v{c.version}</span>
              <span>{c.cantidad.toLocaleString("es-AR")}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-ink-dim text-[11px] leading-relaxed text-pretty">
        Publicar nunca las mueve ni las rompe. Terminan en la versión donde arrancaron y v{nueva} se
        aplica sólo a las nuevas.
      </p>
    </div>
  );
}

/**
 * La leyenda de los tres colores, siempre visible en la barra.
 *
 * No es un tooltip ni un "¿qué significan estos colores?" plegado. Verde,
 * ámbar y rojo son el idioma del diff, pero quien no distingue rojo de verde
 * necesita el texto, y quien sí los distingue no pierde nada teniéndolo. Ocupa
 * 200 px de una barra que tiene de sobra.
 */
function LeyendaDiff() {
  const items: { clase: ClaseCambio; texto: string }[] = [
    { clase: "agregado", texto: "agregado" },
    { clase: "cambiado", texto: "cambiado" },
    { clase: "eliminado", texto: "eliminado" },
  ];
  return (
    <div className="flex items-center gap-3" role="list" aria-label="Qué significa cada color">
      {items.map((i) => (
        <span
          key={i.clase}
          role="listitem"
          className={cn("flex items-center gap-1.5 text-[11px] font-medium", CLASE_TEXTO[i.clase])}
        >
          <span aria-hidden className={cn("size-2 rounded-[2px]", CLASE_PUNTO[i.clase])} />
          {i.texto}
        </span>
      ))}
    </div>
  );
}
