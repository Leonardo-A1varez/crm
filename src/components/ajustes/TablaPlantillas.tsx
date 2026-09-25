import { BadgeSalud } from "@/components/ajustes/BadgeSalud";
import { descriptorDePlantilla } from "@/components/ajustes/descriptores";
import { Warning } from "@/components/icons";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { cantidad } from "@/lib/ui/metricas";
import { cn } from "@/lib/utils";
import type { PlantillaMeta } from "@/components/ajustes/tipos";

const COLUMNAS = "grid-cols-[230px_92px_112px_1fr]";

function tinte(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

/** Frenada ahora mismo: pausada, o marcada para despausar a mano. */
function pideAtencion(p: PlantillaMeta): boolean {
  return p.requiereDespausadoManual || p.estado === "pausada";
}

/**
 * Las plantillas de la cuenta, leídas de Meta.
 *
 * ============== LAS FRENADAS VAN PRIMERO ==============
 *
 * Una plantilla pausada no sale, y dejarla en su orden alfabético repite el
 * problema que la pantalla viene a resolver: el dato está, pero en la fila 7,
 * y nadie baja a la fila 7 hasta que un cliente se queja. Encima del bloque va
 * el conteo, que es lo único que hay que mirar si se entra con apuro.
 *
 * No hay columna de acción: la pantalla sólo lee de Meta. Despausar es un POST
 * a la cuenta, y eso no se dispara desde un panel que se abre para mirar.
 */
export function TablaPlantillas({
  plantillas,
  nota,
}: {
  plantillas: readonly PlantillaMeta[];
  /** Por qué la lista está incompleta, si lo está. */
  nota: string | null;
}) {
  // Se copia antes de ordenar: `plantillas` es una prop y ordenarla en el lugar
  // mutaría el array del caller. `toSorted` haría lo mismo, pero es ES2023 y el
  // tsconfig de este proyecto apunta a ES2022.
  const ordenadas = [...plantillas].sort(
    (a, b) => Number(pideAtencion(b)) - Number(pideAtencion(a)),
  );
  const pausadas = plantillas.filter((p) => p.estado === "pausada").length;
  const manuales = plantillas.filter((p) => p.requiereDespausadoManual).length;

  return (
    <section className="border-line-card bg-surface-card overflow-hidden rounded-[14px] border">
      <div className="border-line-row flex flex-wrap items-center gap-2.5 border-b px-5 py-3.5">
        <Eyebrow>Plantillas sincronizadas desde Meta</Eyebrow>
        {pausadas > 0 ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[10.5px] leading-none font-semibold"
            style={{
              color: "var(--color-caution)",
              backgroundColor: tinte("var(--color-caution)", 12),
            }}
          >
            <Warning size={11} strokeWidth={2.5} aria-hidden />
            {cantidad(pausadas, "pausada", "pausadas")}
            {manuales > 0
              ? ` · ${cantidad(manuales, "espera", "esperan")} que la despausen a mano`
              : ""}
          </span>
        ) : null}
        <span className="text-ink-ghost ml-auto text-[11px]">
          se crean en el administrador de Meta · acá sólo se leen
        </span>
      </div>

      <div
        className={`bg-surface-input text-ink-faint border-line-row grid ${COLUMNAS} gap-3.5 border-b px-5 py-2.5 font-mono text-[9px] font-semibold tracking-[0.08em] uppercase`}
      >
        <span>plantilla</span>
        <span>categoría</span>
        <span>estado</span>
        <span>por qué</span>
      </div>

      {ordenadas.length === 0 ? (
        <p className="text-ink-faint px-5 py-3 text-[11.5px]">La cuenta no tiene plantillas.</p>
      ) : (
        <ul>
          {ordenadas.map((p) => (
            <li
              key={p.id}
              className={cn(
                "border-line-row grid items-start gap-3.5 border-b px-5 py-3 last:border-b-0",
                COLUMNAS,
              )}
              style={
                p.requiereDespausadoManual
                  ? { backgroundColor: tinte("var(--color-danger)", 5) }
                  : p.estado === "pausada"
                    ? { backgroundColor: tinte("var(--color-caution)", 5) }
                    : undefined
              }
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-ink-primary truncate font-mono text-[12px] font-medium">
                  {p.nombre}
                </span>
                {p.idioma !== null ? (
                  <span className="text-ink-ghost font-mono text-[10px]">{p.idioma}</span>
                ) : null}
              </span>
              <span className="text-ink-faint truncate font-mono text-[11px]">{p.categoria}</span>
              <span className="flex flex-col items-start gap-1.5">
                <BadgeSalud descriptor={descriptorDePlantilla(p.estado)} />
                {p.escalonPausado !== null ? <EscalonPacing escalon={p.escalonPausado} /> : null}
              </span>
              <span className="text-ink-faint text-[11.5px] leading-snug text-pretty">
                {p.nota}
              </span>
            </li>
          ))}
        </ul>
      )}

      {nota !== null ? (
        <p className="text-ink-secondary border-line-row border-t px-5 py-3 text-[11px] leading-relaxed">
          {nota}
        </p>
      ) : null}

      <p className="text-ink-ghost border-line-row border-t px-5 py-3 text-[10.5px] leading-relaxed text-pretty">
        Meta pausa una plantilla por calidad 3 h la primera vez y 6 h la segunda, y a la tercera la
        deshabilita; las dos primeras pausas vuelven solas. Una frenada por pacing, en cambio, no
        vuelve sola: hay que despausarla desde el administrador de WhatsApp.
      </p>
    </section>
  );
}

/**
 * En qué escalón del pausado por calidad está la plantilla.
 *
 * Tres casillas, la última con borde y sin relleno: es la que no vuelve. Los
 * dos primeros escalones son un reloj que corre y el tercero es una puerta que
 * se cierra, y un medidor que sólo se llena los pondría en la misma escala.
 */
function EscalonPacing({ escalon }: { escalon: 1 | 2 | 3 }) {
  const terminal = escalon === 3;
  const color = terminal ? "var(--color-danger)" : "var(--color-caution)";
  const texto = terminal ? "sin vuelta" : escalon === 1 ? "3 h" : "6 h";

  return (
    <span className="flex items-center gap-1.5">
      <span
        className="flex gap-0.5"
        role="img"
        aria-label={`Escalón ${escalon} de 3 del pausado de Meta`}
      >
        {([1, 2, 3] as const).map((n) => (
          <span
            key={n}
            className={cn(
              "h-[7px] w-[9px] rounded-[2px]",
              n > escalon && "bg-surface-input",
              n === 3 && "border",
            )}
            style={
              n <= escalon
                ? {
                    backgroundColor: n === 3 ? "transparent" : tinte(color, 60),
                    borderColor: color,
                  }
                : n === 3
                  ? { borderColor: "var(--color-line-control)", backgroundColor: "transparent" }
                  : undefined
            }
          />
        ))}
      </span>
      <span className="font-mono text-[10px] tabular-nums" style={{ color }}>
        {texto}
      </span>
    </span>
  );
}
