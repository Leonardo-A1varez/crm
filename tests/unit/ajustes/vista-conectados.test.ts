import { describe, expect, test } from "vitest";
import { vistaNumeroConectado } from "@/components/ajustes/conectados";
import type { WhatsAppNumero } from "@/types/whatsapp-numeros";

const BASE: WhatsAppNumero = {
  id: "00000000-0000-4000-8000-000000000001",
  waba_id: "102290129340398",
  phone_number_id: "106540352242922",
  display_phone_number: "+1 555-078-3881",
  verified_name: "Lucky Shrub",
  modo: "coexistencia",
  estado: "conectado",
  error: null,
  conectado_por: null,
  conectado_at: new Date("2026-10-11T10:00:00Z"),
  is_on_biz_app: null,
  platform_type: null,
  verificado_at: null,
  contactos_pedido_at: null,
  contactos_sincronizados_at: null,
  historial_pedido_at: null,
  historial_estado: "pendiente",
  historial_progreso: null,
};

const AHORA = new Date("2026-10-11T11:00:00Z");

describe("vistaNumeroConectado", () => {
  test("recién conectado: los tres pasos pendientes", () => {
    const v = vistaNumeroConectado(BASE, AHORA);
    expect(v.numero).toBe("+1 555-078-3881");
    expect(v.pasos.map((p) => p.estado)).toEqual(["pendiente", "pendiente", "pendiente"]);
  });

  test("todo en orden: verificado, contactos pedidos, historial sincronizando con su porcentaje", () => {
    const v = vistaNumeroConectado(
      {
        ...BASE,
        is_on_biz_app: true,
        platform_type: "CLOUD_API",
        verificado_at: AHORA,
        contactos_pedido_at: AHORA,
        contactos_sincronizados_at: AHORA,
        historial_pedido_at: AHORA,
        historial_estado: "en_curso",
        historial_progreso: 55,
      },
      AHORA,
    );
    expect(v.pasos).toEqual([
      {
        clave: "verificacion",
        titulo: "Coexistencia",
        estado: "ok",
        detalle: "App Business y Cloud API",
      },
      { clave: "contactos", titulo: "Contactos", estado: "ok", detalle: "Pedidos a Meta" },
      { clave: "historial", titulo: "Historial", estado: "en_curso", detalle: "Importando, 55 %" },
    ]);
  });

  test("historial rechazado por el negocio y uno vencido se distinguen", () => {
    expect(
      vistaNumeroConectado({ ...BASE, historial_estado: "rechazado" }, AHORA).pasos[2],
    ).toMatchObject({ estado: "omitido", detalle: "El negocio no lo compartió" });
    expect(
      vistaNumeroConectado({ ...BASE, historial_estado: "vencido" }, AHORA).pasos[2],
    ).toMatchObject({ estado: "error" });
  });

  test("pasadas 24 h sin pedir los contactos: vencido", () => {
    const tarde = new Date("2026-10-12T11:00:00Z");
    expect(vistaNumeroConectado(BASE, tarde).pasos[1]).toMatchObject({ estado: "error" });
  });

  test("Meta no confirma la coexistencia: error en la verificación", () => {
    const v = vistaNumeroConectado(
      { ...BASE, is_on_biz_app: false, platform_type: "CLOUD_API", verificado_at: AHORA },
      AHORA,
    );
    expect(v.pasos[0]).toMatchObject({ estado: "error" });
  });

  test("número de Cloud API (no coexistencia): contactos e historial no aplican", () => {
    const v = vistaNumeroConectado({ ...BASE, modo: "cloud" }, AHORA);
    expect(v.modo).toBe("Solo Cloud API");
    expect(v.pasos.slice(1).map((p) => p.estado)).toEqual(["omitido", "omitido"]);
  });

  test("sin número visible cae al id, y viaja sólo texto plano (se pasa a un componente cliente)", () => {
    const v = vistaNumeroConectado({ ...BASE, display_phone_number: null }, AHORA);
    expect(v.numero).toBe("106540352242922");
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
  });
});
