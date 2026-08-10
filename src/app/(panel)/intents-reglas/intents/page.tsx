import { DatabaseSearch } from "@/components/icons";
import { PantallaPendiente } from "@/components/shared/PantallaPendiente";

export default function IntentsPage() {
  return (
    <PantallaPendiente
      titulo="Intents"
      icono={<DatabaseSearch size={34} strokeWidth={1.4} />}
      descripcion="Va a listar los intents que el clasificador detecta solo y dejar que un admin los apruebe. La tabla existe y está vacía: por eso hoy cada mensaje pasa por el LLM."
      origen="sub-proyecto G2"
    />
  );
}
