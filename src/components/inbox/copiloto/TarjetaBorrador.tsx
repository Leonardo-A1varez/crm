"use client";

import { format } from "date-fns";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AutoAwesome,
  DuplicateIcon,
  OpenInNew,
  Refresh,
  SendIcon,
  Warning,
} from "@/components/icons";
import { useContextoCopiloto } from "@/components/inbox/copiloto/ContextoCopiloto";
import { Textarea } from "@/components/ui/textarea";
import { ETIQUETA_PRINCIPAL, accionesDeTarjeta } from "@/lib/copiloto/acciones";
import { etiquetaUso, mensajeDeErrorBorrador } from "@/lib/copiloto/etiquetas";
import { LARGO_MAXIMO_BORRADOR } from "@/lib/copiloto/limites";
import { textoEnviable, urlWhatsAppWeb } from "@/lib/copiloto/whatsapp-web";
import type { RegenerarBorradorInput, UsarBorradorInput } from "@/lib/validation/copiloto.schema";
import type { SendMessageInput } from "@/lib/validation/inbox.schema";
import { cn } from "@/lib/utils";
import type { BorradorVista, ViaUsoBorrador } from "@/types/copiloto";
import type { Canal } from "@/types/domain";
import type { UUID } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

/**
 * Cuánto esperar a que aparezca el borrador regenerado antes de dejar de decir
 * "Redactando…". La función de Inngest puede terminar en `omitido` (borrador ya
 * no vigente, sesión cerrada) o descartarse por su dedup de 24 h por borrador, y
 * en ninguno de los dos casos la Server Action lo sabe: devuelve ok igual.
 */
const ESPERA_REGENERAR_MS = 45_000;

const AVISO_SIN_BORRADOR_NUEVO =
  "No se pudo regenerar el borrador. Probá de nuevo o redactá a mano.";

const BASE_BOTON =
  "focus-visible:ring-ring/50 inline-flex h-8 items-center gap-1.5 rounded-[9px] px-3 text-[11.5px] font-semibold whitespace-nowrap transition-[background-color,color,opacity,transform] duration-150 ease-out focus-visible:ring-3 focus-visible:outline-none disabled:opacity-45 motion-safe:enabled:active:scale-[0.97]";
const BOTON_PRINCIPAL = cn(BASE_BOTON, "bg-brand text-brand-ink hover:bg-brand-hover");
const BOTON_SECUNDARIO = cn(
  BASE_BOTON,
  "border-line-card text-ink-secondary hover:bg-surface-elevated border bg-transparent",
);

interface Props {
  leadId: UUID;
  sessionId: UUID;
  canal: Canal;
  borrador: BorradorVista;
  onUsar: (input: UsarBorradorInput) => Promise<ActionResult>;
  onRegenerar: (input: RegenerarBorradorInput) => Promise<ActionResult>;
  /** "Al composer": el mismo envío por la API que el composer (`sendMessageAction`). */
  onEnviar: (input: SendMessageInput) => Promise<ActionResult>;
}

/**
 * La tarjeta del copiloto (§5): el borrador que la IA redactó, editable, con las
 * acciones que correspondan al contexto (app de escritorio en WhatsApp Web, app
 * de escritorio en Hilo del CRM, o navegador). El copiloto es solo de WhatsApp:
 * en Instagram y Messenger no hay tarjeta.
 *
 * El texto que la persona edita vive acá, en el estado de la tarjeta y **atado al
 * id del borrador**: el refresco de 5 s del Inbox vuelve a renderizar con un
 * objeto nuevo del mismo borrador y no puede pisar lo que se está escribiendo; un
 * borrador distinto sí resetea el texto. Vive en este nivel (y no en el cuerpo
 * que se desmonta mientras dice "Redactando…") para que un Regenerar que falla
 * no se lleve lo que la persona había escrito. La edición no se persiste (§5).
 */
export function TarjetaBorrador(props: Props) {
  if (props.canal !== "wa") return null;
  return <TarjetaWhatsApp {...props} />;
}

