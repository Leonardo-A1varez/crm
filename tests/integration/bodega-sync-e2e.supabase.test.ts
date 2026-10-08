import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { sincronizarBodegaHandler } from "@/inngest/functions/sincronizar-bodega.cron";
import { PermissionDeniedError } from "@/lib/errors";
import { SupabaseBodegaCatalogoRepository } from "@/server/repositories/bodega-catalogo.supabase.repo";
import { HttpBodegaCatalogoClient } from "@/server/services/catalog/bodega/bodega-client";
import { DefaultSincronizarBodegaService } from "@/server/services/catalog/bodega/sincronizar-bodega.service";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

// La sincronización completa contra Postgres real y un stub HTTP de la RPC de Bodega Web
// (`crm_catalogo_cambios`): cliente real, repo real, función SQL real. El stub implementa
// el cursor del contrato (§2): `(sello, clave) > (desde, despues)`, orden ascendente,
// `siguiente` no nulo cuando la página viene llena. Los sellos son texto con
// microsegundos y varias filas comparten sello: un cursor redondeado repetiría páginas.

const CLAVE = "clave-de-lectura-de-prueba-0123456789abcdef";
const ANON = "anon-de-prueba";

interface Fila {
  sello: string;
  clave: string;
  fila: Record<string, unknown>;
}

const SELLO_A = "2026-10-07T10:00:00.123456+00:00";
const SELLO_B = "2026-10-07T10:00:00.123457+00:00";

const existencias: Fila[] = ["I-1", "I-2", "I-3", "I-4", "I-5"].map((no_item, i) => ({
  // Tres ítems con el MISMO sello (desempate por clave) y dos con otro.
  sello: i < 3 ? SELLO_A : SELLO_B,
  clave: no_item,
  fila: {
    no_item,
    codigo: null,
    otros_codigos: null,
    grupo: "G",
    grupo_numero: 100 + i,
    descripcion: "x",
    auxiliar: null,
    origen: "excel",
    creado_en: SELLO_A,
    actualizado_en: i < 3 ? SELLO_A : SELLO_B,
  },
}));

let datos: Record<string, Fila[]> = {};
let claveEsperada = CLAVE;
let llamadas: Record<string, unknown>[] = [];
let server: Server;
let url = "";
let service: TestClient;

function responder(cuerpo: Record<string, unknown>): { status: number; json: unknown } {
  if (cuerpo["p_clave"] !== claveEsperada) {
    return { status: 403, json: { code: "42501", message: "clave invalida" } };
  }
  const tabla = String(cuerpo["p_tabla"]);
  // El stub sirve páginas de a lo sumo 2 filas: el cursor cae en medio de un grupo de sellos iguales.
  const limite = Math.min(Number(cuerpo["p_limite"]), 2);
  const desde = String(cuerpo["p_desde"]);
  const despues = cuerpo["p_despues"] === null ? null : String(cuerpo["p_despues"]);
  const todas = [...(datos[tabla] ?? [])].sort(
    (a, b) => a.sello.localeCompare(b.sello) || a.clave.localeCompare(b.clave),
  );
  const pasan = todas.filter((f) => {
    if (desde === "-infinity") return true;
    const s = f.sello.replace("+00:00", "Z");
    if (despues === null) return s > desde;
    return s > desde || (s === desde && f.clave > despues);
  });
  const pagina = pasan.slice(0, limite);
  const ultima = pagina[pagina.length - 1];
  const cursor = ultima
    ? { desde: ultima.sello.replace("+00:00", "Z"), despues: ultima.clave }
    : { desde, despues };
  return {
    status: 200,
    json: {
      tabla,
      filas: pagina.map((f) => f.fila),
      cursor,
      siguiente: pagina.length === limite ? cursor : null,
      hasta: "2026-10-07T10:09:00.000000Z",
    },
  };
}

