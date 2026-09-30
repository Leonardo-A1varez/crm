import type { ReactNode } from "react";

/**
 * Cuerpo de una página legal. El ancho de lectura (~65ch) y la jerarquía de
 * h1/h2/listas viven acá, en un solo lugar, para que las tres páginas no
 * diverjan.
 */
export function Documento({
  titulo,
  vigencia,
  children,
}: {
  titulo: string;
  vigencia: string;
  children: ReactNode;
}) {
  return (
    <article
      className={
        "max-w-[65ch] text-base leading-7 " +
        "[&_h2]:text-ink-primary [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:leading-snug [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:[text-wrap:balance] " +
        "[&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_p]:mt-4 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 " +
        "[&_li]:marker:text-ink-dim [&_strong]:text-ink-primary [&_li]:pl-1 [&_strong]:font-semibold " +
        "[&_a]:text-brand [&_a]:hover:text-brand-hover [&_a]:focus-visible:outline-brand [&_a]:underline [&_a]:underline-offset-4 [&_a]:focus-visible:outline-2 [&_a]:focus-visible:outline-offset-2"
      }
    >
      <h1 className="text-ink-primary text-3xl leading-tight font-semibold tracking-tight [text-wrap:balance] sm:text-4xl">
        {titulo}
      </h1>
      <p className="text-ink-muted mt-3 text-sm">
        <strong className="text-ink-secondary font-medium">Vigente desde:</strong> {vigencia}
      </p>
      {children}
    </article>
  );
}

export const VIGENCIA = "30 de septiembre de 2026";
export const CORREO = "mercadeo@elgenuinorepuestos.com";