function TarjetaWhatsApp({
  leadId,
  sessionId,
  canal,
  borrador,
  onUsar,
  onRegenerar,
  onEnviar,
}: Props) {
  const [edicion, setEdicion] = useState<{ id: UUID; texto: string } | null>(null);
  const texto = edicion?.id === borrador.id ? edicion.texto : (borrador.contenido ?? "");

  // Regenerar es asíncrono (la función Inngest arranca el borrador nuevo unos
  // segundos después): hasta que llegue uno con otro id se muestra "Redactando…".
  const [pedido, setPedido] = useState<{ de: UUID; vencido: boolean } | null>(null);
  const regenerando = pedido !== null && pedido.de === borrador.id && !pedido.vencido;
  const sinBorradorNuevo = pedido !== null && pedido.de === borrador.id && pedido.vencido;

  useEffect(() => {
    if (!regenerando) return;
    const id = borrador.id;
    const t = setTimeout(
      () => setPedido((p) => (p !== null && p.de === id ? { ...p, vencido: true } : p)),
      ESPERA_REGENERAR_MS,
    );
    return () => clearTimeout(t);
  }, [regenerando, borrador.id]);

  const pedirRegenerar = () => {
    const id = borrador.id;
    setPedido({ de: id, vencido: false });
    const fallo = (mensaje: string) => {
      setPedido((p) => (p !== null && p.de === id ? null : p));
      toast.error(mensaje);
    };
    onRegenerar({ leadId, borradorId: id }).then(
      (r) => {
        if (!r.ok) fallo(r.error);
      },
      () => fallo("No se pudo pedir un borrador nuevo. Reintentá."),
    );
  };

  // Marca local de "ya usado": el refresco que trae el estado real tarda hasta 5 s
  // y en ese lapso un segundo clic en "Al composer" reenviaría el mensaje.
  const [usadoLocal, setUsadoLocal] = useState<{ id: UUID; via: ViaUsoBorrador } | null>(null);
  const usadoAhora = usadoLocal !== null && usadoLocal.id === borrador.id ? usadoLocal.via : null;
  const usado = borrador.estado === "usado" || usadoAhora !== null;
  const via = borrador.usadoVia ?? usadoAhora;

  const redactando = borrador.estado === "redactando" || (regenerando && !usado);

  const hora = (
    <time
      dateTime={borrador.creadoAt}
      suppressHydrationWarning
      className="text-ink-faint font-mono text-[9.5px]"
    >
      {format(new Date(borrador.creadoAt), "HH:mm")}
    </time>
  );
  const origen =
    borrador.origen === "regla" ? `Regla: ${borrador.reglaNombre ?? "sin nombre"}` : "IA";

  return (
    <section
      aria-label="Borrador de la IA"
      className={cn(
        "border-line-layout bg-surface-panel shrink-0 border-t px-[26px] py-3",
        usado && "opacity-60",
      )}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <AutoAwesome size={13} className="text-brand shrink-0" aria-hidden />
        <span className="text-ink-secondary text-[11.5px] font-semibold">
          Borrador de la IA · {origen}
        </span>
        {hora}
      </div>

      {redactando ? (
        <Redactando />
      ) : borrador.estado === "error" ? (
        <Fallo
          borrador={borrador}
          sinBorradorNuevo={sinBorradorNuevo}
          onReintentar={pedirRegenerar}
        />
      ) : (
        <Cuerpo
          key={borrador.id}
          leadId={leadId}
          sessionId={sessionId}
          canal={canal}
          borrador={borrador}
          texto={texto}
          onTexto={(t) => setEdicion({ id: borrador.id, texto: t })}
          usado={usado}
          via={via}
          sinBorradorNuevo={sinBorradorNuevo}
          onUsar={onUsar}
          onEnviar={onEnviar}
          onUsado={(v) => setUsadoLocal({ id: borrador.id, via: v })}
          onRegenerar={pedirRegenerar}
        />
      )}
    </section>
  );
}

function Redactando() {
  return (
    <div role="status" className="flex flex-col gap-1.5">
      <span className="text-ink-dim text-[12px]">Redactando…</span>
      <div aria-hidden className="flex flex-col gap-1.5 motion-safe:animate-pulse">
        <div className="bg-surface-elevated h-2.5 w-[80%] rounded-full" />
        <div className="bg-surface-elevated h-2.5 w-[55%] rounded-full" />
      </div>
    </div>
  );
}

