"use client";

import { useMemo, useState, type ReactNode } from "react";
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
import { Eyebrow } from "@/components/shared/Eyebrow";
import type { WorkflowRunEstado } from "@/types/entities";
import type { Grafo } from "@/types/workflows";
import { EncuadreInicial } from "./EncuadreInicial";
import { BarraEditor, ChipEstado } from "./BarraEditor";
import { MEDIDAS, PRESION_TACTIL, TRANSICION_CONTROL, FOCO } from "./tokens-editor";
import { TIPOS_NODO_CORRIDA, type NodoCorridaFlow } from "./NodoCorrida";
import { CartelPlan, PreviaReanudacion } from "./PreviaReanudacion";
import {
  pasoFallado,
  planDeReanudacion,
  type EstadoPaso,
  type PasoCorrida,
  type PlanReanudacion,
  type PreviaReanudar,
  type PreviaRepetir,
} from "./corrida";
import type { ResolverNodo } from "./contrato-nodos";

interface DatosAristaCorrida extends Record<string, unknown> {
  recorrida: boolean;
  activa: boolean;
}
type AristaCorridaFlow = Edge<DatosAristaCorrida>;

/**
 * La arista de una corrida.
 *
 * Verde sólida por donde ya pasó, azul punteada y en movimiento por donde está
 * pasando, gris tenue por donde todavía no. El camino recorrido es la
 * información principal de esta pantalla: con una condición en el medio, saber
 * por cuál de las dos ramas se fue es la mitad de lo que uno viene a averiguar.
 *
 * La animación de la línea activa es una `stroke-dashoffset` en CSS, que corre
 * fuera del hilo principal. Con `prefers-reduced-motion` se detiene: la línea
 * sigue punteada y azul, o sea que la información —"está pasando por acá"—
 * no depende del movimiento.
 */
function AristaCorrida({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<AristaCorridaFlow>) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 10,
  });
  return (
    <BaseEdge
      path={path}
      className={cn(
        data?.activa
          ? "!stroke-info animate-[corrida-flujo_1s_linear_infinite] !stroke-2 [stroke-dasharray:5_4] motion-reduce:animate-none"
          : data?.recorrida
            ? "!stroke-ok !stroke-2"
            : "!stroke-line-card !stroke-[1.6]",
      )}
    />
  );
}

const TIPOS_ARISTA_CORRIDA = { corrida: AristaCorrida } as const;

/** Cómo está la suscripción en vivo. Se dice siempre: una pantalla "en vivo" congelada miente. */
export type EstadoConexion = "conectando" | "conectada" | "caida";

/**
 * Por dónde pasan las corridas de producción de la misma versión en los
 * últimos `dias` días (las de Probar no cuentan). Se dibuja sobre el lienzo:
 * un chip por bloque y el total junto al estado en vivo.
 */
export interface TraficoCorridas {
  corridas: number;
  /** De ésas, las que siguen corriendo o esperando. */
  vivas: number;
  /** Número de la versión, para decir de cuál son. */
  version: number;
  dias: number;
  /** Un bloque por el que no pasó ninguna no aparece. */
  nodos: ReadonlyArray<{ nodoId: string; corridas: number; fallaron: number; esperando: number }>;
}

export interface CorridaEnVivoProps {
  nombreFlujo: string;
  grafo: Grafo;
  pasos: readonly PasoCorrida[];
  resolver: ResolverNodo;
  /** `#a3f2 · Juan Pérez · v3`. Sale en mono: es un identificador. */
  identificacion: string;
  enVivo?: boolean;
  /** Corrida de "Probar": corrió con los efectos interceptados y no se relanza. */
  esPrueba?: boolean;
  /** Cuántos pasos como máximo puede dar una corrida. Es un tope real del motor. */
  topePasos?: number;
  /** Estado de la suscripción. Ausente = la pantalla no escucha cambios. */
  conexion?: EstadoConexion;
  /**
   * Estado de la corrida. Con la suscripción conectada, el cartel dice esto y
   * no "en vivo": una corrida terminada sigue escuchando —si se reanuda, los
   * pasos nuevos llegan solos— pero ya no está corriendo.
   */
  estado?: WorkflowRunEstado;
  volverEtiqueta?: string;
  onVolver: () => void;
  onCancelar?: () => void;
  /**
   * Las previas del servidor. Con una corrida fallada y alguna de las dos
   * posible, aparecen los dos botones; si ninguna se puede, se dice por qué.
   */
  reanudar?: PreviaReanudar;
  repetir?: PreviaRepetir;
  onReanudar?: () => void;
  onEjecutarDeNuevo?: () => void;
  /** Cuál de las dos acciones está en vuelo. */
  enCurso?: PlanReanudacion | null;
  /** Una franja debajo de la barra: el error de una acción, un aviso. */
  aviso?: ReactNode;
  /** Las otras corridas de la versión, dibujadas sobre el lienzo. */
  trafico?: TraficoCorridas;
}

