import { canalColor, canalesDeFila, canalLabel } from "@/lib/ui/canal";
import { cn } from "@/lib/utils";
import type { Canal } from "@/types/domain";

export function CanalGlyph({ canal, className }: { canal: Canal; className: string }) {
  switch (canal) {
    case "wa":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
          <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1-.2.2-.7.8-.8 1-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-2-1.2 7.5 7.5 0 0 1-1.4-1.7c-.1-.2 0-.4.1-.5l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.1s.9 2.4 1 2.6c.1.2 1.8 2.7 4.3 3.8.6.3 1.1.4 1.5.5.6.2 1.2.2 1.6.1.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2 0-.1-.2-.1-.5-.2Z" />
        </svg>
      );
    case "ig":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
          <path d="M12 2c2.7 0 3 .01 4.1.06 1.1.05 1.8.22 2.4.47.7.25 1.2.6 1.8 1.15.5.55.9 1.1 1.1 1.76.3.64.5 1.36.5 2.44.1 1.07.1 1.41.1 4.12s0 3.05-.1 4.12c0 1.08-.2 1.8-.5 2.44a4.9 4.9 0 0 1-1.1 1.76 4.9 4.9 0 0 1-1.8 1.15c-.6.25-1.3.42-2.4.47-1.1.05-1.4.06-4.1.06s-3-.01-4.1-.06c-1.1-.05-1.8-.22-2.4-.47a4.9 4.9 0 0 1-1.8-1.15 4.9 4.9 0 0 1-1.1-1.76c-.3-.64-.5-1.36-.5-2.44C2 15.05 2 14.71 2 12s0-3.05.1-4.12c0-1.08.2-1.8.5-2.44.2-.66.6-1.21 1.1-1.76A4.9 4.9 0 0 1 5.5 2.53c.6-.25 1.3-.42 2.4-.47C9 2.01 9.3 2 12 2Zm0 1.8c-2.7 0-3 .01-4 .06-1 .04-1.5.2-1.9.34-.5.18-.8.4-1.2.77-.4.37-.6.72-.8 1.2-.1.36-.3.9-.3 1.9-.1 1-.1 1.3-.1 4s0 3 .1 4c0 1 .2 1.5.3 1.9.2.48.4.83.8 1.2.4.37.7.59 1.2.77.4.14.9.3 1.9.34 1 .05 1.3.06 4 .06s3-.01 4-.06c1-.04 1.5-.2 1.9-.34.5-.18.8-.4 1.2-.77.4-.37.6-.72.8-1.2.1-.36.3-.9.3-1.9.1-1 .1-1.3.1-4s0-3-.1-4c0-1-.2-1.5-.3-1.9a3.1 3.1 0 0 0-.8-1.2 3.1 3.1 0 0 0-1.2-.77c-.4-.14-.9-.3-1.9-.34-1-.05-1.3-.06-4-.06Zm0 3.1a5.1 5.1 0 1 1 0 10.2 5.1 5.1 0 0 1 0-10.2Zm0 1.8a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6Zm5.3-3.1a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4Z" />
        </svg>
      );
    case "fb":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
          <path d="M12 2a9.6 9.6 0 0 0-9.6 9.7c0 3 1.3 5.6 3.5 7.4v3l3-1.7c.9.3 2 .5 3.1.5a9.6 9.6 0 0 0 9.6-9.7A9.6 9.6 0 0 0 12 2Zm1 12.9-2.5-2.6-4.7 2.6 5.2-5.5 2.5 2.6 4.6-2.6-5.1 5.5Z" />
        </svg>
      );
  }
}

/**
 * Los canales de una fila de la lista, en una tira de una sola línea: el mismo
 * glifo + nombre del header de la conversación, encogido a lo que entra.
 *
 * Es `shrink-0` a propósito. Quien la usa la pone al lado de un hermano
 * flexible —el nombre del lead en la fila completa— y ese hermano es el que
 * cede el ancho: así la tira nunca se recorta a medio glifo ni empuja la fila
 * fuera de los 322px del panel.
 */
export function CanalesFila({
  canales,
  canalActivo,
  glifo,
  permiteEtiqueta,
}: {
  canales: Canal[];
  canalActivo: Canal | null;
  /** Clases de tamaño del SVG: la fila completa y la compacta no miden igual. */
  glifo: string;
  permiteEtiqueta: boolean;
}) {
  const { canales: orden, conEtiqueta } = canalesDeFila(canales, canalActivo, permiteEtiqueta);
  if (orden.length === 0) return null;

  return (
    <span className="flex shrink-0 items-center gap-1">
      {orden.map((canal, i) => (
        <span
          key={canal}
          role="img"
          aria-label={canalLabel(canal)}
          title={canalLabel(canal)}
          // El vinculado va atenuado: el activo es el canal por el que se
          // responde, y esa diferencia tiene que leerse sin pasar el mouse.
          className={cn("flex items-center gap-1", i > 0 && "opacity-55")}
          style={{ color: canalColor(canal) }}
        >
          <CanalGlyph canal={canal} className={glifo} />
          {conEtiqueta ? (
            <span aria-hidden className="text-[10px] font-medium">
              {canalLabel(canal)}
            </span>
          ) : null}
        </span>
      ))}
    </span>
  );
}

/**
 * Glifo del canal montado sobre el avatar, en el lugar del punto de color.
 *
 * Existe para la fila compacta, donde la tira no entra: esa fila es una sola
 * línea y sus 250px útiles ya están tomados por nombre, etapa, preview y hora.
 * Sobre el avatar el glifo cuesta cero ancho.
 */
export function ChannelBadge({
  canal,
  size,
  ringColor,
  className,
}: {
  canal: Canal;
  size: number;
  ringColor: string;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={canalLabel(canal)}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full", className)}
      style={{
        width: size,
        height: size,
        backgroundColor: ringColor,
        border: `1.5px solid ${ringColor}`,
        color: canalColor(canal),
      }}
    >
      <CanalGlyph canal={canal} className="h-full w-full" />
    </span>
  );
}

/**
 * Íconos de canal estilo WhatsApp Web: el activo grande, los vinculados
 * chicos y atenuados. Server component (SVG estático).
 */
export function ChannelIcons({
  activos,
  activoActual,
}: {
  activos: Canal[];
  activoActual?: Canal;
}) {
  if (activos.length === 0 && !activoActual) return null;
  const vinculados = activos.filter((c) => c !== activoActual);
  return (
    <div className="flex items-center gap-1.5">
      {activoActual ? (
        <span
          aria-label={`Canal activo: ${canalLabel(activoActual)}`}
          title={canalLabel(activoActual)}
          style={{ color: canalColor(activoActual) }}
        >
          <CanalGlyph canal={activoActual} className="h-5 w-5" />
        </span>
      ) : null}
      {vinculados.map((c) => (
        <span
          key={c}
          aria-label={`Canal vinculado: ${canalLabel(c)}`}
          title={canalLabel(c)}
          className="opacity-50"
          style={{ color: canalColor(c) }}
        >
          <CanalGlyph canal={c} className="h-3.5 w-3.5" />
        </span>
      ))}
    </div>
  );
}
