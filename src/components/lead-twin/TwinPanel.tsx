import { AltRoute, ContactEmergency } from "@/components/icons";
import { CampoEditable } from "@/components/lead-twin/CampoEditable";
import { TwinEmptyState } from "@/components/lead-twin/TwinEmptyState";
import { TwinField } from "@/components/lead-twin/TwinField";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { MonoMeta } from "@/components/shared/MonoMeta";
import { RelativeTime } from "@/components/shared/RelativeTime";
import { FUNNEL_STAGES, funnelStep, isDetour, stageColor, stageLabel } from "@/lib/ui/stage";
import type { CurrentStage, MetodoPago, Urgencia } from "@/types/domain";
import type { EditarCampoTwinInput } from "@/lib/validation/inbox.schema";
import type { LeadSession, UUID } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

const URGENCIA_CONFIG: Record<Urgencia, { label: string; dotClass: string }> = {
  baja: { label: "Baja", dotClass: "bg-ink-faint" },
  media: { label: "Media", dotClass: "bg-caution" },
  alta: { label: "Alta", dotClass: "bg-danger" },
};

const METODO_PAGO_LABEL: Record<MetodoPago, string> = {
  transferencia: "Transferencia",
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
};

/**
 * Gris del rail congelado. Va literal porque no hay token: es más claro que
 * `line-card` a propósito, para que el rail de un desvío se lea como una barra
 * inerte y no como progreso apagado.
 */
const RAIL_CONGELADO = "#3A3F49";

// Sin currency configurable todavía (white-label diferido); "es" da separador de miles Latam.
function formatPrecio(precio: number): string {
  return `$ ${precio.toLocaleString("es")}`;
}

function formatExtraKey(key: string): string {
  const spaced = key.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatExtraValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}

// comprobante_pago_url proviene del extractor LLM sobre contenido del lead (no confiable):
// solo http(s) se renderiza como link, bloquea javascript:/data: URIs (XSS al click).
function safeHttpUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? raw : null;
  } catch {
    return null;
  }
}

function Seccion({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-line-layout flex flex-col gap-3 border-b px-[17px] py-[15px]">
      {children}
    </div>
  );
}

/**
 * Rail del embudo: 6 segmentos, los alcanzados en el color de la etapa. En un
 * desvío (`perdido`, `requiere_humano`) `funnelStep` es `null` porque esas
 * etapas no tienen posición: el rail entero se congela y desaparece el
 * contador, en vez de inventar un paso 7 que el embudo no tiene.
 */
function RailEmbudo({ stage }: { stage: CurrentStage }) {
  const desvio = isDetour(stage);
  const paso = funnelStep(stage);

  return (
    <Seccion>
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="text-[18px] font-[680] tracking-[-0.02em]"
          style={{ color: stageColor(stage) }}
        >
          {stageLabel(stage)}
        </span>
        {paso !== null ? <MonoMeta>{`paso ${paso}/${FUNNEL_STAGES.length}`}</MonoMeta> : null}
      </div>

      <div className="flex gap-[3px]" role="presentation">
        {FUNNEL_STAGES.map((etapa, i) => (
          <span
            key={etapa}
            className={
              !desvio && paso !== null && i < paso
                ? "h-[3.5px] flex-1 rounded-full"
                : "bg-line-card h-[3.5px] flex-1 rounded-full"
            }
            style={
              desvio
                ? { backgroundColor: RAIL_CONGELADO }
                : paso !== null && i < paso
                  ? { backgroundColor: stageColor(stage) }
                  : undefined
            }
          />
        ))}
      </div>

      {desvio ? (
        <span className="text-special bg-special/9 inline-flex items-center gap-1.5 self-start rounded-md px-[7px] py-[3px] text-[10.5px] font-medium">
          <AltRoute size={12} />
          El embudo quedó frenado
        </span>
      ) : null}
    </Seccion>
  );
}

/**
 * Ficha estructurada de la sesión activa (Lead Twin). Read-only server render;
 * secciones opcionales solo aparecen cuando el extractor pobló los campos.
 */
