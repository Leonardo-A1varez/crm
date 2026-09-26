"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CURVA, DURACION, FOCO, PRESION_TACTIL, TRANSICION_CONTROL } from "./tokens-editor";
import {
  SEVERIDAD_AYUDA,
  SEVERIDAD_FONDO,
  SEVERIDAD_LABEL,
  SEVERIDAD_PUNTO,
  SEVERIDAD_TEXTO,
  severidadesDeNodo,
  type ProblemaNodo,
  type Severidad,
} from "./severidad";

/**
 * La marca de severidad que va sobre el nodo culpable.
 *
 * Un punto por severidad activa, ordenados de más a menos grave. Tres puntos
 * como máximo, porque hay tres severidades: la marca no crece con la cantidad
 * de problemas, sólo con la variedad. Un nodo con cuatro errores muestra un
 * punto rojo, no cuatro.
 *
 * **El color nunca va solo.** La marca lleva `title` con el nombre de cada
 * severidad y su explicación, y un texto para lectores de pantalla: quien no
 * distingue rojo de ámbar recibe la misma información. Es requisito de WCAG
 * 1.4.1 y además es lo que hace que el equipo pueda hablar de "los ámbar" sin
 * ambigüedad.
 *
 * No es interactiva: es una marca, no un botón. Lo clickeable es el nodo, que
 * abre el panel, y el globo, que ofrece los arreglos. Un tercer objetivo de
 * clic de 12 px dentro de un nodo de 200 px sería una trampa.
 */
export function MarcaSeveridad({
  problemas,
  className,
}: {
  problemas: readonly ProblemaNodo[];
  className?: string;
}) {
  const severidades = severidadesDeNodo(problemas);
  if (severidades.length === 0) return null;

  const resumen = severidades
    .map((s) => `${SEVERIDAD_LABEL[s]}: ${SEVERIDAD_AYUDA[s]}`)
    .join(" · ");

  return (
    <span
      title={resumen}
      className={cn(
        "border-line-card bg-surface-elevated inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-1",
        className,
      )}
    >
      {severidades.map((s) => (
        <span key={s} aria-hidden className={cn("size-1.5 rounded-full", SEVERIDAD_PUNTO[s])} />
      ))}
      <span className="sr-only">{resumen}</span>
    </span>
  );
}

/**
 * El globo que explica un problema al lado del nodo, con los arreglos de un
 * clic.
 *
 * Un error rojo sin salida es un reproche. El globo convierte el reproche en
 * una tarea: dice qué falta, de qué regla sale, y ofrece los uno o dos
 * arreglos que resuelven ese caso. "Elegir etiqueta", "Conectar a Detener".
 *
 * Se dibuja en el lienzo, anclado al nodo, y no en un panel lateral de
 * problemas — es la regla dura de esta pantalla. Que aparezca uno por vez es
 * deliberado: el globo se abre para el nodo seleccionado, no para los ocho
 * que tengan algo.
 */
