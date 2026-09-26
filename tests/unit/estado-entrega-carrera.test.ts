import { describe, expect, test } from "vitest";
import { esAvance, estadosQueAvanzanA } from "@/lib/entrega";
import type { AppClient } from "@/server/db/client";
import { SupabaseMessagesRepository } from "@/server/repositories/messages.supabase.repo";
import { SupabaseWorkflowPlantillasSinSesionRepository } from "@/server/repositories/workflow-plantillas-sin-sesion.supabase.repo";
import type { EstadoEntrega } from "@/types/domain";

const ESTADOS: EstadoEntrega[] = ["enviado", "entregado", "leido", "fallido"];

describe("estadosQueAvanzanA", () => {
  test("es exactamente el conjunto de estados previos que esAvance deja pisar", () => {
    for (const hacia of ESTADOS) {
      const esperado = ESTADOS.filter((desde) => esAvance(desde, hacia));
      expect(estadosQueAvanzanA(hacia)).toEqual(esperado);
    }
  });

  test("nadie pisa a fallido y enviado no pisa nada", () => {
    expect(estadosQueAvanzanA("enviado")).toEqual([]);
    expect(estadosQueAvanzanA("fallido")).toEqual(["enviado", "entregado", "leido"]);
  });
});

// ---------------------------------------------------------------------------
// Doble de PostgREST con el reloj en la mano del test.
//
// Las lecturas (SELECT sin UPDATE) quedan retenidas hasta que el test las
// suelta, en el orden que quiera. Así se arma la carrera que se reprodujo en el
// stack local: "entregado" y "leído" leen los dos `enviado` antes de que
// cualquiera escriba, y después escribe primero "leído". Los UPDATE se aplican
// en el orden en que llegan, como en Postgres, con su WHERE evaluado contra la
// fila en ese momento.
// ---------------------------------------------------------------------------

type Fila = Record<string, unknown>;
type Filtro = (f: Fila) => boolean;

function partirOr(expr: string): string[] {
  const partes: string[] = [];
  let nivel = 0;
  let actual = "";
  for (const c of expr) {
    if (c === "(") nivel++;
    if (c === ")") nivel--;
    if (c === "," && nivel === 0) {
      partes.push(actual);
      actual = "";
    } else actual += c;
  }
  partes.push(actual);
  return partes;
}

function filtroOr(expr: string): Filtro {
  const alternativas = partirOr(expr).map((parte): Filtro => {
    const esNull = /^(\w+)\.is\.null$/.exec(parte);
    if (esNull) return (f) => (f[esNull[1] as string] ?? null) === null;
    const enLista = /^(\w+)\.in\.\((.*)\)$/.exec(parte);
    if (enLista) {
      const valores = (enLista[2] as string).split(",");
      return (f) => valores.includes(String(f[enLista[1] as string]));
    }
    throw new Error(`filtro or sin soporte en el doble: ${parte}`);
  });
  return (f) => alternativas.some((p) => p(f));
}

function dobleConLecturasRetenidas(tablas: Record<string, Fila[]>) {
  const retenidas: Array<() => void> = [];

  const from = (tabla: string) => {
    const filas = tablas[tabla];
    if (!filas) throw new Error(`tabla ${tabla} sin filas en el doble`);
    const filtros: Filtro[] = [];
    let cambios: Fila | null = null;

    const ejecutar = () => {
      const coinciden = filas.filter((f) => filtros.every((p) => p(f)));
      if (cambios) for (const f of coinciden) Object.assign(f, cambios);
      return coinciden.map((f) => ({ ...f }));
    };
    const unica = (exigir: boolean) => ({
      then: <R>(resolve: (r: unknown) => R) => {
        const correr = () => {
          const out = ejecutar();
          if (out.length === 0 && exigir)
            return resolve({ data: null, error: { code: "PGRST116", message: "0 rows" } });
          return resolve({ data: out[0] ?? null, error: null });
        };
        if (cambios) return Promise.resolve().then(correr);
        // La lectura ve la fila del momento en que llegó, aunque se entregue después.
        const foto = ejecutar();
        return new Promise<void>((soltar) => retenidas.push(soltar)).then(() =>
          resolve({ data: foto[0] ?? null, error: null }),
        );
      },
    });

    const q = {
      select: () => q,
      update: (c: Fila) => ((cambios = c), q),
      eq: (col: string, v: unknown) => (filtros.push((f) => f[col] === v), q),
      in: (col: string, vs: unknown[]) => (filtros.push((f) => vs.includes(f[col])), q),
      or: (expr: string) => (filtros.push(filtroOr(expr)), q),
      single: () => unica(true),
      maybeSingle: () => unica(false),
      then: <R>(resolve: (r: unknown) => R) => {
        if (!cambios) throw new Error("select sin single en el doble");
        return Promise.resolve().then(() => resolve({ data: ejecutar(), error: null }));
      },
    };
    return q;
  };

  return {
    db: { from } as unknown as AppClient,
    /** Suelta las lecturas retenidas en el orden pedido (índice de llegada). */
    async soltar(orden: number[]) {
      await vueltas();
      const pendientes = retenidas.splice(0);
      for (const i of orden) {
        pendientes[i]?.();
        await vueltas();
      }
      // Lo que no se nombró, se suelta al final.
      for (const [i, s] of pendientes.entries()) if (!orden.includes(i)) s();
    },
  };
}

