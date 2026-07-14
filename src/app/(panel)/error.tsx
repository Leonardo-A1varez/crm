"use client";

import { Button } from "@/components/ui/button";

/**
 * Error boundary del panel. El detalle real queda en logs server-side;
 * al usuario solo se le muestra el digest para correlacionar con soporte.
 */
export default function PanelError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <h2 className="text-lg font-medium">Algo salió mal</h2>
      <p className="text-muted-foreground max-w-sm text-sm">
        Ocurrió un error inesperado al cargar el panel. Reintentá; si persiste, avisale al
        administrador.
      </p>
      {error.digest ? (
        <p className="text-muted-foreground font-mono text-xs">Ref: {error.digest}</p>
      ) : null}
      <Button variant="outline" className="mt-2" onClick={reset}>
        Reintentar
      </Button>
    </div>
  );
}