export function TwinPanel({
  session,
  leadId,
  onEditar,
}: {
  session: LeadSession | null;
  leadId: UUID;
  onEditar: (input: EditarCampoTwinInput) => Promise<ActionResult>;
}) {
  if (!session) return <TwinEmptyState />;

  const editable = {
    leadId,
    sessionId: session.id,
    onGuardar: onEditar,
  };

  const urgencia = URGENCIA_CONFIG[session.urgencia];
  const hasCotizacion =
    session.codigo_interno !== null ||
    session.precio_cotizado !== null ||
    session.cantidad !== null;
  const hasPago = session.metodo_pago !== null || session.comprobante_pago_url !== null;
  const comprobanteUrl = session.comprobante_pago_url
    ? safeHttpUrl(session.comprobante_pago_url)
    : null;
  const extras = Object.entries(session.extras);

  return (
    <div className="flex flex-col">
      <Seccion>
        <span className="text-ink-primary flex items-center gap-1.5 text-[12.5px] font-[650]">
          <ContactEmergency size={14} className="text-brand" />
          Lead Twin
        </span>
      </Seccion>

      <RailEmbudo stage={session.current_stage} />

      <Seccion>
        <CampoEditable
          {...editable}
          label="Consulta"
          campo="consulta"
          valor={session.consulta}
          procedencia={session.procedencia.consulta}
          multilinea
        />
        <TwinField
          label="Urgencia"
          value={
            <span className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${urgencia.dotClass}`} />
              {urgencia.label}
            </span>
          }
        />
        <TwinField
          label="Sesión iniciada"
          value={<RelativeTime iso={session.started_at.toISOString()} />}
        />
      </Seccion>

      {hasCotizacion ? (
        <Seccion>
          <Eyebrow>Cotización</Eyebrow>
          <CampoEditable
            {...editable}
            label="Código interno"
            campo="codigo_interno"
            valor={session.codigo_interno}
            procedencia={session.procedencia.codigo_interno}
          />
          <CampoEditable
            {...editable}
            label="Precio cotizado"
            campo="precio_cotizado"
            valor={session.precio_cotizado !== null ? formatPrecio(session.precio_cotizado) : null}
            procedencia={session.procedencia.precio_cotizado}
          />
          <CampoEditable
            {...editable}
            label="Cantidad"
            campo="cantidad"
            valor={session.cantidad !== null ? String(session.cantidad) : null}
            procedencia={session.procedencia.cantidad}
          />
        </Seccion>
      ) : null}

      {session.bloqueador ? (
        <Seccion>
          <CampoEditable
            {...editable}
            label="Bloqueador"
            campo="bloqueador"
            valor={session.bloqueador}
            procedencia={session.procedencia.bloqueador}
            multilinea
          />
        </Seccion>
      ) : null}

      {hasPago ? (
        <Seccion>
          <Eyebrow>Pago</Eyebrow>
          <TwinField
            label="Método"
            value={session.metodo_pago ? METODO_PAGO_LABEL[session.metodo_pago] : undefined}
          />
          <TwinField
            label="Comprobante"
            value={
              comprobanteUrl ? (
                <a
                  href={comprobanteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand underline underline-offset-4"
                >
                  Ver comprobante
                </a>
              ) : undefined
            }
          />
        </Seccion>
      ) : null}

      {extras.length > 0 ? (
        <Seccion>
          <Eyebrow>Datos adicionales</Eyebrow>
          {extras.map(([key, value]) => (
            <TwinField
              key={key}
              label={formatExtraKey(key)}
              value={
                <span className="break-words whitespace-pre-wrap">{formatExtraValue(value)}</span>
              }
            />
          ))}
        </Seccion>
      ) : null}

      {session.context_summary ? (
        <Seccion>
          <TwinField
            label="Resumen de contexto"
            value={
              <span className="text-ink-dim text-[11.5px] break-words whitespace-pre-wrap">
                {session.context_summary}
              </span>
            }
          />
        </Seccion>
      ) : null}
    </div>
  );
}
