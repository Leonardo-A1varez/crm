"use client";

import { useId, useState } from "react";
import { KeyboardArrowDown } from "@/components/icons";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { CURVA, DURACION, FOCO, TRANSICION_CONTROL } from "@/lib/ui/motion";

import type { PantallaCorrida } from "../_lib/vista-corrida";

const ESTADO_ENTREGA: Record<string, string> = {
  enviado: "enviado",
  entregado: "entregado",
  leido: "leído",
  fallido: "falló",
};

/**
 * Debajo del lienzo de la corrida: los mensajes que mandó.
 *
 * Vive acá, fuera de `CorridaEnVivo`, porque ese componente no tiene un lugar
 * para contenido extra. Plegado por defecto: el lienzo es lo principal, y la
 * línea de resumen ya dice cuántos mensajes hay antes de abrirlo. Por dónde
 * pasan las otras corridas de la versión ya no va acá: se dibuja sobre el
 * lienzo (`trafico` de `CorridaEnVivo`), bloque por bloque.
 */
export function DetalleBajoLienzo({ mensajes }: { mensajes: PantallaCorrida["mensajes"] }) {
  const [abierto, setAbierto] = useState(false);
  const idCuerpo = useId();
  const simulados = mensajes.length > 0 && mensajes.every((m) => m.simulado);

  return (
    <section
      aria-label="Mensajes de esta corrida"
      className="border-line-layout bg-surface-panel shrink-0 border-t"
    >
      <button
        type="button"
        aria-expanded={abierto}
        aria-controls={idCuerpo}
        onClick={() => setAbierto((a) => !a)}
        className={cn(
          "hover:bg-surface-hover flex min-h-10 w-full items-center gap-3 px-4.5 text-left",
          TRANSICION_CONTROL,
          FOCO,
        )}
      >
        <span className="text-ink-primary text-[12.5px] font-semibold">
          Mensajes de esta corrida
        </span>
        <span className="text-ink-ghost font-mono text-[11px] tabular-nums">{mensajes.length}</span>
        <KeyboardArrowDown
          aria-hidden
          className={cn(
            "text-ink-faint ml-auto size-4 shrink-0 transition-transform motion-reduce:transition-none",
            DURACION.FLOTANTE,
            CURVA.SALIDA,
            abierto && "rotate-180",
          )}
        />
      </button>

      {abierto ? (
        <ScrollArea id={idCuerpo} className="border-line-layout max-h-[38vh] min-h-0 border-t">
          <div className="flex flex-col gap-2 px-4.5 py-3.5">
            {simulados ? (
              <p className="text-ink-dim text-[11px] leading-relaxed text-pretty">
                Corrida de Probar: no salió nada. Estos son los mensajes que habría mandado.
              </p>
            ) : null}
            {mensajes.length === 0 ? (
              <p className="text-ink-dim text-[12px]">Esta corrida no mandó mensajes.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {mensajes.map((m) => (
                  <li key={m.clave} className="flex flex-col items-end gap-1">
                    <p
                      className={cn(
                        "max-w-[85%] rounded-[10px] rounded-br-[4px] px-3 py-2 text-[12.5px] leading-snug text-pretty",
                        m.simulado
                          ? "border-line-card text-ink-body border border-dashed"
                          : "bg-surface-hover text-ink-primary",
                        m.texto === null && "text-ink-ghost italic",
                      )}
                    >
                      {m.texto ?? "El texto ya no está: la sesión se purgó."}
                    </p>
                    <span className="text-ink-ghost font-mono text-[10.5px] tabular-nums">
                      {m.hora}
                      {m.estado ? ` · ${ESTADO_ENTREGA[m.estado] ?? m.estado}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </ScrollArea>
      ) : null}
    </section>
  );
}
