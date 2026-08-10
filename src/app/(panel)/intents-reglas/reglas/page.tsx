import { Bolt } from "@/components/icons";
import { PantallaPendiente } from "@/components/shared/PantallaPendiente";

export default function ReglasPage() {
  return (
    <PantallaPendiente
      titulo="Reglas"
      icono={<Bolt size={34} strokeWidth={1.4} />}
      descripcion="Va a permitir escribir la respuesta fija de cada intent, con prioridad y escalado a un humano. Sin reglas cargadas cada saludo cuesta una llamada al LLM."
      origen="sub-proyecto G2"
    />
  );
}
