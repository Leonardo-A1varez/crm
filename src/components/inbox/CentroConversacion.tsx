"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AreaWhatsApp } from "@/components/whatsapp/AreaWhatsApp";
import { BarraVistaWhatsApp } from "@/components/whatsapp/BarraVistaWhatsApp";
import { useEscritorio } from "@/components/whatsapp/useEscritorio";
import { usePreferenciaVistaCentro } from "@/components/whatsapp/usePreferenciaVistaCentro";
import { useVistaWhatsApp } from "@/components/whatsapp/useVistaWhatsApp";
import { motivoLegible } from "@/lib/whatsapp/chat";

interface ResultadoApertura {
  leadId: string;
  error: string | null;
}

/**
 * La columna del medio de `/inbox/[leadId]`.
 *
 * Por defecto es el hilo del CRM tal cual lo arma la página (`hilo`): en el
 * navegador, en un chat de Instagram o Messenger y en un lead sin teléfono
 * válido no cambia nada, ni hay barra, ni aviso de app de escritorio.
 *
 * Solo dentro de la app de escritorio (`window.crmEscritorio`) y con un chat de
 * WhatsApp abrible (`telefono`), aparece arriba una barra con el selector
 * WhatsApp Web / Hilo del CRM (la elección se recuerda por usuario):
 *
 * - WhatsApp Web: debajo va el hueco donde la app superpone la vista nativa, y
 *   al entrar al lead (una sola vez por lead) se le pide abrir ese chat. El
 *   número llega ya normalizado desde el server y nunca pasa por la URL ni por
 *   un log.
 * - Hilo del CRM: el hilo de siempre, sin controles de WhatsApp. El hueco no
 *   está montado, así que la app deja oculta la vista nativa.
 *
 * Primer render: siempre el hilo. El server no sabe si hay app de escritorio, y
 * el navegador tiene que ver exactamente lo mismo que antes; el puente se
 * detecta en el cliente y recién ahí, si corresponde, se pasa al modo WhatsApp
 * Web. Se descartó mostrar un esqueleto hasta decidir: castigaría a todos los
 * que abren un lead de WhatsApp en el navegador (el caso más común) por el
 * beneficio de un parpadeo de un instante dentro de la app de escritorio, y
 * quien elige "Hilo del CRM" no lo ve nunca.
 */
export function CentroConversacion({
  leadId,
  usuarioId,
  telefono,
  hilo,
}: {
  leadId: string;
  /** Solo para recordar la elección por usuario; `null` si no hay sesión. */
  usuarioId: string | null;
  /** E.164 sin `+`; `null` si la conversación no se puede abrir en WhatsApp Web. */
  telefono: string | null;
  /** Header, mensajes y composer del Inbox, armados por el server. */
  hilo: React.ReactNode;
}) {
  const escritorio = useEscritorio();
  const [modo, cambiarModo] = usePreferenciaVistaCentro(usuarioId);

  const conVista = escritorio === true && telefono !== null;
  const enWhatsApp = conVista && modo === "whatsapp";

  const { vista, error: errorVista, cambiar } = useVistaWhatsApp(enWhatsApp);
  const [resultado, setResultado] = useState<ResultadoApertura | null>(null);
  // Qué lead ya se mandó a abrir. Un ref y no estado: es la guarda contra la
  // doble llamada del doble montaje de StrictMode y de los re-render (el
  // refresco de 5 s del layout re-renderiza con las mismas props), no algo que
  // la pantalla dibuje.
  const abierto = useRef<string | null>(null);

  const abrir = useCallback((id: string, numero: string) => {
    const puente = window.crmEscritorio;
    if (!puente) return;
    puente
      .abrirChat(numero, "")
      .then((r) =>
        setResultado({ leadId: id, error: r?.ok === false ? motivoLegible(r.motivo) : null }),
      )
      .catch(() => setResultado({ leadId: id, error: "No se pudo abrir la conversación." }));
  }, []);

  // Se abre al mostrar WhatsApp Web, no al entrar al lead: con "Hilo del CRM"
  // no se toca la app, y al pasar después a WhatsApp Web el chat que quedó
  // puesto podría ser el de otro lead.
  useEffect(() => {
    if (!enWhatsApp || !telefono) return;
    if (abierto.current === leadId) return;
    abierto.current = leadId;
    abrir(leadId, telefono);
  }, [enWhatsApp, leadId, telefono, abrir]);

  const apertura = resultado !== null && resultado.leadId === leadId ? resultado : null;
  const estado = errorVista
    ? { texto: errorVista, esError: true }
    : apertura?.error
      ? { texto: apertura.error, esError: true }
      : enWhatsApp && apertura === null
        ? { texto: "Abriendo la conversación…", esError: false }
        : null;

  return (
    <div className="bg-surface-chat flex min-w-[520px] flex-1 flex-col overflow-hidden">
      {conVista ? (
        <BarraVistaWhatsApp
          modo={modo}
          onModo={cambiarModo}
          vista={vista}
          estado={estado}
          onCambiar={(cambios) => void cambiar(cambios)}
          onRecargado={() => {
            if (!telefono) return;
            setResultado(null);
            abrir(leadId, telefono);
          }}
        />
      ) : null}
      {enWhatsApp ? (
        <div className="min-h-0 flex-1">
          <AreaWhatsApp />
        </div>
      ) : (
        hilo
      )}
    </div>
  );
}
