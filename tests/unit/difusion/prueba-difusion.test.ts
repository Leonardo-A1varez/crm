import { describe, expect, test, vi } from "vitest";
import { NotFoundError, RateLimitError, ValidationError } from "@/lib/errors";
import type { Grupo } from "@/lib/ui/condiciones";
import { InMemoryAdminAuditRepository } from "@/server/repositories/admin-audit.repo";
import { InMemoryDifusionEnviosRepository } from "@/server/repositories/difusion-envios.repo";
import { InMemoryDifusionesRepository } from "@/server/repositories/difusiones.repo";
import {
  ACCION_PRUEBA_DIFUSION,
  DefaultPruebaDifusionService,
  PRUEBAS_POR_HORA,
} from "@/server/services/difusion/prueba.service";

/**
 * "Enviar de prueba a mi número" (PRD §7.5): la plantilla de la difusión, con
 * las variables resueltas contra un lead de muestra, a un número que carga el
 * admin. Sale por el mismo `sendTemplate` que el motor, no es un envío de la
 * difusión y queda auditada.
 */

const AHORA = new Date("2026-09-25T15:00:00.000Z");
const ADMIN = "00000000-0000-4000-8000-0000000000a1";
const LEAD = "00000000-0000-4000-8000-000000000001";
const ARBOL: Grupo = { id: "raiz", clase: "grupo", operador: "y", hijos: [] };

async function armar(opciones: { parametros?: boolean; bajas?: string[] } = {}) {
  let reloj = AHORA;
  const difusiones = new InMemoryDifusionesRepository();
  const envios = new InMemoryDifusionEnviosRepository();
  const audit = new InMemoryAdminAuditRepository();
  // `admin_actions.created_at` lo pone la base con su reloj: el fake lo sella
  // con el reloj de la prueba para poder hacer pasar la hora.
  const crear = audit.create.bind(audit);
  const conHora = new Map<string, Date>();
  audit.create = async (input) => {
    const fila = await crear(input);
    conHora.set(fila.id, reloj);
    return { ...fila, created_at: reloj };
  };
  const listar = audit.list.bind(audit);
  audit.list = async (filtro) =>
    (await listar(filtro)).map((f) => ({ ...f, created_at: conHora.get(f.id) ?? f.created_at }));
  const sendTemplate = vi.fn(async () => ({ meta_message_id: "wamid.prueba" }));
  const d = await difusiones.create({
    nombre: "Promo frenos",
    audiencia: ARBOL,
    creada_por: ADMIN,
    plantilla_nombre: "promo_frenos_v3",
    plantilla_categoria: "marketing",
    plantilla_idioma: "es_AR",
    plantilla_parametros: opciones.parametros ? [{ valor: "{{lead.nombre}}", respaldo: "" }] : [],
    canary_tamano: null,
  });
  const svc = new DefaultPruebaDifusionService({
    difusiones,
    audit,
    meta: { sendTemplate },
    supresiones: {
      activasPorTelefonos: async (tels: readonly string[]) =>
        tels
          .filter((t) => (opciones.bajas ?? []).includes(t))
          .map((t) => ({ telefono: t, origen: "propia" }) as never),
    },
    datosDelLead: async (leadId) =>
      leadId === LEAD ? { lead: { nombre: "Ana" } } : { lead: { nombre: "" } },
    ahora: () => reloj,
  });
  return {
    svc,
    d,
    audit,
    envios,
    sendTemplate,
    avanzar: (ms: number) => {
      reloj = new Date(reloj.getTime() + ms);
    },
  };
}

const pedido = (difusionId: string) => ({
  difusionId,
  telefono: "+54 9 11 5555-0000",
  leadId: LEAD,
  actorId: ADMIN,
});

describe("PruebaDifusion", () => {
  test("manda la plantilla con las variables del lead de muestra al número cargado", async () => {
    const m = await armar({ parametros: true });
    const r = await m.svc.enviar(pedido(m.d.id));

    expect(m.sendTemplate).toHaveBeenCalledWith({
      to: "5491155550000",
      plantilla: { nombre: "promo_frenos_v3", idioma: "es_AR", parametrosCuerpo: ["Ana"] },
    });
    expect(r).toEqual({ restantes: PRUEBAS_POR_HORA - 1 });
  });

  test("no es un envío de la difusión: no toca difusion_envios", async () => {
    const m = await armar();
    await m.svc.enviar(pedido(m.d.id));
    expect(await m.envios.contarPorDifusion(m.d.id)).toMatchObject({ total: 0 });
  });

  test("queda en la auditoría, sin el número entero", async () => {
    const m = await armar();
    await m.svc.enviar(pedido(m.d.id));
    const [fila] = await m.audit.list({ actorUserId: ADMIN });
    expect(fila).toMatchObject({
      action: ACCION_PRUEBA_DIFUSION,
      entity_type: "difusion",
      entity_id: m.d.id,
      payload: { lead_id: LEAD, plantilla: "promo_frenos_v3", telefono: "+549 ••• ••• 000" },
    });
    expect(JSON.stringify(fila?.payload)).not.toContain("5491155550000");
  });

  test(`pasadas ${PRUEBAS_POR_HORA} pruebas en una hora, no manda más`, async () => {
    const m = await armar();
    for (let i = 0; i < PRUEBAS_POR_HORA; i++) await m.svc.enviar(pedido(m.d.id));
    await expect(m.svc.enviar(pedido(m.d.id))).rejects.toBeInstanceOf(RateLimitError);
    expect(m.sendTemplate).toHaveBeenCalledTimes(PRUEBAS_POR_HORA);

    m.avanzar(60 * 60_000 + 1);
    await expect(m.svc.enviar(pedido(m.d.id))).resolves.toBeDefined();
  });

  test("un número que no es de WhatsApp no manda", async () => {
    const m = await armar();
    await expect(m.svc.enviar({ ...pedido(m.d.id), telefono: "abc" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(m.sendTemplate).not.toHaveBeenCalled();
  });

  test("una variable que queda vacía para el lead de muestra no manda", async () => {
    const m = await armar({ parametros: true });
    await expect(
      m.svc.enviar({ ...pedido(m.d.id), leadId: "00000000-0000-4000-8000-000000000009" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(m.sendTemplate).not.toHaveBeenCalled();
  });

  test("una difusión que no existe es NotFound", async () => {
    const m = await armar();
    await expect(
      m.svc.enviar(pedido("00000000-0000-4000-8000-00000000dead")),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("un número dado de baja no recibe la prueba: el botón no saltea la lista", async () => {
    const m = await armar({ bajas: ["5491155550000"] });
    await expect(m.svc.enviar(pedido(m.d.id))).rejects.toBeInstanceOf(ValidationError);
    expect(m.sendTemplate).not.toHaveBeenCalled();
  });
});
