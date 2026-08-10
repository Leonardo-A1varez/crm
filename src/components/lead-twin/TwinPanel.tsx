import { format } from "date-fns";
import {
  AltRoute,
  ContactEmergency,
  DirectionsCar,
  Inventory2,
  Sell,
  Warning,
} from "@/components/icons";
import { CampoEditable } from "@/components/lead-twin/CampoEditable";
import { ChipProcedencia } from "@/components/lead-twin/ChipProcedencia";
import { TwinEmptyState } from "@/components/lead-twin/TwinEmptyState";
import { TwinField } from "@/components/lead-twin/TwinField";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { MonoMeta } from "@/components/shared/MonoMeta";
import { RelativeTime } from "@/components/shared/RelativeTime";
import { FUNNEL_STAGES, funnelStep, isDetour, stageColor, stageLabel } from "@/lib/ui/stage";
import type {
  CampoTwinEditable,
  CurrentStage,
  EtapaEmbudo,
  MetodoPago,
  Urgencia,
} from "@/types/domain";
import type { EditarCampoTwinInput } from "@/lib/validation/inbox.schema";
import type {
  Lead,
  LeadSession,
  Mensaje,
  ProcedenciaCampo,
  Producto,
  Tag,
  UUID,
} from "@/types/entities";
import type { ActionResult, OrigenCampo, SesionesPrevias } from "@/types/inbox";

/**
 * Urgencia como tres barras: alta llena las tres, media dos, baja una. La
 * forma dice el nivel sin leer la palabra, que es lo que se escanea al pasar
 * por la lista.
 */
const URGENCIA_CONFIG: Record<Urgencia, { label: string; llenas: number; clase: string }> = {
  baja: { label: "Baja", llenas: 1, clase: "text-ink-dim bg-ink-dim" },
  media: { label: "Media", llenas: 2, clase: "text-caution bg-caution" },
  alta: { label: "Alta", llenas: 3, clase: "text-warn bg-warn" },
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
 * Traduce la procedencia guardada a la línea que se lee debajo del campo.
 *
 * Devuelve `null` para lo corregido a mano: ese caso lo cuenta `valor_anterior`
 * ("el extractor había inferido …") y no el mensaje de origen. Cuando el
 * mensaje no está en el hilo cargado —o el turno se procesó antes de que el
 * pipeline anotara el id— la línea igual se dibuja, pero nombrando al extractor
 * y con la hora en que escribió: es lo único que se sabe con certeza.
 */
function origenDe(
  procedencia: ProcedenciaCampo | undefined,
  porId: Map<UUID, Mensaje>,
): OrigenCampo | null {
  if (!procedencia || procedencia.por !== "ia") return null;

  const mensaje = procedencia.mensaje_origen_id
    ? (porId.get(procedencia.mensaje_origen_id) ?? null)
    : null;
  if (mensaje) {
    return {
      fuente: mensaje.direction === "in" ? "mensaje del cliente" : "respuesta del agente",
      hora: format(mensaje.created_at, "HH:mm"),
    };
  }

  const at = new Date(procedencia.at);
  return {
    fuente: "el extractor",
    hora: Number.isNaN(at.getTime()) ? null : format(at, "HH:mm"),
  };
}

/**
 * Rail del embudo: 6 segmentos, los alcanzados en el color de la etapa.
 *
 * En un desvío (`perdido`, `requiere_humano`) `funnelStep` es `null` porque
 * esas etapas no tienen posición. El rail no se apaga entero: se congela en
 * gris **hasta `etapa_alcanzada`**, que es hasta dónde llegó la conversación
 * antes de salirse. Desaparece el contador de pasos —no hay paso 7— y el chip
 * de desvío nombra dónde quedó frenada.
 */
function RailEmbudo({ stage, alcanzada }: { stage: CurrentStage; alcanzada: EtapaEmbudo }) {
  const desvio = isDetour(stage);
  const paso = funnelStep(stage);
  // En un desvío el largo pintado sale de lo alcanzado; en el embudo, de la
  // etapa actual (que es lo alcanzado, salvo que el extractor haya retrocedido).
  const llenos = desvio ? (funnelStep(alcanzada) ?? 0) : (paso ?? 0);
  const color = desvio ? RAIL_CONGELADO : stageColor(stage);

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

      <div className="flex flex-col gap-1">
        <div className="flex gap-[3px]" role="presentation">
          {FUNNEL_STAGES.map((etapa, i) => (
            <span
              key={etapa}
              className={
                i < llenos
                  ? "h-[3.5px] flex-1 rounded-full"
                  : "bg-line-card h-[3.5px] flex-1 rounded-full"
              }
              style={i < llenos ? { backgroundColor: color } : undefined}
            />
          ))}
        </div>
        <div className="flex items-baseline justify-between">
          <MonoMeta className="text-ink-fainter text-[9px]">nuevo</MonoMeta>
          <MonoMeta className="text-ink-fainter text-[9px]">cerrado</MonoMeta>
        </div>
      </div>

      {desvio ? (
        <span className="text-special bg-special/9 inline-flex items-center gap-1.5 self-start rounded-md px-[7px] py-[3px] text-[10.5px] font-medium">
          <AltRoute size={12} className="shrink-0" />
          El embudo quedó frenado en «{stageLabel(alcanzada)}»
        </span>
      ) : null}
    </Seccion>
  );
}

