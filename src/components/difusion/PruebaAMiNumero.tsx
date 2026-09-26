"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Destinatario } from "./tipos";

export type ResultadoPrueba = { ok: true; restantes: number } | { ok: false; error: string };

/** Cuántos leads de la lista se ofrecen como muestra: los primeros que ya están cargados. */
const MUESTRAS_OFRECIDAS = 20;

/**
 * "Enviar de prueba a mi número" (PRD §7.5).
 *
 * La plantilla guardada, con las variables del lead que se elija de la lista,
 * a un número que escribe el admin. Es un WhatsApp real: por eso el botón dice
 * a qué número va antes de mandarlo, y la respuesta dice cuántas pruebas
 * quedan en la hora. No cuenta como envío de la difusión.
 */
export function PruebaAMiNumero({
  destinatarios,
  onEnviar,
}: {
  destinatarios: readonly Destinatario[];
  onEnviar: (pedido: { telefono: string; leadId: string }) => Promise<ResultadoPrueba>;
}) {
  const idTelefono = useId();
  const idLead = useId();
  const idEstado = useId();
  const muestras = destinatarios.slice(0, MUESTRAS_OFRECIDAS);
  const [telefono, setTelefono] = useState("");
  const [leadId, setLeadId] = useState(muestras[0]?.leadId ?? "");
  const [enviando, setEnviando] = useState(false);
  const [estado, setEstado] = useState<ResultadoPrueba | null>(null);

  const leadElegido = muestras.some((d) => d.leadId === leadId)
    ? leadId
    : (muestras[0]?.leadId ?? "");
  const listo = telefono.trim().length >= 6 && leadElegido !== "" && !enviando;

  async function enviar() {
    if (!listo) return;
    setEnviando(true);
    setEstado(null);
    try {
      setEstado(await onEnviar({ telefono: telefono.trim(), leadId: leadElegido }));
    } catch {
      setEstado({ ok: false, error: "No se pudo mandar: el servidor no respondió." });
    } finally {
      setEnviando(false);
    }
  }

  const campo =
    "border-line-input bg-surface-card text-ink-primary focus-visible:ring-ring/50 h-8 rounded-lg border px-2 text-[12px] focus-visible:ring-3 focus-visible:outline-none";

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-1">
        <span className="text-ink-primary text-[12px] font-[650]">Prueba a mi número</span>
        <span className="text-ink-faint text-[11px] leading-relaxed text-pretty">
          Llega la plantilla con las variables del lead que elijas. No cuenta como envío de la
          difusión y queda registrada en la auditoría.
        </span>
      </div>

      {muestras.length === 0 ? (
        <p className="text-ink-faint text-[11px]">
          Hace falta al menos un destinatario para resolver las variables.
        </p>
      ) : (
        <div className="grid grid-cols-[1fr_1fr] gap-2">
          <label htmlFor={idTelefono} className="flex flex-col gap-1">
            <span className="text-ink-dim text-[11px]">Número, con código de país</span>
            <input
              id={idTelefono}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+54 9 11 5555 0000"
              value={telefono}
              maxLength={24}
              onChange={(e) => setTelefono(e.target.value)}
              aria-describedby={estado ? idEstado : undefined}
              className={`${campo} font-mono tabular-nums`}
            />
          </label>
          <label htmlFor={idLead} className="flex flex-col gap-1">
            <span className="text-ink-dim text-[11px]">Variables de</span>
            <select
              id={idLead}
              value={leadElegido}
              onChange={(e) => setLeadId(e.target.value)}
              className={campo}
            >
              {muestras.map((d) => (
                <option key={d.leadId} value={d.leadId}>
                  {d.nombre || "Sin nombre"}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="flex items-center gap-2.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void enviar()}
          disabled={!listo}
          aria-busy={enviando || undefined}
        >
          {enviando ? "Mandando…" : "Enviar de prueba"}
        </Button>
        <p id={idEstado} role="status" aria-live="polite" className="min-w-0 flex-1 text-[11px]">
          {estado === null ? null : estado.ok ? (
            <span className="text-ok">
              Mandada.{" "}
              {estado.restantes === 0
                ? "No te quedan pruebas en esta hora."
                : `Te quedan ${estado.restantes} en esta hora.`}
            </span>
          ) : (
            <span className="text-danger">{estado.error}</span>
          )}
        </p>
      </div>
    </div>
  );
}
