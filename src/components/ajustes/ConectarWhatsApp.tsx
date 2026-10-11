"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { BadgeSalud } from "@/components/ajustes/BadgeSalud";
import { SeccionAjuste } from "@/components/ajustes/SeccionAjuste";
import { Done, ErrorIcon, Remove, Schedule } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  leerMensajeEmbeddedSignup,
  opcionesDeLogin,
  type MensajeEmbeddedSignup,
  type OpcionesFbLogin,
} from "@/lib/meta/embedded-signup";
import type { Descriptor } from "@/components/ajustes/descriptores";
import type { EstadoPaso, NumeroConectadoVista } from "@/components/ajustes/conectados";

/**
 * "Conectar WhatsApp": el número que ya usa la app WhatsApp Business entra al
 * CRM sin dejar de andar en el teléfono (coexistencia, registro insertado v4).
 * Diseño y fuentes: docs/meta/conectar-whatsapp.md.
 *
 * El SDK de Facebook se carga sólo acá, cuando un admin abre esta pestaña y la
 * configuración está completa. El popup devuelve dos cosas por caminos
 * distintos: el código (callback de `FB.login`) y la cuenta (`postMessage`).
 * Se espera a tener las dos y se mandan al servidor, que canjea el código: el
 * token del negocio nunca pasa por el navegador.
 */

const SDK_URL = "https://connect.facebook.net/en_US/sdk.js";
const SDK_ID = "facebook-jssdk";
/** El código vive 30 s: si la cuenta no llega en este tiempo, no tiene sentido seguir. */
const ESPERA_CUENTA_MS = 15_000;

interface RespuestaFbLogin {
  authResponse?: { code?: string } | null;
  status?: string;
}

interface FbSdk {
  init(opciones: {
    appId: string;
    autoLogAppEvents: boolean;
    xfbml: boolean;
    version: string;
  }): void;
  login(callback: (r: RespuestaFbLogin) => void, opciones: OpcionesFbLogin): void;
}

declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

export type ConfiguracionConectar =
  | { estado: "lista"; appId: string; configId: string; graphVersion: string }
  | { estado: "incompleta"; faltan: readonly string[] };

export type ConectarWhatsAppAccion = (input: {
  code: string;
  wabaId: string;
  phoneNumberId: string | null;
  evento: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" | "FINISH";
}) => Promise<{ ok: true; numero: string } | { ok: false; error: string }>;

type Fase =
  | { tipo: "inactivo" }
  | { tipo: "esperando-meta" }
  | { tipo: "conectando" }
  | { tipo: "conectado"; numero: string }
  | { tipo: "error"; mensaje: string };

const PASO: Record<EstadoPaso, Descriptor> = {
  ok: { label: "Listo", glifo: Done, color: "var(--color-ok)" },
  en_curso: { label: "En curso", glifo: Schedule, color: "var(--color-info)" },
  pendiente: { label: "Pendiente", glifo: Schedule, color: "var(--color-ink-faint)" },
  omitido: { label: "No aplica", glifo: Remove, color: "var(--color-ink-faint)" },
  error: { label: "Revisar", glifo: ErrorIcon, color: "var(--color-danger)" },
};

function useSdkDeFacebook(
  config: ConfiguracionConectar,
): "cargando" | "listo" | "error" | "apagado" {
  const [estado, setEstado] = useState<"cargando" | "listo" | "error" | "apagado">(
    config.estado === "lista" ? "cargando" : "apagado",
  );
  const appId = config.estado === "lista" ? config.appId : null;
  const version = config.estado === "lista" ? config.graphVersion : null;

  useEffect(() => {
    if (appId === null || version === null) return;
    const iniciar = () => {
      window.FB?.init({ appId, autoLogAppEvents: true, xfbml: true, version });
      setEstado("listo");
    };
    if (window.FB) {
      iniciar();
      return;
    }
    window.fbAsyncInit = iniciar;
    if (document.getElementById(SDK_ID)) return;
    const s = document.createElement("script");
    s.id = SDK_ID;
    s.src = SDK_URL;
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => setEstado("error");
    document.body.appendChild(s);
  }, [appId, version]);

  return estado;
}