/**
 * Producto del catálogo que la sesión cotizó. Es el único bloque del Twin cuyo
 * dato no lo infirió nadie: sale de la fila de `productos`, y por eso lleva el
 * chip gris "Del catálogo" y no tiene lápiz. El badge de stock es el que
 * decide si la cotización se puede sostener.
 */
function ProductoCotizado({ producto }: { producto: Producto }) {
  const hayStock = producto.stock > 0;

  return (
    <div className="border-line-control bg-surface-elevated flex flex-col gap-2 rounded-[12px] border p-3">
      <div className="flex items-center justify-between gap-2">
        <ChipProcedencia
          Icon={Inventory2}
          className="text-ink-dim bg-surface-card border-line-input border"
          titulo="Dato duro de la DB. No editable."
        >
          Del catálogo
        </ChipProcedencia>
        <span
          className={`shrink-0 rounded-md px-[7px] py-[2.5px] text-[10px] font-semibold ${
            hayStock ? "text-ok bg-ok/13" : "text-danger bg-danger/13"
          }`}
        >
          {hayStock ? `${producto.stock} en stock` : "Sin stock"}
        </span>
      </div>
      <span className="text-ink-secondary text-[12px] font-semibold break-words">
        {producto.nombre}
      </span>
      <MonoMeta className="text-brand break-all">{producto.codigo_interno}</MonoMeta>
    </div>
  );
}

/**
 * Vehículo del lead. Es dato del lead y no de la sesión, así que no pasa por
 * `editarCampoTwin` — de ahí que no tenga lápiz todavía.
 */
function Vehiculo({ lead }: { lead: Lead }) {
  const modelo = [lead.vehiculo_marca, lead.vehiculo_modelo].filter(Boolean).join(" ").trim();
  if (modelo === "") return null;

  const tecnico = [lead.vehiculo_anio ? String(lead.vehiculo_anio) : null, lead.vehiculo_motor]
    .filter(Boolean)
    .join(" · ");

  return (
    <Seccion>
      <div className="flex items-center gap-1.5">
        <span className="text-ink-faint text-[10.5px]">Vehículo</span>
        <ChipProcedencia
          Icon={Inventory2}
          className="text-ink-dim bg-surface-card border-line-input border"
          titulo="Dato de la ficha del lead."
        >
          De la ficha
        </ChipProcedencia>
      </div>
      <div className="bg-surface-elevated border-line-card flex items-center gap-2.5 rounded-[12px] border p-3">
        <DirectionsCar size={22} className="text-ink-dim shrink-0" />
        <span className="min-w-0">
          <span className="text-ink-secondary block truncate text-[12.5px] font-semibold">
            {modelo}
          </span>
          {tecnico ? <MonoMeta className="block truncate">{tecnico}</MonoMeta> : null}
        </span>
      </div>
    </Seccion>
  );
}

