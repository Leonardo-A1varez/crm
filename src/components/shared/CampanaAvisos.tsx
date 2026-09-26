"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { NotificationsIcon } from "@/components/icons";
import { RelativeTime } from "@/components/shared/RelativeTime";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAvisosEnVivo } from "@/hooks/use-avisos-en-vivo";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/types/inbox";
import type { NotificacionVista, PanelNotificaciones } from "@/types/notificaciones";

/**
 * La campanita del panel: los avisos que un flujo le dejó a quien mira
 * ("Avisar al equipo", decisión 3 del dueño).
 *
 * Un menú y no un popover suelto: cada aviso es una acción —ir a la
 * conversación— y el menú ya trae la navegación con flechas, el foco que
 * vuelve al botón al cerrar y el Escape. Abrir un aviso lo marca leído.
 *
 * Se entera de uno nuevo por Realtime (`useAvisosEnVivo`) y vuelve a pedir la
 * lista al servidor; sin Realtime, la trae de nuevo cada vez que se abre.
 */
export function CampanaAvisos({
  usuarioId,
  inicial,
  onLeer,
  onMarcarLeida,
  onMarcarTodas,
}: {
  usuarioId: string | null;
  inicial: PanelNotificaciones | null;
  onLeer: () => Promise<PanelNotificaciones | null>;
  onMarcarLeida: (input: { id: string }) => Promise<ActionResult>;
  onMarcarTodas: () => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<PanelNotificaciones>(inicial ?? { noLeidas: 0, items: [] });
  const [, empezar] = useTransition();

  const releer = () =>
    empezar(async () => {
      const nuevo = await onLeer();
      if (nuevo) setPanel(nuevo);
    });

  useAvisosEnVivo(usuarioId, releer);

  const abrir = (aviso: NotificacionVista) => {
    if (!aviso.leida) {
      // Optimista: el punto se apaga en el acto; si falla, la próxima lectura lo trae de vuelta.
      setPanel((p) => ({
        noLeidas: Math.max(0, p.noLeidas - 1),
        items: p.items.map((i) => (i.id === aviso.id ? { ...i, leida: true } : i)),
      }));
      empezar(async () => {
        await onMarcarLeida({ id: aviso.id });
      });
    }
    if (aviso.href) router.push(aviso.href);
  };

  const marcarTodas = () => {
    setPanel((p) => ({ noLeidas: 0, items: p.items.map((i) => ({ ...i, leida: true })) }));
    empezar(async () => {
      await onMarcarTodas();
    });
  };

  const { noLeidas, items } = panel;
  const etiqueta = noLeidas === 0 ? "Avisos" : `Avisos: ${noLeidas} sin leer`;

  return (
    <DropdownMenu onOpenChange={(abierto) => abierto && releer()}>
      <DropdownMenuTrigger
        aria-label={etiqueta}
        title={etiqueta}
        className="text-ink-dim hover:text-ink-primary hover:bg-surface-elevated focus-visible:ring-brand/60 relative flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] transition-[color,background-color,transform] duration-150 ease-out outline-none focus-visible:ring-2 active:scale-[0.96]"
      >
        <NotificationsIcon size={17} strokeWidth={1.6} />
        {noLeidas > 0 ? (
          <span
            aria-hidden
            className="bg-brand text-brand-ink ring-surface-root absolute -top-1 -right-1 min-w-[15px] rounded-full px-[3px] text-center font-mono text-[9px] leading-[15px] font-semibold tabular-nums ring-2"
          >
            {noLeidas > 9 ? "9+" : noLeidas}
          </span>
        ) : null}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side="bottom"
        align="start"
        sideOffset={8}
        className="bg-surface-elevated border-line-card w-[320px] rounded-[11px] border p-1 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.45)] ring-0"
      >
        <div className="flex items-center justify-between gap-2 px-2 pt-1.5 pb-2">
          <span className="text-ink-primary text-[12px] font-semibold">Avisos del equipo</span>
          {noLeidas > 0 ? (
            <button
              type="button"
              onClick={marcarTodas}
              className="text-ink-faint hover:text-ink-primary focus-visible:ring-brand/60 rounded-[6px] px-1.5 py-1 text-[10.5px] transition-colors outline-none focus-visible:ring-2"
            >
              Marcar todos como leídos
            </button>
          ) : null}
        </div>

        {items.length === 0 ? (
          <p className="text-ink-faint px-2 pt-1 pb-3 text-[11px] leading-relaxed text-pretty">
            No tenés avisos. Cuando un flujo avise al equipo sobre una conversación, aparece acá.
          </p>
        ) : (
          <div className="max-h-[360px] overflow-y-auto">
            {items.map((aviso) => (
              <DropdownMenuItem
                key={aviso.id}
                onClick={() => abrir(aviso)}
                className="focus:bg-surface-hover items-start gap-2.5 rounded-[8px] px-2 py-2"
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-[5px] h-[6px] w-[6px] shrink-0 rounded-full",
                    aviso.leida ? "bg-transparent" : "bg-brand",
                  )}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    className={cn(
                      "text-[11.5px] leading-snug text-pretty",
                      aviso.leida ? "text-ink-dim" : "text-ink-primary font-medium",
                    )}
                  >
                    {aviso.texto}
                  </span>
                  <span className="text-ink-faint flex min-w-0 items-baseline gap-1.5 text-[10px]">
                    {aviso.leadNombre ? (
                      <span className="text-ink-secondary truncate">{aviso.leadNombre}</span>
                    ) : null}
                    <span className="shrink-0 font-mono">
                      <RelativeTime iso={aviso.creadaAt} />
                    </span>
                  </span>
                  <span className="sr-only">{aviso.leida ? "Leído" : "Sin leer"}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
