"use client";

import { Eyebrow } from "@/components/shared/Eyebrow";
import { InitialsAvatar } from "@/components/shared/InitialsAvatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { COLOR_RUTA, ETIQUETA_RUTA, tinte } from "./paleta";
import { formatearEntero, formatearResta } from "./formato";
import { Cifra, Nota } from "./primitivas";
import type { AlcanceAudiencia, EstadoAlcance } from "./tipos";
import type { ReactNode } from "react";

/** Filas de la muestra en el panel: alcanzan para ver que es gente, no un número. */
const FILAS_MUESTRA = 12;

/**
 * El tamaño de la audiencia, calculado por el servidor mientras se editan los
 * filtros.
 *
 * Todas las cifras son las del planificador: destinatarios, exclusiones y
 * rutas llegan hechos y acá no se resta nada. La cifra grande está en
 * `aria-live="polite"` para que el cambio se anuncie a quien no la ve, pero
 * solo la cifra: el panel entero recitaría la muestra cada vez que se toca un
 * chip.
 *
 * ## Con una condición a medias o sin condiciones no dice ningún número
 *
 * Una fila sin terminar alcanza a todo el padrón o a nadie según cómo se lea,
 * y las dos cifras mienten. Un árbol vacío tampoco es "todos": mandarle a
 * toda la base se elige a propósito. En los dos casos no se le pregunta nada
 * al servidor.
 */
export function AlcanceEnVivo({
  estado,
  onReintentar,
}: {
  estado: EstadoAlcance;
  onReintentar: () => void;
}) {
  return (
    <aside
      aria-label="Tamaño de la audiencia"
      className="border-line-layout bg-surface-panel flex w-[340px] shrink-0 flex-col overflow-auto border-l"
    >
      {contenido(estado, onReintentar)}
    </aside>
  );
}

function contenido(estado: EstadoAlcance, onReintentar: () => void): ReactNode {
  switch (estado.estado) {
    case "incompleta":
      return (
        <Seccion>
          <Eyebrow>Tamaño en vivo</Eyebrow>
          <Aviso
            tono="caution"
            titulo={
              estado.faltan === 1
                ? "Falta terminar una condición"
                : `Faltan terminar ${estado.faltan} condiciones`
            }
          >
            No se muestra a cuánta gente alcanza hasta que estén todas completas. Una condición a
            medias alcanza al padrón entero o a nadie según el caso, y las dos cifras engañan: acá
            eso son mensajes que salen.
          </Aviso>
        </Seccion>
      );
    case "sin-condiciones":
      return (
        <Seccion>
          <Eyebrow>Tamaño en vivo</Eyebrow>
          <Aviso tono="neutro" titulo="Todavía no hay condiciones">
            Agregá al menos una, o elegí mandarle a toda la base. Un árbol vacío no se interpreta
            como «todos»: le llegaría a gente que nadie eligió.
          </Aviso>
        </Seccion>
      );
    case "calculando":
      return estado.previo ? (
        <Resumen alcance={estado.previo} nota="Recalculando…" atenuado />
      ) : (
        <Seccion>
          <Eyebrow>Tamaño en vivo</Eyebrow>
          <p role="status" className="text-ink-dim text-[12px]">
            Calculando a cuántos les llega…
          </p>
        </Seccion>
      );
    case "error":
      return (
        <>
          <Seccion>
            <Eyebrow>Tamaño en vivo</Eyebrow>
            <Aviso tono="danger" titulo="No se pudo calcular la audiencia">
              <span className="block">{estado.mensaje}</span>
              <Button variant="outline" size="sm" onClick={onReintentar} className="mt-2 w-fit">
                Reintentar
              </Button>
            </Aviso>
          </Seccion>
          {estado.previo ? (
            <Resumen alcance={estado.previo} nota="Último cálculo que salió" atenuado />
          ) : null}
        </>
      );
    case "listo":
      return <Resumen alcance={estado.alcance} nota={`calculado ${estado.calculado}`} />;
  }
}

function Seccion({ children }: { children: ReactNode }) {
  return <div className="border-line-row flex flex-col gap-3 border-b p-4">{children}</div>;
}

const COLOR_AVISO = {
  caution: "var(--color-caution)",
  danger: "var(--color-danger)",
  neutro: "var(--color-line-control)",
} as const;

function Aviso({
  tono,
  titulo,
  children,
}: {
  tono: keyof typeof COLOR_AVISO;
  titulo: string;
  children: ReactNode;
}) {
  const color = COLOR_AVISO[tono];
  return (
    <div
      role={tono === "danger" ? "alert" : "status"}
      className="flex flex-col gap-1.5 rounded-[11px] border p-3.5"
      style={{ borderColor: tinte(color, 32), backgroundColor: tinte(color, 10) }}
    >
      <p
        className={cn(
          "text-[12px] leading-snug font-semibold text-pretty",
          tono === "neutro" && "text-ink-primary",
        )}
        style={tono === "neutro" ? undefined : { color }}
      >
        {titulo}
      </p>
      <div className="text-ink-dim text-[10.5px] leading-relaxed text-pretty">{children}</div>
    </div>
  );
}

