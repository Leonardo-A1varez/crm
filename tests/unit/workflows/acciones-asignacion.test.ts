import { beforeEach, describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import { InMemorySessionLock, NoopSessionLock, type SessionLock } from "@/server/lock/session-lock";
import {
  InMemoryLeadSessionRepository,
  type LeadSessionInsert,
} from "@/server/repositories/lead-session.repo";
import { InMemoryUsersRepository } from "@/server/repositories/users.repo";
import { DefaultAsignacionService } from "@/server/services/asignacion/asignacion.service";
import { DefaultUsuariosService } from "@/server/services/usuarios/usuarios.service";
import {
  crearAccionesDeAsignacion,
  type AvisoVendedorAsignado,
} from "@/server/services/workflows/acciones/asignacion";
import type { EntornoAccion } from "@/server/services/workflows/acciones/registro";
import type { UUID } from "@/types/entities";
import type { Nodo, NodoTipo } from "@/types/workflows";

/**
 * "Asignar vendedor" y "Round Robin": los dos escriben sobre la sesión activa
 * del lead por `AsignacionService`, con el servicio real sobre repos en memoria.
 */

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

function nodo(tipo: NodoTipo, config: Record<string, unknown>): Nodo {
  return { id: "n", tipo, config, posicion: { x: 0, y: 0 } };
}

function entorno(leadId: UUID): EntornoAccion {
  return { leadId, leadSessionId: null, runId: "run-1", orden: 3, contexto: {} };
}

describe("acciones de asignación", () => {
  let sessions: InMemoryLeadSessionRepository;
  let users: InMemoryUsersRepository;
  let avisos: AvisoVendedorAsignado[];
  let ana: UUID;
  let beto: UUID;
  let paz: UUID;

  function acciones(candado: SessionLock = new InMemorySessionLock()) {
    return crearAccionesDeAsignacion({
      asignacion: new DefaultAsignacionService({
        sessions,
        usuarios: new DefaultUsuariosService({ users }),
      }),
      sessions,
      avisos: {
        vendedorAsignado: async (aviso) => {
          avisos.push(aviso);
        },
      },
      candadoReparto: candado,
    });
  }

  beforeEach(async () => {
    sessions = new InMemoryLeadSessionRepository();
    users = new InMemoryUsersRepository();
    avisos = [];
    const crear = async (nombre: string, activo: boolean) =>
      (
        await users.create({
          nombre,
          email: `${nombre.toLowerCase()}@crm.local`,
          rol: "vendedor",
          activo,
        })
      ).id;
    ana = await crear("Ana", true);
    beto = await crear("Beto", true);
    paz = await crear("Paz", false);
  });

  describe("asignar_vendedor", () => {
    it("asigna la sesión activa del lead y avisa «vendedor asignado»", async () => {
      const s = await sessions.create(nuevaSesion("lead-1"));

      const r = await acciones().asignar_vendedor(
        nodo("crm_vendedor", { vendedorId: ana }),
        entorno("lead-1"),
      );

      expect(r.puerto).toBe("salida");
      expect(r.salida).toMatchObject({ lead_session_id: s.id, vendedor_id: ana, cambio: true });
      expect((await sessions.findById(s.id))?.vendedor_asignado_id).toBe(ana);
      expect(avisos).toEqual([
        expect.objectContaining({ leadId: "lead-1", vendedorId: ana, sesion: expect.anything() }),
      ]);
    });

    it("el que ya estaba asignado no se reescribe ni se vuelve a avisar", async () => {
      await sessions.create(nuevaSesion("lead-1"));
      const a = acciones();
      await a.asignar_vendedor(nodo("crm_vendedor", { vendedorId: ana }), entorno("lead-1"));

      const r = await a.asignar_vendedor(
        nodo("crm_vendedor", { vendedorId: ana }),
        entorno("lead-1"),
      );

      expect(r.salida).toMatchObject({ cambio: false });
      expect(avisos).toHaveLength(1);
    });

    it("lee la clave vieja `vendedor_id`", async () => {
      await sessions.create(nuevaSesion("lead-1"));
      const r = await acciones().asignar_vendedor(
        nodo("crm_vendedor", { vendedor_id: beto }),
        entorno("lead-1"),
      );
      expect(r.salida).toMatchObject({ vendedor_id: beto });
    });

    it("sin sesión activa del lead falla sin reintento", async () => {
      await expect(
        acciones().asignar_vendedor(nodo("crm_vendedor", { vendedorId: ana }), entorno("lead-1")),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(avisos).toEqual([]);
    });

    it("sin vendedor elegido es error de config", async () => {
      await sessions.create(nuevaSesion("lead-1"));
      await expect(
        acciones().asignar_vendedor(nodo("crm_vendedor", {}), entorno("lead-1")),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("repartir_round_robin", () => {
    it("reparte entre los candidatos activos y avisa", async () => {
      const s = await sessions.create(nuevaSesion("lead-1"));

      const r = await acciones().repartir_round_robin(
        nodo("crm_round_robin", { candidatos: [paz, ana, beto] }),
        entorno("lead-1"),
      );

      // Paz está inactiva: se saltea aunque va primera.
      expect(r.puerto).toBe("salida");
      expect(r.salida).toMatchObject({ asignado: true, vendedor_id: ana, lead_session_id: s.id });
      expect(avisos.map((a) => a.vendedorId)).toEqual([ana]);
    });

    it("nadie disponible es un resultado: sigue por la salida, sin asignar ni avisar", async () => {
      const s = await sessions.create(nuevaSesion("lead-1"));

      const r = await acciones().repartir_round_robin(
        nodo("crm_round_robin", { candidatos: [paz] }),
        entorno("lead-1"),
      );

      expect(r.puerto).toBe("salida");
      expect(r.salida).toEqual({
        asignado: false,
        motivo: "ninguno_disponible",
        lead_session_id: s.id,
      });
      expect((await sessions.findById(s.id))?.vendedor_asignado_id ?? null).toBeNull();
      expect(avisos).toEqual([]);
    });

    it("todos en su tope también es un resultado", async () => {
      await sessions.create(nuevaSesion("lead-0"));
      const a = acciones();
      await a.repartir_round_robin(
        nodo("crm_round_robin", { candidatos: [ana], topeSesionesAbiertasPorVendedor: 1 }),
        entorno("lead-0"),
      );
      await sessions.create(nuevaSesion("lead-1"));

      const r = await a.repartir_round_robin(
        nodo("crm_round_robin", { candidatos: [ana], topeSesionesAbiertasPorVendedor: 1 }),
        entorno("lead-1"),
      );

      expect(r.salida).toMatchObject({ asignado: false, motivo: "todos_en_tope" });
    });

    it("una sesión que ya tiene vendedor no se reparte de nuevo", async () => {
      await sessions.create(nuevaSesion("lead-1"));
      const a = acciones();
      await a.asignar_vendedor(nodo("crm_vendedor", { vendedorId: beto }), entorno("lead-1"));

      const r = await a.repartir_round_robin(
        nodo("crm_round_robin", { candidatos: [ana, beto] }),
        entorno("lead-1"),
      );

      expect(r.salida).toMatchObject({ asignado: true, vendedor_id: beto, ya_estaba: true });
      expect(avisos).toHaveLength(1);
    });

    it("sin el candado, dos repartos simultáneos le dan las dos sesiones a la misma persona", async () => {
      // El caso que el candado evita: los dos leen el historial antes de que
      // el otro escriba. Queda como prueba de que la carrera es real.
      await sessions.create(nuevaSesion("lead-1"));
      await sessions.create(nuevaSesion("lead-2"));
      const a = acciones(new NoopSessionLock());
      const n = nodo("crm_round_robin", { candidatos: [ana, beto] });

      const [r1, r2] = await Promise.all([
        a.repartir_round_robin(n, entorno("lead-1")),
        a.repartir_round_robin(n, entorno("lead-2")),
      ]);

      expect(r1.salida?.vendedor_id).toBe(r2.salida?.vendedor_id);
    });

    it("con el candado, dos repartos simultáneos van a personas distintas", async () => {
      await sessions.create(nuevaSesion("lead-1"));
      await sessions.create(nuevaSesion("lead-2"));
      const a = acciones(new InMemorySessionLock());
      const n = nodo("crm_round_robin", { candidatos: [ana, beto] });

      const [r1, r2] = await Promise.all([
        a.repartir_round_robin(n, entorno("lead-1")),
        a.repartir_round_robin(n, entorno("lead-2")),
      ]);

      expect(new Set([r1.salida?.vendedor_id, r2.salida?.vendedor_id])).toEqual(
        new Set([ana, beto]),
      );
    });
  });
});