beforeAll(async () => {
  service = makeTestSupabaseClient();
  server = createServer((req, res) => {
    const trozos: Buffer[] = [];
    req.on("data", (c: Buffer) => trozos.push(c));
    req.on("end", () => {
      const cuerpo = JSON.parse(Buffer.concat(trozos).toString("utf-8")) as Record<string, unknown>;
      if (req.url !== "/rest/v1/rpc/crm_catalogo_cambios" || req.headers["apikey"] !== ANON) {
        res.writeHead(404).end("{}");
        return;
      }
      llamadas.push(cuerpo);
      const r = responder(cuerpo);
      res.writeHead(r.status, { "content-type": "application/json" }).end(JSON.stringify(r.json));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((ok) => server.close(() => ok()));
  await limpiar();
  await cleanupTestDb(service);
});

async function limpiar(): Promise<void> {
  const rs = [
    await service
      .from("bodega_variantes")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000"),
    await service.from("bodega_existencias").delete().neq("no_item", ""),
    await service.from("bodega_sync_cursor").delete().neq("tabla", ""),
    await service.from("catalogo_marcas").delete().neq("nombre", ""),
  ];
  for (const { error } of rs) if (error) throw new Error(error.message);
}

beforeEach(async () => {
  await limpiar();
  datos = { marcas: [], existencias, variantes: [], bajas: [] };
  claveEsperada = CLAVE;
  llamadas = [];
});

function armar(clave = CLAVE) {
  const repo = new SupabaseBodegaCatalogoRepository(service);
  const servicio = new DefaultSincronizarBodegaService({
    client: new HttpBodegaCatalogoClient({ url, anonKey: ANON, clave }),
    repo,
  });
  const memoria = new Map<string, unknown>();
  const paso = {
    run: async <T>(nombre: string, fn: () => Promise<T>): Promise<T> => {
      if (memoria.has(nombre)) return memoria.get(nombre) as T;
      const v = await fn();
      memoria.set(nombre, v);
      return v;
    },
  };
  return { repo, servicio, paso };
}

const TS = Date.UTC(2026, 9, 8, 14, 0, 0);

describe("sincronización completa contra el stub de Bodega Web", () => {
  test("trae las cinco existencias con sellos repetidos, sin repetir páginas, y guarda el cursor exacto", async () => {
    const { repo, servicio, paso } = armar();

    const r = await sincronizarBodegaHandler({ ts: TS }, { servicio }, paso);

    expect(r.configurado).toBe(true);
    // 5 filas de a 2: tres páginas, ninguna repetida pese a los sellos iguales.
    expect(llamadas.filter((l) => l["p_tabla"] === "existencias")).toHaveLength(3);
    expect(r.porTabla.existencias.filas).toBe(5);
    const { data } = await service.from("bodega_existencias").select("no_item, grupo_numero");
    expect((data ?? []).map((d) => d.no_item).sort()).toEqual(["I-1", "I-2", "I-3", "I-4", "I-5"]);
    const cursores = await repo.leerCursores();
    expect(cursores.existencias).toEqual({ desde: "2026-10-07T10:00:00.123457Z", despues: "I-5" });
    expect(cursores.existencias.desde).toMatch(/\.123457Z$/);
  });

  test("una segunda corrida no vuelve a escribir: pide desde el cursor y recibe una página vacía", async () => {
    const { servicio, paso } = armar();
    await sincronizarBodegaHandler({ ts: TS }, { servicio }, paso);
    llamadas = [];
    const otra = armar();
    const r = await sincronizarBodegaHandler(
      { ts: TS + 300_000 },
      { servicio: otra.servicio },
      otra.paso,
    );
    expect(r.filas).toBe(0);
    const pedidoExistencias = llamadas.find((l) => l["p_tabla"] === "existencias");
    expect(pedidoExistencias).toMatchObject({
      p_desde: "2026-10-07T10:00:00.123457Z",
      p_despues: "I-5",
    });
  });

  test("las bajas llegan al final y desactivan solo lo anterior al borrado", async () => {
    datos["bajas"] = [
      {
        sello: "2026-10-07T11:00:00.000000+00:00",
        clave: "0001",
        fila: {
          id: 1,
          tabla: "existencias",
          clave: "I-1",
          datos: {},
          borrado_en: "2026-10-07T11:00:00.000000+00:00",
        },
      },
      {
        // I-5 se volvió a cargar DESPUÉS de este borrado: la baja es vieja.
        sello: "2026-10-07T09:00:00.000000+00:00",
        clave: "0002",
        fila: {
          id: 2,
          tabla: "existencias",
          clave: "I-5",
          datos: {},
          borrado_en: "2026-10-07T09:00:00.000000+00:00",
        },
      },
    ];
    const { servicio, paso } = armar();
    await sincronizarBodegaHandler({ ts: TS }, { servicio }, paso);

    const { data } = await service.from("bodega_existencias").select("no_item, activa");
    const por = Object.fromEntries((data ?? []).map((d) => [d.no_item, d.activa]));
    expect(por["I-1"]).toBe(false);
    expect(por["I-5"]).toBe(true);
    // El orden de los pedidos es el del contrato.
    const orden = llamadas.map((l) => l["p_tabla"]);
    expect(orden.indexOf("bajas")).toBeGreaterThan(orden.lastIndexOf("existencias"));
  });

  test("una clave rechazada (42501) se propaga como PermissionDenied y no cambia nada", async () => {
    claveEsperada = "otra-clave-distinta-0123456789abcdefghij";
    const { repo, servicio, paso } = armar();
    await expect(sincronizarBodegaHandler({ ts: TS }, { servicio }, paso)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    const { count } = await service
      .from("bodega_existencias")
      .select("*", { count: "exact", head: true });
    expect(count).toBe(0);
    expect((await repo.leerCursores()).marcas).toEqual({ desde: "-infinity", despues: null });
  });
});
