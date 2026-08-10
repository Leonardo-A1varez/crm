import { SettingsIcon } from "@/components/icons";
import { PantallaPendiente } from "@/components/shared/PantallaPendiente";

export default function AjustesPage() {
  return (
    <PantallaPendiente
      titulo="Ajustes"
      icono={<SettingsIcon size={34} strokeWidth={1.4} />}
      descripcion="Va a juntar los ajustes del sistema: datos de la empresa, usuarios y roles, y horario de atención. La configuración del agente vendedor no vive acá: está en Agente IA."
      origen="fase 12"
    />
  );
}
