export default function InboxLoading() {
  return (
    <div role="status" aria-label="Cargando inbox" className="divide-y">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="px-4 py-3">
          <div className="bg-muted h-4 w-1/3 animate-pulse rounded" />
          <div className="bg-muted mt-2 h-3 w-2/3 animate-pulse rounded" />
          <div className="bg-muted mt-2 h-3 w-16 animate-pulse rounded" />
        </div>
      ))}
    </div>
  );
}
