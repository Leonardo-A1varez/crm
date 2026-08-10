import { beforeEach, describe, expect, test } from "vitest";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { InMemoryAdminAuditRepository } from "@/server/repositories/admin-audit.repo";
import { InMemoryTagsRepository } from "@/server/repositories/tags.repo";
import { DefaultAdminAuditService } from "@/server/services/admin-audit.service";
import { DefaultTagsAdminService } from "@/server/services/tags/tags-admin.service";

const ACTOR = "11111111-1111-4111-8111-111111111111";

describe("DefaultTagsAdminService", () => {
  let tags: InMemoryTagsRepository;
  let auditRepo: InMemoryAdminAuditRepository;
  let svc: DefaultTagsAdminService;

  beforeEach(() => {
    tags = new InMemoryTagsRepository();
    auditRepo = new InMemoryAdminAuditRepository();
    svc = new DefaultTagsAdminService({
      tags,
      audit: new DefaultAdminAuditService(auditRepo),
    });
  });

  const crear = (nombre: string, color = "#FFAF3A") =>
    svc.crear({ nombre, color, descripcion: null });

  // --- listar ---

  test("cada etiqueta trae en cuántos leads está colgada", async () => {
    const usada = await crear("urgente");
    const sinUso = await crear("seguimiento");
    await tags.assignToLead("lead-A", usada.id, "manual");
    await tags.assignToLead("lead-B", usada.id, "manual");

    const filas = await svc.listar();

    expect(filas.find((f) => f.id === usada.id)?.leadsUsando).toBe(2);
    expect(filas.find((f) => f.id === sinUso.id)?.leadsUsando).toBe(0);
  });

  test("el mismo lead con dos etiquetas cuenta una vez en cada una", async () => {
    const a = await crear("a-tag");
    const b = await crear("b-tag");
    await tags.assignToLead("lead-A", a.id, "manual");
    await tags.assignToLead("lead-A", b.id, "manual");

    const filas = await svc.listar();

    expect(filas.map((f) => f.leadsUsando)).toEqual([1, 1]);
  });

  test("las etiquetas salen ordenadas por nombre", async () => {
    await crear("zeta");
    await crear("alfa");
    await crear("ñandú");

    expect((await svc.listar()).map((f) => f.nombre)).toEqual(["alfa", "ñandú", "zeta"]);
  });

  // --- crear ---

  test("el nombre se guarda recortado", async () => {
    const t = await crear("  con espacios  ");
    expect(t.nombre).toBe("con espacios");
  });

  test("dos etiquetas con el mismo nombre no pueden convivir", async () => {
    await crear("urgente");

    // `tags.nombre` es UNIQUE: sin el chequeo previo el alta reventaría con un
    // 23505 que el operador lee como error genérico.
    await expect(crear("urgente")).rejects.toBeInstanceOf(ConflictError);
  });

  test("el duplicado se detecta también cuando difiere solo en espacios", async () => {
    await crear("urgente");
    await expect(crear("  urgente ")).rejects.toBeInstanceOf(ConflictError);
  });

  // --- editar ---

  test("editar cambia nombre, color y descripción", async () => {
    const t = await crear("vieja");

    const editada = await svc.editar({
      id: t.id,
      nombre: "nueva",
      color: "#34D399",
      descripcion: "con descripción",
    });

    expect(editada).toMatchObject({
      id: t.id,
      nombre: "nueva",
      color: "#34D399",
      descripcion: "con descripción",
    });
  });

  test("guardar una etiqueta sin cambiarle el nombre no choca contra sí misma", async () => {
    const t = await crear("urgente");

    const editada = await svc.editar({
      id: t.id,
      nombre: "urgente",
      color: "#F87171",
      descripcion: null,
    });

    expect(editada.color).toBe("#F87171");
  });

  test("renombrar pisando el nombre de otra etiqueta falla", async () => {
    await crear("urgente");
    const otra = await crear("seguimiento");

    await expect(
      svc.editar({ id: otra.id, nombre: "urgente", color: "#FFAF3A", descripcion: null }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test("editar una etiqueta que ya no existe falla con NotFound", async () => {
    await expect(
      svc.editar({ id: "no-existe", nombre: "x-tag", color: "#FFAF3A", descripcion: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // --- borrar ---

  test("borrar informa a cuántos leads afectó y los desetiqueta", async () => {
    const t = await crear("urgente");
    await tags.assignToLead("lead-A", t.id, "manual");
    await tags.assignToLead("lead-B", t.id, "workflow");

    const resultado = await svc.borrar(t.id, ACTOR);

    expect(resultado).toEqual({ leadsAfectados: 2, nombre: "urgente" });
    expect(await tags.findById(t.id)).toBeNull();
    // El CASCADE se lleva las asignaciones: los leads pierden la etiqueta.
    expect(await tags.listByLead("lead-A")).toEqual([]);
    expect(await tags.listByLead("lead-B")).toEqual([]);
  });

  test("borrar una etiqueta sin uso informa 0 leads afectados", async () => {
    const t = await crear("sin-uso");
    expect(await svc.borrar(t.id, ACTOR)).toEqual({ leadsAfectados: 0, nombre: "sin-uso" });
  });

  test("borrar no toca las asignaciones de las otras etiquetas", async () => {
    const borrada = await crear("borrada");
    const queda = await crear("queda");
    await tags.assignToLead("lead-A", borrada.id, "manual");
    await tags.assignToLead("lead-A", queda.id, "manual");

    await svc.borrar(borrada.id, ACTOR);

    expect((await tags.listByLead("lead-A")).map((t) => t.id)).toEqual([queda.id]);
  });

  test("borrar deja rastro en auditoría con el impacto que tuvo", async () => {
    const t = await crear("urgente", "#E879F9");
    await tags.assignToLead("lead-A", t.id, "manual");

    await svc.borrar(t.id, ACTOR);

    const [accion] = await auditRepo.list({ entityType: "tag" });
    expect(accion).toMatchObject({
      actor_user_id: ACTOR,
      action: "tag.delete",
      entity_type: "tag",
      entity_id: t.id,
      // El nombre y el color quedan porque después del CASCADE no hay de dónde
      // sacarlos: la fila ya no existe.
      payload: { nombre: "urgente", color: "#E879F9", leadsAfectados: 1 },
    });
  });

  test("borrar una etiqueta inexistente falla con NotFound y no audita nada", async () => {
    await expect(svc.borrar("no-existe", ACTOR)).rejects.toBeInstanceOf(NotFoundError);
    expect(await auditRepo.list()).toEqual([]);
  });

  test("el nombre de una etiqueta borrada se puede reusar", async () => {
    const t = await crear("urgente");
    await svc.borrar(t.id, ACTOR);

    await expect(crear("urgente")).resolves.toMatchObject({ nombre: "urgente" });
  });
});
