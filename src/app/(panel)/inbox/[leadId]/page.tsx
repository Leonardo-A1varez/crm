import { notFound } from "next/navigation";
import { CentroConversacion } from "@/components/inbox/CentroConversacion";
import { ChatThread } from "@/components/inbox/ChatThread";
import { ConversationHeader } from "@/components/inbox/ConversationHeader";
import { HandoffToggle } from "@/components/inbox/HandoffToggle";
import { MessageInput } from "@/components/inbox/MessageInput";
import { InterruptorModo } from "@/components/inbox/copiloto/InterruptorModo";
import { TarjetaBorrador } from "@/components/inbox/copiloto/TarjetaBorrador";
import { TwinPanel } from "@/components/lead-twin/TwinPanel";
import { EmptyState } from "@/components/shared/EmptyState";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import { TELEFONO_ABRIBLE } from "@/lib/copiloto/whatsapp-web";
import { NotFoundError } from "@/lib/errors";
import { estadoVentana } from "@/lib/ventana";
import { chatWhatsAppDeLead } from "@/lib/whatsapp/chat";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getAgenteConfigServiceForRequest } from "@/server/bootstrap/agente-bootstrap";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
import { cargarEstadoCopiloto } from "../_lib/estado-copiloto";
import { agregarDatoLeadAction } from "../_actions/agregar-dato-lead.action";
import { asignarEtiquetaAction } from "../_actions/asignar-etiqueta.action";
import { auditoriaTurnoAction } from "../_actions/auditoria-turno.action";
import { borrarDatoLeadAction } from "../_actions/borrar-dato-lead.action";
import { cancelarRecordatorioAction } from "../_actions/cancelar-recordatorio.action";
import { closeSessionAction } from "../_actions/close-session.action";
import { cambiarModoRespuestaAction } from "../_actions/cambiar-modo-respuesta.action";
import { crearEtiquetaAction } from "../_actions/crear-etiqueta.action";
import { editarCampoTwinAction } from "../_actions/editar-campo-twin.action";
import { moverEtapaAction } from "../_actions/mover-etapa.action";
import { programarRecordatorioAction } from "../_actions/programar-recordatorio.action";
import { quitarEtiquetaAction } from "../_actions/quitar-etiqueta.action";
import { regenerarBorradorAction } from "../_actions/regenerar-borrador.action";
import { renombrarLeadAction } from "../_actions/renombrar-lead.action";
import { reprogramarRecordatorioAction } from "../_actions/reprogramar-recordatorio.action";
import { sendMessageAction } from "../_actions/send-message.action";
import { toggleHandoffAction } from "../_actions/toggle-handoff.action";
import { usarBorradorAction } from "../_actions/usar-borrador.action";
import {
  agregarVehiculoAction,
  editarIdentidadVehiculoAction,
} from "@/app/(panel)/leads/_actions/vehiculos.action";
import type { ConversationView } from "@/types/inbox";

export const dynamic = "force-dynamic";

