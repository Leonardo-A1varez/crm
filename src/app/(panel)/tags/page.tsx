import { Sell } from "@/components/icons";
import { PantallaPendiente } from "@/components/shared/PantallaPendiente";

export default function TagsPage() {
  return (
    <PantallaPendiente
      titulo="Tags"
      icono={<Sell size={34} strokeWidth={1.4} />}
      descripcion="Va a permitir crear, renombrar y colorear las etiquetas que se le cuelgan a un lead. Hoy las tags se leen en la ficha del lead pero no hay dónde administrarlas."
      origen="fase 12"
    />
  );
}
