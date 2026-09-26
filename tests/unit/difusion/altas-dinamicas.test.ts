import { describe, expect, test } from "vitest";
import { NoopLogger } from "@/lib/observability/logger";
import type { Grupo } from "@/lib/ui/condiciones";
import type { Difusion } from "@/lib/difusion/modelo";
import { InMemoryDifusionEnviosRepository } from "@/server/repositories/difusion-envios.repo";
import { InMemoryDifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.repo";
import { InMemoryDifusionesRepository } from "@/server/repositories/difusiones.repo";
import { DefaultAltasDinamicasService } from "@/server/services/difusion/altas-dinamicas.service";
import type { LecturaTope } from "@/server/services/difusion/difusion.service";
import {
  FakeDifusionAudienciaRepository,
  candidato,
  leadIdDe,
  telefonoDe,
} from "../../helpers/difusion-fakes";

const AHORA = new Date("2026-09-26T15:00:00.000Z");
const DIA = 24 * 3_600_000;
const ARBOL: Grupo = {
  id: "raiz",
  clase: "grupo",
  operador: "y",
  hijos: [
    {
      id: "r1",
      clase: "regla",
      campoId: "canal",
      comparador: "tiene",
      valor: { tipo: "opciones", valores: ["wa"] },
    },
  ],
};

async function armar(o: { tope?: LecturaTope; usado24h?: number; textoLibre?: string } = {}) {
  const difusiones = new InMemoryDifusionesRepository();
  const envios = new InMemoryDifusionEnviosRepository();
  const supresiones = new InMemoryDifusionSupresionesRepository();
  const audiencia = new FakeDifusionAudienciaRepository([], o.usado24h ?? 0);
  const creada = await difusiones.create({
    nombre: "Dinámica",
    audiencia: ARBOL,
    creada_por: null,
    audiencia_modo: "dinamica",
    plantilla_nombre: "promo",
    plantilla_categoria: "marketing",
    plantilla_idioma: "es",
    texto_libre: o.textoLibre ?? null,
  });
  const d: Difusion = await difusiones.update(creada.id, {
    estado: "enviando",
    programada_para: new Date(AHORA.getTime() - DIA),
  });
  // El plan original: el lead 1, ya en cola.
  await envios.registrarPlan([
    {
      difusion_id: d.id,
      lead_id: leadIdDe(1),
      telefono: telefonoDe(1),
      estado: "en_cola",
      motivo_exclusion: null,
      ruta: "plantilla",
      tanda: 0,
      programado_para: new Date(AHORA.getTime() - DIA),
    },
  ]);
  const servicio = new DefaultAltasDinamicasService({
    audiencia,
    envios,
    supresiones,
    leerTopeMensajeria: async () => o.tope ?? { estado: "ok", tope: 2000 },
    leerMaxSalientes24h: async () => 3,
    logger: new NoopLogger(),
  });
  const filas = async () => envios.listarPorDifusion(d.id, { limite: 100 });
  return { d, envios, supresiones, audiencia, servicio, filas };
}

describe("AltasDinamicas — los que empezaron a coincidir", () => {
  test("suma sólo a los nuevos, en la tanda que se re-evalúa, marcados como alta", async () => {
    const m = await armar();
    m.audiencia.candidatos = [candidato(1), candidato(2), candidato(3)];

    const r = await m.servicio.sumar(m.d, 1, AHORA);

    expect(r).toEqual({ coinciden: 3, nuevos: 2, sumadas: 2 });
    const altas = (await m.filas()).filter((f) => f.alta_dinamica);
    expect(altas.map((f) => f.lead_id).sort()).toEqual([leadIdDe(2), leadIdDe(3)]);
    for (const f of altas) {
      expect(f).toMatchObject({ estado: "en_cola", tanda: 1, ruta: "plantilla" });
      expect(f.programado_para?.toISOString()).toBe(AHORA.toISOString());
    }
    // El del plan original no se toca.
    const uno = (await m.filas()).find((f) => f.lead_id === leadIdDe(1));
    expect(uno).toMatchObject({ tanda: 0, alta_dinamica: false });
  });

  test("pasan por el mismo planificador: una baja entra excluida con su motivo", async () => {
    const m = await armar();
    await m.supresiones.registrar({
      telefono: telefonoDe(2),
      origen: "palabra_clave",
      detalle: "BAJA",
    });
    m.audiencia.candidatos = [candidato(1), candidato(2)];

    await m.servicio.sumar(m.d, 1, AHORA);

    const dos = (await m.filas()).find((f) => f.lead_id === leadIdDe(2));
    expect(dos).toMatchObject({
      estado: "excluido",
      motivo_exclusion: "baja_propia",
      alta_dinamica: true,
    });
  });

  test("un nuevo con el teléfono de alguien que ya recibe no se duplica", async () => {
    const m = await armar();
    // Otro lead con el mismo número que el lead 1 (con `+`, como en `leads`).
    m.audiencia.candidatos = [candidato(1), candidato(7, { telefono: `+${telefonoDe(1)}` })];

    const r = await m.servicio.sumar(m.d, 1, AHORA);

    expect(r.sumadas).toBe(1);
    const siete = (await m.filas()).find((f) => f.lead_id === leadIdDe(7));
    expect(siete).toMatchObject({ estado: "excluido", motivo_exclusion: "duplicado_telefono" });
    expect((await m.filas()).filter((f) => f.estado === "en_cola")).toHaveLength(1);
  });

  test("con texto libre, un nuevo con la ventana abierta va por la ventana y no pide cupo", async () => {
    const m = await armar({
      textoLibre: "Hola {{lead.nombre}}",
      tope: { estado: "ok", tope: 100 },
      usado24h: 85,
    });
    m.audiencia.candidatos = [
      candidato(1),
      candidato(2, { ultimoEntranteAt: new Date(AHORA.getTime() - 2 * 3_600_000) }),
    ];

    const r = await m.servicio.sumar(m.d, 2, AHORA);

    expect(r.sumadas).toBe(1);
    const dos = (await m.filas()).find((f) => f.lead_id === leadIdDe(2));
    expect(dos).toMatchObject({ estado: "en_cola", ruta: "ventana_abierta", tanda: 2 });
  });

  test("el cupo se recalcula: sin lugar hoy para plantillas, las altas no entran y lo dice", async () => {
    // Tope 100 → reserva 15 → se usaron 85: no queda nada para plantillas.
    const m = await armar({ tope: { estado: "ok", tope: 100 }, usado24h: 85 });
    m.audiencia.candidatos = [candidato(1), candidato(2)];

    const r = await m.servicio.sumar(m.d, 1, AHORA);

    expect(r).toEqual({ coinciden: 2, nuevos: 1, sumadas: 0, motivo: "sin_cupo" });
    expect((await m.filas()).some((f) => f.alta_dinamica)).toBe(false);
  });

  test("las altas se reparten en tandas desde la que se re-evalúa, según el cupo de hoy", async () => {
    // Tope 100 → reserva 15 → entran 85; se usaron 84 → una plantilla por tanda.
    const m = await armar({ tope: { estado: "ok", tope: 100 }, usado24h: 84 });
    m.audiencia.candidatos = [candidato(1), candidato(2), candidato(3)];

    await m.servicio.sumar(m.d, 1, AHORA);

    const altas = (await m.filas()).filter((f) => f.alta_dinamica);
    expect(altas.map((f) => f.tanda).sort()).toEqual([1, 2]);
    const segunda = altas.find((f) => f.tanda === 2);
    expect(segunda?.programado_para?.toISOString()).toBe(
      new Date(AHORA.getTime() + DIA).toISOString(),
    );
  });

  test("sin nadie nuevo no planifica ni escribe", async () => {
    const m = await armar();
    m.audiencia.candidatos = [candidato(1)];
    expect(await m.servicio.sumar(m.d, 1, AHORA)).toEqual({ coinciden: 1, nuevos: 0, sumadas: 0 });
  });

  test("una congelada no suma nunca", async () => {
    const m = await armar();
    m.audiencia.candidatos = [candidato(1), candidato(2)];
    const congelada: Difusion = { ...m.d, audiencia_modo: "congelada" };
    expect(await m.servicio.sumar(congelada, 1, AHORA)).toEqual({
      coinciden: 0,
      nuevos: 0,
      sumadas: 0,
      motivo: "congelada",
    });
    expect(m.audiencia.pedidas).toHaveLength(0);
  });
});
