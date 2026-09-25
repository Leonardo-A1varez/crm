"use client";

import { useRouter } from "next/navigation";
import { ListadoDifusiones } from "@/components/difusion";
import type { Cupo, Dato, ListadoVista, SaludNumero } from "@/components/difusion";

/**
 * El listado es de cliente porque sus dos acciones son navegación imperativa
 * (`useRouter`): las filas son `<button>` y la cabecera trae un
 * `<Button onClick>`. Este envoltorio existe solo para eso; la página de al
 * lado sigue siendo un Server Component.
 */
export function PantallaListado({
  listado,
  cupo,
  salud,
  puedeCrear,
}: {
  listado: Dato<ListadoVista>;
  cupo: Cupo;
  salud: SaludNumero;
  puedeCrear: boolean;
}) {
  const router = useRouter();

  return (
    <ListadoDifusiones
      listado={listado}
      cupo={cupo}
      salud={salud}
      puedeCrear={puedeCrear}
      onNueva={() => router.push("/difusion/nueva")}
      onAbrir={(id) => router.push(`/difusion/${id}`)}
    />
  );
}
