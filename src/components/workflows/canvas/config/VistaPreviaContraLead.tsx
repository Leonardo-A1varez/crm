"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { SearchIcon } from "@/components/icons";
import { FOCO, TRANSICION_CONTROL } from "@/lib/ui/motion";
import { estadoVentana, restanteLegible } from "@/lib/ventana";
import { interpolarVariables, type DatosInterpolacion } from "@/lib/workflows/variables";
import { VARIABLES_DISPONIBLES } from "./VariableSelector";
import type { LeadListItem } from "@/types/leads";

/** Lo que devuelve la lectura del lead. Es el `VistaPreviaMensaje` del servicio. */
export interface DatosVistaPrevia {
  datos: Pick<DatosInterpolacion, "lead" | "sesion" | "vendedor">;
  ventana: { canal: string; ultimoEntranteAt: string | null } | null;
}

export type BuscarLeadsFn = (
  raw: unknown,
) => Promise<{ ok: true; items: LeadListItem[] } | { ok: false; error: string }>;

export type LeerVistaPreviaFn = (
  raw: unknown,
) => Promise<{ ok: true; data: DatosVistaPrevia } | { ok: false; error: string }>;

const CORTO: ReadonlyMap<string, string> = new Map(
  VARIABLES_DISPONIBLES.map((v) => [v.key, v.corto]),
);

function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  return (partes[0]?.[0] ?? "?").toUpperCase() + (partes[1]?.[0] ?? "").toUpperCase();
}

/**
 * La vista previa de «Enviar mensaje» contra un lead real.
 *
 * Las variables se resuelven con `interpolarVariables`, el mismo que usa el
 * motor, sobre los datos que el motor cargaría para ese lead. Debajo va la
 * ventana de 24 h de su conversación, medida desde su último mensaje: fuera
 * de ella el motor no manda texto libre y salta el paso (`sin_ventana`).
 *
 * La ventana se mide contra la hora en que se leyó el lead, y lo dice: no es
 * un reloj que corre, es una foto.
 */