/**
 * Una corrida, en vivo o terminada, dibujada sobre el mismo lienzo en el que se
 * editó el flujo.
 *
 * Que sea el mismo lienzo y las mismas tarjetas no es ahorro de código: es lo
 * que hace que quien armó el flujo reconozca lo que está mirando sin traducir.
 * Una vista de ejecución con otro layout obliga a mapear mentalmente "el
 * tercero de la lista" contra "el que estaba abajo a la izquierda".
 *
 * ## Y acá vive la memoización visible
 *
 * Cuando la corrida falló aparecen los dos botones de relanzar. Apuntar
 * cualquiera de los dos —con mouse o con teclado— **pinta el plan sobre este
 * lienzo antes de confirmar nada**: gris hundido con la hora en los pasos que
 * se reusan, color en los que van a volver a correr. Ver las dos imágenes es
 * lo que hace imposible confundir las dos acciones.
 */
export function CorridaEnVivo({
  nombreFlujo,
  grafo,
  pasos,
  resolver,
  identificacion,
  enVivo = false,
  esPrueba = false,
  topePasos,
  conexion,
  estado,
  volverEtiqueta = "Editor",
  onVolver,
  onCancelar,
  reanudar,
  repetir,
  onReanudar,
  onEjecutarDeNuevo,
  enCurso = null,
  aviso,
  trafico,
}: CorridaEnVivoProps) {
  const [plan, setPlan] = useState<PlanReanudacion | null>(null);
  const [pasoAbierto, setPasoAbierto] = useState<string | null>(null);

  const porNodo = useMemo(() => new Map(pasos.map((p) => [p.nodoId, p])), [pasos]);
  const mapaPlan = useMemo(
    () => (plan && reanudar ? planDeReanudacion(pasos, plan, reanudar) : null),
    [pasos, plan, reanudar],
  );
  const fallado = useMemo(() => pasoFallado(pasos), [pasos]);
  const ejecutados = useMemo(() => pasos.filter((p) => p.estado !== "pendiente").length, [pasos]);
  const traficoPorNodo = useMemo(
    () => new Map((trafico?.nodos ?? []).map((n) => [n.nodoId, n])),
    [trafico],
  );

  const nodos = useMemo<NodoCorridaFlow[]>(
    () =>
      grafo.nodos.map((n) => {
        const p = resolver(n);
        const paso = porNodo.get(n.id);
        const enPlan = mapaPlan?.get(n.id);
        const t = traficoPorNodo.get(n.id);
        return {
          id: n.id,
          type: "corrida",
          position: n.posicion,
          draggable: false,
          data: {
            nombre: p.nombre,
            categoria: p.categoria,
            icono: p.icono,
            resumen: p.resumen,
            salidas: p.salidas,
            sinEntrada: p.sinEntrada,
            paso: (paso?.estado ?? "pendiente") satisfies EstadoPaso,
            duracion: paso?.duracion,
            plan: enPlan?.accion,
            horaReuso: enPlan?.hora,
            ...(t
              ? { trafico: { corridas: t.corridas, fallaron: t.fallaron, esperando: t.esperando } }
              : {}),
          },
        };
      }),
    [grafo.nodos, porNodo, mapaPlan, resolver, traficoPorNodo],
  );

  const aristas = useMemo<AristaCorridaFlow[]>(
    () =>
      grafo.aristas.map((a, i) => {
        const origen = porNodo.get(a.desde);
        const destino = porNodo.get(a.hasta);
        return {
          id: `${a.desde}-${a.hasta}-${a.puerto}-${i}`,
          type: "corrida",
          source: a.desde,
          target: a.hasta,
          sourceHandle: a.puerto === "salida" ? undefined : a.puerto,
          data: {
            // El destino tiene que haber corrido: la lista trae también los
            // pendientes, y sin esto la rama que no se tomó salía verde.
            recorrida:
              origen?.estado === "completado" &&
              destino !== undefined &&
              destino.estado !== "pendiente",
            activa: origen?.estado === "completado" && destino?.estado === "activo",
          },
        };
      }),
    [grafo.aristas, porNodo],
  );

  return (
    <div className="bg-surface-root flex h-full flex-col">
      {/* La animación del trazo vive acá y no en `globals.css` porque es de esta
          pantalla y de ninguna otra. Corre en el compositor y no toca layout. */}
      <style>{`@keyframes corrida-flujo{to{stroke-dashoffset:-18}}`}</style>

      <BarraEditor
        titulo={nombreFlujo}
        onVolver={onVolver}
        volverEtiqueta={volverEtiqueta}
        contexto={
          <>
            {enVivo ? <ChipEstado tono="info">corrida en vivo</ChipEstado> : null}
            {esPrueba ? <ChipEstado tono="aviso">corrida de prueba</ChipEstado> : null}
            <span className="text-ink-secondary shrink-0 font-mono text-[11.5px] tabular-nums">
              {identificacion}
            </span>
          </>
        }
        acciones={
          fallado &&
          reanudar &&
          repetir &&
          onReanudar &&
          onEjecutarDeNuevo &&
          (reanudar.posible || repetir.posible) ? (
            <PreviaReanudacion
              reanudar={reanudar}
              repetir={repetir}
              planPrevisualizado={plan}
              onPrevisualizar={setPlan}
              onReanudar={onReanudar}
              onEjecutarDeNuevo={onEjecutarDeNuevo}
              enCurso={enCurso}
            />
          ) : fallado && reanudar && !reanudar.posible ? (
            // Ninguna de las dos se puede: se dice por qué en lugar de dejar
            // la barra muda sobre una corrida que falló.
            <span className="text-ink-dim max-w-[420px] text-right text-[11.5px] leading-snug text-pretty">
              {reanudar.motivo}
            </span>
          ) : onCancelar ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancelar}
              className={cn("text-danger", TRANSICION_CONTROL, PRESION_TACTIL)}
            >
              Cancelar corrida
            </Button>
          ) : null
        }
      />

      {aviso}

      <div className="flex min-h-0 flex-1">
        <div className="bg-surface-root relative min-w-0 flex-1">
          <ReactFlowProvider>
            <ReactFlow<NodoCorridaFlow, AristaCorridaFlow>
              nodes={nodos}
              edges={aristas}
              nodeTypes={TIPOS_NODO_CORRIDA}
              edgeTypes={TIPOS_ARISTA_CORRIDA}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              onlyRenderVisibleElements
              minZoom={0.3}
              maxZoom={1.5}
              // El encuadre al abrir lo hace `<EncuadreInicial>`: la prop
              // `fitView` sólo cuenta los nodos ya medidos.
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={18}
                size={1}
                className="!text-line-layout"
              />
              <EncuadreInicial />
            </ReactFlow>
          </ReactFlowProvider>

          {plan && reanudar && repetir ? (
            <CartelPlan
              plan={plan}
              reanudar={reanudar}
              repetir={repetir}
              className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2"
            />
          ) : conexion || trafico ? (
            <IndicadorConexion
              conexion={conexion}
              estado={estado}
              detalle={trafico ? textoTrafico(trafico) : undefined}
              className="absolute top-4 right-4"
            />
          ) : null}
        </div>

        <aside
          style={{ width: MEDIDAS.PANEL_LATERAL }}
          aria-label="Pasos de la corrida"
          className="border-line-layout bg-surface-panel flex shrink-0 flex-col border-l"
        >
          <div className="border-line-layout flex shrink-0 flex-col gap-1.5 border-b px-4.5 py-3.5">
            <h2 className="text-ink-primary text-[13px] leading-none font-semibold">
              Pasos de la corrida
            </h2>
            <span className="text-ink-ghost font-mono text-[10.5px] tabular-nums">
              {ejecutados} de {pasos.length}
              {topePasos ? ` · tope ${topePasos.toLocaleString("es-AR")} pasos` : ""}
            </span>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-1 px-4.5 py-3.5">
              {pasos.map((p) => (
                <FilaPaso
                  key={p.nodoId}
                  paso={p}
                  abierto={pasoAbierto === p.nodoId}
                  planAccion={mapaPlan?.get(p.nodoId)?.accion}
                  horaReuso={mapaPlan?.get(p.nodoId)?.hora}
                  onAlternar={() =>
                    setPasoAbierto((actual) => (actual === p.nodoId ? null : p.nodoId))
                  }
                />
              ))}
            </div>
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
}

