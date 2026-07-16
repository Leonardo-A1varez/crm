import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export function DuplicadosBanner({ count, activo }: { count: number; activo: boolean }) {
  if (count === 0) return null;
  return (
    <div className="border-border flex items-center gap-2 border-b bg-amber-50 px-4 py-2 text-sm dark:bg-amber-950/30">
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <span>
        {count} {count === 1 ? "par duplicado pendiente" : "pares duplicados pendientes"}
      </span>
      <Link
        href={activo ? "/leads" : "/leads?duplicados=1"}
        className="text-amber-700 hover:underline dark:text-amber-400"
      >
        {activo ? "Ver todos los leads" : "Ver involucrados"}
      </Link>
    </div>
  );
}
