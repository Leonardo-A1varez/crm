import { HelpIcon, Warning } from "@/components/icons";
import { Eyebrow } from "@/components/shared/Eyebrow";

type NoLeida = { estado: "error"; mensaje: string } | { estado: "no-disponible"; motivo: string };

function tinte(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

/**
 * El lugar de una sección cuyos datos no llegaron.
 *
 * Dos casos con dos tonos. "No se pudo leer" va en ámbar y dice cómo
 * reintentar: algo falló en el camino y recargar puede alcanzar. "No
 * disponible" va en gris y sin verbo de acción: no hay de dónde leer el dato,
 * y sugerir recargar mandaría a alguien a apretar un botón que nunca va a
 * funcionar.
 *
 * El rojo no se usa: una lectura caída no es una cuenta caída, y gastarlo acá
 * le baja el precio para cuando Meta bloquee algo de verdad.
 */
export function AvisoLectura({ titulo, lectura }: { titulo: string; lectura: NoLeida }) {
  const esError = lectura.estado === "error";
  const color = esError ? "var(--color-caution)" : "var(--color-ink-faint)";
  const Glifo = esError ? Warning : HelpIcon;

  return (
    <section className="border-line-card bg-surface-card flex flex-col gap-3 rounded-[14px] border p-5">
      <div className="flex items-center gap-2.5">
        <Eyebrow>{titulo}</Eyebrow>
        <span
          className="inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[10.5px] leading-none font-semibold"
          style={{ color, backgroundColor: tinte(color, 12) }}
        >
          <Glifo size={11} strokeWidth={2.25} aria-hidden />
          {esError ? "No se pudo leer" : "No disponible"}
        </span>
      </div>

      <p className="text-ink-secondary max-w-[72ch] text-[11.5px] leading-relaxed text-pretty">
        {esError ? lectura.mensaje : lectura.motivo}
      </p>

      {esError ? (
        <p className="text-ink-ghost text-[10.5px]">Recargá la página para volver a intentarlo.</p>
      ) : null}
    </section>
  );
}
