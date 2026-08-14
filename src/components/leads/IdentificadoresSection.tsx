"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Add, Close } from "@/components/icons";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { useCerrarAlSalir } from "@/hooks/use-cerrar-al-salir";
import { LARGO_MAX_CRUDO } from "@/lib/identificadores";
import {
  IDENTIFICADOR_AYUDA,
  IDENTIFICADOR_LABEL,
  agruparIdentificadores,
  origenLabel,
  valorVisible,
} from "@/lib/ui/identificadores";
import { IDENTIFICADOR_TIPO } from "@/types/domain";
import type { IdentificadorTipo } from "@/types/domain";
import type { LeadIdentificador, UUID } from "@/types/entities";
import type {
  AgregarIdentificadorFormInput,
  QuitarIdentificadorInput,
} from "@/lib/validation/leads.schema";
import type { ActionResult } from "@/types/inbox";

const CONTROL =
  "text-ink-body border-line-input bg-surface-input rounded-[7px] border px-2 py-1 text-[11.5px] outline-none";

/** El tipo con el que abre el formulario. Primero de la lista, sin adivinar. */
const TIPO_INICIAL: IdentificadorTipo = "telefono";

/**
 * Los datos que identifican al lead: teléfonos, correos, documento fiscal,
 * placa y VIN.
 *
 * Es la única puerta de entrada de esos datos. El detector de duplicados ya
 * sabía buscar por RUC, placa y VIN —compartir uno es evidencia real de ser la
 * misma persona, a diferencia de compartir el nombre—, pero nadie tenía dónde
 * escribirlos: la capacidad existía y era inalcanzable.
 *
 * Los valores van en monoespaciada porque se leen dígito a dígito y se comparan
 * contra un papel o una pantalla; en proporcional un VIN de 17 caracteres es
 * imposible de cotejar.
 */
export function IdentificadoresSection({
  leadId,
  identificadores,
  onAgregar,
  onQuitar,
}: {
  leadId: UUID;
  identificadores: LeadIdentificador[];
  onAgregar: (input: AgregarIdentificadorFormInput) => Promise<ActionResult>;
  onQuitar: (input: QuitarIdentificadorInput) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState<IdentificadorTipo>(TIPO_INICIAL);
  const [valor, setValor] = useState("");
  const [isPending, startTransition] = useTransition();
  const panel = useRef<HTMLElement>(null);

  const cerrar = useCallback(() => {
    setAbierto(false);
    setTipo(TIPO_INICIAL);
    setValor("");
  }, []);

  // El `ref` abarca la lista y el formulario, no sólo el formulario: quitar un
  // identificador mientras se está cargando otro es la misma tarea, y cerrar el
  // panel ahí sería castigar un click legítimo. Mismo criterio que el selector
  // de etiquetas del Twin.
  useCerrarAlSalir(abierto, panel, cerrar);

  const grupos = agruparIdentificadores(identificadores);
  const puedeGuardar = valor.trim() !== "" && !isPending;

  const ejecutar = (accion: () => Promise<ActionResult>, alTerminar?: () => void) => {
    if (isPending) return;
    startTransition(async () => {
      const r = await accion();
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      alTerminar?.();
      router.refresh();
    });
  };

  const guardar = () => {
    if (!puedeGuardar) return;
    // El valor viaja crudo: normalizarlo es responsabilidad del schema de la
    // action, y hacerlo también acá sería una segunda regla capaz de derivar.
    ejecutar(
      () => onAgregar({ leadId, tipo, valor }),
      () => setValor(""),
    );
  };

  return (
    <section ref={panel} className="border-line-layout flex flex-col gap-3 border-t px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <Eyebrow>Identificadores ({identificadores.length})</Eyebrow>
        {abierto ? null : (
          <button
            type="button"
            onClick={() => setAbierto(true)}
            className="border-line-control text-ink-dim hover:border-brand/50 hover:text-brand inline-flex items-center gap-1 rounded-md border border-dashed px-[7px] py-[3px] text-[10.5px] font-medium transition-colors"
          >
            <Add size={11} className="shrink-0" />
            Agregar identificador
          </button>
        )}
      </div>

      {abierto ? (
        <div className="border-line-control bg-surface-elevated flex flex-wrap items-center gap-1.5 rounded-[10px] border p-2">
          <select
            value={tipo}
            disabled={isPending}
            aria-label="Tipo de identificador"
            onChange={(e) => setTipo(e.target.value as IdentificadorTipo)}
            className={CONTROL}
          >
            {IDENTIFICADOR_TIPO.map((t) => (
              <option key={t} value={t}>
                {IDENTIFICADOR_LABEL[t]}
              </option>
            ))}
          </select>

          <input
            value={valor}
            autoFocus
            disabled={isPending}
            maxLength={LARGO_MAX_CRUDO}
            aria-label={`Valor del identificador (${IDENTIFICADOR_LABEL[tipo]})`}
            placeholder={IDENTIFICADOR_AYUDA[tipo]}
            onChange={(e) => setValor(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") guardar();
            }}
            className={`${CONTROL} min-w-[200px] flex-1 font-mono`}
          />

          <button
            type="button"
            onClick={guardar}
            disabled={!puedeGuardar}
            className="bg-brand text-brand-ink rounded-[7px] px-2 py-[3px] text-[10.5px] font-semibold disabled:opacity-50"
          >
            {isPending ? "Guardando…" : "Guardar"}
          </button>
          <button
            type="button"
            onClick={cerrar}
            disabled={isPending}
            className="text-ink-dim border-line-control rounded-[7px] border px-2 py-[3px] text-[10.5px] font-semibold"
          >
            Cancelar
          </button>
        </div>
      ) : null}

      {grupos.length === 0 ? (
        <p className="text-ink-faint text-[11.5px] leading-relaxed">
          Este lead todavía no tiene identificadores cargados. Un documento fiscal, una placa o un
          VIN son lo que permite reconocerlo cuando vuelve a escribir desde otro número o por otro
          canal.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {grupos.map((grupo) => (
            <li key={grupo.tipo} className="flex flex-col gap-1">
              <span className="text-ink-faint text-[10.5px]">{grupo.label}</span>
              <ul className="divide-line-card flex flex-col divide-y">
                {grupo.items.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 py-[5px]">
                    <span className="text-ink-secondary min-w-0 font-mono text-[12.5px] break-all">
                      {valorVisible(item)}
                    </span>
                    {item.principal ? (
                      <span
                        title="Es el que se usa primero cuando el lead tiene varios de este tipo."
                        className="border-brand/40 text-brand shrink-0 rounded-md border px-[5px] py-[1px] font-mono text-[9px] font-semibold tracking-[0.06em] uppercase"
                      >
                        principal
                      </span>
                    ) : null}
                    <span className="text-ink-fainter ml-auto shrink-0 font-mono text-[10px]">
                      {origenLabel(item.origen)}
                    </span>
                    <button
                      type="button"
                      disabled={isPending}
                      aria-label={`Quitar ${grupo.label} ${valorVisible(item)}`}
                      onClick={() => ejecutar(() => onQuitar({ leadId, identificadorId: item.id }))}
                      className="text-ink-ghost hover:text-danger shrink-0 rounded-[4px] transition-colors disabled:opacity-50"
                    >
                      <Close size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
