import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import {
  InMemoryLeadSessionRepository,
  type LeadSessionInsert,
} from "@/server/repositories/lead-session.repo";
import { InMemoryUsersRepository } from "@/server/repositories/users.repo";
import { DefaultAsignacionService } from "@/server/services/asignacion/asignacion.service";
import { DefaultUsuariosService } from "@/server/services/usuarios/usuarios.service";
import type { UUID } from "@/types/entities";

function nuevaSesion(leadId: UUID): LeadSessionInsert {
  return {
    lead_id: leadId,
    current_stage: "nuevo",
    urgencia: "media",
    consulta: "",
    producto_cotizado_id: null,
    codigo_interno: null,
    precio_cotizado: null,
    cantidad: null,
    bloqueador: null,
    comprobante_pago_url: null,
    metodo_pago: null,
    resultado: null,
    motivo_perdida: null,
    ia_pausada: false,
  };
}

describe("DefaultAsignacionService", () => {
  let sessions: InMemoryLeadSessionRepository;
  let users: InMemoryUsersRepository;
  let svc: DefaultAsignacionService;
  let ana: UUID;
  let beto: UUID;
  let paz: UUID;
  let leo: UUID;
  let reloj: number;

  /**
   * Cada asignación en su propio minuto. Sin esto dos asignaciones seguidas
   * caen en el mismo milisegundo, empatan, y el desempate por orden de la lista
   * haría pasar un test que el historial debería estar decidiendo.
   */
  function avanzarReloj(): void {
    reloj += 60_000;
    vi.setSystemTime(reloj);
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    reloj = new Date("2026-09-01T12:00:00.000Z").getTime();
    vi.setSystemTime(reloj);

    sessions = new InMemoryLeadSessionRepository();
    users = new InMemoryUsersRepository();
    svc = new DefaultAsignacionService({
      sessions,
      usuarios: new DefaultUsuariosService({ users }),
    });

    const crear = async (nombre: string, rol: "admin" | "vendedor", activo: boolean) =>
      (await users.create({ nombre, email: `${nombre.toLowerCase()}@crm.local`, rol, activo })).id;
    ana = await crear("Ana", "vendedor", true);
    beto = await crear("Beto", "vendedor", true);
    paz = await crear("Paz", "vendedor", false);
    leo = await crear("Leo", "admin", true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("asignar", () => {
    test("asigna a un vendedor activo y avisa que hubo cambio", async () => {
      const s = await sessions.create(nuevaSesion("lead-1"));

      const r = await svc.asignar(s.id, ana);

      expect(r.cambio).toBe(true);
      expect(r.session.vendedor_asignado_id).toBe(ana);
      expect(r.session.asignado_at).toEqual(new Date(reloj));
      expect((await sessions.findById(s.id))?.vendedor_asignado_id).toBe(ana);
    });

    test("asignar otra vez al mismo vendedor no escribe nada (replay-safe)", async () => {
      const s = await sessions.create(nuevaSesion("lead-1"));
      const primera = await svc.asignar(s.id, ana);
      avanzarReloj();

      const segunda = await svc.asignar(s.id, ana);

      expect(segunda.cambio).toBe(false);
      expect(segunda.session.asignado_at).toEqual(primera.session.asignado_at);
    });

    test("reasignar a otro vendedor mueve la fecha de asignación", async () => {
      const s = await sessions.create(nuevaSesion("lead-1"));
      await svc.asignar(s.id, ana);
      avanzarReloj();

      const r = await svc.asignar(s.id, beto);

      expect(r).toMatchObject({ cambio: true, session: { vendedor_asignado_id: beto } });
      expect(r.session.asignado_at).toEqual(new Date(reloj));
    });

    test("con null la sesión queda sin asignar", async () => {
      const s = await sessions.create(nuevaSesion("lead-1"));
      await svc.asignar(s.id, ana);

      const r = await svc.asignar(s.id, null);

      expect(r).toMatchObject({
        cambio: true,
        session: { vendedor_asignado_id: null, asignado_at: null },
      });
      expect((await svc.asignar(s.id, null)).cambio).toBe(false);
    });

    test("un admin activo también puede recibir: el rol no se filtra", async () => {
      const s = await sessions.create(nuevaSesion("lead-1"));
      expect((await svc.asignar(s.id, leo)).session.vendedor_asignado_id).toBe(leo);
    });

    test("un vendedor que no existe es NotFound y la sesión no se toca", async () => {
      const s = await sessions.create(nuevaSesion("lead-1"));

      await expect(svc.asignar(s.id, "no-existe")).rejects.toMatchObject({
        code: "NOT_FOUND",
        resource: "usuario",
      });
      expect((await sessions.findById(s.id))?.vendedor_asignado_id).toBeNull();
    });

    test("un vendedor inactivo no recibe", async () => {
      const s = await sessions.create(nuevaSesion("lead-1"));

      await expect(svc.asignar(s.id, paz)).rejects.toMatchObject({
        code: "ILLEGAL_STATE",
        stateType: "vendedor_inactivo",
      });
      expect((await sessions.findById(s.id))?.vendedor_asignado_id).toBeNull();
    });

    test("una sesión que no existe es NotFound", async () => {
      await expect(svc.asignar("no-existe", ana)).rejects.toMatchObject({
        code: "NOT_FOUND",
        resource: "lead_session",
      });
    });

    test("una sesión cerrada no se reasigna, pero repetir la que tiene sigue siendo un no-op", async () => {
      const s = await sessions.create(nuevaSesion("lead-1"));
      await svc.asignar(s.id, ana);
      await sessions.close(s.id, { resultado: "exito" });

      await expect(svc.asignar(s.id, beto)).rejects.toMatchObject({
        code: "ILLEGAL_STATE",
        stateType: "sesion_cerrada",
      });
      await expect(svc.asignar(s.id, null)).rejects.toMatchObject({ stateType: "sesion_cerrada" });
      expect((await svc.asignar(s.id, ana)).cambio).toBe(false);
    });
  });

  describe("asignarPorRoundRobin", () => {
    test("si nadie recibió todavía, al primero de la lista", async () => {
      const s = await sessions.create(nuevaSesion("lead-1"));

      const r = await svc.asignarPorRoundRobin(s.id, { candidatos: [beto, ana], tope: null });

      expect(r).toMatchObject({ tipo: "asignada", vendedorId: beto });
      expect(r.session.vendedor_asignado_id).toBe(beto);
      expect((await sessions.findById(s.id))?.vendedor_asignado_id).toBe(beto);
    });

    test("el turno sale de las sesiones asignadas, no de un puntero guardado", async () => {
      // ANA recibió una a mano antes del reparto: el round robin la cuenta.
      const previa = await sessions.create(nuevaSesion("lead-0"));
      await svc.asignar(previa.id, ana);

      const turnos: (UUID | null)[] = [];
      for (const leadId of ["lead-1", "lead-2", "lead-3"]) {
        avanzarReloj();
        const s = await sessions.create(nuevaSesion(leadId));
        const r = await svc.asignarPorRoundRobin(s.id, { candidatos: [ana, beto], tope: null });
        turnos.push(r.tipo === "asignada" ? r.vendedorId : null);
      }

      // BETO no había recibido nunca: va primero aunque ANA encabece la lista.
      expect(turnos).toEqual([beto, ana, beto]);
    });

    test("saltea a los inactivos y a los que ya no existen", async () => {
      const s = await sessions.create(nuevaSesion("lead-1"));

      const r = await svc.asignarPorRoundRobin(s.id, {
        candidatos: [paz, "usuario-borrado", beto],
        tope: null,
      });

      expect(r).toMatchObject({ tipo: "asignada", vendedorId: beto });
    });

    test("el tope cuenta sesiones abiertas: cerrar una libera lugar", async () => {
      const config = { candidatos: [ana, beto], tope: 1 };
      const s1 = await sessions.create(nuevaSesion("lead-1"));
      expect(await svc.asignarPorRoundRobin(s1.id, config)).toMatchObject({ vendedorId: ana });
      avanzarReloj();
      const s2 = await sessions.create(nuevaSesion("lead-2"));
      expect(await svc.asignarPorRoundRobin(s2.id, config)).toMatchObject({ vendedorId: beto });
      avanzarReloj();
      const s3 = await sessions.create(nuevaSesion("lead-3"));

      const lleno = await svc.asignarPorRoundRobin(s3.id, config);
      expect(lleno).toMatchObject({ tipo: "sin_vendedor", motivo: "todos_en_tope" });
      expect((await sessions.findById(s3.id))?.vendedor_asignado_id).toBeNull();

      await sessions.close(s1.id, { resultado: "exito" });
      expect(await svc.asignarPorRoundRobin(s3.id, config)).toMatchObject({
        tipo: "asignada",
        vendedorId: ana,
      });
    });

    test("sin nadie disponible la sesión queda sin asignar y dice por qué", async () => {
      const s = await sessions.create(nuevaSesion("lead-1"));

      const r = await svc.asignarPorRoundRobin(s.id, { candidatos: [paz], tope: null });

      expect(r).toMatchObject({ tipo: "sin_vendedor", motivo: "ninguno_disponible" });
      expect((await sessions.findById(s.id))?.vendedor_asignado_id).toBeNull();
    });

    test("una lista vacía tampoco asigna", async () => {
      const s = await sessions.create(nuevaSesion("lead-1"));
      expect(await svc.asignarPorRoundRobin(s.id, { candidatos: [], tope: null })).toMatchObject({
        tipo: "sin_vendedor",
        motivo: "sin_candidatos",
      });
    });

    test("una sesión que ya tiene vendedor no se reparte de nuevo (replay-safe)", async () => {
      const s = await sessions.create(nuevaSesion("lead-1"));
      const asignada = await svc.asignar(s.id, ana);
      avanzarReloj();

      const r = await svc.asignarPorRoundRobin(s.id, { candidatos: [beto], tope: null });

      expect(r).toMatchObject({ tipo: "ya_asignada", vendedorId: ana });
      expect(r.session.asignado_at).toEqual(asignada.session.asignado_at);
    });

    test("una sesión cerrada sin vendedor no se reparte", async () => {
      const s = await sessions.create(nuevaSesion("lead-1"));
      await sessions.close(s.id, { resultado: "perdido", motivo_perdida: "precio" });

      await expect(
        svc.asignarPorRoundRobin(s.id, { candidatos: [ana], tope: null }),
      ).rejects.toMatchObject({ code: "ILLEGAL_STATE", stateType: "sesion_cerrada" });
    });

    test("un tope inválido es un error de configuración", async () => {
      const s = await sessions.create(nuevaSesion("lead-1"));
      await expect(
        svc.asignarPorRoundRobin(s.id, { candidatos: [ana], tope: 0 }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect((await sessions.findById(s.id))?.vendedor_asignado_id).toBeNull();
    });

    test("una sesión que no existe es NotFound", async () => {
      await expect(
        svc.asignarPorRoundRobin("no-existe", { candidatos: [ana], tope: null }),
      ).rejects.toMatchObject({ code: "NOT_FOUND", resource: "lead_session" });
    });
  });
});