export default async function InboxLeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;

  let view: ConversationView;
  try {
    const svc = await getInboxServiceForRequest();
    view = await svc.getConversation(leadId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }

  // La zona horaria del negocio, para el recordatorio de seguimiento: lo que se
  // muestra y lo que se elige tienen que estar en el reloj del local y no en el
  // del navegador de quien abre la ficha.
  //
  // Se lee la misma `agente_config.horario_timezone` que gobierna el horario de
  // atención en vez de guardar una segunda copia: dos zonas configurables para
  // el mismo negocio se desincronizan, y el día que pasa nadie sabe cuál manda.
  // Sin fila activa se cae a la de fábrica, igual que el resto del agente.
  const agenteSvc = await getAgenteConfigServiceForRequest();
  const configActiva = await agenteSvc.activa();
  const timezoneNegocio = configActiva?.horario_timezone ?? CONFIG_DE_FABRICA.horario_timezone;

  // La ventana de 24 h se mide desde el ultimo mensaje del cliente: cada
  // entrante la reabre entera.
  const ultimoEntrante = [...view.messages].reverse().find((m) => m.direction === "in") ?? null;
  const ventana = estadoVentana(ultimoEntrante?.created_at ?? null, new Date());

  // Solo el número (E.164) y la elección recordada del selector viajan al
  // cliente; nada de esto va a la URL. Si el chat no se abre en WhatsApp Web
  // (otro canal, sin teléfono válido) `telefono` es null y el centro es el hilo.
  const chat = chatWhatsAppDeLead(view.lead, view.canalActivo);
  // Además de normalizado, el número tiene que ser abrible por la app de escritorio
  // (8 a 15 dígitos): uno de 7 pasa la normalización pero `abrirChat` lo rechaza.
  const telefono =
    "telefono" in chat && TELEFONO_ABRIBLE.test(chat.telefono) ? chat.telefono : null;
  const usuarioId = (await getAuthenticatedUser())?.id ?? null;

  // El copiloto es de WhatsApp: solo ahí hay interruptor y tarjeta. Si no se puede
  // leer su estado se degrada a "sin copiloto" y la ficha del lead sigue andando.
  const estadoCopiloto = await cargarEstadoCopiloto(view, ultimoEntrante?.id ?? null);

  // La misma tarjeta se monta en dos lugares según el modo del centro (entre la
  // barra y la vista de WhatsApp, o sobre el composer) y solo hay una a la vez.
  const tarjeta =
    view.session && estadoCopiloto?.borrador ? (
      <TarjetaBorrador
        leadId={view.lead.id}
        sessionId={view.session.id}
        canal={view.canalActivo}
        borrador={estadoCopiloto.borrador}
        onUsar={usarBorradorAction}
        onRegenerar={regenerarBorradorAction}
        onEnviar={sendMessageAction}
      />
    ) : null;

  // El mismo interruptor se monta en dos lugares según el modo del centro (junto a
  // "IA activa" en el hilo, o en la barra de WhatsApp Web) y solo hay uno a la vez.
  const interruptor = estadoCopiloto ? (
    <InterruptorModo
      leadId={view.lead.id}
      conversacionId={estadoCopiloto.conversacionId}
      override={estadoCopiloto.override}
      modoEfectivo={estadoCopiloto.modoEfectivo}
      onCambiar={cambiarModoRespuestaAction}
    />
  ) : null;

  return (
    // Tres columnas hermanas, no un header que cruza las dos: el header de la
    // conversación pertenece al panel de conversación y el Twin arranca con el
    // suyo, al mismo alto.
    <div className="flex flex-1 overflow-hidden">
      <CentroConversacion
        leadId={view.lead.id}
        usuarioId={usuarioId}
        telefono={telefono}
        tarjeta={tarjeta}
        interruptor={interruptor}
        hilo={
          <>
            <ConversationHeader
              lead={view.lead}
              session={view.session}
              canalActivo={view.canalActivo}
              actions={
                view.session ? (
                  <div className="flex min-w-0 items-center gap-2">
                    {interruptor}
                    <HandoffToggle
                      leadId={view.lead.id}
                      sessionId={view.session.id}
                      iaPausada={view.session.ia_pausada}
                      onToggle={toggleHandoffAction}
                      handoffStatus={view.handoffStatus}
                    />
                  </div>
                ) : null
              }
            />
            {view.session ? (
              <>
                <div className="flex-1 overflow-hidden">
                  <ChatThread
                    messages={view.messages}
                    onAuditoria={auditoriaTurnoAction}
                    interceptados={view.interceptados}
                  />
                </div>
                {tarjeta}
                <MessageInput
                  leadId={view.lead.id}
                  sessionId={view.session.id}
                  canal={view.canalActivo}
                  ventana={ventana}
                  ultimoEntranteIso={ultimoEntrante?.created_at.toISOString() ?? null}
                  onSend={sendMessageAction}
                />
              </>
            ) : (
              <EmptyState
                title="Sin sesión activa"
                description="La sesión de este lead fue cerrada. El historial se purga a los 29 días del cierre."
              />
            )}
          </>
        }
      />
      <aside
        aria-label="Lead Twin"
        className="border-line-layout bg-surface-panel w-[322px] shrink-0 overflow-y-auto border-l"
      >
        <TwinPanel
          lead={view.lead}
          session={view.session}
          leadId={view.lead.id}
          mensajes={view.messages}
          producto={view.producto}
          tags={view.tags}
          tagsDisponibles={view.tagsDisponibles}
          sesionesPrevias={view.sesionesPrevias}
          gastoIa={view.gastoIa}
          recordatorio={view.recordatorio}
          timezoneNegocio={timezoneNegocio}
          onEditar={editarCampoTwinAction}
          onMoverEtapa={moverEtapaAction}
          onCerrarSesion={closeSessionAction}
          onRenombrar={renombrarLeadAction}
          onAgregarDato={agregarDatoLeadAction}
          onBorrarDato={borrarDatoLeadAction}
          onAsignarEtiqueta={asignarEtiquetaAction}
          onQuitarEtiqueta={quitarEtiquetaAction}
          onCrearEtiqueta={crearEtiquetaAction}
          onToggleHandoff={toggleHandoffAction}
          vehiculos={view.vehiculos}
          onAgregarVehiculo={agregarVehiculoAction}
          onEditarIdentidadVehiculo={editarIdentidadVehiculoAction}
          onProgramarRecordatorio={programarRecordatorioAction}
          onCancelarRecordatorio={cancelarRecordatorioAction}
          onReprogramarRecordatorio={reprogramarRecordatorioAction}
        />
      </aside>
    </div>
  );
}
