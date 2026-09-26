"use client";

import { EditorConVariables } from "@/components/workflows/canvas/config/EditorConVariables";
import { LARGO_MAXIMO_TEXTO_LIBRE } from "@/lib/difusion/modelo";
import { CATALOGO_TEXTO_LIBRE } from "./campos-mensaje";
import { formatearEntero } from "./formato";
import { Nota } from "./primitivas";

/**
 * La versión en texto libre, para quien tiene la ventana de 24 h abierta
 * (PRD §7.3.5). Opcional: vacía, todos reciben la plantilla.
 *
 * Las variables son las mismas que las de la plantilla y se eligen igual que
 * en los mensajes de un flujo, como chips: nadie escribe `{{ }}` a mano. La
 * cifra de a cuántos les llega sale del planificador; el motor vuelve a mirar
 * la ventana al mandar, y quien la tenga cerrada recibe la plantilla.
 */
export function TextoLibreMensaje({
  valor,
  onCambiar,
  porTextoLibre,
}: {
  valor: string;
  onCambiar: (valor: string) => void;
  /** A cuántos les saldría hoy, según el plan. `null` mientras no hay cálculo. */
  porTextoLibre: number | null;
}) {
  const vacio = valor.trim() === "";
  return (
    <section className="flex flex-col gap-3" aria-labelledby="texto-libre-titulo">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="texto-libre-titulo" className="text-ink-primary text-[13px] font-[650]">
          Texto libre para la ventana abierta
        </h2>
        <span className="text-ink-ghost text-[11px]">opcional</span>
      </div>

      <div className="border-line-card bg-surface-card flex flex-col gap-2.5 rounded-[11px] border p-3.5">
        <p className="text-ink-secondary text-[12px] leading-relaxed text-pretty">
          A quien escribió en las últimas 24 h le llega este texto en lugar de la plantilla: no se
          cobra y no usa el cupo. Si lo dejás vacío, todos reciben la plantilla.
        </p>
        <EditorConVariables
          etiqueta="Texto libre"
          value={valor}
          onChange={onCambiar}
          placeholder="Escribí el mensaje y sumá datos del lead con «+ Variable»"
          maxLength={LARGO_MAXIMO_TEXTO_LIBRE}
          catalogo={CATALOGO_TEXTO_LIBRE}
        />
        <Nota>
          {vacio
            ? "Sin texto libre: sale la plantilla también a quien tiene la ventana abierta."
            : porTextoLibre === null
              ? "Se calcula a cuántos les llega cuando termine de cargar la audiencia."
              : porTextoLibre === 1
                ? "Hoy le llegaría a 1 persona. La ventana se vuelve a mirar al mandar."
                : `Hoy les llegaría a ${formatearEntero(porTextoLibre)} personas. La ventana se vuelve a mirar al mandar.`}
        </Nota>
      </div>
    </section>
  );
}
