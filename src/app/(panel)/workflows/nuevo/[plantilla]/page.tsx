import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowForward } from "@/components/icons";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { PLANTILLAS } from "@/components/workflows/lista/plantillas";
import { getCurrentRol } from "@/server/auth/guards";
import { EN_BLANCO } from "../../_lib/listado";
import { crearFlujoAction } from "../_actions/crear-flujo.action";
import { armarPlantilla } from "../_lib/grafos-plantillas";
import { FormularioNuevoFlujo } from "./_components/FormularioNuevoFlujo";

export const dynamic = "force-dynamic";

/**
 * `/workflows/nuevo/[plantilla]` — el nombre del flujo antes de abrir el lienzo.
 *
 * Crear desde una plantilla guarda su grafo como la primera versión del flujo
 * (`armarPlantilla`, en `../_lib/grafos-plantillas`), así que el lienzo se abre
 * ya armado. La tarjeta sigue a la vista con sus pasos numerados, y debajo se
 * dice cuántos bloques trae el lienzo y qué queda por elegir: lo que depende
 * del negocio —qué etiqueta, qué texto, qué plantilla de Meta— una plantilla no
 * lo puede saber. Esa línea sale del mismo grafo que se va a guardar, así que
 * no puede prometer más de lo que el lienzo trae.
 */
export default async function NuevoFlujoDesdePlantillaPage({
  params,
}: {
  params: Promise<{ plantilla: string }>;
}) {
  const { plantilla: idPlantilla } = await params;

  const rol = await getCurrentRol();
  if (rol !== "admin") redirect("/workflows");

  const enBlanco = idPlantilla === EN_BLANCO;
  const plantilla = enBlanco ? null : PLANTILLAS.find((p) => p.id === idPlantilla);
  // Un id que no existe es un link roto, no una pantalla vacía con un formulario.
  if (!enBlanco && !plantilla) notFound();

  const armada = plantilla ? armarPlantilla(plantilla.id) : null;
  const Glifo = plantilla?.glifo;

  return (
    <div className="bg-surface-root flex h-full flex-col overflow-hidden">
      <header className="border-line-layout bg-surface-panel flex shrink-0 items-center gap-3.5 border-b px-5 py-[15px]">
        <Link
          href="/workflows/nuevo"
          aria-label="Volver a las plantillas"
          className="border-line-card text-ink-secondary hover:bg-surface-hover hover:text-ink-primary flex size-8 shrink-0 items-center justify-center rounded-[9px] border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
        >
          <ArrowForward size={15} className="rotate-180" aria-hidden />
        </Link>
        <div className="min-w-0">
          <h1 className="text-ink-primary truncate text-[22px] leading-tight font-[680] tracking-[-0.03em]">
            {plantilla ? plantilla.nombre : "Flujo en blanco"}
          </h1>
          <p className="text-ink-faint mt-[3px] truncate text-[12px]">
            {plantilla ? plantilla.descripcion : "Sin plantilla: el lienzo arranca vacío."}
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[620px] flex-col gap-5 p-5">
          {plantilla ? (
            <section className="border-line-card bg-surface-card flex flex-col gap-3 rounded-[13px] border p-4">
              <div className="flex items-center gap-2.5">
                {Glifo ? <Glifo size={16} className="text-ink-secondary shrink-0" /> : null}
                <Eyebrow>Lo que tiene que hacer</Eyebrow>
              </div>

              <p className="text-ink-secondary text-[12px] leading-relaxed">
                Cuando <strong className="text-ink-primary">{plantilla.disparador}</strong>:
              </p>

              {/*
                Los números no son decoración de lista: los pasos ocurren en ese
                orden y el orden es la información. Por eso `<ol>` y no `<ul>`.
              */}
              <ol className="flex flex-col gap-1.5">
                {plantilla.pasos.map((paso, i) => (
                  <li key={paso} className="text-ink-secondary flex gap-2.5 text-[12px]">
                    <span className="text-ink-ghost shrink-0 font-mono text-[11px] tabular-nums">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="leading-relaxed">{paso}</span>
                  </li>
                ))}
              </ol>

              <p className="text-ink-ghost border-line-row border-t pt-3 text-[11px] leading-relaxed text-pretty">
                Reemplaza {plantilla.reemplaza}.
                {armada ? (
                  <>
                    {" "}
                    <strong>El lienzo aparece ya armado</strong> con sus{" "}
                    <span className="tabular-nums">{armada.grafo.nodos.length}</span> bloques
                    conectados
                    {armada.pendiente
                      ? `; antes de publicar falta ${armada.pendiente}.`
                      : ", listo para revisar y publicar."}
                  </>
                ) : null}
              </p>
            </section>
          ) : null}

          <FormularioNuevoFlujo
            nombreSugerido={plantilla ? plantilla.nombre : ""}
            descripcionSugerida={plantilla ? plantilla.descripcion : ""}
            plantillaId={plantilla ? plantilla.id : null}
            onCrear={crearFlujoAction}
          />
        </div>
      </div>
    </div>
  );
}
