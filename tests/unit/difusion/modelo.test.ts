import { describe, expect, test } from "vitest";
import {
  ESTADO_ENVIO,
  ESTADOS_QUE_SALIERON,
  MOTIVO_EXCLUSION,
  ORIGEN_SUPRESION,
  esMotivoEximible,
  motivoDeSupresion,
  transicionEnvioPermitida,
  type EstadoEnvio,
} from "@/lib/difusion/modelo";

/**
 * La tabla escrita a mano, a propósito distinta de la implementación: si
 * alguien agrega una transición en `modelo.ts` sin pensarlo, este test lo
 * nota. La misma tabla vive en el trigger `difusion_envios_transicion` y
 * `modelo-vs-migracion.test.ts` verifica que coincidan.
 */
const PERMITIDAS: Record<EstadoEnvio, readonly EstadoEnvio[]> = {
  excluido: [],
  en_cola: ["aceptado", "fallido", "cancelado", "excluido"],
  cancelado: ["aceptado", "fallido"],
  aceptado: ["entregado", "leido", "fallido"],
  entregado: ["leido"],
  leido: [],
  fallido: [],
};

describe("transicionEnvioPermitida", () => {
  const pares = ESTADO_ENVIO.flatMap((desde) =>
    ESTADO_ENVIO.filter((hacia) => hacia !== desde).map((hacia) => [desde, hacia] as const),
  );

  test.each(pares)("%s → %s", (desde, hacia) => {
    expect(transicionEnvioPermitida(desde, hacia)).toBe(PERMITIDAS[desde].includes(hacia));
  });

  test("quedarse en el mismo estado no es una transición", () => {
    for (const e of ESTADO_ENVIO) expect(transicionEnvioPermitida(e, e)).toBe(false);
  });

  // Volver a la cola es exactamente cómo se manda dos veces.
  test("nada vuelve a en_cola", () => {
    for (const desde of ESTADO_ENVIO)
      expect(transicionEnvioPermitida(desde, "en_cola")).toBe(false);
  });

  // Detener no puede dejar creer que frenó algo que ya estaba en el teléfono.
  test("lo que ya salió no se cancela", () => {
    for (const desde of ESTADOS_QUE_SALIERON) {
      expect(transicionEnvioPermitida(desde, "cancelado")).toBe(false);
    }
  });

  // Un envío que estaba en vuelo cuando se detuvo puede terminar aceptado:
  // si Meta lo aceptó, salió, y la fila tiene que decirlo.
  test("un cancelado en vuelo puede terminar aceptado", () => {
    expect(transicionEnvioPermitida("cancelado", "aceptado")).toBe(true);
  });
});

describe("motivoDeSupresion", () => {
  test.each([
    ["palabra_clave", "baja_propia"],
    ["boton_baja", "baja_propia"],
    ["manual", "baja_propia"],
    ["meta_131050", "baja_meta"],
    ["meta_preferencias", "baja_meta"],
  ] as const)("%s → %s", (origen, motivo) => {
    expect(motivoDeSupresion(origen)).toBe(motivo);
  });

  test("cubre todos los orígenes", () => {
    for (const o of ORIGEN_SUPRESION)
      expect(["baja_propia", "baja_meta"]).toContain(motivoDeSupresion(o));
  });
});

describe("esMotivoEximible", () => {
  // Sólo dos se pueden levantar por campaña, y quedan auditadas en la fila de
  // la difusión. El resto protege al número o a una conversación en curso.
  test("sólo el tope de frecuencia y la negociación se eximen", () => {
    const eximibles = MOTIVO_EXCLUSION.filter(esMotivoEximible);
    expect([...eximibles].sort()).toEqual(["cap_frecuencia", "en_negociacion"]);
  });
});
