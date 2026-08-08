import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { TwinEmptyState } from "@/components/lead-twin/TwinEmptyState";
import { TwinField } from "@/components/lead-twin/TwinField";
import { RelativeTime } from "@/components/shared/RelativeTime";
import { StageBadge } from "@/components/shared/StageBadge";
import type { MetodoPago, Urgencia } from "@/types/domain";
import type { LeadSession } from "@/types/entities";

const URGENCIA_CONFIG: Record<Urgencia, { label: string; dotClass: string }> = {
  baja: { label: "Baja", dotClass: "bg-zinc-400" },
  media: { label: "Media", dotClass: "bg-amber-500" },
  alta: { label: "Alta", dotClass: "bg-red-500" },
};

const METODO_PAGO_LABEL: Record<MetodoPago, string> = {
  transferencia: "Transferencia",
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
};

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

/**
 * Ficha estructurada de la sesión activa (Lead Twin). Read-only server render;
 * secciones opcionales solo aparecen cuando el extractor pobló los campos.
 */
export function TwinPanel({ session }: { session: LeadSession | null }) {
  if (!session) return <TwinEmptyState />;

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
    <Card size="sm">
      <CardHeader>
        <CardTitle>Lead Twin</CardTitle>
        <CardAction>
          <StageBadge stage={session.current_stage} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <TwinField
          label="Consulta"
          value={
            session.consulta ? (
              <span className="break-words whitespace-pre-wrap">{session.consulta}</span>
            ) : undefined
          }
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

        {hasCotizacion ? (
          <>
            <Separator />
            <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Cotización
            </div>
            <TwinField
              label="Código interno"
              value={
                session.codigo_interno ? (
                  <span className="font-mono">{session.codigo_interno}</span>
                ) : undefined
              }
            />
            <TwinField
              label="Precio cotizado"
              value={
                session.precio_cotizado !== null ? formatPrecio(session.precio_cotizado) : undefined
              }
            />
            <TwinField
              label="Cantidad"
              value={session.cantidad !== null ? String(session.cantidad) : undefined}
            />
          </>
        ) : null}

        {session.bloqueador ? (
          <>
            <Separator />
            <TwinField
              label="Bloqueador"
              value={
                <span className="break-words whitespace-pre-wrap text-amber-700 dark:text-amber-400">
                  {session.bloqueador}
                </span>
              }
            />
          </>
        ) : null}

        {hasPago ? (
          <>
            <Separator />
            <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Pago
            </div>
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
                    className="text-primary underline underline-offset-4"
                  >
                    Ver comprobante
                  </a>
                ) : undefined
              }
            />
          </>
        ) : null}

        {extras.length > 0 ? (
          <>
            <Separator />
            <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Datos adicionales
            </div>
            {extras.map(([key, value]) => (
              <TwinField
                key={key}
                label={formatExtraKey(key)}
                value={
                  <span className="break-words whitespace-pre-wrap">{formatExtraValue(value)}</span>
                }
              />
            ))}
          </>
        ) : null}

        {session.context_summary ? (
          <>
            <Separator />
            <TwinField
              label="Resumen de contexto"
              value={
                <span className="text-muted-foreground text-xs break-words whitespace-pre-wrap">
                  {session.context_summary}
                </span>
              }
            />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
