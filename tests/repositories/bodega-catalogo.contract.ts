import { beforeEach, describe, expect, test } from "vitest";
import type {
  FilaBaja,
  FilaExistencia,
  FilaMarca,
  FilaVariante,
} from "@/lib/catalogo/bodega-contrato";
import type { BodegaCatalogoRepository } from "@/server/repositories/bodega-catalogo.repo";

export interface MarcaLeida {
  nombre: string;
  tipo: string | null;
  procedencia: string | null;
  activa: boolean;
  alias: string[];
}

export interface BodegaCatalogoHarness {
  repo: BodegaCatalogoRepository;
  marca(nombre: string): Promise<MarcaLeida | undefined>;
  existencia(
    noItem: string,
  ): Promise<{ activa: boolean; grupo_numero: number | null; origen: string | null } | undefined>;
  variante(
    id: string,
  ): Promise<{ activa: boolean; estado: string; descartada: boolean } | undefined>;
  /** Una marca como la dejaría la carga del ERP: sin sello de Bodega Web. */
  sembrarMarcaDelErp(m: {
    nombre: string;
    tipo: string | null;
    procedencia: string | null;
  }): Promise<void>;
}

const T1 = "2026-10-07T10:00:00.000001+00:00";
const T2 = "2026-10-07T12:00:00.000000+00:00";
const T3 = "2026-10-07T14:00:00.000000+00:00";
const CURSOR = { desde: "2026-10-07T15:04:05.123456Z", despues: "10234" };

const marca = (o: Partial<FilaMarca> = {}): FilaMarca => ({
  nombre: "MANDO",
  tipo: "producto",
  procedencia: "KOREA",
  activa: true,
  alias: ["MANDO CORP"],
  actualizada_en: T1,
  ...o,
});

const existencia = (o: Partial<FilaExistencia> = {}): FilaExistencia => ({
  no_item: "C-100",
  grupo_numero: 100,
  origen: "excel",
  actualizado_en: T1,
  ...o,
});

const V1 = "00000000-0000-4000-8000-000000000001";
const V2 = "00000000-0000-4000-8000-000000000002";

const variante = (o: Partial<FilaVariante> = {}): FilaVariante => ({
  id: V1,
  item_codigo_interno: "C-100",
  proveedor: { id: "00000000-0000-4000-8000-0000000000aa", nombre: "PROV", abreviatura: "PV" },
  supplier_code_raw: "ab-123",
  supplier_code_norm: "AB123",
  codigos_auxiliares: [],
  descripcion_raw: null,
  descripcion_limpia: null,
  descripcion_auxiliar: null,
  marca_raw: null,
  marca_canonica: "MANDO",
  marca_id: null,
  marca_procedencia: "KOREA",
  lado: "LEFT",
  categoria: null,
  estado: "CONFIRMED",
  descartada: false,
  promovida: false,
  promovida_en: null,
  primera_vez: null,
  ultima_vez: null,
  actualizado_en: T1,
  ...o,
});

const baja = (o: Partial<FilaBaja>): FilaBaja => ({
  id: 1,
  tabla: "existencias",
  clave: "C-100",
  borrado_en: T2,
  ...o,
});

/**
 * Contrato de la copia del catálogo de Bodega Web. Lo corren el repo in-memory y el de
 * Supabase contra Postgres real (la función `bodega_aplicar_pagina`).
 */
