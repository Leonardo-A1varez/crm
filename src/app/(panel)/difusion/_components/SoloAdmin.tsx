import Link from "next/link";
import { EmptyState } from "@/components/shared/EmptyState";
import { buttonVariants } from "@/components/ui/button";

/**
 * Lo que ve un vendedor si llega a armar o editar una difusión por URL.
 *
 * Armar una es de admin —lo exigen las acciones y las policies de
 * `difusiones`—, así que en vez de un asistente que falla al primer
 * "Continuar" se le dice de entrada.
 */
export function SoloAdmin({ titulo }: { titulo: string }) {
  return (
    <div className="bg-surface-root flex h-full flex-col items-center justify-center p-6">
      <EmptyState
        title={titulo}
        description="Armar, programar o detener una difusión es de un administrador."
        action={
          <Link href="/difusion" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Volver a Difusión
          </Link>
        }
      />
    </div>
  );
}