async function vueltas(n = 10) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

function filaMensaje(wamid: string, estado: EstadoEntrega | null): Fila {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    conversacion_id: "00000000-0000-4000-8000-0000000000c1",
    lead_session_id: "00000000-0000-4000-8000-0000000000a1",
    direction: "out",
    sender: "ia",
    sender_user_id: null,
    tipo: "text",
    contenido: "hola",
    media_url: null,
    meta_message_id: wamid,
    idempotency_key: null,
    metadata: {},
    created_at: "2026-09-25T10:00:00.000Z",
    platform_created_at: null,
    estado_entrega: estado,
    estado_entrega_at: null,
    error_entrega: null,
  };
}

describe("SupabaseMessagesRepository.aplicarEstadoEntrega con webhooks intercalados", () => {
  test("entregado y leído leen los dos 'enviado' y escribe primero leído: queda leído", async () => {
    const fila = filaMensaje("wamid.carrera", "enviado");
    const doble = dobleConLecturasRetenidas({ mensajes: [fila] });
    const repo = new SupabaseMessagesRepository(doble.db);

    const entregado = repo.aplicarEstadoEntrega("wamid.carrera", {
      estado: "entregado",
      at: new Date("2026-09-25T10:00:01Z"),
      error: null,
    });
    const leido = repo.aplicarEstadoEntrega("wamid.carrera", {
      estado: "leido",
      at: new Date("2026-09-25T10:00:02Z"),
      error: null,
    });
    // Llegaron en orden [entregado, leído]; se sueltan al revés.
    await doble.soltar([1, 0]);
    await Promise.all([entregado, leido]);

    expect(fila.estado_entrega).toBe("leido");
    expect(fila.estado_entrega_at).toBe("2026-09-25T10:00:02.000Z");
  });

  test("el perdedor devuelve la fila como quedó, no la que quiso escribir", async () => {
    const fila = filaMensaje("wamid.tarde", "leido");
    const doble = dobleConLecturasRetenidas({ mensajes: [fila] });
    const repo = new SupabaseMessagesRepository(doble.db);

    const p = repo.aplicarEstadoEntrega("wamid.tarde", {
      estado: "entregado",
      at: new Date("2026-09-25T10:00:01Z"),
      error: null,
    });
    await doble.soltar([0]);
    const out = await p;

    expect(out?.estado_entrega).toBe("leido");
    expect(fila.estado_entrega).toBe("leido");
  });

  test("wamid desconocido sigue siendo null", async () => {
    const doble = dobleConLecturasRetenidas({ mensajes: [] });
    const repo = new SupabaseMessagesRepository(doble.db);
    const p = repo.aplicarEstadoEntrega("wamid.nadie", {
      estado: "leido",
      at: new Date(),
      error: null,
    });
    await doble.soltar([0]);
    expect(await p).toBeNull();
  });

  test("el primer estado entra sobre una fila sin estado", async () => {
    const fila = filaMensaje("wamid.nuevo", null);
    const doble = dobleConLecturasRetenidas({ mensajes: [fila] });
    const repo = new SupabaseMessagesRepository(doble.db);
    const p = repo.aplicarEstadoEntrega("wamid.nuevo", {
      estado: "enviado",
      at: new Date("2026-09-25T10:00:00Z"),
      error: null,
    });
    await doble.soltar([0]);
    expect((await p)?.estado_entrega).toBe("enviado");
  });
});

describe("SupabaseWorkflowPlantillasSinSesionRepository.aplicarEstadoMeta con webhooks intercalados", () => {
  test("entregado gana el CAS primero y leído igual queda: no se pierde el avance", async () => {
    const fila: Fila = {
      id: "00000000-0000-4000-8000-0000000000b1",
      meta_message_id: "wamid.plantilla",
      estado: "aceptado",
      estado_at: null,
      error_codigo: null,
      error_detalle: null,
    };
    const doble = dobleConLecturasRetenidas({ workflow_plantillas_sin_sesion: [fila] });
    const repo = new SupabaseWorkflowPlantillasSinSesionRepository(doble.db);

    const entregado = repo.aplicarEstadoMeta(
      "wamid.plantilla",
      "entregado",
      new Date("2026-09-25T10:00:01Z"),
    );
    const leido = repo.aplicarEstadoMeta(
      "wamid.plantilla",
      "leido",
      new Date("2026-09-25T10:00:02Z"),
    );
    // Los dos leen `aceptado`; escribe primero entregado.
    await doble.soltar([0, 1]);
    await Promise.all([entregado, leido]);

    expect(fila.estado).toBe("leido");
  });
});
