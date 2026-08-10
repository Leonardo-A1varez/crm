import { format } from "date-fns";
import { AutoAwesome } from "@/components/icons";
import { MonoMeta } from "@/components/shared/MonoMeta";
import { cn } from "@/lib/utils";
import type { Mensaje } from "@/types/entities";
import type { TipoMensaje } from "@/types/domain";

const MEDIA_LABEL: Partial<Record<TipoMensaje, string>> = {
  image: "Imagen",
  audio: "Audio",
  video: "Video",
  doc: "Documento",
  location: "Ubicación",
  template: "Plantilla",
};

/**
 * Gradiente de la burbuja del agente. Va inline y no como token: son dos
 * paradas de color, algo que la escala de `--color-*` no puede expresar.
 */
const FONDO_IA = {
  backgroundImage: "linear-gradient(150deg, rgba(255,175,58,.16), rgba(255,175,58,.07))",
};

function EtiquetaRemitente({ sender }: { sender: "ia" | "humano" }) {
  if (sender === "ia") {
    return (
      <span className="text-brand-hover mb-1 flex items-center gap-1 font-mono text-[9px] tracking-wide uppercase">
        <AutoAwesome size={12} />
        Agente IA
      </span>
    );
  }
  return (
    <span className="text-ink-faint mb-1 block font-mono text-[9px] tracking-wide uppercase">
      Vendedor
    </span>
  );
}

/**
 * Burbuja de mensaje. El remitente sale de `sender`, no de `direction`: `ia` y
 * `humano` son ambos salientes pero el handoff los distingue visualmente para
 * que se vea de un vistazo qué escribió el agente y qué escribió una persona.
 * Server component; timestamp estático hh:mm.
 */
export function MessageBubble({ message }: { message: Mensaje }) {
  const hora = format(message.created_at, "HH:mm");

  if (message.sender === "sistema") {
    return (
      <div className="flex items-center gap-2.5 px-1 py-0.5">
        <span aria-hidden className="bg-surface-avatar h-px flex-1" />
        <span className="text-ink-fainter shrink-0 font-mono text-[9.5px] tracking-wide uppercase">
          {message.contenido ?? ""} · {hora}
        </span>
        <span aria-hidden className="bg-surface-avatar h-px flex-1" />
      </div>
    );
  }

  const esLead = message.sender === "lead";
  const mediaLabel = message.tipo !== "text" ? (MEDIA_LABEL[message.tipo] ?? "Adjunto") : null;

  return (
    <div className={esLead ? "flex justify-start" : "flex justify-end"}>
      <div
        className={cn(
          "max-w-[62%] px-[13px] py-[9px] text-[12.5px]",
          esLead &&
            "bg-surface-bubble-in border-line-input text-ink-body rounded-[15px_15px_15px_5px] border",
          message.sender === "ia" &&
            "border-brand/22 text-ink-body rounded-[15px_15px_5px_15px] border",
          // Burbuja clara sobre fondo oscuro, a propósito: así distingue el
          // handoff al vendedor del agente. El texto no puede ser un token
          // `ink-*` porque todos están pensados para fondo oscuro.
          message.sender === "humano" &&
            "bg-surface-bubble-vend rounded-[15px_15px_5px_15px] text-[#14161b]",
        )}
        style={message.sender === "ia" ? FONDO_IA : undefined}
      >
        {esLead ? null : <EtiquetaRemitente sender={message.sender === "ia" ? "ia" : "humano"} />}
        {mediaLabel ? (
          <p className="italic">
            [{mediaLabel}]
            {message.media_url ? (
              <>
                {" "}
                <a
                  href={message.media_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  ver
                </a>
              </>
            ) : null}
          </p>
        ) : null}
        {message.contenido ? (
          <p className="break-words whitespace-pre-wrap">{message.contenido}</p>
        ) : null}
        <MonoMeta className="mt-1 block text-right text-[9.5px]">{hora}</MonoMeta>
      </div>
    </div>
  );
}
