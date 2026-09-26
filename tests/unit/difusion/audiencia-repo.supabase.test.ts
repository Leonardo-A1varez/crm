import { describe, expect, test, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import type { AudienciaCompilada } from "@/lib/difusion/audiencia";
import type { AppClient } from "@/server/db/client";
import { SupabaseDifusionAudienciaRepository } from "@/server/repositories/difusion-audiencia.supabase.repo";
import { fakePostgrest, uuidDe, type Fila } from "../../helpers/fake-postgrest";

// Filas armadas a mano con la forma de `difusion_resolver_audiencia`: ids con
// forma de UUID v4 y teléfonos inventados.
function fila(n: number, over: Record<string, unknown> = {}) {
  return {
    lead_id: `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`,
    nombre: `Lead ${n}`,
    telefono: `5939${n.toString().padStart(8, "0")}`,
    etapa_activa: null,
    ultimo_entrante_at: null,
    salientes_automaticos_24h: 0,
    vehiculo: null,
    ...over,
  };
}

function pagina(desde: number, cantidad: number) {
  return Array.from({ length: cantidad }, (_, i) => fila(desde + i));
}

const TODA: AudienciaCompilada = { tipo: "toda_la_base" };
const AHORA = new Date("2026-09-14T12:00:00.000Z");

function clienteCon(paginas: unknown[][]) {
  const cola = [...paginas];
  const rpc = vi.fn(async () => ({ data: cola.shift() ?? [], error: null }));
  return { db: { rpc } as unknown as AppClient, rpc };
}

describe("SupabaseDifusionAudienciaRepository.resolver", () => {
  // PostgREST corta en 1.000 filas y no avisa (AGENTS.md, lección 12).
  test("encadena páginas por el último id hasta recibir una vacía", async () => {
    const { db, rpc } = clienteCon([pagina(1, 1000), pagina(1001, 1000), pagina(2001, 600), []]);
    const repo = new SupabaseDifusionAudienciaRepository(db);

    const todos = await repo.resolver(TODA, AHORA);

    expect(todos).toHaveLength(2600);
    expect(new Set(todos.map((c) => c.leadId)).size).toBe(2600);
    expect(rpc).toHaveBeenCalledTimes(4);
    expect(rpc).toHaveBeenNthCalledWith(1, "difusion_resolver_audiencia", {
      p_audiencia: TODA,
      p_ahora: AHORA.toISOString(),
      p_limite: 1000,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "difusion_resolver_audiencia", {
      p_audiencia: TODA,
      p_ahora: AHORA.toISOString(),
      p_despues_de: fila(1000).lead_id,
      p_limite: 1000,
    });
  });

  // Si el servidor corta más abajo que el límite pedido, una página corta no
  // significa que se terminó: sólo una vacía lo significa.
  test("no confunde una página recortada por el servidor con el final", async () => {
    const { db } = clienteCon([pagina(1, 500), pagina(501, 500), pagina(1001, 20), []]);
    const repo = new SupabaseDifusionAudienciaRepository(db);

    expect(await repo.resolver(TODA, AHORA)).toHaveLength(1020);
  });

  test("mapea las filas: fechas, nulos y la etapa activa", async () => {
    const { db } = clienteCon([
      [
        fila(1, {
          etapa_activa: "negociando",
          ultimo_entrante_at: "2026-09-14T11:00:00+00:00",
          salientes_automaticos_24h: 2,
          vehiculo: "Chevrolet Aveo 2012",
        }),
        fila(2),
      ],
      [],
    ]);
    const repo = new SupabaseDifusionAudienciaRepository(db);

    const [a, b] = await repo.resolver(TODA, AHORA);

    expect(a).toEqual({
      leadId: fila(1).lead_id,
      nombre: "Lead 1",
      telefono: "593900000001",
      etapaActiva: "negociando",
      ultimoEntranteAt: new Date("2026-09-14T11:00:00.000Z"),
      salientesAutomaticos24h: 2,
      vehiculo: "Chevrolet Aveo 2012",
    });
    expect(b?.etapaActiva).toBeNull();
    expect(b?.ultimoEntranteAt).toBeNull();
    expect(b?.vehiculo).toBeNull();
  });

  test("una audiencia más grande que el tope se rechaza en vez de llenar la memoria", async () => {
    const { db } = clienteCon([pagina(1, 1000), pagina(1001, 1000), pagina(2001, 1000), []]);
    const repo = new SupabaseDifusionAudienciaRepository(db, { maxAudiencia: 2500 });

    await expect(repo.resolver(TODA, AHORA)).rejects.toThrow(ValidationError);
  });

  test("un 23514 de la base (lo que no conoce) llega como ValidationError", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: "23514", message: "campo de audiencia desconocido: x" },
    }));
    const repo = new SupabaseDifusionAudienciaRepository({ rpc } as unknown as AppClient);

    await expect(repo.resolver(TODA, AHORA)).rejects.toThrow(ValidationError);
  });
});