export function VistaPreviaContraLead({
  mensaje,
  onBuscarLeads,
  onLeer,
}: {
  mensaje: string;
  onBuscarLeads: BuscarLeadsFn;
  onLeer: LeerVistaPreviaFn;
}) {
  const [query, setQuery] = useState("");
  const [resultados, setResultados] = useState<LeadListItem[]>([]);
  const [lead, setLead] = useState<LeadListItem | null>(null);
  const [lectura, setLectura] = useState<{ datos: DatosVistaPrevia; a: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buscando, startBuscar] = useTransition();
  const [leyendo, startLeer] = useTransition();

  useEffect(() => {
    if (lead || query.trim().length === 0) return;
    const id = setTimeout(() => {
      startBuscar(async () => {
        const r = await onBuscarLeads({ q: query.trim() });
        setResultados(r.ok ? r.items : []);
      });
    }, 300);
    return () => clearTimeout(id);
  }, [query, lead, onBuscarLeads]);

  const elegir = (item: LeadListItem) => {
    setLead(item);
    setError(null);
    setLectura(null);
    startLeer(async () => {
      const r = await onLeer({ leadId: item.leadId });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setLectura({ datos: r.data, a: Date.now() });
    });
  };

  const cambiar = () => {
    setLead(null);
    setLectura(null);
    setError(null);
  };

  return (
    <section aria-labelledby="vista-previa-lead" className="flex flex-col gap-2">
      <h3
        id="vista-previa-lead"
        className="text-ink-primary text-[11px] leading-none font-semibold"
      >
        Vista previa contra un lead real
      </h3>

      {!lead ? (
        <div className="flex flex-col gap-1.5">
          <div className="relative">
            <SearchIcon
              aria-hidden
              className="text-ink-ghost pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar un lead por nombre o teléfono…"
              aria-label="Buscar el lead para la vista previa"
              className="h-8 pl-8 text-[12px]"
            />
          </div>
          {buscando ? (
            <p className="text-ink-ghost text-[11px]">Buscando…</p>
          ) : query.trim() && resultados.length > 0 ? (
            <ul className="border-line-card max-h-44 overflow-y-auto rounded-lg border">
              {resultados.map((r) => (
                <li key={r.leadId}>
                  <button
                    type="button"
                    onClick={() => elegir(r)}
                    className={cn(
                      "hover:bg-surface-hover flex w-full items-center gap-2 px-2.5 py-1.5 text-left",
                      TRANSICION_CONTROL,
                      FOCO,
                    )}
                  >
                    <span className="text-ink-primary min-w-0 flex-1 truncate text-[12px]">
                      {r.nombre}
                    </span>
                    <span className="text-ink-ghost truncate text-[10.5px]">
                      {r.vehiculo || r.telefono}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : query.trim() ? (
            <p className="text-ink-ghost text-[11px]">Ningún lead coincide.</p>
          ) : (
            <p className="text-ink-ghost text-[10.5px] leading-snug text-pretty">
              Elegí un lead para ver el mensaje con sus datos y si hoy le llegaría.
            </p>
          )}
        </div>
      ) : (
        <div className="border-line-card overflow-hidden rounded-lg border">
          <div className="border-line-card bg-surface-panel flex items-center gap-2 border-b px-2.5 py-2">
            <span
              aria-hidden
              className="bg-surface-hover text-ink-secondary grid size-5 shrink-0 place-items-center rounded-full font-mono text-[9px] font-semibold"
            >
              {iniciales(lead.nombre)}
            </span>
            <span className="text-ink-primary min-w-0 flex-1 truncate text-[11.5px] font-medium">
              {lead.nombre}
              {lead.vehiculo ? <span className="text-ink-faint"> · {lead.vehiculo}</span> : null}
            </span>
            <button
              type="button"
              onClick={cambiar}
              className={cn(
                "text-ink-faint hover:text-ink-primary rounded px-1 text-[10.5px]",
                TRANSICION_CONTROL,
                FOCO,
              )}
            >
              cambiar
            </button>
          </div>
          <div className="bg-surface-root px-2.5 py-3">
            {leyendo ? (
              <p className="text-ink-ghost text-[11px]">Leyendo el lead…</p>
            ) : error ? (
              <p role="alert" className="text-danger text-[11px]">
                {error}
              </p>
            ) : lectura ? (
              <Burbuja mensaje={mensaje} datos={lectura.datos} />
            ) : null}
          </div>
        </div>
      )}

      {lead && lectura && !leyendo && !error ? (
        <AvisoVentana ventana={lectura.datos.ventana} leidoA={lectura.a} />
      ) : null}
    </section>
  );
}

function Burbuja({ mensaje, datos }: { mensaje: string; datos: DatosVistaPrevia }) {
  if (!mensaje.trim()) {
    return <p className="text-ink-ghost text-[11px]">El mensaje está vacío.</p>;
  }
  const { texto, warnings } = interpolarVariables(mensaje, datos.datos);
  // `interpolarVariables` avisa "lead.email no encontrado": se traduce al nombre
  // del chip, que es lo que la persona ve en el campo.
  const vacias = [
    ...new Set(
      warnings
        .map((w) => w.replace(/ no encontrado$/, ""))
        .map((clave) => CORTO.get(clave) ?? clave),
    ),
  ];
  return (
    <div className="flex flex-col gap-1.5">
      <p className="bg-surface-elevated text-ink-primary max-w-[88%] rounded-lg px-2.5 py-2 text-[11.5px] leading-normal break-words whitespace-pre-wrap shadow-xs">
        {texto}
      </p>
      {vacias.length > 0 ? (
        <p className="text-caution text-[10.5px] leading-snug text-pretty">
          Para este lead sale{vacias.length === 1 ? "" : "n"} vacía{vacias.length === 1 ? "" : "s"}:{" "}
          <span className="font-mono">{vacias.join(", ")}</span>.
        </p>
      ) : null}
    </div>
  );
}

function AvisoVentana({
  ventana,
  leidoA,
}: {
  ventana: DatosVistaPrevia["ventana"];
  leidoA: number;
}) {
  if (ventana === null) {
    return (
      <Aviso tono="danger">
        El lead no tiene conversación: el motor no tendría por dónde mandarle este mensaje.
      </Aviso>
    );
  }
  const v = estadoVentana(
    ventana.ultimoEntranteAt ? new Date(ventana.ultimoEntranteAt) : null,
    new Date(leidoA),
  );
  switch (v.estado) {
    case "abierta":
      return (
        <Aviso tono="ok">
          Sale <strong className="font-semibold">dentro</strong> de la ventana de 24 h: quedan{" "}
          <span className="font-mono tabular-nums">{restanteLegible(v.restanteMs)}</span> desde el
          último mensaje del lead. Se puede mandar texto libre.
        </Aviso>
      );
    case "por-vencer":
      return (
        <Aviso tono="caution">
          La ventana de 24 h está por cerrarse: quedan{" "}
          <span className="font-mono tabular-nums">{restanteLegible(v.restanteMs)}</span>. Si el
          flujo llega a este paso después, el motor lo salta.
        </Aviso>
      );
    case "cerrada":
      return (
        <Aviso tono="danger">
          Fuera de la ventana de 24 h: el lead no escribe hace más de un día. El motor salta este
          paso (<span className="font-mono">sin_ventana</span>); para escribirle hace falta una
          plantilla aprobada.
        </Aviso>
      );
    case "sin-mensajes":
      return (
        <Aviso tono="danger">
          El lead nunca escribió: no hay ventana abierta y el motor salta este paso (
          <span className="font-mono">sin_ventana</span>).
        </Aviso>
      );
  }
}

const TONO: Record<"ok" | "caution" | "danger", { caja: string; punto: string }> = {
  ok: { caja: "border-ok/30 bg-ok/10", punto: "bg-ok" },
  caution: { caja: "border-caution/30 bg-caution/10", punto: "bg-caution" },
  danger: { caja: "border-danger/30 bg-danger/10", punto: "bg-danger" },
};

function Aviso({ tono, children }: { tono: keyof typeof TONO; children: ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        "text-ink-body flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[11px] leading-normal text-pretty",
        TONO[tono].caja,
      )}
    >
      <span aria-hidden className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", TONO[tono].punto)} />
      <p>{children}</p>
    </div>
  );
}
