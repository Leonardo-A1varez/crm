import type { Canal } from "@/types/domain";

const CANAL_LABEL: Record<Canal, string> = {
  wa: "WhatsApp",
  ig: "Instagram",
  fb: "Facebook Messenger",
};

const CANAL_COLOR_CLASS: Record<Canal, string> = {
  wa: "text-green-500",
  ig: "text-pink-500",
  fb: "text-blue-500",
};

function CanalGlyph({ canal, className }: { canal: Canal; className: string }) {
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
          aria-label={`Canal activo: ${CANAL_LABEL[activoActual]}`}
          title={CANAL_LABEL[activoActual]}
          className={CANAL_COLOR_CLASS[activoActual]}
        >
          <CanalGlyph canal={activoActual} className="h-5 w-5" />
        </span>
      ) : null}
      {vinculados.map((c) => (
        <span
          key={c}
          aria-label={`Canal vinculado: ${CANAL_LABEL[c]}`}
          title={CANAL_LABEL[c]}
          className={`${CANAL_COLOR_CLASS[c]} opacity-50`}
        >
          <CanalGlyph canal={c} className="h-3.5 w-3.5" />
        </span>
      ))}
    </div>
  );
}