function BarrasUrgencia({ urgencia }: { urgencia: Urgencia }) {
  const { label, llenas, clase } = URGENCIA_CONFIG[urgencia];
  const [color, fondo] = clase.split(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-ink-faint text-[10.5px]">Urgencia</span>
      <div className="flex items-center gap-2">
        <span className="flex gap-1" role="img" aria-label={`Urgencia ${label.toLowerCase()}`}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`h-1 w-[18px] rounded-[3px] ${i < llenas ? fondo : "bg-line-control"}`}
            />
          ))}
        </span>
        <span className={`text-[11px] font-semibold ${color}`}>{label}</span>
      </div>
    </div>
  );
}

/**
 * Ficha estructurada de la sesión activa (Lead Twin). Secciones opcionales
 * solo aparecen cuando el extractor pobló los campos: una sección vacía ocupa
 * el mismo espacio que una con dato y no dice nada.
 */
export function TwinPanel({
  lead,
  session,
  leadId,
  mensajes,
  producto,
  tags,
  sesionesPrevias,
  onEditar,
}: {
  lead: Lead;
  session: LeadSession | null;
  leadId: UUID;
  /** Hilo de la sesión: resuelve `mensaje_origen_id` a la hora que se muestra. */
  mensajes: Mensaje[];
  producto: Producto | null;
  tags: Tag[];
  sesionesPrevias: SesionesPrevias;
  onEditar: (input: EditarCampoTwinInput) => Promise<ActionResult>;
}) {
  if (!session) return <TwinEmptyState />;

  const editable = {
    leadId,
    sessionId: session.id,
    onGuardar: onEditar,
  };

  const porId = new Map(mensajes.map((m) => [m.id, m]));
  const origen = (campo: CampoTwinEditable) => origenDe(session.procedencia[campo], porId);

  const hasCotizacion =
    session.codigo_interno !== null ||
    session.precio_cotizado !== null ||
    session.cantidad !== null ||
    // Puede haber producto enganchado sin que el extractor haya dejado precio ni
    // código: la sección igual tiene qué mostrar.
    producto !== null;
  const hasPago = session.metodo_pago !== null || session.comprobante_pago_url !== null;
  const comprobanteUrl = session.comprobante_pago_url
    ? safeHttpUrl(session.comprobante_pago_url)
    : null;
  const extras = Object.entries(session.extras);

  return (
    <div className="flex flex-col">
      <Seccion>
        <div className="flex items-center justify-between gap-2">
          <span className="text-ink-primary flex items-center gap-1.5 text-[12.5px] font-[650]">
            <ContactEmergency size={14} className="text-brand" />
            Lead Twin
          </span>
          {/* "hace 40 s" del handoff §1.4: cuándo se tocó la ficha por última
              vez, no cuándo empezó la sesión. Sale de `lead_session.updated_at`,
              que escribe un trigger en cada UPDATE — el extractor y las
              correcciones humanas quedan las dos contadas. */}
          <MonoMeta className="flex shrink-0 items-center gap-1.5">
            <span aria-hidden className="bg-ok animate-pulse-dot h-[5px] w-[5px] rounded-full" />
            <RelativeTime iso={session.updated_at.toISOString()} />
          </MonoMeta>
        </div>
        <p className="text-ink-faint text-[10.5px]">
          Ficha mantenida por el extractor LLM en cada turno. No hace falta leer el hilo.
        </p>
      </Seccion>

      <RailEmbudo stage={session.current_stage} alcanzada={session.etapa_alcanzada} />

      <Vehiculo lead={lead} />

      <Seccion>
        <CampoEditable
          {...editable}
          label="Consulta"
          campo="consulta"
          valor={session.consulta}
          procedencia={session.procedencia.consulta}
          origen={origen("consulta")}
          multilinea
        />
        <BarrasUrgencia urgencia={session.urgencia} />
      </Seccion>

      {hasCotizacion ? (
        <Seccion>
          <Eyebrow>Cotización</Eyebrow>
          {/* Fondo cálido del handoff, sin token en globals.css: es el único
              gradiente de superficie del diseño. */}
          <div
            className="border-line-control flex flex-col gap-3 rounded-[13px] border p-3"
            style={{
              backgroundImage:
                "linear-gradient(160deg,var(--color-surface-warm),var(--color-surface-elevated))",
            }}
          >
            {/* Cuando la sesión enganchó una fila del catálogo, el código sale
                de ahí y no del extractor: es el mismo dato con una procedencia
                mejor. Mostrar los dos duplicaría la línea y dejaría dudando
                cuál manda. Sin producto resuelto queda el campo editable, que
                es lo único que hay. */}
            {producto ? (
              <ProductoCotizado producto={producto} />
            ) : (
              <CampoEditable
                {...editable}
                label="Código interno"
                campo="codigo_interno"
                valor={session.codigo_interno}
                procedencia={session.procedencia.codigo_interno}
                origen={origen("codigo_interno")}
                claseValor="font-mono text-[10px] text-brand"
              />
            )}
            <CampoEditable
              {...editable}
              label="Precio cotizado"
              campo="precio_cotizado"
              valor={
                session.precio_cotizado !== null ? formatPrecio(session.precio_cotizado) : null
              }
              procedencia={session.procedencia.precio_cotizado}
              origen={origen("precio_cotizado")}
              claseValor="font-mono text-[25px] font-semibold tracking-[-0.03em] text-white"
            />
            <CampoEditable
              {...editable}
              label="Cantidad"
              campo="cantidad"
              valor={session.cantidad !== null ? `IVA incl. · x${session.cantidad}` : null}
              procedencia={session.procedencia.cantidad}
              origen={origen("cantidad")}
              claseValor="text-ink-dim text-[10.5px]"
            />
          </div>
        </Seccion>
      ) : null}

      {session.bloqueador ? (
        <Seccion>
          <div className="border-warn/24 bg-warn/7 flex flex-col gap-1.5 rounded-[12px] border p-3">
            <span className="text-warn flex items-center gap-1.5">
              <Warning size={13} className="shrink-0" />
              <Eyebrow className="text-warn">Bloqueador</Eyebrow>
            </span>
            <CampoEditable
              {...editable}
              label="Qué lo frena"
              campo="bloqueador"
              valor={session.bloqueador}
              procedencia={session.procedencia.bloqueador}
              origen={origen("bloqueador")}
              multilinea
              // Texto cálido sobre el fondo naranja del bloque; sin token.
              claseValor="text-ink-warm-dim text-[11.5px]"
            />
          </div>
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

      {tags.length > 0 ? (
        <Seccion>
          <Eyebrow>Tags</Eyebrow>
          {/* Solo lectura: asignar y quitar tags vive en la pantalla de Leads y
              duplicar el flujo acá abriría dos caminos para el mismo dato. El
              "+ Agregar" del handoff queda pendiente de esa acción. */}
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag.id}
                className="border-line-input bg-surface-card text-ink-secondary inline-flex items-center gap-1 rounded-md border px-[7px] py-[2.5px] text-[10.5px] font-medium"
                title={tag.descripcion ?? undefined}
              >
                <Sell size={11} className="shrink-0" style={{ color: tag.color }} />
                {tag.nombre}
              </span>
            ))}
          </div>
        </Seccion>
      ) : null}

      <Seccion>
        <Eyebrow>Historial</Eyebrow>
        <TwinField
          label="Sesión iniciada"
          value={<RelativeTime iso={session.started_at.toISOString()} />}
        />
        {sesionesPrevias.total > 0 ? (
          <TwinField
            label="Sesiones previas"
            value={`${sesionesPrevias.total} · ${sesionesPrevias.conCompra} con compra`}
          />
        ) : null}
        {session.context_summary ? (
          <div className="bg-surface-elevated rounded-[10px] p-2.5 text-[11px]">
            <span className="text-ink-secondary">Resumen: </span>
            <span className="text-ink-dim break-words whitespace-pre-wrap">
              {session.context_summary}
            </span>
          </div>
        ) : null}
      </Seccion>
    </div>
  );
}
