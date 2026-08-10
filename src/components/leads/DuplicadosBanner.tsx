import Link from "next/link";
import { Warning } from "@/components/icons";

export function DuplicadosBanner({ count, activo }: { count: number; activo: boolean }) {
  if (count === 0) return null;
  return (
    <div className="border-line-layout bg-caution/8 text-ink-secondary flex shrink-0 items-center gap-2 border-b px-5 py-2 text-[11.5px]">
      <Warning className="text-caution shrink-0" size={14} />
      <span>
        {count} {count === 1 ? "par duplicado pendiente" : "pares duplicados pendientes"}
      </span>
      <Link
        href={activo ? "/leads" : "/leads?duplicados=1"}
        className="text-caution font-semibold hover:underline"
      >
        {activo ? "Ver todos los leads" : "Ver involucrados"}
      </Link>
    </div>
  );
}
