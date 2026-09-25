"use client";

import { useState } from "react";
import { InitialsAvatar } from "@/components/shared/InitialsAvatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { COLOR_RUTA, ETIQUETA_RUTA } from "./paleta";
import { formatearEntero } from "./formato";
import { Cifra, Nota } from "./primitivas";
import type { DiffContraAnterior, Destinatario } from "./tipos";

type FiltroDiff = "todos" | "nuevo" | "repite";

const FILTROS: { clave: FiltroDiff; etiqueta: string }[] = [
  { clave: "todos", etiqueta: "Todos" },
  { clave: "nuevo", etiqueta: "Solo nuevos" },
  { clave: "repite", etiqueta: "Solo los que repiten" },
];

/**
 * La lista exacta, uno por uno, en el orden en que salen.
 *
 * Llega por páginas del servidor: "Cargar más" pide la siguiente. El diff
 * contra el envío anterior está arriba y filtra lo cargado; sus cifras son las
 * de la lista entera.
 */
export function ListaDestinatarios({
  destinatarios,
  total,
  diff,
  onCargarMas,
  cargando,
}: {
  /** Lo cargado hasta ahora. Puede ser menos que `total`. */
  destinatarios: readonly Destinatario[];
  total: number;
  /** `null` = no hay un envío anterior con qué comparar. */
  diff: DiffContraAnterior | null;
  /** `null` = no hay más páginas que pedir. */
  onCargarMas: (() => void) | null;
  cargando: boolean;
}) {
  const [filtro, setFiltro] = useState<FiltroDiff>("todos");
  const visibles =
    filtro === "todos" ? destinatarios : destinatarios.filter((d) => d.diff === filtro);
  const faltan = Math.max(0, total - destinatarios.length);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1.5">
        <span className="text-ink-faint font-mono text-[9px] font-semibold tracking-[0.13em] uppercase">
          Destinatarios
        </span>
        <div className="flex items-baseline gap-2">
          <Cifra valor={formatearEntero(total)} tamano="xl" />
          <span className="text-ink-faint text-[12px]">leads, uno por uno</span>
        </div>
      </div>

      {diff ? (
        <div className="bg-surface-input flex flex-col gap-2.5 rounded-[11px] px-3 py-2.5">
          <span className="text-ink-dim text-[11.5px]">
            Contra <span className="text-ink-primary font-medium">{diff.referencia.nombre}</span>,
            el envío anterior
          </span>
          <div
            role="group"
            aria-label="Filtrar por diferencia con el envío anterior"
            className="flex flex-wrap gap-1.5"
          >
            {FILTROS.map((f) => {
              const n =
                f.clave === "todos"
                  ? diff.nuevos + diff.repiten
                  : f.clave === "nuevo"
                    ? diff.nuevos
                    : diff.repiten;
              const activo = filtro === f.clave;
              return (
                <button
                  key={f.clave}
                  type="button"
                  aria-pressed={activo}
                  onClick={() => setFiltro(f.clave)}
                  className={cn(
                    "focus-visible:ring-ring/50 inline-flex min-h-[26px] items-center gap-1.5 rounded-[20px] border px-2.5 py-1 text-[11.5px] font-[550] transition-colors duration-150 focus-visible:ring-3 focus-visible:outline-none",
                    activo
                      ? "bg-surface-avatar border-line-control text-ink-primary"
                      : "border-line-card text-ink-dim hover:text-ink-secondary",
                  )}
                >
                  {f.etiqueta}
                  <span className="font-mono tabular-nums">{formatearEntero(n)}</span>
                </button>
              );
            })}
            <span className="text-ink-ghost inline-flex items-center gap-1.5 px-1 text-[11.5px]">
              <span className="font-mono tabular-nums">{formatearEntero(diff.yaNoCalifican)}</span>{" "}
              ya no califican
            </span>
          </div>
        </div>
      ) : (
        <Nota>No hay un envío anterior con qué comparar esta lista.</Nota>
      )}

      <ul className="border-line-row flex max-h-[268px] flex-col overflow-auto rounded-[11px] border">
        {visibles.map((d, i) => (
          <li
            key={d.leadId}
            className={cn(
              "flex min-h-[44px] items-center gap-2.5 px-3 py-2",
              i > 0 && "border-line-row border-t",
            )}
          >
            <InitialsAvatar nombre={d.nombre || "?"} size={26} />
            <span className="min-w-0 flex-1">
              <span className="text-ink-primary block truncate text-[11.5px] font-medium">
                {d.nombre || "Sin nombre"}
              </span>
              <span className="text-ink-ghost block truncate font-mono text-[10px]">
                {d.telefono}
                {d.vehiculo ? ` · ${d.vehiculo}` : ""}
              </span>
            </span>
            {d.diff === "nuevo" ? (
              <span className="text-ok shrink-0 font-mono text-[9.5px] font-semibold">nuevo</span>
            ) : null}
            {d.tanda > 0 ? (
              <span className="text-ink-faint shrink-0 font-mono text-[9.5px]">
                tanda {d.tanda + 1}
              </span>
            ) : null}
            <span
              className="w-[86px] shrink-0 text-right font-mono text-[9.5px] font-medium"
              style={{ color: COLOR_RUTA[d.ruta] }}
            >
              {ETIQUETA_RUTA[d.ruta]}
            </span>
          </li>
        ))}
        {visibles.length === 0 ? (
          <li className="text-ink-ghost px-3 py-6 text-center text-[11.5px]">
            Ningún destinatario cargado en este corte.
          </li>
        ) : null}
      </ul>

      {faltan > 0 ? (
        <div className="flex items-center justify-between gap-3">
          <Nota>
            Se muestran {formatearEntero(destinatarios.length)} de {formatearEntero(total)}
            {filtro === "todos" ? "." : ": el filtro aplica a los cargados."}
          </Nota>
          {onCargarMas ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onCargarMas}
              disabled={cargando}
              aria-busy={cargando || undefined}
              className="shrink-0"
            >
              {cargando ? "Cargando…" : "Cargar más"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