function Resumen({
  alcance,
  nota,
  atenuado = false,
}: {
  alcance: AlcanceAudiencia;
  nota: string;
  /** El número es de un cálculo anterior: se ve, pero no se lee como el actual. */
  atenuado?: boolean;
}) {
  const excluidos = Math.max(0, alcance.coinciden - alcance.destinatarios);
  const pctIncluidos =
    alcance.coinciden > 0 ? (alcance.destinatarios / alcance.coinciden) * 100 : 0;
  const muestra = alcance.muestra.slice(0, FILAS_MUESTRA);

  return (
    <div
      aria-busy={atenuado || undefined}
      className={cn("flex flex-col transition-opacity duration-200", atenuado && "opacity-55")}
    >
      <Seccion>
        <div className="flex items-baseline justify-between gap-3">
          <Eyebrow>Tamaño en vivo</Eyebrow>
          <span className="text-ink-ghost text-[10.5px]">{nota}</span>
        </div>

        <div className="flex items-baseline gap-2" aria-live="polite" aria-atomic>
          <Cifra valor={formatearEntero(alcance.destinatarios)} tamano="xl" />
          <span className="text-ink-faint text-[12px]">
            {alcance.destinatarios === 1 ? "destinatario" : "destinatarios"}
          </span>
        </div>

        <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums">
          <span className="text-ink-dim">{formatearEntero(alcance.coinciden)} coinciden</span>
          <span className="text-line-dot" aria-hidden>
            ·
          </span>
          <span className="text-danger">{formatearResta(excluidos)} excluidos</span>
        </div>

        <div className="bg-surface-input flex h-[6px] overflow-hidden rounded-full" aria-hidden>
          <div
            className="border-surface-panel h-full border-r-2 transition-[width] duration-500 ease-out"
            style={{ width: `${pctIncluidos}%`, backgroundColor: "var(--color-ok)" }}
          />
          <div
            className="h-full flex-1"
            style={{ backgroundColor: tinte("var(--color-danger)", 45) }}
          />
        </div>

        {alcance.categoriaSupuesta ? (
          <Nota>
            Calculado como si la plantilla fuera de marketing, que es la que más excluye: se ajusta
            cuando elijas una.
          </Nota>
        ) : null}
      </Seccion>

      <div className="flex flex-col gap-3 p-4">
        <Eyebrow>Primeros de la lista</Eyebrow>

        {muestra.length === 0 ? (
          <Nota>No queda nadie en la lista.</Nota>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {muestra.map((d) => (
              <li
                key={d.leadId}
                className="border-line-row flex items-center gap-2.5 rounded-[9px] border px-2.5 py-2"
              >
                <InitialsAvatar nombre={d.nombre || "?"} size={26} />
                <span className="min-w-0 flex-1">
                  <span
                    className="text-ink-primary block truncate text-[11.5px] font-medium"
                    title={d.nombre || undefined}
                  >
                    {d.nombre || "Sin nombre"}
                  </span>
                  <span className="text-ink-ghost block truncate font-mono text-[10px]">
                    {d.vehiculo ?? d.telefono}
                  </span>
                </span>
                <span
                  className="shrink-0 font-mono text-[9.5px] font-medium"
                  style={{ color: COLOR_RUTA[d.ruta] }}
                >
                  {ETIQUETA_RUTA[d.ruta]}
                </span>
              </li>
            ))}
          </ul>
        )}

        {alcance.destinatarios > muestra.length ? (
          <Nota>
            Son los primeros {formatearEntero(muestra.length)}, en el orden en que salen. La lista
            entera se revisa en el pre-vuelo.
          </Nota>
        ) : null}

        <div className="border-line-row bg-surface-card flex flex-col gap-2 rounded-[11px] border p-3">
          <span className="text-ink-primary text-[11.5px] font-[650]">Ruteo por destinatario</span>
          <Nota>
            <span className="text-ok font-mono">{formatearEntero(alcance.porVentanaAbierta)}</span>{" "}
            {alcance.porTextoLibre > 0
              ? "tienen la ventana de servicio abierta: reciben el texto libre, que no se cobra ni consume cupo."
              : "tienen la ventana de servicio abierta: reciben la plantilla y no consumen el cupo; con marketing se cobra igual. Con un texto libre en el paso Mensaje les llega gratis."}{" "}
            Los otros{" "}
            <span className="text-caution font-mono">{formatearEntero(alcance.porPlantilla)}</span>{" "}
            están fuera de la ventana y sí consumen cupo.
          </Nota>
        </div>
      </div>
    </div>
  );
}
