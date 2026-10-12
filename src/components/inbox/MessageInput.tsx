"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { AttachFile, Close, Description, LockClock, Schedule, SendIcon } from "@/components/icons";
import { Textarea } from "@/components/ui/textarea";
import { bytesLegibles } from "@/lib/media/formato";
import { ACCEPT_DEL_COMPOSER } from "@/lib/media/limites";
import { elegirAdjunto, subirYEnviarAdjunto } from "@/lib/media/subir-adjunto";
import { clienteNavegador } from "@/lib/realtime/cliente-navegador";
import { esperaLegible } from "@/lib/triage";
import { cn } from "@/lib/utils";
import { estadoVentana, restanteLegible, VENTANA_MS, type Ventana } from "@/lib/ventana";
import type { SendMessageInput } from "@/lib/validation/inbox.schema";
import type { TipoMedia } from "@/lib/media/limites";
import type { Canal } from "@/types/domain";
import type { ActionResult, ResultadoPrepararAdjunto } from "@/types/inbox";
import type { UUID } from "@/types/entities";

/**
 * Barra de estado de la ventana de 24 h. Va arriba del input y no como error
 * después de enviar: es el punto del handoff — la restricción se ve antes de
 * escribir.
 */
function BarraVentana({ ventana }: { ventana: Ventana }) {
  const porVencer = ventana.estado === "por-vencer";
  const proporcion = Math.min(1, Math.max(0, ventana.restanteMs / VENTANA_MS));

  return (
    <div className="mb-2 flex items-center gap-2">
      <Schedule size={13} className={cn("shrink-0", porVencer ? "text-caution" : "text-ok")} />
      <span className={cn("font-mono text-[9.5px]", porVencer ? "text-caution" : "text-ok")}>
        Ventana de 24 h abierta · quedan {restanteLegible(ventana.restanteMs)}
      </span>
      <div className="bg-line-card h-[3px] w-full max-w-[130px] overflow-hidden rounded-full">
        <div
          className={cn("h-full rounded-full", porVencer ? "bg-caution" : "bg-ok")}
          style={{ width: `${proporcion * 100}%` }}
        />
      </div>
    </div>
  );
}

/** "hace 31h" contra el reloj actual. Envuelta para no llamar `Date.now` en el render. */
function desdeHace(iso: string): string {
  return esperaLegible(Date.now() - new Date(iso).getTime());
}

/**
 * Reemplazo del input cuando Meta ya no acepta texto libre. Es un bloque y no
 * un input deshabilitado a propósito: deshabilitado se lee como "algo se rompió",
 * y esto es una regla de la plataforma con una salida concreta.
 */
function VentanaCerrada({ ultimoEntranteIso }: { ultimoEntranteIso: string | null }) {
  return (
    // Fondo cálido oscuro del bloque de aviso
    // del diseño y solo aparece acá y en la tarjeta de cotización del Twin.
    <div className="border-warn/28 bg-surface-warm rounded-[14px] border px-[13px] py-3">
      <div className="flex items-center gap-2">
        <LockClock size={15} className="text-warn shrink-0" />
        <span className="text-warn text-[12px] font-semibold">Ventana de 24 h cerrada</span>
        {ultimoEntranteIso ? (
          <span className="text-ink-faint font-mono text-[9.5px]">
            último mensaje del cliente {desdeHace(ultimoEntranteIso)}
          </span>
        ) : null}
      </div>
      <p className="text-ink-dim mt-1.5 text-[11.5px]">
        Meta no permite mensajes libres. Solo plantillas aprobadas hasta que el cliente vuelva a
        escribir.
      </p>
    </div>
  );
}

interface AdjuntoElegido {
  file: File;
  tipo: TipoMedia;
  /** `blob:` de la miniatura (sólo imágenes). */
  vistaPrevia: string | null;
}

/**
 * Sube directo a Storage con el token que dio el servidor (`createSignedUploadUrl`):
 * un archivo de 16 MB no cabe en el cuerpo de una función de Vercel (4,5 MB), y el
 * panel no tiene permiso de escritura en el bucket.
 */
