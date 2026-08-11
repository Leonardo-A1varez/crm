import { notFound } from "next/navigation";
import { ChatThread } from "@/components/inbox/ChatThread";
import { CloseSessionButton } from "@/components/inbox/CloseSessionButton";
import { ConversationHeader } from "@/components/inbox/ConversationHeader";
import { HandoffToggle } from "@/components/inbox/HandoffToggle";
import { MessageInput } from "@/components/inbox/MessageInput";
import { TwinPanel } from "@/components/lead-twin/TwinPanel";
import { EmptyState } from "@/components/shared/EmptyState";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import { NotFoundError } from "@/lib/errors";
import { estadoVentana } from "@/lib/ventana";
import { getAgenteConfigServiceForRequest } from "@/server/bootstrap/agente-bootstrap";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
import { agregarDatoLeadAction } from "../_actions/agregar-dato-lead.action";
import { asignarEtiquetaAction } from "../_actions/asignar-etiqueta.action";
import { auditoriaTurnoAction } from "../_actions/auditoria-turno.action";
import { borrarDatoLeadAction } from "../_actions/borrar-dato-lead.action";
import { cancelarRecordatorioAction } from "../_actions/cancelar-recordatorio.action";
import { closeSessionAction } from "../_actions/close-session.action";
import { crearEtiquetaAction } from "../_actions/crear-etiqueta.action";
import { editarCampoTwinAction } from "../_actions/editar-campo-twin.action";
import { moverEtapaAction } from "../_actions/mover-etapa.action";
import { programarRecordatorioAction } from "../_actions/programar-recordatorio.action";
import { quitarEtiquetaAction } from "../_actions/quitar-etiqueta.action";
import { renombrarLeadAction } from "../_actions/renombrar-lead.action";
import { reprogramarRecordatorioAction } from "../_actions/reprogramar-recordatorio.action";
import { sendMessageAction } from "../_actions/send-message.action";
import { toggleHandoffAction } from "../_actions/toggle-handoff.action";
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

  return (
    // Tres columnas hermanas, no un header que cruza las dos: el header de la
    // conversación pertenece al panel de conversación y el Twin arranca con el
    // suyo, al mismo alto.
    <div className="flex flex-1 overflow-hidden">
      <div className="bg-surface-chat flex min-w-[520px] flex-1 flex-col overflow-hidden">
        <ConversationHeader
          lead={view.lead}
          session={view.session}
          canalActivo={view.canalActivo}
          actions={
            view.session ? (
              <>
                <HandoffToggle
                  leadId={view.lead.id}
                  sessionId={view.session.id}
                  iaPausada={view.session.ia_pausada}
                  onToggle={toggleHandoffAction}
                />
                <CloseSessionButton
                  leadId={view.lead.id}
                  sessionId={view.session.id}
                  onClose={closeSessionAction}
                />
              </>
            ) : null
          }
        />
        {view.session ? (
          <>
            <div className="flex-1 overflow-hidden">
              <ChatThread messages={view.messages} onAuditoria={auditoriaTurnoAction} />
            </div>
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
      </div>
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
          onProgramarRecordatorio={programarRecordatorioAction}
          onCancelarRecordatorio={cancelarRecordatorioAction}
          onReprogramarRecordatorio={reprogramarRecordatorioAction}
        />
      </aside>
    </div>
  );
}
