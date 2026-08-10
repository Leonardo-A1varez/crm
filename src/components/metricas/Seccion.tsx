import { Eyebrow } from "@/components/shared/Eyebrow";
import { MonoMeta } from "@/components/shared/MonoMeta";
import { cn } from "@/lib/utils";

/** Tarjeta de sección de la pantalla de métricas: título, meta a la derecha y cuerpo. */
export function Seccion({
  titulo,
  extra,
  nota,
  className,
  children,
}: {
  titulo: string;
  extra?: string;
  /** Lectura al pie: qué mirar en el bloque, o cómo está definido el corte. */
  nota?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn("border-line-card bg-surface-card rounded-[14px] border p-[17px]", className)}
    >
      <div className="mb-3.5 flex items-baseline justify-between gap-2">
        <Eyebrow>{titulo}</Eyebrow>
        {extra ? <MonoMeta>{extra}</MonoMeta> : null}
      </div>
      {children}
      {nota ? <p className="text-ink-ghost mt-3.5 text-[10.5px] leading-relaxed">{nota}</p> : null}
    </section>
  );
}
