import { format } from "date-fns";
import { AutoAwesome, Done, DoneAll, ErrorIcon, Schedule } from "@/components/icons";
import { MonoMeta } from "@/components/shared/MonoMeta";
import { partirTexto } from "@/lib/ui/busqueda-hilo";
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

/**
 * Acuse de entrega. Solo en salientes: en un entrante no significa nada, y el
 * `null` de un saliente es "Meta todavia no reporto", que no es lo mismo que
 * fallado — por eso muestra un reloj y no una cruz.
 */
function AcuseEntrega({ mensaje, claro }: { mensaje: Mensaje; claro: boolean }) {
  if (mensaje.direction !== "out" || mensaje.sender === "sistema") return null;

  // Sobre la burbuja clara del vendedor el gris del handoff no se ve: ahí el
  // acuse va en la tinta oscura de esa burbuja, con la misma jerarquia.
  const tono = claro ? "text-[#14161b]/45" : "text-ink-dim";

  switch (mensaje.estado_entrega) {
    case "leido":
      return <DoneAll size={12} className="text-info shrink-0" aria-label="Leido" />;
    case "entregado":
      return <DoneAll size={12} className={`${tono} shrink-0`} aria-label="Entregado" />;
    case "enviado":
      return <Done size={12} className={`${tono} shrink-0`} aria-label="Enviado" />;
    case "fallido":
      return (
        <ErrorIcon
          size={12}
          className="text-danger shrink-0"
          aria-label={mensaje.error_entrega ?? "No se pudo entregar"}
        />
      );
    default:
      return <Schedule size={12} className={`${tono} shrink-0`} aria-label="Sin acuse todavia" />;
  }
}

/**
 * Lo que el buscador del hilo le pasa a cada burbuja. `ordinalInicial` es
 * cuántas coincidencias quedaron en los mensajes anteriores: sumado al índice
 * local da la numeración global que usan el contador y las flechas.
 */
export interface ResaltadoBusqueda {
  consulta: string;
  ordinalInicial: number;
  /** Ordinal global de la coincidencia enfocada; `null` cuando no hay ninguna. */
  ordinalActivo: number | null;
}

/**
 * Texto de la burbuja con las coincidencias marcadas.
 *
 * El contenido lo escribió un tercero del otro lado de WhatsApp: se parte en
 * tramos y se renderiza como nodos. Nada de `dangerouslySetInnerHTML` — bastaría
 * un `<img onerror>` en un mensaje entrante para ejecutar código en el panel.
 *
 * El `data-coincidencia` es el ancla: `ChatThread` busca por ese atributo para
 * traer la coincidencia activa a la vista, y así no hay que colgar un `ref` por
 * cada tramo de cada uno de los 200 mensajes.
 */
function TextoDelMensaje({
  texto,
  resaltado,
}: {
  texto: string;
  resaltado: ResaltadoBusqueda | null;
}) {
  if (!resaltado || resaltado.consulta.trim() === "") return <>{texto}</>;

  const tramos = partirTexto(texto, resaltado.consulta, resaltado.ordinalInicial);
  return (
    <>
      {tramos.map((tramo, i) =>
        tramo.ordinal === null ? (
          // El índice alcanza como key: los tramos se derivan del texto y de la
          // consulta, así que no se reordenan ni se insertan en el medio.
          <span key={i}>{tramo.texto}</span>
        ) : (
          <mark
            key={i}
            data-coincidencia={tramo.ordinal}
            className={cn(
              "rounded-[3px] px-[1px]",
              tramo.ordinal === resaltado.ordinalActivo
                ? "bg-warn text-[#14161b]"
                : "bg-warn/30 text-inherit",
            )}
          >
            {tramo.texto}
          </mark>
        ),
      )}
    </>
  );
}

/** Eyebrow del handoff: mono 9px / 600 / .13em / uppercase. */
const ETIQUETA = "mb-1 font-mono text-[9px] font-semibold tracking-[0.13em] uppercase";

function EtiquetaRemitente({ sender }: { sender: "ia" | "humano" }) {
  if (sender === "ia") {
    return (
      <span className={`text-brand-hover flex items-center gap-1 ${ETIQUETA}`}>
        <AutoAwesome size={12} />
        Agente IA
      </span>
    );
  }
  return <span className={`text-ink-faint block ${ETIQUETA}`}>Vendedor</span>;
}

/**
 * Burbuja de mensaje. El remitente sale de `sender`, no de `direction`: `ia` y
 * `humano` son ambos salientes pero el handoff los distingue visualmente para
 * que se vea de un vistazo qué escribió el agente y qué escribió una persona.
 * Server component; timestamp estático hh:mm.
 */
export function MessageBubble({
  message,
  resaltado = null,
}: {
  message: Mensaje;
  resaltado?: ResaltadoBusqueda | null;
}) {
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
          // El texto de la burbuja del agente es más cálido que `ink-body`
          // para no chocar con el ámbar del fondo. Sin token en globals.css.
          message.sender === "ia" &&
            "border-brand/22 text-ink-warm rounded-[15px_15px_5px_15px] border",
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
          <p className="break-words whitespace-pre-wrap">
            <TextoDelMensaje texto={message.contenido} resaltado={resaltado} />
          </p>
        ) : null}
        <div className="mt-1 flex items-center justify-end gap-1">
          {message.estado_entrega === "fallido" && message.error_entrega ? (
            <span className="text-danger mr-auto truncate text-[10px]">
              {message.error_entrega}
            </span>
          ) : null}
          <MonoMeta className="text-[9.5px]">{hora}</MonoMeta>
          <AcuseEntrega mensaje={message} claro={message.sender === "humano"} />
        </div>
      </div>
    </div>
  );
}
