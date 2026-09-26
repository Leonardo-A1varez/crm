import { notFound } from "next/navigation";
import { getLogger } from "@/lib/observability/get-logger";
import { getCurrentRol } from "@/server/auth/guards";
import { getDifusionServiceForRequest } from "@/server/bootstrap/difusion-bootstrap";
import { getReglasAdminServiceForRequest } from "@/server/bootstrap/reglas-bootstrap";
import { getTagsAdminServiceForRequest } from "@/server/bootstrap/tags-bootstrap";
import { getUsuariosServiceForRequest } from "@/server/bootstrap/usuarios-bootstrap";
import { getWorkflowsAdminServiceForRequest } from "@/server/bootstrap/workflows-bootstrap";
import { zonaDelNegocio } from "../../difusion/_lib/zona";
import { searchLeadsAction } from "../../leads/_actions/search-leads.action";
import {
  guardarVersionAction,
  obtenerDetalleRunAction,
  probarHastaAcaAction,
  probarWorkflowAction,
} from "../_actions/workflows.actions";
import { leerVistaPreviaMensajeAction } from "../_actions/vista-previa.actions";
import { EditorWorkflowCliente } from "./_components/EditorWorkflowCliente";
import { TOPE_PASOS } from "./_lib/max-pasos";
import { opcionesDeEtapas, opcionesDeIntents, opcionesDeVendedores } from "./_lib/opciones-editor";
import type { Grafo } from "@/types/workflows";

export const dynamic = "force-dynamic";

/** Un flujo que todavía no tiene nada. El editor arranca con la paleta y el lienzo vacío. */
const GRAFO_VACIO: Grafo = { nodos: [], aristas: [] };

/**
 * El editor de un flujo.
 *
 * **Ocupa la pantalla entera y no lleva `PageHeader`**: `EditorWorkflow` trae su
 * propia `BarraEditor` con el título, el botón de volver y las tres acciones, y
 * el lienzo necesita todo el ancho y todo el alto. Un encabezado de la página
 * encima sería un segundo título y ~60 px menos de lienzo.
 *
 * Lo único que la página dibuja son las dos franjas de estado. Van acá y no en
 * el cliente porque son hechos que el servidor ya sabe —si hay versión
 * publicada, qué rol tiene quien mira— y así se pintan sin JavaScript.
 */
export default async function WorkflowDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const svc = await getWorkflowsAdminServiceForRequest();
  const detalle = await svc.detalle(id);
  if (!detalle) notFound();

  const [rol, tags, intents, usuarios, zona, difusiones] = await Promise.all([
    getCurrentRol(),
    // Las listas alimentan los selectores del panel, que guardan un id real:
    // escribirlo a mano es un `tag_id_ausente` en producción esperando a que
    // alguien se equivoque de UUID. Las etapas no se piden: son un enum del
    // dominio y salen de `opcionesDeEtapas`.
    getTagsAdminServiceForRequest().then((s) => s.listar()),
    getReglasAdminServiceForRequest().then((s) => s.listarIntents()),
    getUsuariosServiceForRequest().then((s) => s.listar()),
    // Las horas de Flujos van en la zona del negocio, como en el historial y
    // en la corrida.
    zonaDelNegocio(getLogger({ scope: "workflows" })),
    // "Difusión respondida" elige a cuál: sólo las que salieron o van a salir.
    // Un borrador todavía no le llegó a nadie.
    getDifusionServiceForRequest()
      .then((s) => s.listar())
      .then((l) => l.difusiones.filter((d) => d.estado !== "borrador")),
  ]);
  const isAdmin = rol === "admin";

  // Se edita sobre la última versión guardada: es lo que alguien esperaría al
  // volver a una pantalla que dejó a medias.
  const ultima = detalle.versiones[0];
  const publicada = detalle.versiones.find((v) => v.publicada);

  return (
    <div className="bg-surface-root flex h-full flex-col overflow-hidden">
      {!publicada && detalle.workflow.activo ? (
        <p className="border-caution/30 bg-caution/10 text-caution flex shrink-0 items-center gap-2 border-b px-4 py-1.5 text-[11.5px] leading-snug text-pretty">
          <span aria-hidden className="bg-caution size-1.5 shrink-0 rounded-full" />
          Este flujo está prendido pero no tiene ninguna versión publicada, así que{" "}
          <strong className="font-semibold">no corre</strong>. Publicá una versión para que empiece.
        </p>
      ) : null}

      {!isAdmin ? (
        <p className="border-line-layout bg-surface-panel text-ink-faint flex shrink-0 items-center gap-2 border-b px-4 py-1.5 text-[11.5px] leading-snug text-pretty">
          <span aria-hidden className="bg-ink-ghost size-1.5 shrink-0 rounded-full" />
          Estás mirando el flujo. Guardar, publicar y probar quedan para un administrador.
        </p>
      ) : null}

      <div className="min-h-0 flex-1">
        <EditorWorkflowCliente
          workflowId={detalle.workflow.id}
          nombre={detalle.workflow.nombre}
          grafoInicial={ultima?.grafo ?? GRAFO_VACIO}
          // Sin versión guardada, el tope arranca en el mismo default que pone
          // la base. Antes arrancaba en 50: el primer "Guardar" de un flujo
          // nuevo le bajaba el tope a un décimo sin que nadie lo pidiera.
          maxPasos={ultima?.max_pasos ?? TOPE_PASOS.POR_DEFECTO}
          maxPasosPublicado={publicada?.max_pasos ?? null}
          versionPublicada={publicada?.version ?? null}
          grafoPublicado={publicada?.grafo ?? null}
          ultimaVersionId={ultima?.id ?? null}
          ultimaVersionNumero={ultima?.version ?? null}
          grafoUltimaGuardada={ultima?.grafo ?? null}
          versiones={detalle.versiones}
          puedeEditar={isAdmin}
          zona={zona}
          tags={tags.map((t) => ({ id: t.id, nombre: t.nombre }))}
          etapas={opcionesDeEtapas()}
          vendedores={opcionesDeVendedores(usuarios)}
          intents={opcionesDeIntents(intents.map((i) => i.intent))}
          difusiones={difusiones.map((d) => ({ id: d.id, nombre: d.nombre }))}
          onGuardar={guardarVersionAction}
          onProbar={probarWorkflowAction}
          onProbarHastaAca={probarHastaAcaAction}
          onBuscarLeads={searchLeadsAction}
          onObtenerDetalleRun={obtenerDetalleRunAction}
          onLeerVistaPrevia={leerVistaPreviaMensajeAction}
        />
      </div>
    </div>
  );
}
