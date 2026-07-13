import { format } from "date-fns";
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

function SenderTag({ mensaje }: { mensaje: Mensaje }) {
  if (mensaje.direction !== "out") return null;
  const label = mensaje.sender === "ia" ? "IA" : mensaje.sender === "humano" ? "Vendedor" : null;
  if (!label) return null;
  return (
    <span className="text-[10px] font-medium tracking-wide uppercase opacity-70">{label}</span>
  );
}

/**
 * Burbuja de mensaje: out alineado derecha (primary), in izquierda (muted),
 * sistema centrado. Server component; timestamp estático hh:mm.
 */
export function MessageBubble({ message }: { message: Mensaje }) {
  const hora = format(message.created_at, "HH:mm");

  if (message.sender === "sistema") {
    return (
      <div className="flex justify-center">
        <span className="bg-muted text-muted-foreground rounded-full px-3 py-1 text-xs">
          {message.contenido ?? ""} · {hora}
        </span>
      </div>
    );
  }

  const out = message.direction === "out";
  const mediaLabel = message.tipo !== "text" ? (MEDIA_LABEL[message.tipo] ?? "Adjunto") : null;

  return (
    <div className={out ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          out
            ? "bg-primary text-primary-foreground max-w-[75%] rounded-2xl rounded-br-sm px-3 py-2"
            : "bg-muted max-w-[75%] rounded-2xl rounded-bl-sm px-3 py-2"
        }
      >
        <SenderTag mensaje={message} />
        {mediaLabel ? (
          <p className="text-sm italic">
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
          <p className="text-sm break-words whitespace-pre-wrap">{message.contenido}</p>
        ) : null}
        <p
          className={`mt-0.5 text-right text-[10px] ${out ? "opacity-70" : "text-muted-foreground"}`}
        >
          {hora}
        </p>
      </div>
    </div>
  );
}
