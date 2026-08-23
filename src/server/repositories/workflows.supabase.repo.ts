import { InfraError, NotFoundError } from "@/lib/errors";
import { disparadorMatch } from "@/lib/workflows/recorrer";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { isUuid } from "@/server/db/uuid";
import type { AppClient } from "@/server/db/client";
import type { PoliticaConcurrencia, UUID, Workflow, WorkflowVersion } from "@/types/entities";
import type { Grafo } from "@/types/workflows";
import type { WorkflowInsert, WorkflowVersionInsert, WorkflowsRepository } from "./workflows.repo";

const COLS_WORKFLOW = "id, nombre, descripcion, activo, created_at";
const COLS_VERSION =
  "id, workflow_id, version, grafo, max_pasos, publicada, created_at, created_by, politica_concurrencia";

/**
 * Tope de la consulta de `listarPublicadasPorDisparador`, no de `productos`
 * ni de `leads`: `workflows`/`workflow_versiones` son una tabla de
 * CONFIGURACIÓN que arma un admin a mano, no un catálogo que crece con cada
 * venta ni una tabla de leads que crece con cada conversación -- el modelo de
 * deployment es "1 instalación por cliente" (AGENTS.md §1), así que un solo
 * cliente jamás va a tener miles de workflows activos. Aun así se deja el
 * `.range()` EXPLÍCITO en vez de un `.select()` desnudo: PostgREST corta en
 * 1.000 filas sin avisar (la lección pagada con `productos.list()`, ver
 * AGENTS.md nota 12), y confiar en que "esta tabla es chica" sin un tope
 * explícito es la misma apuesta silenciosa que ya salió mal una vez.
 */
const MAX_WORKFLOWS_ACTIVOS = 5000;

type PublicarVersionErrorCode = "version_not_found";

interface PublicarVersionRow {
  version_id: string | null;
  error_code: PublicarVersionErrorCode | null;
}

export class SupabaseWorkflowsRepository implements WorkflowsRepository {
  constructor(private readonly db: AppClient) {}

  async crearWorkflow(input: WorkflowInsert): Promise<Workflow> {
    const { data, error } = await this.db
      .from("workflows")
      .insert({ nombre: input.nombre, descripcion: input.descripcion, activo: input.activo })
      .select(COLS_WORKFLOW)
      .single();
    if (error) throw mapPostgrestError(error, { resource: "workflows" });
    return mapWorkflow(data);
  }

  async listarWorkflows(): Promise<Workflow[]> {
    const { data, error } = await this.db
      .from("workflows")
      .select(COLS_WORKFLOW)
      .order("created_at", { ascending: false });
    if (error) throw mapPostgrestError(error, { resource: "workflows" });
    return (data ?? []).map(mapWorkflow);
  }

