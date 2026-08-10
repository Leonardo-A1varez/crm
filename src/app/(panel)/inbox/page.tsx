import { EmptyState } from "@/components/shared/EmptyState";

export default function InboxPage() {
  return (
    <div className="bg-surface-chat flex flex-1 items-center justify-center">
      <EmptyState
        title="Elegí una conversación"
        description="Seleccioná una de la lista para ver el hilo y la ficha del lead."
      />
    </div>
  );
}