function Fallo({
  borrador,
  sinBorradorNuevo,
  onReintentar,
}: {
  borrador: BorradorVista;
  sinBorradorNuevo: boolean;
  onReintentar: () => void;
}) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3">
      <Warning size={14} className="text-danger shrink-0" aria-hidden />
      <p className="text-danger min-w-0 flex-1 text-[12px] text-pretty">
        {mensajeDeErrorBorrador(borrador.errorCodigo)}
        {sinBorradorNuevo ? ` ${AVISO_SIN_BORRADOR_NUEVO}` : null}
      </p>
      <button type="button" onClick={onReintentar} className={BOTON_SECUNDARIO}>
        <Refresh size={13} aria-hidden />
        Reintentar
      </button>
    </div>
  );
}

interface PropsCuerpo {
  leadId: UUID;
  sessionId: UUID;
  canal: Canal;
  borrador: BorradorVista;
  texto: string;
  onTexto: (texto: string) => void;
  usado: boolean;
  via: ViaUsoBorrador | null;
  sinBorradorNuevo: boolean;
  onUsar: (input: UsarBorradorInput) => Promise<ActionResult>;
  onEnviar: (input: SendMessageInput) => Promise<ActionResult>;
  onUsado: (via: ViaUsoBorrador) => void;
  onRegenerar: () => void;
}

