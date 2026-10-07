import type { MarcaCatalogo } from "@/lib/catalogo/procedencia";

/**
 * Marcas de prueba. Los nombres y las procedencias son los que el dueño confirmó
 * el 2026-10-07 (MOBIS/HMC/GM original; MANDO/CTR/DONGSUNG/JUNGWOO Korea; 555/AISIN/
 * SEIWA Japón; VALEO Francia; BOSCH Alemania; KRC/PRO-AUT China). Los alias de
 * abajo son INVENTADOS para probar la resolución: no vienen de `marca_alias`.
 * TAIHO está sin procedencia a propósito (marca de origen desconocido) y VIEJA
 * está inactiva.
 */
const m = (
  nombre: string,
  procedencia: string | null,
  alias: string[] = [],
  tipo: string | null = "alterna",
  activa = true,
): MarcaCatalogo => ({ nombre, tipo, procedencia, activa, alias });

export const MARCAS: MarcaCatalogo[] = [
  m("MOBIS", "ORIGINAL", ["HYUNDAI MOBIS"], "original"),
  m("HMC", "ORIGINAL", [], "original"),
  m("GM", "ORIGINAL", [], "original"),
  m("MANDO", "KOREA"),
  m("CTR", "KOREA"),
  m("DONGSUNG", "KOREA"),
  m("JUNGWOO", "KOREA", ["JUNG WOO"]),
  m("555", "JAPON"),
  m("AISIN", "JAPON"),
  m("SEIWA", "JAPON"),
  m("VALEO", "FRANCIA"),
  m("BOSCH", "ALEMANIA"),
  m("KRC", "CHINA"),
  m("PRO-AUT", "CHINA"),
  m("TAIHO", null),
  m("VIEJA", "KOREA", [], "alterna", false),
];
