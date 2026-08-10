import { redirect } from "next/navigation";

/**
 * Ver la nota de `../reglas/page.tsx`: los intents se administran desde la
 * pestaña "Reglas IF/THEN" de la consola del agente, y esta ruta queda solo
 * como redirección para no romper marcadores.
 */
export default function IntentsPage() {
  redirect("/agente?tab=reglas");
}
