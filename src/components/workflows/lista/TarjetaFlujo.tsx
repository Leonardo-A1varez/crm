import Link from "next/link";
import { PauseIcon } from "@/components/icons";
import { BadgeEstado } from "@/components/workflows/lista/BadgeEstado";
import { SEMANTICA_PAUSA, tinte } from "@/components/workflows/lista/estado";
import { categoriaChipFondo, categoriaColor } from "@/lib/ui/workflow-nodos";
import { formatearEntero, formatearPorcentaje, porcentajeDe } from "@/lib/ui/metricas";
import type { FlujoEnLista } from "@/components/workflows/lista/tipos";
import type { ReactNode } from "react";

/**
 * Una tarjeta de `/workflows`.
 *
 * La tarjeta entera es clickeable sin que haya un `<a>` envolviendo a los dos
 * botones —eso sería contenido interactivo anidado, HTML inválido y una trampa
 * para el teclado—. El truco es el link del título con `after:absolute
 * after:inset-0`: un solo ancla estirada sobre la tarjeta, y los botones
 * elevados con `relative z-10` para quedar por encima. Un `<a>`, un tab stop,
 * área de click completa.
 */
export function TarjetaFlujo({ flujo, acciones }: { flujo: FlujoEnLista; acciones?: ReactNode }) {
  const { id, nombre, estado, resumen, corridas30d, exitosas30d, ultimaEjecucion } = flujo;
  const huboCorridas = corridas30d > 0;
  const tasaExito = porcentajeDe(exitosas30d, corridas30d);
  const fallidas = corridas30d - exitosas30d;

  return (
    <li className="border-line-card bg-surface-card focus-within:border-line-control hover:border-line-control relative flex flex-col gap-3 rounded-[13px] border p-4 transition-colors">
      <div className="flex items-start gap-2.5">
        <IconoDisparador disparador={flujo.disparador} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Link
            href={`/workflows/${id}`}
            className="text-ink-primary rounded-[4px] text-[13.5px] leading-tight font-[680] tracking-[-0.01em] text-balance after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
          >
            {nombre}
          </Link>
          <p className="text-ink-faint truncate text-[11.5px]">{resumen}</p>
        </div>
        <BadgeEstado estado={estado} />
      </div>

      <div className="border-line-row flex items-end gap-5 border-t pt-3">
        <Dato valor={formatearEntero(corridas30d)} label="corridas 30 d" />
        <Dato
          valor={huboCorridas ? formatearPorcentaje(tasaExito) : "—"}
          label={huboCorridas ? "éxito" : "sin corridas"}
        />
        <Dato valor={ultimaEjecucion ?? "—"} label="última" atenuado />

        {/*
          `relative z-10` levanta esta fila por encima del ancla estirada del
          título. Sin eso, el `after:inset-0` del `<Link>` de arriba se come los
          clicks de los botones y el menú no se abre nunca.

          `acciones` es un slot y no un menú propio a propósito: pausar,
          duplicar y eliminar disparan Server Actions, y `components/**` no
          puede importar `app/**` (boundaries). Quien tiene las actions es la
          pantalla, así que la pantalla arma el control y esta tarjeta sólo le
          hace lugar. Mismo patrón que `renderAccion` en `TablaPlantillas`.
        */}
        <div className="relative z-10 ml-auto flex shrink-0 items-center gap-1.5">
          <Accion href={`/workflows/${id}/historial`}>Historial</Accion>
          <Accion href={`/workflows/${id}`} destacada>
            Abrir
          </Accion>
          {acciones}
        </div>
      </div>

      {/*
        El riel del éxito. Repite el porcentaje de arriba a propósito: el número
        es exacto, el riel es comparable. Como todas las tarjetas lo dibujan al
        mismo ancho y a la misma altura, la columna se escanea de un vistazo y
        salta el flujo que viene degradándose sin haber roto todavía —el que
        tiene badge "Activo" y 78%, que es justo el que nadie mira.

        Dos segmentos y no uno: éxito a la izquierda, fallos a la derecha. Verde
        y rojo se separaban ΔE 6.5 en deuteranopía sobre el fondo oscuro y hoy
        dan 8.0 (medido, tras el re-escalonado del 2026-09-03) — el objetivo
        justo, sin margen; acá hay dos codificaciones secundarias más:
        el porcentaje escrito justo arriba y los 2px de aire entre los bloques.
        La posición también encodea —los fallos SIEMPRE a la derecha—, así que
        el color no es el único portador.

        Sin corridas no hay riel. Una barra en cero se lee como un dato y no lo
        es: es la ausencia de datos.
      */}
      {huboCorridas ? (
        <div
          className="flex h-[3px] gap-0.5 overflow-hidden rounded-full"
          role="img"
          aria-label={`${formatearEntero(exitosas30d)} de ${formatearEntero(corridas30d)} corridas terminaron bien`}
        >
          <span style={{ flex: exitosas30d, backgroundColor: "var(--color-ok)" }} />
          {fallidas > 0 ? (
            <span style={{ flex: fallidas, backgroundColor: "var(--color-danger)" }} />
          ) : null}
        </div>
      ) : null}

      {estado === "pausado" ? <NotaDePausa enCurso={flujo.corridasEnCurso} /> : null}
    </li>
  );
}