const TEXTO_CONEXION: Record<EstadoConexion, string> = {
  conectando: "Conectando en vivo…",
  conectada: "En vivo: cada paso aparece al terminar",
  caida: "Sin conexión en vivo: recargá para ver lo último",
};

/** Con la suscripción al día, lo que importa es en qué quedó la corrida. */
const TEXTO_ESTADO: Record<WorkflowRunEstado, string> = {
  corriendo: TEXTO_CONEXION.conectada,
  esperando: "En vivo: la corrida espera para seguir",
  terminado: "Terminó: no quedan pasos por correr",
  fallado: "Falló: si la reanudan, los pasos nuevos aparecen acá",
  cancelado: "Cancelada: no va a correr más",
};

function textoConexion(conexion: EstadoConexion, estado?: WorkflowRunEstado): string {
  return conexion === "conectada" && estado ? TEXTO_ESTADO[estado] : TEXTO_CONEXION[conexion];
}

/** Terminada, fallada o cancelada: nada se mueve, aunque se siga escuchando. */
function estaQuieta(estado?: WorkflowRunEstado): boolean {
  return estado === "terminado" || estado === "fallado" || estado === "cancelado";
}

/** "42 corridas de v3 en 30 días · 3 en marcha": lo que suman los chips de los bloques. */
function textoTrafico(t: TraficoCorridas): string {
  if (t.corridas === 0) return `Ninguna otra corrida de v${t.version} en ${t.dias} días`;
  const total = `${t.corridas.toLocaleString("es-AR")} ${t.corridas === 1 ? "corrida" : "corridas"}`;
  return `${total} de v${t.version} en ${t.dias} días · ${t.vivas.toLocaleString("es-AR")} en marcha`;
}

