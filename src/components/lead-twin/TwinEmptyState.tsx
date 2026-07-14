import { EmptyState } from "@/components/shared/EmptyState";

export function TwinEmptyState() {
  return (
    <EmptyState
      title="Sin Lead Twin"
      description="La ficha se construye automáticamente durante una sesión activa. Se genera con la próxima conversación."
    />
  );
}
