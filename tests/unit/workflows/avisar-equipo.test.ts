import { describe, expect, test } from "vitest";
import { InMemoryNotificacionesRepository } from "@/server/repositories/notificaciones.repo";
import { InMemoryUsersRepository } from "@/server/repositories/users.repo";
import { crearRegistroDeAcciones } from "@/server/services/workflows/acciones/registro";
import { AvisarEquipoService } from "@/server/services/workflows/avisar-equipo.service";
import type { Nodo } from "@/types/workflows";

/**
 * "Avisar al equipo" (decisión 3 del dueño): una notificación en el panel para
 * el vendedor asignado o, sin uno, para los admins. Guarda referencias y el
 * texto del flujo; nunca datos del lead.
 */

const LEAD = "00000000-0000-4000-8000-00000000000a";
const SESION = "00000000-0000-4000-8000-00000000000b";
const CONV = "00000000-0000-4000-8000-00000000000c";
const RUN = "00000000-0000-4000-8000-00000000000d";

async function montar(vendedorAsignado: "vendedor" | null) {
  const users = new InMemoryUsersRepository();
  const admin = await users.create({ nombre: "Admin", email: "a@x", rol: "admin", activo: true });
  const adminInactivo = await users.create({
    nombre: "Ex admin",
    email: "b@x",
    rol: "admin",
    activo: false,
  });
  const vendedor = await users.create({
    nombre: "Vera",
    email: "v@x",
    rol: "vendedor",
    activo: true,
  });
  const notificaciones = new InMemoryNotificacionesRepository();
  const svc = new AvisarEquipoService({
    users,
    sessions: {
      findById: async (id) =>
        id === SESION
          ? ({ id: SESION, vendedor_asignado_id: vendedorAsignado ? vendedor.id : null } as never)
          : null,
      findActiveByLeadId: async () => null,
    },
    conversations: {
      findActivaByLead: async () => ({ id: CONV, canal: "wa", ultimo_entrante_at: null }),
    },
    notificaciones,
  });
  return { svc, notificaciones, admin, adminInactivo, vendedor };
}

const pedido = {
  leadId: LEAD,
  leadSessionId: SESION,
  destinatario: "vendedor_asignado",
  texto: "Pidió hablar con una persona",
  clave: `wf:${RUN}:3`,
  runId: RUN,
};

describe("AvisarEquipoService", () => {
  test("con vendedor asignado, el aviso es para él y lleva referencias, no datos", async () => {
    const { svc, notificaciones, vendedor, admin } = await montar("vendedor");

    const r = await svc.avisar(pedido);

    expect(r).toEqual({ destinatarios: 1, para: "vendedor_asignado" });
    expect(await notificaciones.listarDeUsuario(admin.id, 10)).toHaveLength(0);
    expect(await notificaciones.listarDeUsuario(vendedor.id, 10)).toMatchObject([
      {
        lead_id: LEAD,
        conversacion_id: CONV,
        workflow_run_id: RUN,
        texto: "Pidió hablar con una persona",
        clave: `wf:${RUN}:3`,
        leida_at: null,
      },
    ]);
  });

  test("sin vendedor asignado, va a los admins activos", async () => {
    const { svc, notificaciones, admin, adminInactivo } = await montar(null);

    expect(await svc.avisar(pedido)).toEqual({ destinatarios: 1, para: "admins" });
    expect(await notificaciones.contarNoLeidas(admin.id)).toBe(1);
    expect(await notificaciones.contarNoLeidas(adminInactivo.id)).toBe(0);
  });

  test("el reintento del paso no duplica el aviso", async () => {
    const { svc, notificaciones, vendedor } = await montar("vendedor");
    await svc.avisar(pedido);
    await svc.avisar(pedido);
    expect(await notificaciones.contarNoLeidas(vendedor.id)).toBe(1);
  });

  test("una persona elegida que ya no está activa: el aviso cae en los admins", async () => {
    const { svc, notificaciones, admin, adminInactivo } = await montar(null);
    const r = await svc.avisar({ ...pedido, destinatario: adminInactivo.id });
    expect(r.para).toBe("admins");
    expect(await notificaciones.contarNoLeidas(admin.id)).toBe(1);
  });
});

describe("bloque «Avisar al equipo» en el registro", () => {
  test("int_notif_vendedor avisa con la clave wf:<runId>:<orden> y el texto del bloque", async () => {
    const pedidos: unknown[] = [];
    const registro = crearRegistroDeAcciones({
      avisarEquipo: {
        avisar: async (p: unknown) => {
          pedidos.push(p);
          return { destinatarios: 2, para: "admins" };
        },
      },
    } as never);
    const nodo: Nodo = {
      id: "n5",
      tipo: "int_notif_vendedor",
      config: { mensaje: "Revisá esta cotización" },
      posicion: { x: 0, y: 0 },
    };

    const r = await registro.ejecutar(nodo, {
      leadId: LEAD,
      leadSessionId: SESION,
      runId: RUN,
      orden: 4,
      contexto: {},
    });

    expect(pedidos).toEqual([
      {
        leadId: LEAD,
        leadSessionId: SESION,
        destinatario: "vendedor_asignado",
        texto: "Revisá esta cotización",
        clave: `wf:${RUN}:4`,
        runId: RUN,
      },
    ]);
    expect(r).toEqual({ puerto: "salida", salida: { destinatarios: 2, para: "admins" } });
  });

  test("sin texto el bloque está mal configurado", async () => {
    const registro = crearRegistroDeAcciones({
      avisarEquipo: { avisar: async () => ({ destinatarios: 0, para: "admins" }) },
    } as never);
    await expect(
      registro.ejecutar(
        { id: "n5", tipo: "int_notif_vendedor", config: {}, posicion: { x: 0, y: 0 } },
        { leadId: LEAD, runId: RUN, orden: 1, contexto: {} },
      ),
    ).rejects.toThrow(/mal configurado/);
  });
});
