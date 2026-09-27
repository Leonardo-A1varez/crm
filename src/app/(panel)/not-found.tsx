import Link from "next/link";
import { EmptyState } from "@/components/shared/EmptyState";

/**
 * Lo que se ve cuando una pantalla del panel llama a `notFound()`: un flujo,
 * un lead o una difusión que ya no existe. Sin este archivo salía la página
 * por defecto de Next, en inglés y sin la barra lateral.
 */
export default function PanelNoEncontrado() {
  return (
    <div className="bg-surface-root h-full">
      <EmptyState
        title="Esto ya no existe"
        description="Puede que lo hayan borrado o que el link esté mal escrito."
        action={
          <Link
            href="/inbox"
            className="border-line-control text-ink-secondary hover:text-ink-primary focus-visible:ring-brand/60 rounded-[8px] border px-3 py-1.5 text-[12px] font-medium transition-colors outline-none focus-visible:ring-2"
          >
            Ir a la bandeja
          </Link>
        }
      />
    </div>
  );
}
