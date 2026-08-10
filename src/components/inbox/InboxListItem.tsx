"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bolt, PanTool, ReceiptLong, Warning } from "@/components/icons";
import { ChannelDot } from "@/components/shared/ChannelDot";
import { InitialsAvatar } from "@/components/shared/InitialsAvatar";
import { MonoMeta } from "@/components/shared/MonoMeta";
import { StageBadge } from "@/components/shared/StageBadge";
import { esperaLegible } from "@/lib/triage";
import { cn } from "@/lib/utils";
import type { MotivoTriage } from "@/types/domain";
import type { InboxItem } from "@/types/inbox";
import type { ComponentType } from "react";

/** "hace 12m" contra el reloj actual. Envuelta para no llamar `Date.now` en el render. */
function desdeHace(date: Date): string {
  return esperaLegible(Date.now() - date.getTime());
}

/** Timestamp compacto para la fila: "ahora" / "3m" / "2h" / "1d". */
function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "ahora";
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d`;
}

/**
 * Los tres motivos del handoff, cada uno con su color. El chip es lo que
 * distingue el triage de una lista cronológica: dice en una línea por qué esta
 * conversación está arriba.
 */
const CHIP_MOTIVO: Record<
  MotivoTriage,
  { Icon: ComponentType<{ size?: number; className?: string }>; clase: string }
> = {
  humano: { Icon: PanTool, clase: "text-special bg-special/10 border-special/26" },
  bloqueo: { Icon: Warning, clase: "text-warn bg-warn/10 border-warn/26" },
  pago: { Icon: ReceiptLong, clase: "text-caution bg-caution/10 border-caution/26" },
};

function previewTexto(item: InboxItem): string {
  if (!item.ultimoMensaje) return "Sin mensajes";
  return `${item.ultimoMensaje.direction === "out" ? "Vos: " : ""}${item.ultimoMensaje.body}`;
}

function BarraSeleccion() {
  return (
    <span aria-hidden className="bg-brand absolute inset-y-0 left-0 w-[2.5px] rounded-r-[3px]" />
  );
}

/**
 * Fila compacta del grupo "La IA está manejando": una sola línea. La densidad
 * es la señal — lo que la IA resuelve sola no tiene que ocupar el mismo alto
 * que lo que espera a una persona.
 */
function FilaCompacta({ item, activa }: { item: InboxItem; activa: boolean }) {
  return (
    <Link
      href={`/inbox/${item.leadId}`}
      aria-current={activa ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-2 rounded-[10px] px-[11px] py-2 transition-colors",
        activa ? "bg-surface-hover" : "hover:bg-surface-elevated",
      )}
    >
      {activa ? <BarraSeleccion /> : null}
      <div className="relative shrink-0">
        <InitialsAvatar
          nombre={item.nombre}
          size={26}
          className="bg-surface-hover text-ink-dim font-medium"
        />
        {item.canalActivo ? (
          <ChannelDot
            canal={item.canalActivo}
            size={9}
            ringColor="var(--color-surface-panel)"
            className="absolute right-[-2px] bottom-[-2px]"
          />
        ) : null}
      </div>
      <span className="text-ink-secondary shrink-0 truncate text-[12px] font-[550]">
        {item.nombre}
      </span>
      <StageBadge
        stage={item.currentStage}
        className="shrink-0 px-1.5 py-[1.5px] text-[9.5px] font-medium"
      />
      <span className="text-ink-faint min-w-0 flex-1 truncate text-[11px]">
        {previewTexto(item)}
      </span>
      <MonoMeta className="shrink-0 text-[9.5px]">{formatRelative(item.ultimaActividad)}</MonoMeta>
    </Link>
  );
}

/**
 * Fila completa: la del grupo "Requieren tu atención" y la del modo Recientes.
 * El chip de motivo solo aparece en triage — en Recientes la lista es
 * cronológica y el motivo no ordena nada.
 */
function FilaCompleta({
  item,
  activa,
  conMotivo,
}: {
  item: InboxItem;
  activa: boolean;
  conMotivo: boolean;
}) {
  const motivo = conMotivo ? item.motivo : null;
  const chip = motivo ? CHIP_MOTIVO[motivo.tipo] : null;

  return (
    <Link
      href={`/inbox/${item.leadId}`}
      aria-current={activa ? "page" : undefined}
      className={cn(
        "relative flex items-start gap-2.5 rounded-[12px] p-[11px] transition-colors",
        activa ? "bg-surface-hover" : "hover:bg-surface-elevated",
      )}
    >
      {activa ? <BarraSeleccion /> : null}

      <div className="relative shrink-0">
        <InitialsAvatar nombre={item.nombre} size={38} />
        {item.canalActivo ? (
          <ChannelDot
            canal={item.canalActivo}
            size={13}
            ringColor="var(--color-surface-panel)"
            className="absolute right-[-2px] bottom-[-2px]"
          />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="text-ink-primary truncate text-[12.5px] font-semibold">
            {item.nombre}
          </span>
          <MonoMeta className="shrink-0">{formatRelative(item.ultimaActividad)}</MonoMeta>
        </div>

        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="text-ink-dim min-w-0 flex-1 truncate text-[11.5px]">{previewTexto(item)}</p>
          {item.sinResponder > 0 ? (
            <span
              className="bg-brand text-brand-ink inline-flex h-[17px] min-w-[17px] shrink-0 items-center justify-center rounded-full px-1 font-mono text-[10px] font-semibold"
              aria-label={`${item.sinResponder} sin responder`}
            >
              {item.sinResponder}
            </span>
          ) : null}
        </div>

        {motivo && chip ? (
          <div
            className={cn(
              "mt-1.5 flex items-center gap-1.5 rounded-[8px] border px-2 py-[5px]",
              chip.clase,
            )}
          >
            <chip.Icon size={13} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate text-[10.5px] font-semibold">
              {motivo.texto}
            </span>
            {item.esperandoDesde ? (
              <span className="shrink-0 font-mono text-[9.5px] opacity-75">
                {desdeHace(item.esperandoDesde)}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="mt-1.5 flex items-center gap-1.5">
          <StageBadge stage={item.currentStage} />
          {item.iaPausada ? (
            <span className="text-danger bg-danger/13 inline-flex shrink-0 items-center gap-1 rounded-md px-[7px] py-[2.5px] text-[10px] font-semibold">
              <PanTool size={12} className="shrink-0" />
              IA pausada
            </span>
          ) : null}
          {item.urgencia === "alta" ? (
            <Bolt size={13} className="text-warn ml-auto shrink-0" aria-label="Urgencia alta" />
          ) : null}
        </div>
      </div>
    </Link>
  );
}

export function InboxListItem({
  item,
  variante = "completa",
  conMotivo = true,
}: {
  item: InboxItem;
  variante?: "completa" | "compacta";
  conMotivo?: boolean;
}) {
  const pathname = usePathname();
  const activa = pathname === `/inbox/${item.leadId}`;

  return variante === "compacta" ? (
    <FilaCompacta item={item} activa={activa} />
  ) : (
    <FilaCompleta item={item} activa={activa} conMotivo={conMotivo} />
  );
}
