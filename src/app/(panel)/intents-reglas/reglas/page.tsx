import { redirect } from "next/navigation";

/**
 * La administración de reglas vive adentro de la consola del agente, como
 * pestaña "Reglas IF/THEN" (handoff §4.1): esa pantalla reemplaza el ítem
 * "Intents y reglas" de la nav.
 *
 * La ruta se conserva como redirección en vez de borrarse: no está en el nav
 * pero sí en marcadores y en los docs de la sesión anterior, y un 404 sobre
 * una URL que ayer funcionaba es peor que un salto a donde vive ahora.
 */
export default function ReglasPage() {
  redirect("/agente?tab=reglas");
}