/**
 * El disparador del flujo, como ícono: con qué arranca es lo primero que
 * distingue a dos flujos de nombre parecido. Es el mismo ícono y el mismo
 * color de categoría que el nodo en el lienzo, así que al abrir el flujo se
 * reconoce. El nombre va en el `title` y para el lector de pantalla.
 */
function IconoDisparador({ disparador }: { disparador: FlujoEnLista["disparador"] }) {
  const Icono = disparador?.icono;
  return (
    <span
      role="img"
      aria-label={disparador ? `Arranca con: ${disparador.nombre}` : "Todavía sin disparador"}
      title={disparador ? `Arranca con: ${disparador.nombre}` : "Todavía sin disparador"}
      className="border-line-card grid size-[26px] shrink-0 place-items-center rounded-[7px]"
      style={
        disparador
          ? { background: categoriaChipFondo("trigger"), color: categoriaColor("trigger") }
          : undefined
      }
    >
      {Icono ? (
        <Icono aria-hidden className="size-3.5" />
      ) : (
        <span aria-hidden className="bg-ink-ghost size-1.5 rounded-full" />
      )}
    </span>
  );
}

function Dato({ valor, label, atenuado }: { valor: string; label: string; atenuado?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className={
          atenuado
            ? "text-ink-secondary font-mono text-[13px] leading-none font-semibold tabular-nums"
            : "text-ink-primary font-mono text-[13px] leading-none font-semibold tabular-nums"
        }
      >
        {valor}
      </span>
      <span className="text-ink-ghost text-[10px] leading-none">{label}</span>
    </div>
  );
}

function Accion({
  href,
  destacada,
  children,
}: {
  href: string;
  destacada?: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        destacada
          ? "border-line-input bg-surface-input text-ink-primary hover:bg-surface-hover flex h-7 items-center rounded-[8px] border px-2.5 text-[11.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
          : "border-line-card text-ink-secondary hover:bg-surface-hover hover:text-ink-primary flex h-7 items-center rounded-[8px] border px-2.5 text-[11.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
      }
    >
      {children}
    </Link>
  );
}

/**
 * El contrato de pausar, escrito en la tarjeta que está pausada.
 *
 * No es un tooltip ni una ayuda contextual escondida: si el flujo está pausado,
 * la frase está a la vista. "Pausado" a secas deja abierta la pregunta de qué
 * pasó con las corridas que ya estaban andando, y esa ambigüedad es una queja
 * documentada del mercado. Cuando hay corridas vivas se dice cuántas, porque
 * "las que están corriendo" en abstracto no tranquiliza a nadie: "las 2 que
 * están corriendo" sí.
 */
function NotaDePausa({ enCurso }: { enCurso: number }) {
  const color = "var(--color-caution)";

  return (
    <p
      className="flex items-start gap-2 rounded-[9px] px-2.5 py-2 text-[11px] leading-relaxed"
      style={{ color, backgroundColor: tinte(color, 9) }}
    >
      <PauseIcon size={12} strokeWidth={2.5} className="mt-px shrink-0" aria-hidden />
      <span>
        {SEMANTICA_PAUSA.frena}{" "}
        {enCurso > 0 ? (
          <>
            Las{" "}
            <span className="font-mono font-semibold tabular-nums">{formatearEntero(enCurso)}</span>{" "}
            que están corriendo siguen hasta terminar.
          </>
        ) : (
          "No hay ninguna corriendo ahora."
        )}
      </span>
    </p>
  );
}