/**
 * Si lo que se ve está vivo o congelado, y cuántas corridas suman los chips de
 * los bloques.
 *
 * Una pantalla que se llama "en vivo" y dejó de recibir cambios sin avisar es
 * peor que una estática: se mira un fallo que ya se reanudó. Por eso el estado
 * de la suscripción se dice siempre, con palabra y no sólo con el punto.
 */
function IndicadorConexion({
  conexion,
  estado,
  detalle,
  className,
}: {
  conexion?: EstadoConexion;
  estado?: WorkflowRunEstado;
  detalle?: string;
  className?: string;
}) {
  const quieta = conexion === "conectada" && estaQuieta(estado);
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "border-line-card bg-surface-elevated flex items-center gap-2 rounded-lg border px-3 py-2 shadow-sm",
        className,
      )}
    >
      {conexion ? (
        <>
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              conexion === "conectada" && (quieta ? "bg-line-dot" : "bg-ok"),
              conexion === "conectando" && "bg-info animate-pulse-dot motion-reduce:animate-none",
              conexion === "caida" && "bg-danger",
            )}
          />
          <span className="text-ink-secondary text-[11px] leading-none font-medium">
            {textoConexion(conexion, estado)}
          </span>
        </>
      ) : null}
      {conexion && detalle ? <span aria-hidden className="bg-line-card h-3 w-px shrink-0" /> : null}
      {detalle ? (
        <span className="text-ink-dim text-[11px] leading-none tabular-nums">{detalle}</span>
      ) : null}
    </div>
  );
}

const PUNTO_PASO: Record<EstadoPaso, string> = {
  completado: "bg-ok",
  saltado: "bg-special",
  activo: "bg-info animate-pulse-dot motion-reduce:animate-none",
  fallado: "bg-danger",
  pendiente: "bg-line-dot",
};

