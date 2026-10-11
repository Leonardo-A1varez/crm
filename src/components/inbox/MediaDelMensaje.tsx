"use client";

import { useState } from "react";
import { Description, DownloadIcon, ErrorIcon, Refresh, Schedule } from "@/components/icons";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { bytesLegibles } from "@/lib/media/formato";
import { esMimeEnLinea, tipoDeMime } from "@/lib/media/limites";
import { cn } from "@/lib/utils";
import type { MensajeMedia } from "@/types/entities";

/**
 * El archivo de un mensaje de WhatsApp en el hilo del Inbox (docs/meta/media.md).
 *
 * Todo sale de `/api/media/<mensajeId>`: una ruta con sesión que redirige a una
 * URL firmada de pocos minutos. Este componente nunca ve ni guarda una URL del
 * bucket, y nada de lo que dibuja es HTML de un tercero: el nombre del archivo
 * entra como texto de React. Sólo imagen, audio y video de tipos reconocidos se
 * muestran en línea; el resto (documentos, binarios sin tipo) es una tarjeta de
 * descarga que el navegador nunca interpreta.
 */

const MOTIVOS: Record<string, string> = {
  media_no_disponible:
    "El archivo ya no está disponible en WhatsApp (los archivos duran 7 días en sus servidores).",
  sin_id_de_media: "WhatsApp no informó el archivo de este mensaje.",
  reintentos_agotados: "No se pudo descargar el archivo. Pedile al cliente que lo reenvíe.",
  demasiado_grande: "El archivo pesa más de 50 MB y no se guarda en el CRM.",
  historial_viejo:
    "Archivo de hace más de 14 días: WhatsApp ya no lo entrega al importar el historial.",
};

interface Props {
  mensajeId: string;
  /** Un sticker se muestra chico, sin ampliar. */
  sticker: boolean;
  /** Nota de voz grabada con el micrófono de WhatsApp. */
  voz: boolean;
  media: Pick<MensajeMedia, "estado" | "mime" | "nombre" | "bytes" | "error">;
}

export function MediaDelMensaje({ mensajeId, sticker, voz, media }: Props) {
  const url = `/api/media/${mensajeId}`;

  if (media.estado === "pendiente") {
    return (
      <p role="status" className="flex items-center gap-1.5 italic opacity-80">
        <Schedule size={13} aria-hidden className="shrink-0" />
        Descargando archivo…
      </p>
    );
  }

  if (media.estado === "fallido" || media.estado === "omitido") {
    return (
      <p className="flex items-start gap-1.5 opacity-80">
        <ErrorIcon size={13} aria-hidden className="mt-[2px] shrink-0" />
        <span>
          {MOTIVOS[media.error ?? ""] ?? "No se pudo guardar el archivo de este mensaje."}
        </span>
      </p>
    );
  }

  const mime = media.mime ?? "";
  if (esMimeEnLinea(mime)) {
    const tipo = tipoDeMime(mime);
    if (tipo === "image") return <Imagen url={url} sticker={sticker} />;
    if (tipo === "audio") return <Audio url={url} voz={voz} />;
    return <Video url={url} />;
  }
  return <TarjetaDeDocumento url={url} media={media} />;
}

/** Reintento: un `?r=n` distinto salta el caché del redirect que dio error. */
function useReintento(url: string) {
  const [fallo, setFallo] = useState(false);
  const [intento, setIntento] = useState(0);
  const src = intento === 0 ? url : `${url}?r=${intento}`;
  return {
    fallo,
    src,
    alFallar: () => setFallo(true),
    reintentar: () => {
      setFallo(false);
      setIntento((n) => n + 1);
    },
  };
}

function ErrorDeCarga({ alReintentar }: { alReintentar: () => void }) {
  return (
    <p className="flex items-center gap-2 opacity-90">
      <ErrorIcon size={13} aria-hidden className="shrink-0" />
      <span>No se pudo cargar el archivo.</span>
      <button
        type="button"
        onClick={alReintentar}
        className="inline-flex items-center gap-1 underline underline-offset-2"
      >
        <Refresh size={12} aria-hidden />
        Reintentar
      </button>
    </p>
  );
}

