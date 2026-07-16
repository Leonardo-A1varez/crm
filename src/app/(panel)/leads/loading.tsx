export default function LeadsLoading() {
  return (
    <div role="status" aria-label="Cargando leads" className="divide-y">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <div className="bg-muted h-4 w-24 animate-pulse rounded" />
          <div className="bg-muted h-4 w-1/3 animate-pulse rounded" />
          <div className="bg-muted h-4 w-16 animate-pulse rounded" />
        </div>
      ))}
    </div>
  );
}