const ETIQUETA_PASO: Record<EstadoPaso, string> = {
  completado: "terminó bien",
  saltado: "un tope saltó el mensaje y el lead salió del flujo",
  activo: "en curso",
  fallado: "falló",
  pendiente: "todavía no llegó acá",
};

/**
 * Una fila de la lista de pasos. Se despliega para mostrar entrada y salida.
 *
 * Entrada y salida en Geist Mono y como pares clave–valor, no como JSON con
 * llaves. `error: 132015` se escanea; `{"error":132015}` hay que leerlo.
 *
 * Cuando hay un plan previsualizado, la fila lo dice también acá: el lienzo
 * muestra la forma y la lista muestra el detalle, y las dos coinciden. Si sólo
 * lo dijera el lienzo, quien está mirando la lista no vería el cambio.
 */
function FilaPaso({
  paso,
  abierto,
  planAccion,
  horaReuso,
  onAlternar,
}: {
  paso: PasoCorrida;
  abierto: boolean;
  planAccion?: "reusa" | "recorre" | "no_alcanzado";
  horaReuso?: string;
  onAlternar: () => void;
}) {
  const tieneDetalle = Boolean(paso.entrada || paso.salida);

  return (
    <div className="border-line-row flex flex-col gap-1 border-b pb-2 last:border-b-0">
      <button
        type="button"
        onClick={tieneDetalle ? onAlternar : undefined}
        aria-expanded={tieneDetalle ? abierto : undefined}
        disabled={!tieneDetalle}
        className={cn(
          "flex items-center gap-2.5 rounded-md px-1 py-2 text-left",
          tieneDetalle && "hover:bg-surface-hover cursor-pointer",
          TRANSICION_CONTROL,
          FOCO,
        )}
      >
        <span
          aria-hidden
          className={cn("size-1.5 shrink-0 rounded-full", PUNTO_PASO[paso.estado])}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[11.5px] leading-tight font-medium",
            paso.estado === "pendiente" ? "text-ink-ghost" : "text-ink-body",
          )}
        >
          {paso.nombre}
          <span className="sr-only"> — {ETIQUETA_PASO[paso.estado]}</span>
        </span>
        {paso.hora ? (
          <span className="text-ink-ghost shrink-0 font-mono text-[10px] tabular-nums">
            {paso.hora}
          </span>
        ) : null}
        {paso.duracion ? (
          <span className="text-ink-faint shrink-0 font-mono text-[10px] tabular-nums">
            {paso.duracion}
          </span>
        ) : null}
      </button>

      {planAccion && planAccion !== "no_alcanzado" ? (
        <span
          className={cn(
            "pl-4 font-mono text-[9.5px] leading-tight",
            planAccion === "reusa" ? "text-ink-ghost" : "text-brand",
          )}
        >
          {planAccion === "reusa"
            ? `se reusa el resultado${horaReuso ? ` de las ${horaReuso}` : " guardado"}`
            : "vuelve a correr"}
        </span>
      ) : null}

      {abierto && tieneDetalle ? (
        <div className="flex flex-col gap-2 pl-4">
          {paso.entrada ? <BloqueDatos titulo="Entrada" datos={paso.entrada} /> : null}
          {paso.salida ? (
            <BloqueDatos
              titulo="Salida"
              datos={paso.salida}
              tono={paso.estado === "fallado" ? "error" : "normal"}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function BloqueDatos({
  titulo,
  datos,
  tono = "normal",
}: {
  titulo: string;
  datos: Readonly<Record<string, string>>;
  tono?: "normal" | "error";
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border p-2.5",
        tono === "error" ? "border-danger/30 bg-danger/10" : "border-line-card bg-surface-card",
      )}
    >
      <Eyebrow className={tono === "error" ? "text-danger" : undefined}>{titulo}</Eyebrow>
      <dl className="flex flex-col gap-1">
        {Object.entries(datos).map(([k, v]) => (
          <div key={k} className="flex items-baseline gap-2">
            <dt className="text-ink-ghost shrink-0 font-mono text-[10px]">{k}</dt>
            <dd className="text-ink-body min-w-0 flex-1 font-mono text-[10.5px] break-words">
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
