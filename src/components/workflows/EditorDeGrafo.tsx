"use client";

import { useMemo, useState, useTransition } from "react";
import { CAMPOS_CONDICION, OPERADORES } from "@/lib/workflows/condiciones";
import {
  ACCIONES,
  DISPARADORES,
  ETIQUETA_ACCION,
  ETIQUETA_DISPARADOR,
  ETIQUETA_NODO,
  ETIQUETA_PUERTO,
} from "@/lib/workflows/catalogo";
import { validarGrafo } from "@/lib/workflows/validar-grafo";
import { PasosDelGrafo } from "./PasosDelGrafo";
import { ProblemasDelGrafo } from "./ProblemasDelGrafo";
import { ETAPAS_EMBUDO } from "@/types/domain";
import { NODO_TIPOS, PUERTOS } from "@/types/workflows";
import type { ActionResult } from "@/types/inbox";
import type { Grafo, Nodo, NodoTipo, Puerto } from "@/types/workflows";

/**
 * Arma el flujo por formulario. Sin lienzo y sin arrastrar.
 *
 * `Nodo.posicion` existe en el dominio para un canvas que todavía no está
 * hecho — el propio tipo lo dice: "Sólo para el canvas de W5. El motor la
 * ignora". Acá se guarda un valor calculado y no se edita: escribir un canvas
 * antes de tener la pantalla simple andando es empezar por el final.
 *
 * La validación corre **en el cliente mientras se edita**, con la misma
 * `validarGrafo()` que el servidor usa para aceptar o rechazar. No es una
 * segunda implementación: es la misma función, que vive en `lib/` justamente
 * para poder correr de los dos lados. El servidor sigue siendo el que decide.
 */

const ETIQUETA_CAMPO: Record<string, string> = {
  "lead.etapa": "Etapa del lead",
  "lead.nombre": "Nombre del lead",
  "lead.canal": "Canal",
  "sesion.respondio": "Respondió",
  "sesion.tiene_cotizacion": "Tiene cotización",
};

/** Config inicial de cada tipo, con los valores que el motor sabe leer. */
function configPorDefecto(tipo: NodoTipo): Record<string, unknown> {
  switch (tipo) {
    case "disparador":
      return { disparador: DISPARADORES[0] };
    case "accion":
      return { accion: ACCIONES[0], texto: "" };
    case "condicion":
      return { campo: CAMPOS_CONDICION[0], operador: OPERADORES[0], valor: "" };
    case "espera":
      // 60 es el mismo default que aplica `minutosDeEspera()` en el ejecutor
      // cuando la config no trae un número: acá se hace explícito.
      return { minutos: 60 };
    case "fin":
      return {};
  }
}

