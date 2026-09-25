import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  CATEGORIA_PLANTILLA,
  ESTADO_DIFUSION,
  ESTADO_ENVIO,
  MODO_AUDIENCIA,
  MOTIVO_EXCLUSION,
  ORIGEN_SUPRESION,
  RUTA_ENVIO,
  transicionEnvioPermitida,
} from "@/lib/difusion/modelo";

/**
 * Los enums y la tabla de transiciones existen dos veces: en la migración
 * (que es lo que la base hace cumplir) y en `modelo.ts` (que es lo que el
 * código cree). Si divergen, el código deja pasar algo que la base rechaza —o
 * al revés, la base acepta algo que el código no sabe mostrar—, y ningún test
 * de una sola mitad lo ve. Es la lección del Corte 1 del PRD: dos registros que
 * se testean contra sí mismos.
 */

const DIR = path.resolve(process.cwd(), "supabase/migrations");
const archivos = readdirSync(DIR).filter((f) => f.endsWith("_difusion.sql"));

function leerMigracion(): string {
  const [archivo] = archivos;
  if (!archivo) throw new Error("no hay migración *_difusion.sql");
  // Sin comentarios de línea: pueden tener comillas y texto que no es SQL.
  return readFileSync(path.join(DIR, archivo), "utf8").replace(/--[^\n]*/g, "");
}

function valoresDelEnum(sql: string, tipo: string): string[] {
  const m = new RegExp(`create type public\\.${tipo} as enum \\(([^;]*?)\\);`, "s").exec(sql);
  if (!m?.[1]) throw new Error(`no encontré el enum ${tipo} en la migración`);
  return [...m[1].matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1] as string);
}

describe("modelo.ts coincide con la migración de difusión", () => {
  test("hay exactamente una migración de difusión", () => {
    expect(archivos).toHaveLength(1);
  });

  test.each([
    ["difusion_estado", ESTADO_DIFUSION],
    ["difusion_audiencia_modo", MODO_AUDIENCIA],
    ["difusion_plantilla_categoria", CATEGORIA_PLANTILLA],
    ["difusion_envio_estado", ESTADO_ENVIO],
    ["difusion_ruta", RUTA_ENVIO],
    ["difusion_motivo_exclusion", MOTIVO_EXCLUSION],
    ["difusion_supresion_origen", ORIGEN_SUPRESION],
  ] as const)("enum %s", (tipo, valores) => {
    expect(valoresDelEnum(leerMigracion(), tipo).sort()).toEqual([...valores].sort());
  });

  test("el trigger de transiciones permite exactamente lo que permite transicionEnvioPermitida", () => {
    const sql = leerMigracion();
    const cuerpo =
      /create function public\.difusion_envios_transicion\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(
        sql,
      )?.[1];
    if (!cuerpo) throw new Error("no encontré difusion_envios_transicion");

    const enSql = new Set<string>();
    const regla =
      /\(old\.estado = '([a-z_]+)'\s+and new\.estado (?:in \(([^)]*)\)|= '([a-z_]+)')\)/g;
    for (const m of cuerpo.matchAll(regla)) {
      const desde = m[1] as string;
      const destinos = m[3] ? [m[3]] : [...(m[2] ?? "").matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
      for (const hacia of destinos) enSql.add(`${desde}->${hacia}`);
    }

    const enTs = new Set<string>();
    for (const desde of ESTADO_ENVIO) {
      for (const hacia of ESTADO_ENVIO) {
        if (transicionEnvioPermitida(desde, hacia)) enTs.add(`${desde}->${hacia}`);
      }
    }

    expect([...enSql].sort()).toEqual([...enTs].sort());
  });
});