function Cuerpo({
  leadId,
  sessionId,
  canal,
  borrador,
  texto,
  onTexto,
  usado,
  via,
  sinBorradorNuevo,
  onUsar,
  onEnviar,
  onUsado,
  onRegenerar,
}: PropsCuerpo) {
  const { ubicacion, telefono, insertarEnWhatsApp } = useContextoCopiloto();
  const [enCurso, setEnCurso] = useState<"insertar" | "copiar" | "al_composer" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const enlaceRef = useRef<HTMLAnchorElement>(null);

  // El foco va al texto del borrador (§5), pero sin robárselo a otro campo: el
  // refresco no remonta este componente (misma `key`), así que solo corre al
  // aparecer un borrador nuevo.
  useEffect(() => {
    if (!usado && document.activeElement === document.body) areaRef.current?.focus();
  }, [usado]);

  const telefonoAbrible = telefono !== null && urlWhatsAppWeb(telefono, "") !== null;
  const acciones = accionesDeTarjeta(ubicacion, telefonoAbrible);
  const valido = textoEnviable(texto);
  const enviable = valido.ok && enCurso === null && !usado;
  const textoFinal = valido.ok ? valido.texto : "";
  const url =
    acciones.principal === "abrir_web" && telefono !== null && valido.ok
      ? urlWhatsAppWeb(telefono, valido.texto)
      : null;

  /** Registra el uso. `false` si la action devolvió error o reventó (ya avisó con un toast). */
  const marcar = async (v: ViaUsoBorrador): Promise<boolean> => {
    try {
      const u = await onUsar({ leadId, borradorId: borrador.id, via: v, texto: textoFinal });
      if (!u.ok) {
        toast.error(u.error);
        return false;
      }
      onUsado(v);
      return true;
    } catch {
      toast.error("No se pudo registrar el uso del borrador.");
      return false;
    }
  };

  const correr = async (
    cual: "insertar" | "copiar" | "al_composer",
    tarea: () => Promise<void>,
  ) => {
    if (!enviable) return;
    setEnCurso(cual);
    setError(null);
    try {
      await tarea();
    } catch {
      toast.error("Algo salió mal. Reintentá.");
    } finally {
      setEnCurso(null);
    }
  };

  const insertar = () =>
    correr("insertar", async () => {
      const r = await insertarEnWhatsApp(textoFinal);
      if (!r.ok) {
        setError(`${r.error} Podés usar Copiar.`);
        return;
      }
      await marcar("insertar");
    });

  const copiar = () =>
    correr("copiar", async () => {
      try {
        await navigator.clipboard.writeText(textoFinal);
      } catch {
        setError("No se pudo copiar al portapapeles. Seleccioná el texto y copialo a mano.");
        return;
      }
      if (await marcar("copiar")) toast.success("Copiado");
    });

  const alComposer = () =>
    correr("al_composer", async () => {
      const e = await onEnviar({ leadId, sessionId, canal, body: textoFinal });
      if (!e.ok) {
        toast.error(e.error);
        return;
      }
      // Ya salió por la API: se bloquea el reenvío aunque falle el registro del uso.
      onUsado("al_composer");
      await marcar("al_composer");
    });

  const abrirWeb = () => {
    void marcar("abrir_web");
  };

  /** Ctrl+Enter = la acción principal; sin ninguna, la más segura que exista. */
  const accionDeTeclado = () => {
    if (acciones.principal === "insertar") return void insertar();
    if (acciones.principal === "abrir_web") return enlaceRef.current?.click();
    if (acciones.alComposer) return void alComposer();
    return void copiar();
  };
  const nombreAccionDeTeclado =
    acciones.principal !== null
      ? ETIQUETA_PRINCIPAL[acciones.principal]
      : acciones.alComposer
        ? "Al composer"
        : "Copiar";

  const idAyuda = `${borrador.id}-ayuda`;
  const largo = texto.trim().length;
  const conContador = largo > LARGO_MAXIMO_BORRADOR - 200;
  const pasado = !valido.ok && valido.motivo === "largo";

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        ref={areaRef}
        value={texto}
        onChange={(e) => onTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            accionDeTeclado();
          }
        }}
        // `readOnly` y no `disabled` mientras se envía: el campo no pierde el foco.
        readOnly={usado || enCurso !== null}
        aria-label="Texto del borrador"
        aria-invalid={pasado ? true : undefined}
        aria-describedby={idAyuda}
        // Como en `MessageInput`: hay que apagar las variantes `dark:` del primitivo de shadcn
        // (`dark:bg-input/30`, `dark:disabled:bg-input/80`) con la misma variante.
        className="text-ink-body border-line-input bg-surface-input dark:bg-surface-input dark:disabled:bg-surface-input max-h-40 min-h-[56px] w-full resize-none rounded-[12px] border px-3 py-2 text-[12.5px] md:text-[12.5px]"
      />
      <p id={idAyuda} className="text-ink-ghost font-mono text-[10px]">
        {usado ? etiquetaUso(via) : `Ctrl+Enter · ${nombreAccionDeTeclado}`}
        {conContador ? (
          <span className={cn("ml-2 tabular-nums", pasado && "text-danger")}>
            {largo} / {LARGO_MAXIMO_BORRADOR}
            {pasado ? ` · sobran ${valido.exceso}` : null}
          </span>
        ) : null}
      </p>

      {error ? (
        <p role="alert" className="text-danger text-[11.5px] text-pretty">
          {error}
        </p>
      ) : null}
      {sinBorradorNuevo ? (
        <p role="alert" className="text-danger text-[11.5px] text-pretty">
          {AVISO_SIN_BORRADOR_NUEVO}
        </p>
      ) : null}

      {usado ? null : (
        <div className="flex flex-wrap items-center gap-2">
          {acciones.principal === "insertar" ? (
            <button
              type="button"
              onClick={() => void insertar()}
              disabled={!enviable}
              aria-busy={enCurso === "insertar"}
              className={BOTON_PRINCIPAL}
            >
              <SendIcon size={13} aria-hidden />
              {enCurso === "insertar" ? "Insertando…" : ETIQUETA_PRINCIPAL.insertar}
            </button>
          ) : null}
          {acciones.principal === "abrir_web" ? (
            url !== null && enviable ? (
              <a
                ref={enlaceRef}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={abrirWeb}
                className={BOTON_PRINCIPAL}
              >
                <OpenInNew size={13} aria-hidden />
                {ETIQUETA_PRINCIPAL.abrir_web}
                <span className="sr-only"> (se abre en una pestaña nueva)</span>
              </a>
            ) : (
              // Sin URL válida (texto vacío o pasado de 4096) un enlace sin href no tiene
              // rol de enlace ni foco: un botón deshabilitado es lo que lee el lector de pantalla.
              <button type="button" disabled className={BOTON_PRINCIPAL}>
                <OpenInNew size={13} aria-hidden />
                {ETIQUETA_PRINCIPAL.abrir_web}
              </button>
            )
          ) : null}
          {acciones.alComposer ? (
            <button
              type="button"
              onClick={() => void alComposer()}
              disabled={!enviable}
              aria-busy={enCurso === "al_composer"}
              className={BOTON_SECUNDARIO}
            >
              Al composer
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void copiar()}
            disabled={!enviable}
            className={BOTON_SECUNDARIO}
          >
            <DuplicateIcon size={13} aria-hidden />
            Copiar
          </button>
          <button
            type="button"
            onClick={onRegenerar}
            disabled={enCurso !== null}
            className={BOTON_SECUNDARIO}
          >
            <Refresh size={13} aria-hidden />
            Regenerar
          </button>
        </div>
      )}
    </div>
  );
}
