/**
 * Fallback del panel de conversación, no de la lista: desde que el shell de 3
 * paneles vive en el layout, la lista ya está pintada cuando esto aparece.
 */
export default function InboxLoading() {
  return (
    <div
      role="status"
      aria-label="Cargando conversación"
      className="bg-surface-chat flex flex-1 items-center justify-center"
    >
      <div className="bg-surface-elevated h-3 w-40 animate-pulse rounded-full" />
    </div>
  );
}
