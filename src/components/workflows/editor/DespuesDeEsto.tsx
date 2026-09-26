"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PRESION_TACTIL, TRANSICION_CONTROL } from "./tokens-editor";

export interface SalidaDespues {
  /** Id del puerto: `salida`, `verdadero`, `falso`. */
  puerto: string;
  /** Cómo se lee: "" para la salida única, "Sí" / "No" en una condición. */
  etiqueta: string;
  /** A qué paso lleva. `null` = está suelta. */
  destino: { id: string; nombre: string } | null;
}

export interface DespuesDeEstoProps {
  salidas: readonly SalidaDespues[];
  /** Los pasos a los que se puede conectar una salida suelta, ya nombrados. */
  destinos: readonly { id: string; nombre: string }[];
  onConectar: (puerto: string, hasta: string) => void;
  onAgregarDetener: (puerto: string) => void;
  readonly?: boolean;
}

/**
 * «Después de esto»: a dónde sigue el flujo desde este bloque.
 *
 * Una salida conectada dice a qué paso lleva. Una suelta ofrece las dos
 * salidas posibles: conectarla a un paso que ya existe, o cerrar el camino
 * con un «Detener» nuevo —la sugerida, porque es la única que no le pide a
 * nadie decidir nada—. Un bloque sin salidas (Detener) no muestra la sección.
 */
export function DespuesDeEsto({
  salidas,
  destinos,
  onConectar,
  onAgregarDetener,
  readonly,
}: DespuesDeEstoProps) {
  if (salidas.length === 0) return null;
  const items = Object.fromEntries(destinos.map((d) => [d.id, `${d.nombre} · ${d.id}`]));

  return (
    <section aria-labelledby="despues-de-esto" className="flex flex-col gap-2">
      <h3 id="despues-de-esto" className="text-ink-primary text-[11px] leading-none font-semibold">
        Después de esto
      </h3>
      {salidas.map((s) => (
        <div key={s.puerto} className="flex flex-col gap-1.5">
          {s.etiqueta ? (
            <span className="text-ink-faint text-[10.5px] leading-none">
              Si sale por «{s.etiqueta}»
            </span>
          ) : null}
          {s.destino ? (
            <p className="border-line-card bg-surface-root text-ink-body flex h-8 items-center gap-2 rounded-lg border px-2.5 text-[11.5px]">
              <span className="text-ink-ghost" aria-hidden>
                →
              </span>
              <span className="min-w-0 flex-1 truncate">{s.destino.nombre}</span>
              <span className="text-ink-ghost font-mono text-[10.5px]">{s.destino.id}</span>
            </p>
          ) : (
            <>
              <Select
                items={items}
                value={null}
                onValueChange={(v) => {
                  if (v) onConectar(s.puerto, String(v));
                }}
                disabled={readonly || destinos.length === 0}
              >
                <SelectTrigger
                  size="sm"
                  aria-label={
                    s.etiqueta
                      ? `Conectar la salida «${s.etiqueta}» a un paso que ya existe`
                      : "Conectar la salida a un paso que ya existe"
                  }
                  className="bg-surface-root w-full text-[11.5px]"
                >
                  <SelectValue
                    placeholder={
                      destinos.length === 0
                        ? "No hay otro paso al que conectar"
                        : "Conectar a un paso existente…"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {destinos.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      <span className="min-w-0 flex-1 truncate">{d.nombre}</span>
                      <span className="text-ink-ghost font-mono text-[10.5px]">{d.id}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={readonly}
                onClick={() => onAgregarDetener(s.puerto)}
                className={cn(
                  "bg-surface-root w-full justify-between text-[11.5px] font-normal",
                  TRANSICION_CONTROL,
                  PRESION_TACTIL,
                )}
              >
                Agregar «Detener» y conectarlo
                <span className="text-ok font-mono text-[10.5px]">sugerido</span>
              </Button>
            </>
          )}
        </div>
      ))}
    </section>
  );
}