  async findWorkflow(id: UUID): Promise<Workflow | null> {
    const { data, error } = await this.db
      .from("workflows")
      .select(COLS_WORKFLOW)
      .eq("id", id)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "workflows" });
    return data ? mapWorkflow(data) : null;
  }

  async crearVersion(input: WorkflowVersionInsert): Promise<WorkflowVersion> {
    const { data, error } = await this.db
      .from("workflow_versiones")
      .insert({
        workflow_id: input.workflow_id,
        version: input.version,
        // `grafo` es jsonb y `types.gen.ts` lo tipa como `Json`, que exige un
        // índice de string. `Grafo` es una interfaz de forma fija, así que TS
        // rechaza la asignación aunque el valor sea JSON válido. Mismo caso y
        // mismo patrón que `extras` en lead-session y `event_data` en
        // event-outbox: el cast va acá, en el borde con la base, no en el
        // tipo de dominio — `Grafo` sigue estricto para todo el resto del
        // código.
        grafo: input.grafo as never,
        max_pasos: input.max_pasos,
        // Una versión nace despublicada siempre: ver el comentario en
        // `WorkflowVersionInsert` (workflows.repo.ts).
        publicada: false,
        created_by: input.created_by,
      })
      .select(COLS_VERSION)
      .single();
    if (error) throw mapPostgrestError(error, { resource: "workflow_versiones" });
    return mapVersion(data);
  }

  async listarVersiones(workflowId: UUID): Promise<WorkflowVersion[]> {
    const { data, error } = await this.db
      .from("workflow_versiones")
      .select(COLS_VERSION)
      .eq("workflow_id", workflowId)
      .order("version", { ascending: false });
    if (error) throw mapPostgrestError(error, { resource: "workflow_versiones" });
    return (data ?? []).map(mapVersion);
  }

  async findVersionPublicada(workflowId: UUID): Promise<WorkflowVersion | null> {
    const { data, error } = await this.db
      .from("workflow_versiones")
      .select(COLS_VERSION)
      .eq("workflow_id", workflowId)
      .eq("publicada", true)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "workflow_versiones" });
    return data ? mapVersion(data) : null;
  }

  async findVersion(id: UUID): Promise<WorkflowVersion | null> {
    // Postgres rechaza un uuid mal formado con 22P02 en vez de devolver 0
    // filas -- mismo guard que `findById` en `leads.supabase.repo.ts` y el
    // resto de los repos que aceptan un id de fuera.
    if (!isUuid(id)) return null;
    const { data, error } = await this.db
      .from("workflow_versiones")
      .select(COLS_VERSION)
      .eq("id", id)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "workflow_versiones" });
    return data ? mapVersion(data) : null;
  }

  async publicarVersion(versionId: UUID): Promise<WorkflowVersion> {
    // Despublicar la anterior y publicar ésta son una sola transacción
    // Postgres (`publicar_workflow_version`), no dos UPDATE sueltos desde
    // acá: si el proceso muriera entre medio, el workflow quedaría con cero
    // versiones publicadas sin que nadie se enterara. Mismo patrón que
    // `approve_lead_merge` para fusionar leads.
    const { data, error } = await this.db.rpc("publicar_workflow_version", {
      p_version_id: versionId,
    });
    if (error) throw mapPostgrestError(error, { resource: "workflow_versiones" });

    const row = (data as PublicarVersionRow[] | null)?.[0];
    if (!row) {
      throw new InfraError("publicar_workflow_version no devolvió resultado", "postgrest");
    }
    if (row.error_code === "version_not_found") {
      throw new NotFoundError(`versión no encontrada: ${versionId}`, "workflow_version", versionId);
    }
    if (row.version_id === null) {
      throw new InfraError("publicar_workflow_version devolvió version_id nulo", "postgrest");
    }

    const publicada = await this.db
      .from("workflow_versiones")
      .select(COLS_VERSION)
      .eq("id", row.version_id)
      .single();
    if (publicada.error)
      throw mapPostgrestError(publicada.error, { resource: "workflow_versiones" });
    return mapVersion(publicada.data);
  }

  async proximaVersion(workflowId: UUID): Promise<number> {
    const { data, error } = await this.db
      .from("workflow_versiones")
      .select("version")
      .eq("workflow_id", workflowId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "workflow_versiones" });
    return (data?.version ?? 0) + 1;
  }

  /**
   * Dos consultas simples y acotadas en vez de un filtro jsonb embebido
   * (`.contains()`/`@>` sobre `grafo`) resuelto en Postgres. Elegido así:
   *
   *   1. Filtrar "activo" y "publicada" es un booleano y un join, no algo que
   *      necesite jsonb -- SQL para eso es directo. Pero "el disparador de
   *      ESTE grafo matchea" exige mirar dentro de `grafo->nodos[]`, un
   *      array de objetos heterogéneos (disparador/accion/condicion/espera/fin).
   *      Un `@>` de containment ahí depende de semántica de Postgres para
   *      matching parcial DENTRO de elementos de array que nadie en este
   *      repo ejerció ni puede verificar hoy -- los integration tests están
   *      congelados (AGENTS.md, aviso de la tabla de progreso) y no hay
   *      forma de correr la query contra Postgres real en esta sesión.
   *   2. `disparadorMatch()` (`lib/workflows/recorrer.ts`) YA es la fuente
   *      de verdad de "qué dispara este grafo" -- la usan `ejecutarSegmento`
   *      indirectamente (vía `disparadorDe`) y el repo InMemory. Repetir esa
   *      lógica como un patrón jsonb en SQL es una segunda implementación
   *      que se puede desincronizar de la primera sin que ningún test lo note.
   *   3. El riesgo real de las dos consultas es el corte silencioso de
   *      PostgREST en 1.000 filas (AGENTS.md nota 12) -- mitigado con
   *      `.range()` explícito hasta `MAX_WORKFLOWS_ACTIVOS` en AMBAS, no
   *      dejado al default. `workflows`/`workflow_versiones` es una tabla de
   *      configuración de un solo cliente (ver comentario de la constante),
   *      así que ese tope es holgado por diseño, no una apuesta.
   *
   * Es 2 queries y no N+1: el fan-out por versión NO golpea la DB una vez
   * por workflow, sólo una vez por cada una de las dos consultas.
   */
  async listarPublicadasPorDisparador(disparador: string): Promise<WorkflowVersion[]> {
    const activos = await this.db
      .from("workflows")
      .select("id")
      .eq("activo", true)
      .range(0, MAX_WORKFLOWS_ACTIVOS - 1);
    if (activos.error) throw mapPostgrestError(activos.error, { resource: "workflows" });
    const workflowIds = (activos.data ?? []).map((w) => w.id as UUID);
    if (workflowIds.length === 0) return [];

    const versiones = await this.db
      .from("workflow_versiones")
      .select(COLS_VERSION)
      .eq("publicada", true)
      .in("workflow_id", workflowIds)
      .range(0, MAX_WORKFLOWS_ACTIVOS - 1);
    if (versiones.error)
      throw mapPostgrestError(versiones.error, { resource: "workflow_versiones" });

    return (versiones.data ?? [])
      .map(mapVersion)
      .filter((v) => disparadorMatch(v.grafo, disparador));
  }
}

function mapWorkflow(r: {
  id: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  created_at: string;
}): Workflow {
  return {
    id: r.id,
    nombre: r.nombre,
    descripcion: r.descripcion,
    activo: r.activo,
    created_at: new Date(r.created_at),
  };
}

function mapVersion(r: {
  id: string;
  workflow_id: string;
  version: number;
  grafo: unknown;
  max_pasos: number;
  publicada: boolean;
  created_at: string;
  created_by: string | null;
  politica_concurrencia: PoliticaConcurrencia;
}): WorkflowVersion {
  return {
    id: r.id,
    workflow_id: r.workflow_id,
    version: r.version,
    // El grafo se validó antes de insertarse; acá vuelve tal cual salió.
    grafo: r.grafo as Grafo,
    max_pasos: r.max_pasos,
    publicada: r.publicada,
    created_at: new Date(r.created_at),
    created_by: r.created_by,
    politica_concurrencia: r.politica_concurrencia,
  };
}