export function EditorDeGrafo({
  workflowId,
  grafoInicial,
  maxPasosInicial,
  tags,
  puedeEditar,
  onGuardar,
}: {
  workflowId: string;
  grafoInicial: Grafo;
  maxPasosInicial: number;
  tags: ReadonlyArray<{ id: string; nombre: string }>;
  puedeEditar: boolean;
  /** Llega por prop: `components/**` no puede importar actions de `app/**`. */
  onGuardar: (input: {
    workflowId: string;
    grafo: Grafo;
    maxPasos: number;
  }) => Promise<ActionResult>;
}) {
  const [grafo, setGrafo] = useState<Grafo>(grafoInicial);
  const [maxPasos, setMaxPasos] = useState(maxPasosInicial);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [guardando, startGuardar] = useTransition();

  const problemas = useMemo(() => validarGrafo(grafo), [grafo]);
  const sano = problemas.length === 0 && grafo.nodos.length > 0;

  const agregarNodo = (tipo: NodoTipo) => {
    // Id legible y estable. Se numera por tipo para que la lista de aristas
    // se pueda leer sin tener que abrir cada nodo.
    let n = 1;
    while (grafo.nodos.some((x) => x.id === `${tipo}-${n}`)) n += 1;
    const nuevo: Nodo = {
      id: `${tipo}-${n}`,
      tipo,
      config: configPorDefecto(tipo),
      posicion: { x: grafo.nodos.length * 160, y: 0 },
    };
    setGrafo((g) => ({ ...g, nodos: [...g.nodos, nuevo] }));
  };

  const borrarNodo = (id: string) => {
    // Las aristas que lo tocaban se van con él: dejarlas convierte el grafo en
    // uno con `arista_a_nodo_inexistente`, que es un error que el usuario no
    // provocó a propósito.
    setGrafo((g) => ({
      nodos: g.nodos.filter((n) => n.id !== id),
      aristas: g.aristas.filter((a) => a.desde !== id && a.hasta !== id),
    }));
  };

  const cambiarConfig = (id: string, patch: Record<string, unknown>) => {
    setGrafo((g) => ({
      ...g,
      nodos: g.nodos.map((n) => (n.id === id ? { ...n, config: { ...n.config, ...patch } } : n)),
    }));
  };

  const agregarArista = (desde: string, hasta: string, puerto: Puerto) => {
    if (!desde || !hasta) return;
    const yaEsta = grafo.aristas.some(
      (a) => a.desde === desde && a.hasta === hasta && a.puerto === puerto,
    );
    if (yaEsta) return;
    setGrafo((g) => ({ ...g, aristas: [...g.aristas, { desde, hasta, puerto }] }));
  };

  const borrarArista = (i: number) => {
    setGrafo((g) => ({ ...g, aristas: g.aristas.filter((_, k) => k !== i) }));
  };

  const guardar = () => {
    setMensaje(null);
    startGuardar(async () => {
      const r = await onGuardar({ workflowId, grafo, maxPasos });
      setMensaje(
        r.ok
          ? { ok: true, texto: "Versión guardada. Publicala para que empiece a correr." }
          : { ok: false, texto: r.error },
      );
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="border-line-layout bg-surface-panel rounded-[11px] border p-4">
        <h2 className="text-ink-primary mb-3 text-[13px] font-[680]">Cómo queda el flujo</h2>
        <PasosDelGrafo grafo={grafo} />
      </section>

      <section className="border-line-layout bg-surface-panel rounded-[11px] border p-4">
        <h2 className="text-ink-primary mb-2 text-[13px] font-[680]">Revisión</h2>
        <ProblemasDelGrafo problemas={problemas} />
      </section>

      {!puedeEditar ? (
        <p className="text-ink-faint text-[12px]">
          Solo un administrador puede modificar un flujo. Esto es de lectura.
        </p>
      ) : (
        <>
          <section className="border-line-layout bg-surface-panel rounded-[11px] border p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-ink-primary mr-2 text-[13px] font-[680]">Pasos</h2>
              {NODO_TIPOS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => agregarNodo(t)}
                  className="border-line-control text-ink-secondary hover:bg-surface-hover rounded-[9px] border px-2.5 py-1 text-[11.5px] font-semibold transition-colors"
                >
                  + {ETIQUETA_NODO[t] ?? t}
                </button>
              ))}
            </div>

            {grafo.nodos.length === 0 ? (
              <p className="text-ink-faint text-[12px]">
                Empezá agregando un disparador: es lo que hace arrancar el flujo.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {grafo.nodos.map((n) => (
                  <li
                    key={n.id}
                    className="border-line-control flex flex-wrap items-center gap-2 rounded-[9px] border px-3 py-2"
                  >
                    <span className="text-ink-primary min-w-[104px] text-[12px] font-semibold">
                      {ETIQUETA_NODO[n.tipo] ?? n.tipo}
                    </span>
                    <span className="text-ink-faint font-mono text-[11px]">{n.id}</span>
                    <CamposDeNodo nodo={n} tags={tags} onChange={(p) => cambiarConfig(n.id, p)} />
                    <button
                      type="button"
                      onClick={() => borrarNodo(n.id)}
                      className="text-ink-faint ml-auto text-[11.5px] hover:text-red-600"
                    >
                      Borrar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="border-line-layout bg-surface-panel rounded-[11px] border p-4">
            <h2 className="text-ink-primary mb-3 text-[13px] font-[680]">Conexiones</h2>
            <NuevaArista nodos={grafo.nodos} onAgregar={agregarArista} />
            {grafo.aristas.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-1.5">
                {grafo.aristas.map((a, i) => (
                  <li
                    key={`${a.desde}-${a.hasta}-${a.puerto}-${i}`}
                    className="flex items-center gap-2 text-[11.5px]"
                  >
                    <span className="text-ink-primary font-mono">{a.desde}</span>
                    <span className="text-ink-faint">
                      —{ETIQUETA_PUERTO[a.puerto] ?? a.puerto}→
                    </span>
                    <span className="text-ink-primary font-mono">{a.hasta}</span>
                    <button
                      type="button"
                      onClick={() => borrarArista(i)}
                      className="text-ink-faint ml-2 hover:text-red-600"
                    >
                      quitar
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="border-line-layout bg-surface-panel flex flex-wrap items-center gap-3 rounded-[11px] border p-4">
            <label className="text-ink-secondary flex items-center gap-2 text-[12px]">
              Tope de pasos por corrida
              <input
                type="number"
                min={1}
                max={500}
                value={maxPasos}
                onChange={(e) => setMaxPasos(Number(e.target.value))}
                className="border-line-control bg-surface-root text-ink-primary w-20 rounded-[9px] border px-2 py-1 text-[12px]"
              />
            </label>
            <span className="text-ink-faint text-[11px]">
              Es el freno: sin tope, un ciclo con espera manda mensajes para siempre.
            </span>

            <button
              type="button"
              onClick={guardar}
              disabled={guardando || !sano}
              className="ml-auto rounded-[9px] bg-emerald-600 px-3 py-1.5 text-[11.5px] font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {guardando ? "Guardando…" : "Guardar versión"}
            </button>
          </section>

          {mensaje ? (
            <p
              role="status"
              className={`text-[12px] ${mensaje.ok ? "text-emerald-600 dark:text-emerald-500" : "text-red-600 dark:text-red-400"}`}
            >
              {mensaje.texto}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Los campos que el motor sabe leer para cada tipo de nodo. */
function CamposDeNodo({
  nodo,
  tags,
  onChange,
}: {
  nodo: Nodo;
  tags: ReadonlyArray<{ id: string; nombre: string }>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const select =
    "border-line-control bg-surface-root text-ink-primary rounded-[9px] border px-2 py-1 text-[11.5px]";

  if (nodo.tipo === "disparador") {
    return (
      <select
        aria-label="Qué dispara el flujo"
        className={select}
        value={String(nodo.config["disparador"] ?? "")}
        onChange={(e) => onChange({ disparador: e.target.value })}
      >
        {DISPARADORES.map((d) => (
          <option key={d} value={d}>
            {ETIQUETA_DISPARADOR[d]}
          </option>
        ))}
      </select>
    );
  }

  if (nodo.tipo === "accion") {
    const accion = String(nodo.config["accion"] ?? "");
    return (
      <>
        <select
          aria-label="Qué acción"
          className={select}
          value={accion}
          onChange={(e) => onChange({ accion: e.target.value })}
        >
          {ACCIONES.map((a) => (
            <option key={a} value={a}>
              {ETIQUETA_ACCION[a]}
            </option>
          ))}
        </select>

        {accion === "enviar_mensaje" ? (
          <input
            aria-label="Texto del mensaje"
            placeholder="Texto del mensaje"
            className={`${select} min-w-[220px] flex-1`}
            value={String(nodo.config["texto"] ?? "")}
            onChange={(e) => onChange({ texto: e.target.value })}
          />
        ) : null}

        {accion === "poner_etiqueta" ? (
          <select
            aria-label="Qué etiqueta"
            className={select}
            value={String(nodo.config["tagId"] ?? "")}
            onChange={(e) => onChange({ tagId: e.target.value })}
          >
            <option value="">— elegí una etiqueta —</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </select>
        ) : null}

        {accion === "cambiar_etapa" ? (
          <select
            aria-label="A qué etapa"
            className={select}
            value={String(nodo.config["etapa"] ?? "")}
            onChange={(e) => onChange({ etapa: e.target.value })}
          >
            <option value="">— elegí una etapa —</option>
            {ETAPAS_EMBUDO.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        ) : null}
      </>
    );
  }

  if (nodo.tipo === "condicion") {
    return (
      <>
        <select
          aria-label="Qué mira la condición"
          className={select}
          value={String(nodo.config["campo"] ?? "")}
          onChange={(e) => onChange({ campo: e.target.value })}
        >
          {CAMPOS_CONDICION.map((c) => (
            <option key={c} value={c}>
              {ETIQUETA_CAMPO[c] ?? c}
            </option>
          ))}
        </select>
        <select
          aria-label="Operador"
          className={select}
          value={String(nodo.config["operador"] ?? "")}
          onChange={(e) => onChange({ operador: e.target.value })}
        >
          {OPERADORES.map((o) => (
            <option key={o} value={o}>
              {o.replace("_", " ")}
            </option>
          ))}
        </select>
        <input
          aria-label="Valor a comparar"
          placeholder="valor"
          className={`${select} w-32`}
          value={String(nodo.config["valor"] ?? "")}
          onChange={(e) => onChange({ valor: e.target.value })}
        />
      </>
    );
  }

  if (nodo.tipo === "espera") {
    return (
      <label className="text-ink-secondary flex items-center gap-1.5 text-[11.5px]">
        <input
          type="number"
          min={1}
          aria-label="Minutos de espera"
          className={`${select} w-20`}
          value={Number(nodo.config["minutos"] ?? 60)}
          onChange={(e) => onChange({ minutos: Number(e.target.value) })}
        />
        minutos
      </label>
    );
  }

  return null;
}

/** El formulario para conectar dos pasos. */
function NuevaArista({
  nodos,
  onAgregar,
}: {
  nodos: readonly Nodo[];
  onAgregar: (desde: string, hasta: string, puerto: Puerto) => void;
}) {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [puerto, setPuerto] = useState<Puerto>("salida");
  const select =
    "border-line-control bg-surface-root text-ink-primary rounded-[9px] border px-2 py-1 text-[11.5px]";

  if (nodos.length < 2) {
    return (
      <p className="text-ink-faint text-[12px]">
        Hacen falta al menos dos pasos para poder conectarlos.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Desde"
        className={select}
        value={desde}
        onChange={(e) => setDesde(e.target.value)}
      >
        <option value="">desde…</option>
        {nodos.map((n) => (
          <option key={n.id} value={n.id}>
            {n.id}
          </option>
        ))}
      </select>
      <select
        aria-label="Puerto"
        className={select}
        value={puerto}
        onChange={(e) => setPuerto(e.target.value as Puerto)}
      >
        {PUERTOS.map((p) => (
          <option key={p} value={p}>
            {ETIQUETA_PUERTO[p] ?? p}
          </option>
        ))}
      </select>
      <select
        aria-label="Hasta"
        className={select}
        value={hasta}
        onChange={(e) => setHasta(e.target.value)}
      >
        <option value="">hasta…</option>
        {nodos.map((n) => (
          <option key={n.id} value={n.id}>
            {n.id}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => {
          onAgregar(desde, hasta, puerto);
          setDesde("");
          setHasta("");
        }}
        disabled={!desde || !hasta}
        className="border-line-control text-ink-secondary hover:bg-surface-hover rounded-[9px] border px-2.5 py-1 text-[11.5px] font-semibold transition-colors disabled:opacity-40"
      >
        Conectar
      </button>
    </div>
  );
}
