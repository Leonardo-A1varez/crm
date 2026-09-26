import { problemasParaPublicar } from "@/lib/workflows/validar-workflow";
import type { UUID } from "@/types/entities";
import type { Grafo } from "@/types/workflows";
import type { WorkflowsAdminService } from "./workflows-admin.service";

export interface ImportarFlujoInput {
  nombre: string;
  descripcion: string | null;
  grafo: Grafo;
  maxPasos: number;
  userId: UUID | null;
}

export interface ImportarFlujoResult {
  workflowId: UUID;
  /** Cuántos problemas impiden publicarlo: entra igual, como borrador. */
  problemasParaPublicar: number;
}

/**
 * Importa un flujo: lo crea apagado y guarda el grafo como su primera
 * versión, sin publicarla.
 *
 * Todo o nada, igual que crear desde una plantilla: son dos escrituras y el
 * servicio no ofrece una que haga las dos juntas, así que si la versión no
 * pasa `validarGrafo` el flujo recién creado se borra. Un flujo vacío en la
 * lista después de un "no se pudo importar" sería una mentira.
 *
 * Vive fuera de `DefaultWorkflowsAdminService` a propósito: usa sólo su
 * interfaz pública (`crear`, `guardarVersion`, `eliminar`) y no necesita nada
 * más de adentro.
 */
export async function importarFlujo(
  svc: Pick<WorkflowsAdminService, "crear" | "guardarVersion" | "eliminar">,
  input: ImportarFlujoInput,
): Promise<ImportarFlujoResult> {
  const workflow = await svc.crear({ nombre: input.nombre, descripcion: input.descripcion });
  try {
    await svc.guardarVersion({
      workflowId: workflow.id,
      grafo: input.grafo,
      maxPasos: input.maxPasos,
      userId: input.userId,
    });
  } catch (e) {
    await svc.eliminar(workflow.id);
    throw e;
  }
  return {
    workflowId: workflow.id,
    problemasParaPublicar: problemasParaPublicar(input.grafo).length,
  };
}
