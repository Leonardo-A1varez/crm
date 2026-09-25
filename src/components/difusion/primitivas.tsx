import { Eyebrow } from "@/components/shared/Eyebrow";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Escala tipográfica de las cifras. Todo número que cuesta plata o el número
 * de WhatsApp se escribe con `Cifra`: mono, tabular y alineado a la derecha,
 * sin excepción. Un cupo o un costo se escanean en columna, no se leen en
 * prosa, y para eso las cifras tienen que tener todas el mismo ancho.
 */
const TAMANO = {
  xs: "text-[10.5px]",
  sm: "text-[11.5px]",
  md: "text-[13px]",
  lg: "text-[19px] leading-none tracking-[-0.02em]",
  xl: "text-[32px] leading-none tracking-[-0.03em]",
} as const;

export type TamanoCifra = keyof typeof TAMANO;

export function Cifra({
  valor,
  unidad,
  tamano = "md",
  color,
  className,
}: {
  valor: string;
  /** Siempre visible: un número sin unidad obliga a adivinar qué mide. */
  unidad?: string;
  tamano?: TamanoCifra;
  color?: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-baseline justify-end gap-1", className)}>
      <span
        className={cn("font-mono font-semibold tabular-nums", TAMANO[tamano])}
        style={color ? { color } : undefined}
      >
        {valor}
      </span>
      {unidad ? (
        <span className="text-ink-faint font-mono text-[10.5px] font-normal">{unidad}</span>
      ) : null}
    </span>
  );
}

/** La caja de todo: mismo borde, misma superficie, mismo radio en las 4 pantallas. */
export function Panel({
  titulo,
  acciones,
  children,
  acento,
  className,
}: {
  titulo?: string;
  acciones?: ReactNode;
  children: ReactNode;
  /** Borde de color cuando el panel es el que decide algo. */
  acento?: string;
  className?: string;
}) {
  return (
    <section
      className={cn("bg-surface-card rounded-[13px] border p-4", className)}
      style={acento ? { borderColor: acento } : undefined}
    >
      {titulo || acciones ? (
        <header className="flex items-center justify-between gap-3 pb-3">
          {titulo ? <Eyebrow>{titulo}</Eyebrow> : <span />}
          {acciones ? <div className="flex items-center gap-1.5">{acciones}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** Fila etiqueta → cifra, con la cifra pegada al borde derecho. */
export function FilaDato({
  etiqueta,
  children,
  detalle,
}: {
  etiqueta: ReactNode;
  children: ReactNode;
  detalle?: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-ink-dim min-w-0 flex-1 text-[11.5px]">
        {etiqueta}
        {detalle ? <span className="text-ink-ghost"> · {detalle}</span> : null}
      </span>
      {children}
    </div>
  );
}

/** Punto de color de 6px. Nunca va solo: siempre acompaña una etiqueta de texto. */
export function Punto({
  color,
  latiendo,
  className,
}: {
  color: string;
  latiendo?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-[6px] shrink-0 rounded-full",
        latiendo && "motion-safe:animate-pulse-dot",
        className,
      )}
      style={{ backgroundColor: color }}
    />
  );
}

/**
 * Código de error de Meta. Mono siempre: es un identificador que se copia y se
 * busca en la documentación, no una palabra.
 */
export function CodigoMeta({ codigo, color }: { codigo: string; color?: string }) {
  return (
    <code
      className="bg-surface-input rounded-[5px] px-1.5 py-[1px] font-mono text-[10px] font-medium"
      style={color ? { color } : undefined}
    >
      {codigo}
    </code>
  );
}

/** Nota al pie de un panel: la letra chica que explica la regla. */
export function Nota({ children }: { children: ReactNode }) {
  return <p className="text-ink-ghost text-[10.5px] leading-relaxed">{children}</p>;
}