export function runBodegaCatalogoContract(make: () => Promise<BodegaCatalogoHarness>) {
  describe("BodegaCatalogoRepository contract", () => {
    let h: BodegaCatalogoHarness;
    beforeEach(async () => {
      h = await make();
    });

    describe("cursor", () => {
      test("sin nada guardado, cada tabla empieza en -infinity y sin `despues`", async () => {
        const c = await h.repo.leerCursores();
        for (const t of ["marcas", "existencias", "variantes", "bajas"] as const) {
          expect(c[t]).toEqual({ desde: "-infinity", despues: null });
        }
      });

      test("se guarda tal cual, con los microsegundos y como texto", async () => {
        await h.repo.aplicarPagina("existencias", [existencia()], CURSOR);
        const c = await h.repo.leerCursores();
        expect(c.existencias).toEqual(CURSOR);
        expect(c.existencias.desde).toBe("2026-10-07T15:04:05.123456Z");
        expect(c.marcas).toEqual({ desde: "-infinity", despues: null });
      });

      test("una página sin filas igual mueve el cursor", async () => {
        await h.repo.aplicarPagina("variantes", [], CURSOR);
        expect((await h.repo.leerCursores()).variantes).toEqual(CURSOR);
      });

      test("`despues` null se conserva", async () => {
        await h.repo.aplicarPagina("marcas", [marca()], { desde: CURSOR.desde, despues: null });
        expect((await h.repo.leerCursores()).marcas).toEqual({
          desde: CURSOR.desde,
          despues: null,
        });
      });
    });

    describe("existencias", () => {
      test("guarda lo que no trae el ERP y es idempotente", async () => {
        const fila = existencia();
        expect(await h.repo.aplicarPagina("existencias", [fila], CURSOR)).toBe(1);
        await h.repo.aplicarPagina("existencias", [fila], CURSOR);
        expect(await h.existencia("C-100")).toMatchObject({
          activa: true,
          grupo_numero: 100,
          origen: "excel",
        });
      });

      test("una fila más vieja que la guardada no la pisa", async () => {
        await h.repo.aplicarPagina(
          "existencias",
          [existencia({ actualizado_en: T2, grupo_numero: 7 })],
          CURSOR,
        );
        await h.repo.aplicarPagina(
          "existencias",
          [existencia({ actualizado_en: T1, grupo_numero: 1 })],
          CURSOR,
        );
        expect((await h.existencia("C-100"))?.grupo_numero).toBe(7);
      });
    });

    describe("bajas (contrato §6): solo si lo guardado es ANTERIOR al borrado", () => {
      test("una baja posterior al sello desactiva, no borra", async () => {
        await h.repo.aplicarPagina("existencias", [existencia({ actualizado_en: T1 })], CURSOR);
        const n = await h.repo.aplicarPagina("bajas", [baja({ borrado_en: T2 })], CURSOR);
        expect(n).toBe(1);
        expect((await h.existencia("C-100"))?.activa).toBe(false);
      });

      test("una baja ANTERIOR al sello guardado se ignora: la fila volvió a existir", async () => {
        await h.repo.aplicarPagina("existencias", [existencia({ actualizado_en: T3 })], CURSOR);
        const n = await h.repo.aplicarPagina("bajas", [baja({ borrado_en: T2 })], CURSOR);
        expect(n).toBe(0);
        expect((await h.existencia("C-100"))?.activa).toBe(true);
      });

      test("un sello IGUAL al borrado tampoco se da de baja (estrictamente anterior)", async () => {
        await h.repo.aplicarPagina("existencias", [existencia({ actualizado_en: T2 })], CURSOR);
        await h.repo.aplicarPagina("bajas", [baja({ borrado_en: T2 })], CURSOR);
        expect((await h.existencia("C-100"))?.activa).toBe(true);
      });

      test("la diferencia de un microsegundo cuenta", async () => {
        await h.repo.aplicarPagina(
          "existencias",
          [existencia({ actualizado_en: "2026-10-07T12:00:00.000002+00:00" })],
          CURSOR,
        );
        await h.repo.aplicarPagina(
          "bajas",
          [baja({ borrado_en: "2026-10-07T12:00:00.000001+00:00" })],
          CURSOR,
        );
        expect((await h.existencia("C-100"))?.activa).toBe(true);
      });

      test("una fila que se vuelve a crear después de la baja reactiva", async () => {
        await h.repo.aplicarPagina("existencias", [existencia({ actualizado_en: T1 })], CURSOR);
        await h.repo.aplicarPagina("bajas", [baja({ borrado_en: T2 })], CURSOR);
        await h.repo.aplicarPagina("existencias", [existencia({ actualizado_en: T3 })], CURSOR);
        expect((await h.existencia("C-100"))?.activa).toBe(true);
      });

      test("una baja de una clave que nunca se vio no hace nada", async () => {
        const n = await h.repo.aplicarPagina("bajas", [baja({ clave: "NO-EXISTE" })], CURSOR);
        expect(n).toBe(0);
      });

      test("variantes: la baja desactiva y deja de salir en variantesDeItems", async () => {
        await h.repo.aplicarPagina("variantes", [variante({ actualizado_en: T1 })], CURSOR);
        expect(await h.repo.variantesDeItems(["C-100"])).toHaveLength(1);
        await h.repo.aplicarPagina(
          "bajas",
          [baja({ tabla: "variantes", clave: V1, borrado_en: T2 })],
          CURSOR,
        );
        expect((await h.variante(V1))?.activa).toBe(false);
        expect(await h.repo.variantesDeItems(["C-100"])).toEqual([]);
      });

      test("variantes: una baja vieja no desactiva una variante recreada", async () => {
        await h.repo.aplicarPagina("variantes", [variante({ actualizado_en: T3 })], CURSOR);
        await h.repo.aplicarPagina(
          "bajas",
          [baja({ tabla: "variantes", clave: V1, borrado_en: T2 })],
          CURSOR,
        );
        expect((await h.variante(V1))?.activa).toBe(true);
      });

      test("marcas: la baja desactiva la marca cargada por Bodega Web", async () => {
        await h.repo.aplicarPagina("marcas", [marca({ actualizada_en: T1 })], CURSOR);
        await h.repo.aplicarPagina(
          "bajas",
          [baja({ tabla: "marcas", clave: "MANDO", borrado_en: T2 })],
          CURSOR,
        );
        expect((await h.marca("MANDO"))?.activa).toBe(false);
      });

      test("marcas: una baja vieja no desactiva una marca recreada con el mismo nombre", async () => {
        await h.repo.aplicarPagina("marcas", [marca({ actualizada_en: T3 })], CURSOR);
        await h.repo.aplicarPagina(
          "bajas",
          [baja({ tabla: "marcas", clave: "MANDO", borrado_en: T2 })],
          CURSOR,
        );
        expect((await h.marca("MANDO"))?.activa).toBe(true);
      });

      test("marcas: una marca que solo conoce el ERP se desactiva con la baja", async () => {
        await h.sembrarMarcaDelErp({ nombre: "VIEJA", tipo: "alterna", procedencia: "KOREA" });
        await h.repo.aplicarPagina(
          "bajas",
          [baja({ tabla: "marcas", clave: "VIEJA", borrado_en: T2 })],
          CURSOR,
        );
        expect((await h.marca("VIEJA"))?.activa).toBe(false);
      });

      test("una tabla de baja que no se conoce se ignora sin frenar la página", async () => {
        const n = await h.repo.aplicarPagina(
          "bajas",
          [baja({ tabla: "tabla_nueva", clave: "x" })],
          CURSOR,
        );
        expect(n).toBe(0);
        expect((await h.repo.leerCursores()).bajas).toEqual(CURSOR);
      });
    });

    describe("marcas", () => {
      test("las escribe en el catálogo de marcas con su tipo y procedencia", async () => {
        await h.repo.aplicarPagina("marcas", [marca()], CURSOR);
        expect(await h.marca("MANDO")).toMatchObject({
          nombre: "MANDO",
          tipo: "producto",
          procedencia: "KOREA",
          activa: true,
          alias: ["MANDO CORP"],
        });
      });

      test("los alias se REEMPLAZAN, no se suman", async () => {
        await h.repo.aplicarPagina(
          "marcas",
          [marca({ alias: ["A", "B"], actualizada_en: T1 })],
          CURSOR,
        );
        await h.repo.aplicarPagina("marcas", [marca({ alias: ["C"], actualizada_en: T2 })], CURSOR);
        expect((await h.marca("MANDO"))?.alias).toEqual(["C"]);
      });

      test("una marca de vehículo se guarda con su tipo (el agente la ignora al leer)", async () => {
        await h.repo.aplicarPagina(
          "marcas",
          [marca({ nombre: "KIA", tipo: "vehiculo", procedencia: "KOREA", alias: [] })],
          CURSOR,
        );
        expect((await h.marca("KIA"))?.tipo).toBe("vehiculo");
      });

      test("dos filas del mismo nombre en una página no rompen: gana la de producto", async () => {
        await h.repo.aplicarPagina(
          "marcas",
          [
            marca({ nombre: "RARA", tipo: "vehiculo", procedencia: "JAPON", alias: [] }),
            marca({ nombre: "RARA", tipo: "producto", procedencia: "CHINA", alias: [] }),
          ],
          CURSOR,
        );
        expect(await h.marca("RARA")).toMatchObject({ tipo: "producto", procedencia: "CHINA" });
      });
    });

    describe("variantes", () => {
      test("guarda también las descartadas y no confiables, con sus banderas", async () => {
        await h.repo.aplicarPagina(
          "variantes",
          [
            variante({ id: V1, estado: "TRUSTED" }),
            variante({ id: V2, estado: "OBSERVED", descartada: true }),
          ],
          CURSOR,
        );
        expect(await h.variante(V2)).toMatchObject({ estado: "OBSERVED", descartada: true });
        const vs = await h.repo.variantesDeItems(["C-100"]);
        expect(vs.map((v) => v.id).sort()).toEqual([V1, V2]);
      });

      test("devuelve lo que necesita la resolución y nada de precios", async () => {
        await h.repo.aplicarPagina("variantes", [variante()], CURSOR);
        const [v] = await h.repo.variantesDeItems(["C-100"]);
        expect(v).toEqual({
          id: V1,
          item_codigo_interno: "C-100",
          marca_canonica: "MANDO",
          marca_procedencia: "KOREA",
          lado: "LEFT",
          estado: "CONFIRMED",
          descartada: false,
          activa: true,
        });
      });

      test("sin códigos o con un ítem sin variantes devuelve vacío", async () => {
        expect(await h.repo.variantesDeItems([])).toEqual([]);
        expect(await h.repo.variantesDeItems(["NADA"])).toEqual([]);
      });

      test("una variante más vieja que la guardada no la pisa", async () => {
        await h.repo.aplicarPagina(
          "variantes",
          [variante({ actualizado_en: T2, estado: "TRUSTED" })],
          CURSOR,
        );
        await h.repo.aplicarPagina(
          "variantes",
          [variante({ actualizado_en: T1, estado: "CONFLICT" })],
          CURSOR,
        );
        expect((await h.variante(V1))?.estado).toBe("TRUSTED");
      });
    });
  });
}