export function ConectarWhatsApp({
  configuracion,
  numeros,
  conectar,
}: {
  configuracion: ConfiguracionConectar;
  numeros: readonly NumeroConectadoVista[];
  /** `null` = quien mira no es admin: sin botón. */
  conectar: ConectarWhatsAppAccion | null;
}) {
  const sdk = useSdkDeFacebook(conectar ? configuracion : { estado: "incompleta", faltan: [] });
  const [fase, setFase] = useState<Fase>({ tipo: "inactivo" });
  const [, iniciar] = useTransition();
  const codigo = useRef<string | null>(null);
  const cuenta = useRef<Extract<MensajeEmbeddedSignup, { tipo: "exito" }> | null>(null);
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);

  const terminar = useCallback((f: Fase) => {
    if (espera.current) clearTimeout(espera.current);
    espera.current = null;
    codigo.current = null;
    cuenta.current = null;
    setFase(f);
  }, []);

  const intentarConectar = useCallback(() => {
    const code = codigo.current;
    const c = cuenta.current;
    if (!code || !c || !conectar) return;
    codigo.current = null;
    setFase({ tipo: "conectando" });
    iniciar(async () => {
      const r = await conectar({
        code,
        wabaId: c.wabaId,
        phoneNumberId: c.phoneNumberId,
        evento: c.evento,
      });
      terminar(
        r.ok ? { tipo: "conectado", numero: r.numero } : { tipo: "error", mensaje: r.error },
      );
    });
  }, [conectar, terminar]);

  // El popup avisa por postMessage. Sólo se escucha mientras se espera a Meta.
  useEffect(() => {
    if (fase.tipo !== "esperando-meta") return;
    const alMensaje = (e: MessageEvent) => {
      const m = leerMensajeEmbeddedSignup(e.origin, e.data);
      if (m === null) return;
      if (m.tipo === "exito") {
        cuenta.current = m;
        intentarConectar();
      } else if (m.tipo === "cancelado") {
        terminar({ tipo: "error", mensaje: "Se cerró la ventana de Meta antes de terminar." });
      } else {
        terminar({ tipo: "error", mensaje: `Meta informó un error: ${m.mensaje}` });
      }
    };
    window.addEventListener("message", alMensaje);
    return () => window.removeEventListener("message", alMensaje);
  }, [fase.tipo, intentarConectar, terminar]);

  useEffect(
    () => () => {
      if (espera.current) clearTimeout(espera.current);
    },
    [],
  );

  function abrirMeta() {
    if (configuracion.estado !== "lista" || !window.FB) return;
    codigo.current = null;
    cuenta.current = null;
    setFase({ tipo: "esperando-meta" });
    // El SDK exige una función común (no async) como callback.
    window.FB.login((r) => {
      const code = r.authResponse?.code;
      if (!code) {
        terminar({ tipo: "error", mensaje: "No se completó el inicio de sesión en Meta." });
        return;
      }
      codigo.current = code;
      if (cuenta.current) {
        intentarConectar();
        return;
      }
      espera.current = setTimeout(() => {
        if (codigo.current) {
          terminar({
            tipo: "error",
            mensaje: "Meta no devolvió la cuenta de WhatsApp Business. Probá de nuevo.",
          });
        }
      }, ESPERA_CUENTA_MS);
    }, opcionesDeLogin(configuracion.configId));
  }

  const ocupado = fase.tipo === "esperando-meta" || fase.tipo === "conectando";
  const puede = conectar !== null && configuracion.estado === "lista" && sdk === "listo";

  return (
    <SeccionAjuste
      titulo="Conectar WhatsApp"
      nota="El número sigue andando en la app WhatsApp Business del teléfono. Lo que se mande desde la app también aparece en el Inbox, sin que conteste el agente."
      acciones={
        conectar ? (
          <Button type="button" size="sm" onClick={abrirMeta} disabled={!puede || ocupado}>
            {fase.tipo === "esperando-meta"
              ? "Esperando a Meta…"
              : fase.tipo === "conectando"
                ? "Conectando…"
                : "Conectar WhatsApp"}
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-ink-secondary max-w-[68ch] text-[12px] leading-relaxed text-pretty">
          Conectá el número que ya usás en la app WhatsApp Business. Meta comparte los contactos y,
          si lo aceptás en el teléfono, los chats de los últimos 180 días. Tiene que hacerse dentro
          de las 24 horas de conectar.
        </p>

        {conectar && configuracion.estado === "incompleta" ? (
          <p className="text-ink-faint text-[11.5px] leading-relaxed">
            Falta configurar {configuracion.faltan.join(", ")} en el servidor. Hasta entonces el
            botón queda apagado y el CRM sigue mandando por el número de siempre.
          </p>
        ) : null}
        {conectar && sdk === "error" ? (
          <p className="text-[11.5px]" style={{ color: "var(--color-danger)" }}>
            No se pudo cargar el SDK de Facebook (connect.facebook.net). Revisá la conexión o un
            bloqueador de contenido.
          </p>
        ) : null}

        <p role="status" aria-live="polite" className="text-[11.5px] leading-relaxed empty:hidden">
          {fase.tipo === "esperando-meta"
            ? "Completá los pasos en la ventana de Meta."
            : fase.tipo === "conectando"
              ? "Verificando el número con Meta…"
              : fase.tipo === "conectado"
                ? `Listo: ${fase.numero} quedó conectado. Los contactos y el historial se piden solos.`
                : ""}
        </p>
        {fase.tipo === "error" ? (
          <p
            role="alert"
            className="text-[11.5px] leading-relaxed"
            style={{ color: "var(--color-danger)" }}
          >
            {fase.mensaje}
          </p>
        ) : null}

        {numeros.length > 0 ? (
          <ul className="border-line-row flex flex-col border-t">
            {numeros.map((n) => (
              <li
                key={n.phoneNumberId}
                className="border-line-row grid grid-cols-[minmax(160px,0.8fr)_2fr] gap-4 border-b py-3 last:border-b-0"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-ink-primary truncate font-mono text-[12px] font-medium tabular-nums">
                    {n.numero}
                  </span>
                  <span className="text-ink-faint text-[11px] leading-snug break-words">
                    {n.nombre ?? "Sin nombre verificado"}
                  </span>
                  <span className="text-ink-ghost text-[10.5px]">
                    {n.modo}
                    {n.desconectado ? ", desconectado" : ""}
                  </span>
                </div>
                <div className="flex min-w-0 flex-col gap-2">
                  <ol
                    className="flex flex-wrap gap-x-5 gap-y-2"
                    aria-label={`Estado de ${n.numero}`}
                  >
                    {n.pasos.map((p) => (
                      <li key={p.clave} className="flex min-w-0 flex-col gap-1">
                        <span className="text-ink-faint text-[10.5px]">{p.titulo}</span>
                        <BadgeSalud descriptor={{ ...PASO[p.estado], label: p.detalle }} />
                      </li>
                    ))}
                  </ol>
                  {n.error ? (
                    <p
                      className="text-[11px] leading-snug text-pretty"
                      style={{ color: "var(--color-danger)" }}
                    >
                      {n.error}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-faint text-[11.5px]">
            Todavía no hay números conectados desde acá.
          </p>
        )}
      </div>
    </SeccionAjuste>
  );
}