async function subirAStorage(
  ruta: string,
  token: string,
  archivo: File,
  mime: string,
): Promise<{ ok: boolean }> {
  const cliente = clienteNavegador();
  if (!cliente) return { ok: false };
  const { error } = await cliente.storage
    .from("mensajes_media")
    .uploadToSignedUrl(ruta, token, archivo, { contentType: mime });
  return { ok: error === null };
}

/**
 * El archivo elegido, antes de mandarlo: miniatura o ícono, nombre, tamaño y un
 * botón para quitarlo. `role="group"` con nombre para que el lector de pantalla
 * lo anuncie como una unidad.
 */
function VistaPreviaAdjunto({
  adjunto,
  enviando,
  onQuitar,
}: {
  adjunto: AdjuntoElegido;
  enviando: boolean;
  onQuitar: () => void;
}) {
  // La URL `blob:` se crea al elegir el archivo (`elegirArchivo`) y se libera acá
  // al quitarlo, mandarlo o desmontar: no se crea dentro de un efecto.
  const miniatura = adjunto.vistaPrevia;
  useEffect(
    () => () => {
      if (miniatura) URL.revokeObjectURL(miniatura);
    },
    [miniatura],
  );

  return (
    <div
      role="group"
      aria-label="Archivo para enviar"
      className="border-line-input bg-surface-input mb-2 flex items-center gap-2.5 rounded-[12px] border p-2"
    >
      {miniatura ? (
        // eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:), no hay nada que optimizar.
        <img src={miniatura} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
      ) : (
        <Description size={22} aria-hidden className="text-ink-dim shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-ink-body truncate text-[12px] font-medium">{adjunto.file.name}</p>
        <p className="text-ink-faint font-mono text-[10px]">
          {bytesLegibles(adjunto.file.size)}
          {enviando ? " · enviando…" : ""}
        </p>
      </div>
      <button
        type="button"
        onClick={onQuitar}
        disabled={enviando}
        aria-label="Quitar archivo"
        className="text-ink-dim hover:text-ink-body focus-visible:ring-ring flex h-7 w-7 shrink-0 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none disabled:opacity-45"
      >
        <Close size={14} aria-hidden />
      </button>
    </div>
  );
}

/**
 * Input de envío manual del vendedor. Enter envía, Shift+Enter hace salto de
 * línea (patrón WhatsApp Web). Double-submit mitigado con disabled+isPending.
 *
 * Con `onPrepararAdjunto` y `onEnviarAdjunto` (solo WhatsApp) suma el botón de
 * adjuntar: imagen, video, audio o documento, validados contra los límites de
 * Meta acá y de nuevo en el servidor. Lo escrito en la caja va de texto del
 * archivo (excepto en un audio, que no lleva texto).
 */
export function MessageInput({
  leadId,
  sessionId,
  canal,
  ventana,
  ultimoEntranteIso,
  onSend,
  onPrepararAdjunto,
  onEnviarAdjunto,
}: {
  leadId: UUID;
  sessionId: UUID;
  canal: Canal;
  ventana: Ventana;
  /** `created_at` del último mensaje del cliente: desde ahí se mide la ventana. */
  ultimoEntranteIso: string | null;
  onSend: (input: SendMessageInput) => Promise<ActionResult>;
  onPrepararAdjunto?: (input: unknown) => Promise<ResultadoPrepararAdjunto>;
  onEnviarAdjunto?: (input: unknown) => Promise<ActionResult>;
}) {
  const [body, setBody] = useState("");
  const [adjunto, setAdjunto] = useState<AdjuntoElegido | null>(null);
  const inputArchivo = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();

  // La ventana se recalcula en cliente: con la pestaña abierta una hora, el
  // valor que renderizó el server miente. Hasta el primer tick vale el del
  // server —que es fresco en ese momento— y así la hidratación no discrepa.
  const [ahora, setAhora] = useState<Date | null>(null);
  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const viva =
    ahora === null
      ? ventana
      : estadoVentana(ultimoEntranteIso === null ? null : new Date(ultimoEntranteIso), ahora);

  const cerrada = viva.estado === "cerrada";
  const abierta = viva.estado === "abierta" || viva.estado === "por-vencer";

  const puedeAdjuntar =
    canal === "wa" && onPrepararAdjunto !== undefined && onEnviarAdjunto !== undefined;

  const elegirArchivo = (file: File | undefined) => {
    if (!file) return;
    const elegido = elegirAdjunto(file);
    if (!elegido.ok) {
      toast.error(elegido.mensaje);
      return;
    }
    setAdjunto({
      file,
      tipo: elegido.tipo,
      vistaPrevia: elegido.tipo === "image" ? URL.createObjectURL(file) : null,
    });
  };

  const submit = () => {
    const trimmed = body.trim();
    if (isPending || cerrada) return;

    if (adjunto && onPrepararAdjunto && onEnviarAdjunto) {
      startTransition(async () => {
        const result = await subirYEnviarAdjunto({
          leadId,
          sessionId,
          canal,
          archivo: adjunto.file,
          // El audio no admite texto: lo escrito se queda en la caja.
          caption: adjunto.tipo === "audio" ? "" : trimmed,
          preparar: onPrepararAdjunto,
          subir: subirAStorage,
          enviar: onEnviarAdjunto,
        });
        if (result.ok) {
          setAdjunto(null);
          if (adjunto.tipo !== "audio") setBody("");
        } else {
          toast.error(result.error);
        }
      });
      return;
    }

    if (!trimmed) return;
    startTransition(async () => {
      const result = await onSend({ leadId, sessionId, canal, body: trimmed });
      if (result.ok) {
        setBody("");
      } else {
        toast.error(result.error);
      }
    });
  };

  if (cerrada) {
    return (
      <div className="border-line-layout bg-surface-chat border-t px-[26px] py-3">
        <VentanaCerrada ultimoEntranteIso={ultimoEntranteIso} />
      </div>
    );
  }

  return (
    <div className="border-line-layout bg-surface-chat border-t px-[26px] py-3">
      {abierta ? <BarraVentana ventana={viva} /> : null}
      {adjunto ? (
        <VistaPreviaAdjunto
          adjunto={adjunto}
          enviando={isPending}
          onQuitar={() => setAdjunto(null)}
        />
      ) : null}
      <div className="border-line-input bg-surface-input flex items-end gap-2 rounded-[14px] border py-[9px] pr-[10px] pl-[14px]">
        {puedeAdjuntar ? (
          <>
            <input
              ref={inputArchivo}
              type="file"
              accept={ACCEPT_DEL_COMPOSER}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                elegirArchivo(e.target.files?.[0]);
                // Sin esto, elegir de nuevo el mismo archivo no dispara `change`.
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => inputArchivo.current?.click()}
              disabled={isPending}
              aria-label="Adjuntar archivo"
              title="Adjuntar imagen, video, audio o documento"
              className="text-ink-dim hover:text-ink-body focus-visible:ring-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-45"
            >
              <AttachFile size={16} aria-hidden />
            </button>
          </>
        ) : null}
        {/* Los `dark:bg-input/30` y `disabled:bg-input/80` del primitivo de
            shadcn pintan un rectángulo adentro de la caja: hay que apagarlos
            con la misma variante, porque no colisionan con `bg-transparent`. */}
        <div className="min-w-0 flex-1">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              adjunto
                ? adjunto.tipo === "audio"
                  ? "Un audio va sin texto"
                  : "Agregá un texto al archivo (opcional)…"
                : "Escribí un mensaje…"
            }
            aria-label={adjunto ? "Texto del archivo" : "Mensaje"}
            disabled={isPending || adjunto?.tipo === "audio"}
            className="text-ink-body placeholder:text-ink-ghost max-h-40 min-h-8 w-full resize-none rounded-none border-0 bg-transparent p-0 text-[12.5px] focus-visible:ring-0 disabled:bg-transparent md:text-[12.5px] dark:bg-transparent dark:disabled:bg-transparent"
          />
          <p className="text-ink-ghost font-mono text-[10px]">
            Enter envía · ⇧Enter salto de línea
          </p>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={isPending || (body.trim().length === 0 && !adjunto)}
          aria-label={adjunto ? "Enviar archivo" : "Enviar"}
          className="bg-brand text-brand-ink flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] transition-opacity disabled:opacity-45"
          style={{
            boxShadow: "0 3px 12px color-mix(in srgb, var(--color-brand-deep) 30%, transparent)",
          }}
        >
          <SendIcon size={15} />
        </button>
      </div>
    </div>
  );
}
