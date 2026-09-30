"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RUTAS_PUBLICAS } from "@/lib/rutas-publicas";

const ETIQUETAS: Record<(typeof RUTAS_PUBLICAS)[number], string> = {
  "/privacidad": "Privacidad",
  "/condiciones": "Condiciones",
  "/eliminacion-de-datos": "Eliminación de datos",
};

export function LegalNav() {
  const actual = usePathname();
  return (
    <nav aria-label="Documentos legales" className="-mx-2 flex flex-wrap gap-x-1 gap-y-1">
      {RUTAS_PUBLICAS.map((ruta) => {
        const activa = actual === ruta;
        return (
          <Link
            key={ruta}
            href={ruta}
            aria-current={activa ? "page" : undefined}
            className={
              "focus-visible:outline-brand inline-flex min-h-10 items-center rounded-md px-2 text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 " +
              (activa
                ? "text-ink-primary decoration-brand font-medium underline decoration-2 underline-offset-8"
                : "text-ink-muted hover:text-ink-primary")
            }
          >
            {ETIQUETAS[ruta]}
          </Link>
        );
      })}
    </nav>
  );
}