describe("SupabaseDifusionAudienciaRepository.usoCupoDesde", () => {
  test("pide el conteo de la base desde la fecha y lo devuelve", async () => {
    const rpc = vi.fn(async () => ({ data: 37, error: null }));
    const repo = new SupabaseDifusionAudienciaRepository({ rpc } as unknown as AppClient);
    const desde = new Date("2026-09-13T12:00:00.000Z");

    expect(await repo.usoCupoDesde(desde)).toBe(37);
    expect(rpc).toHaveBeenCalledWith("difusion_uso_cupo_24h", { p_desde: desde.toISOString() });
  });
});

describe("SupabaseDifusionAudienciaRepository.estadoConversacional", () => {
  const A = uuidDe(1);
  const B = uuidDe(2);
  const C = uuidDe(3);
  const DESDE = new Date("2026-09-14T11:00:00.000Z");

  function base(over: Partial<Record<string, Fila[]>> = {}) {
    return fakePostgrest({
      lead_session: [
        { lead_id: A, current_stage: "cotizado", resultado: null },
        { lead_id: A, current_stage: "cerrado", resultado: "exito" },
        { lead_id: B, current_stage: "requiere_humano", resultado: null },
      ],
      conversaciones: [
        { id: "c-a-wa", lead_id: A, canal: "wa" },
        { id: "c-a-ig", lead_id: A, canal: "ig" },
        { id: "c-c-wa", lead_id: C, canal: "wa" },
      ],
      mensajes: [
        { conversacion_id: "c-a-wa", direction: "in", created_at: "2026-09-14T11:30:00.000Z" },
        { conversacion_id: "c-a-wa", direction: "in", created_at: "2026-09-14T11:40:00.000Z" },
        { conversacion_id: "c-a-wa", direction: "out", created_at: "2026-09-14T11:50:00.000Z" },
        // Instagram no abre la ventana de WhatsApp: no cuenta.
        { conversacion_id: "c-a-ig", direction: "in", created_at: "2026-09-14T11:55:00.000Z" },
        // Más viejo que `desde`: no cambia la regla y no se trae.
        { conversacion_id: "c-c-wa", direction: "in", created_at: "2026-09-14T10:00:00.000Z" },
      ],
      ...over,
    });
  }

  test("etapa de la sesión ABIERTA y último entrante por WhatsApp desde `desde`", async () => {
    const repo = new SupabaseDifusionAudienciaRepository(base().db);
    const r = await repo.estadoConversacional([A, B, C], DESDE);

    expect(r.get(A)).toEqual({
      etapa: "cotizado",
      ultimoEntranteAt: new Date("2026-09-14T11:40:00.000Z"),
    });
    expect(r.get(B)).toEqual({ etapa: "requiere_humano", ultimoEntranteAt: null });
    // Sin sesión abierta ni entrante reciente: no aparece.
    expect(r.has(C)).toBe(false);
  });

  test("sin leads no consulta nada", async () => {
    const f = base();
    const repo = new SupabaseDifusionAudienciaRepository(f.db);
    expect((await repo.estadoConversacional([], DESDE)).size).toBe(0);
    expect(f.requests()).toBe(0);
  });

  // PostgREST corta en 1.000 filas (lección 12): el más reciente tiene que salir
  // aunque haya más de mil entrantes en la ventana.
  test("pagina los entrantes hasta una página vacía", async () => {
    const muchos = Array.from({ length: 1500 }, (_, i) => ({
      conversacion_id: "c-c-wa",
      direction: "in",
      created_at: new Date(DESDE.getTime() + i * 1000).toISOString(),
    }));
    const repo = new SupabaseDifusionAudienciaRepository(base({ mensajes: muchos }).db);
    const r = await repo.estadoConversacional([C], DESDE);
    expect(r.get(C)?.ultimoEntranteAt).toEqual(new Date(DESDE.getTime() + 1499 * 1000));
  });
});