export function GloboProblema({
  problema,
  onCerrar,
  variante = "panel",
  className,
}: {
  problema: ProblemaNodo;
  onCerrar?: () => void;
  /**
   * `lienzo`: flota sobre la grilla de puntos, así que va opaco con un filo de
   * color a la izquierda; un fondo translúcido sobre la trama se lee sucio.
   * `panel`: va sobre el fondo liso del panel y alcanza con el tinte.
   */
  variante?: "lienzo" | "panel";
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "bg-surface-elevated w-[300px] rounded-lg border p-3",
        // La entrada es sólo opacidad y 4 px de desplazamiento: el globo
        // aparece junto al nodo que ya estás mirando, así que no necesita
        // llamar la atención, sólo no aparecer de golpe.
        "animate-in fade-in slide-in-from-top-1 motion-reduce:animate-none",
        DURACION.FLOTANTE,
        CURVA.SALIDA,
        variante === "lienzo"
          ? cn("border-line-card border-l-[3px] shadow-lg", SEVERIDAD_FILO[problema.severidad])
          : SEVERIDAD_FONDO[problema.severidad],
        className,
      )}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-2">
          <span
            aria-hidden
            // `mt-1` es alineación óptica: centrar el punto contra una caja de
            // texto de varias líneas lo deja flotando en el medio del párrafo.
            // Va al centro de la PRIMERA línea, que es donde el ojo lo espera.
            className={cn(
              "mt-1 size-1.5 shrink-0 rounded-full",
              SEVERIDAD_PUNTO[problema.severidad],
            )}
          />
          <p
            className={cn(
              "flex-1 text-[12px] leading-snug font-semibold text-pretty",
              SEVERIDAD_TEXTO[problema.severidad],
            )}
          >
            <span className="sr-only">{SEVERIDAD_LABEL[problema.severidad]}: </span>
            {problema.mensaje}
          </p>
          {onCerrar ? (
            <button
              type="button"
              onClick={onCerrar}
              aria-label="Cerrar el aviso"
              className={cn(
                // Márgenes negativos: meten el botón dentro del padding de la
                // caja para que su área de 24px llegue al borde sin agrandar el globo.
                "text-ink-ghost hover:text-ink-body -mt-1 -mr-1 grid size-6 shrink-0 place-items-center rounded-md",
                "hover:bg-surface-hover",
                TRANSICION_CONTROL,
                FOCO,
              )}
            >
              <span aria-hidden className="text-[13px] leading-none">
                ×
              </span>
            </button>
          ) : null}
        </div>

        {problema.ayuda ? (
          <p className="text-ink-dim pl-3.5 text-[11px] leading-snug text-pretty">
            {problema.ayuda}
          </p>
        ) : null}

        {problema.regla ? (
          <p className="text-ink-faint pl-3.5 font-mono text-[10px] leading-relaxed">
            {problema.regla}
          </p>
        ) : null}

        {problema.arreglos && problema.arreglos.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pl-3.5">
            {problema.arreglos.map((a) => (
              <Button
                key={a.etiqueta}
                type="button"
                variant="outline"
                size="xs"
                onClick={a.onAplicar}
                className={cn(TRANSICION_CONTROL, PRESION_TACTIL)}
              >
                {a.etiqueta}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** El filo izquierdo del globo del lienzo, del color de la severidad. */
const SEVERIDAD_FILO: Record<ProblemaNodo["severidad"], string> = {
  error: "border-l-danger",
  stale: "border-l-caution",
  sin_publicar: "border-l-info",
};

/**
 * Resumen de validación de la barra superior.
 *
 * Dice cuántos nodos tienen cada severidad y, sobre todo, si se puede
 * publicar. Es lo único que se muestra fuera del nodo, y a propósito: es un
 * conteo, no un diagnóstico. El diagnóstico está en el nodo.
 *
 * Clickear un conteo lleva al primer nodo de esa severidad — por eso es un
 * botón y no un badge. Ese salto es lo que evita que alguien con 80 nodos
 * tenga que buscar a ojo cuál de todos tiene el anillo rojo.
 */
export function ResumenValidacion({
  conteos,
  onIrA,
  className,
}: {
  conteos: Readonly<Record<Severidad, number>>;
  onIrA?: (severidad: Severidad) => void;
  className?: string;
}) {
  const visibles = (Object.keys(conteos) as Severidad[]).filter((s) => conteos[s] > 0);
  if (visibles.length === 0) {
    return (
      <span
        className={cn(
          "text-ok inline-flex items-center gap-1.5 text-[11.5px] font-medium",
          className,
        )}
      >
        <span aria-hidden className="bg-ok size-1.5 rounded-full" />
        Sin problemas
      </span>
    );
  }

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {visibles.map((s) => {
        const n = conteos[s];
        const texto =
          s === "error"
            ? `${n} ${n === 1 ? "error bloquea" : "errores bloquean"} publicar`
            : s === "stale"
              ? `${n} desactualizado${n === 1 ? "" : "s"}`
              : `${n} sin publicar`;

        return (
          <button
            key={s}
            type="button"
            onClick={() => onIrA?.(s)}
            title={`${SEVERIDAD_AYUDA[s]} Ir al primero.`}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11.5px] font-medium",
              "hover:brightness-110",
              SEVERIDAD_FONDO[s],
              SEVERIDAD_TEXTO[s],
              TRANSICION_CONTROL,
              PRESION_TACTIL,
              FOCO,
            )}
          >
            <span aria-hidden className={cn("size-1.5 rounded-full", SEVERIDAD_PUNTO[s])} />
            <span className="tabular-nums">{texto}</span>
          </button>
        );
      })}
    </div>
  );
}