function Imagen({ url, sticker }: { url: string; sticker: boolean }) {
  const { fallo, src, alFallar, reintentar } = useReintento(url);
  const [abierta, setAbierta] = useState(false);
  if (fallo) return <ErrorDeCarga alReintentar={reintentar} />;

  const etiqueta = sticker ? "Sticker" : "Imagen";
  return (
    <>
      {sticker ? (
        // eslint-disable-next-line @next/next/no-img-element -- la URL es un redirect con sesión a una URL firmada: el optimizador de next/image no la puede pedir.
        <img
          src={src}
          alt={etiqueta}
          loading="lazy"
          onError={alFallar}
          className="h-[128px] w-[128px] object-contain"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAbierta(true)}
          aria-label="Ampliar imagen"
          className="focus-visible:ring-ring block cursor-zoom-in overflow-hidden rounded-[10px] focus-visible:ring-2 focus-visible:outline-none"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- ídem: redirect con sesión. */}
          <img
            src={src}
            alt={etiqueta}
            loading="lazy"
            onError={alFallar}
            className="max-h-[240px] max-w-[260px] object-cover"
          />
        </button>
      )}
      {abierta ? (
        <Dialog open onOpenChange={(abre) => !abre && setAbierta(false)}>
          <DialogContent className="max-h-[92vh] sm:max-w-4xl">
            <DialogTitle className="sr-only">Imagen de la conversación</DialogTitle>
            <DialogDescription className="sr-only">
              Vista ampliada. Escape o el botón de cerrar vuelven a la conversación.
            </DialogDescription>
            {/* eslint-disable-next-line @next/next/no-img-element -- ídem: redirect con sesión. */}
            <img
              src={url}
              alt={etiqueta}
              className="mx-auto max-h-[78vh] max-w-full rounded-md object-contain"
            />
            <a
              href={`${url}?descargar=1`}
              download
              className="text-ink-dim hover:text-ink-body inline-flex items-center justify-center gap-1.5 text-[12px] underline underline-offset-2"
            >
              <DownloadIcon size={14} aria-hidden />
              Descargar imagen
            </a>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

function Audio({ url, voz }: { url: string; voz: boolean }) {
  const { fallo, src, alFallar, reintentar } = useReintento(url);
  if (fallo) return <ErrorDeCarga alReintentar={reintentar} />;
  return (
    <audio
      controls
      preload="none"
      src={src}
      onError={alFallar}
      aria-label={voz ? "Nota de voz" : "Audio"}
      className="h-10 w-[240px] max-w-full"
    />
  );
}

function Video({ url }: { url: string }) {
  const { fallo, src, alFallar, reintentar } = useReintento(url);
  if (fallo) return <ErrorDeCarga alReintentar={reintentar} />;
  return (
    <video
      controls
      preload="metadata"
      src={src}
      onError={alFallar}
      aria-label="Video"
      className="max-h-[260px] max-w-full rounded-[10px]"
    />
  );
}

function TarjetaDeDocumento({
  url,
  media,
}: {
  url: string;
  media: Pick<MensajeMedia, "nombre" | "bytes">;
}) {
  const tamano = bytesLegibles(media.bytes);
  return (
    <div className={cn("flex items-center gap-2.5 rounded-[10px] border border-current/20 p-2")}>
      <Description size={22} aria-hidden className="shrink-0 opacity-80" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{media.nombre ?? "Archivo"}</p>
        {tamano ? <p className="text-[10.5px] opacity-70">{tamano}</p> : null}
      </div>
      <a
        href={`${url}?descargar=1`}
        download
        className="focus-visible:ring-ring inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11.5px] underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
      >
        <DownloadIcon size={14} aria-hidden />
        Descargar
      </a>
    </div>
  );
}
