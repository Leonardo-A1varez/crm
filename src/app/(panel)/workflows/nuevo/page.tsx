import { redirect } from "next/navigation";
import { GaleriaPlantillas } from "@/components/workflows/lista/GaleriaPlantillas";
import { PLANTILLAS } from "@/components/workflows/lista/plantillas";
import { getCurrentRol } from "@/server/auth/guards";
import { EN_BLANCO } from "../_lib/listado";
import { armarPlantilla, bloquesQueNoCorren } from "./_lib/grafos-plantillas";

export const dynamic = "force-dynamic";

/**
 * `/workflows/nuevo` — la galería de plantillas.
 *
 * Crear un flujo abre esto y nunca un lienzo vacío: un lienzo en blanco con un
 * disparador sin elegir obliga a saber qué bloques existen antes de haber visto
 * uno. "Empezar en blanco" sigue estando, al final y en gris.
 *
 * Un vendedor no crea flujos —`crearFlujoAction` lo rechaza y la
 * policy de RLS también—, así que la pantalla no se le muestra: es preferible a
 * dejarlo elegir una plantilla, llenar un nombre y recibir un error recién al
 * final.
 */
export default async function NuevoFlujoPage() {
  const rol = await getCurrentRol();
  if (rol !== "admin") redirect("/workflows");

  return (
    <div className="bg-surface-root flex h-full flex-col overflow-hidden">
      <GaleriaPlantillas
        hrefVolver="/workflows"
        hrefPlantilla={(id) => `/workflows/nuevo/${id}`}
        hrefEnBlanco={`/workflows/nuevo/${EN_BLANCO}`}
        noCorren={Object.fromEntries(
          PLANTILLAS.map((p) => {
            const armada = armarPlantilla(p.id);
            return [p.id, armada ? bloquesQueNoCorren(armada.grafo) : []];
          }),
        )}
      />
    </div>
  );
}
