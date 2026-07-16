/**
 * Loading skeleton para /leads/[id]: header + 3 bloques pulse (ficha, heading sesiones, lista).
 */
export default function LeadDetailLoading() {
  return (
    <div className="flex h-screen flex-col">
      <header className="border-border flex items-center gap-3 border-b px-4 py-3">
        <div className="bg-muted h-4 w-16 animate-pulse rounded" />
        <div className="bg-muted h-5 w-48 animate-pulse rounded" />
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="bg-muted h-28 animate-pulse rounded" />
        <div className="bg-muted mt-6 h-5 w-32 animate-pulse rounded" />
        <div className="bg-muted mt-3 h-40 animate-pulse rounded" />
      </div>
    </div>
  );
}
