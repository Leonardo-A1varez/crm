/**
 * Loading skeleton para /leads/[id].
 * Muestra placeholders mientras se carga la ficha y sesiones.
 */
export default function LeadDetailLoading() {
  return (
    <div className="flex h-screen flex-col">
      {/* Header skeleton */}
      <header className="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex-1">
          <div className="bg-muted mb-2 h-6 w-40 rounded" />
          <div className="bg-muted h-4 w-64 rounded" />
        </div>
        <div className="bg-muted h-4 w-20 rounded" />
      </header>

      {/* Contenido */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-3">
          {/* Columna izquierda: Ficha + sesiones */}
          <div className="space-y-6 lg:col-span-2">
            {/* Ficha skeleton */}
            <div className="border-border bg-card space-y-4 rounded-lg border p-6">
              <div className="bg-muted h-6 w-48 rounded" />
              <div className="space-y-2">
                <div className="bg-muted h-4 w-20 rounded" />
                <div className="bg-muted h-4 w-40 rounded" />
              </div>
              <div className="space-y-2">
                <div className="bg-muted h-4 w-20 rounded" />
                <div className="bg-muted h-4 w-36 rounded" />
              </div>
              <div className="border-border border-t pt-4">
                <div className="bg-muted h-4 w-40 rounded" />
              </div>
            </div>

            {/* Sesiones skeleton */}
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="border-border bg-card rounded-lg border p-4">
                  <div className="mb-3 flex gap-2">
                    <div className="bg-muted h-6 w-24 rounded" />
                    <div className="bg-muted h-6 w-20 rounded" />
                  </div>
                  <div className="bg-muted h-4 w-48 rounded" />
                  <div className="bg-muted mt-2 h-4 w-40 rounded" />
                </div>
              ))}
            </div>
          </div>

          {/* Columna derecha: Duplicados skeleton */}
          <div>
            <div className="bg-muted mb-4 h-6 w-32 rounded" />
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="border-border bg-card rounded-lg border p-4">
                  <div className="bg-muted mb-2 h-4 w-32 rounded" />
                  <div className="bg-muted h-4 w-24 rounded" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
