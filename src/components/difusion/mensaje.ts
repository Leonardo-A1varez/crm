import { CATEGORIA_PLANTILLA } from "./paleta";
import type {
  AsignacionVariable,
  CampoVariable,
  CategoriaPlantilla,
  ConfigMensaje,
  LineaCosto,
  Plantilla,
  TarifaPlantilla,
  ValoresLead,
} from "./tipos";

/**
 * Las cuentas del paso «Mensaje». Puras y sin React, igual que `cupo.ts`: son
 * las que deciden qué le llega a cada persona, y tienen que poder probarse sin
 * montar la pantalla.
 *
 * Hoy el texto de las plantillas no se lee de Meta (`Plantilla.cuerpo` llega
 * en `null`), así que las variables y los botones no aparecen. Las funciones
 * aceptan ese caso en vez de suponer un texto: sin texto no hay variables que
 * completar, y eso no es lo mismo que "no le faltan datos".
 */

/** Variables posicionales de Meta: `{{1}}`, `{{2}}`. Ninguna otra forma cuenta. */
const VARIABLE = /\{\{(\d+)\}\}/g;

/** Los números de las variables de un texto, sin repetir y en orden. Sin texto, ninguno. */
export function variablesDe(texto: string | null): number[] {
  if (texto === null) return [];
  const indices = new Set<number>();
  for (const m of texto.matchAll(VARIABLE)) indices.add(Number(m[1]));
  return [...indices].sort((a, b) => a - b);
}

export type Segmento = { tipo: "texto"; texto: string } | { tipo: "variable"; indice: number };

/** El texto aprobado partido en tramos literales y variables, en orden. */
export function segmentar(texto: string): Segmento[] {
  const segmentos: Segmento[] = [];
  let desde = 0;
  for (const m of texto.matchAll(VARIABLE)) {
    const inicio = m.index ?? 0;
    if (inicio > desde) segmentos.push({ tipo: "texto", texto: texto.slice(desde, inicio) });
    segmentos.push({ tipo: "variable", indice: Number(m[1]) });
    desde = inicio + m[0].length;
  }
  if (desde < texto.length) segmentos.push({ tipo: "texto", texto: texto.slice(desde) });
  return segmentos;
}

/**
 * Qué termina escrito en el lugar de una variable, para un lead concreto.
 *
 * `falta` y `sin_asignar` son cosas distintas y se dibujan distinto: la
 * primera es un hueco del lead (el dato no está y no hay respaldo); la
 * segunda es un hueco de la configuración (nadie eligió de dónde sale).
 */
export type Resolucion =
  | { tipo: "valor"; campo: CampoVariable; texto: string }
  | { tipo: "respaldo"; campo: CampoVariable; texto: string }
  | { tipo: "falta"; campo: CampoVariable }
  | { tipo: "sin_asignar" };

function dato(valores: ValoresLead | undefined, campo: CampoVariable): string | null {
  const valor = valores?.[campo]?.trim();
  return valor ? valor : null;
}

export function resolverVariable(
  asignacion: AsignacionVariable | undefined,
  valores: ValoresLead | undefined,
): Resolucion {
  if (!asignacion?.campo) return { tipo: "sin_asignar" };
  const { campo } = asignacion;

  const valor = dato(valores, campo);
  if (valor) return { tipo: "valor", campo, texto: valor };

  // Literal: lo que se escribió es lo que sale. No se buscan llaves adentro.
  const respaldo = asignacion.respaldo.trim();
  if (respaldo) return { tipo: "respaldo", campo, texto: respaldo };

  return { tipo: "falta", campo };
}

export type PiezaMensaje =
  | { tipo: "texto"; texto: string }
  | { tipo: "variable"; indice: number; resolucion: Resolucion };

/** El texto tal como le llega a un lead, con cada variable resuelta contra sus datos. */
export function componerTexto(
  texto: string,
  variables: ConfigMensaje["variables"],
  valores: ValoresLead | undefined,
): PiezaMensaje[] {
  return segmentar(texto).map(
    (s): PiezaMensaje =>
      s.tipo === "texto"
        ? s
        : {
            tipo: "variable",
            indice: s.indice,
            resolucion: resolverVariable(variables[s.indice], valores),
          },
  );
}

/**
 * La configuración con la que arranca una plantilla recién elegida.
 *
 * Las variables nacen sin dato a propósito: adivinar que `{{1}}` es el nombre
 * es acertar casi siempre, y el día que no, el mensaje sale con otro dato en
 * ese lugar sin que nadie lo haya elegido. Los botones sí nacen resueltos,
 * porque «que la conteste el agente» es lo que pasa con cualquier respuesta.
 */
export function configInicial(plantilla: Plantilla): ConfigMensaje {
  return {
    plantillaId: plantilla.id,
    variables: Object.fromEntries(
      variablesDe(plantilla.cuerpo).map((n) => [n, { campo: null, respaldo: "" }]),
    ),
    botones: Object.fromEntries(plantilla.botones.map((b) => [b.id, { tipo: "agente" } as const])),
  };
}

export type Disponibilidad =
  | { elegible: true }
  | {
      elegible: false;
      motivo: string;
      /** Con qué código rechaza Meta el envío. `null` si Meta nunca la aceptó. */
      codigo: string | null;
    };

/**
 * Si una plantilla se puede elegir, y si no, por qué.
 *
 * Los códigos y las duraciones de las pausas son los de
 * `docs/prd-workflows-difusion.md` §4.4 y §4.5: `132015` pausada, `132016`
 * deshabilitada, y el pausado escalonado de 3 h → 6 h → deshabilitada.
 */
export function disponibilidad(plantilla: Plantilla): Disponibilidad {
  switch (plantilla.estado) {
    case "aprobada":
      return { elegible: true };
    case "pausada":
      return {
        elegible: false,
        codigo: "132015",
        motivo: plantilla.requiereDespausadoManual
          ? "Meta la pausó y no vuelve sola: hasta que alguien la despause a mano, rechaza cada envío."
          : plantilla.escalonPausado === 2
            ? "Segunda pausa de Meta: dura 6 h, y una tercera la deshabilita."
            : plantilla.escalonPausado === 1
              ? "Primera pausa de Meta: dura 3 h y después vuelve sola."
              : "Meta la pausó: mientras siga así, rechaza cada envío.",
      };
    case "deshabilitada":
      return {
        elegible: false,
        codigo: "132016",
        motivo: "Meta la deshabilitó: no se puede mandar nada con ella.",
      };
    case "en-revision":
      return {
        elegible: false,
        codigo: null,
        motivo: "Meta todavía no la aprobó, y sin aprobación no sale fuera de la ventana.",
      };
    case "rechazada":
      return {
        elegible: false,
        codigo: null,
        motivo: "Meta la rechazó: no se puede mandar con ella.",
      };
    case "otro":
      return {
        elegible: false,
        codigo: null,
        motivo:
          "Meta la informa con un estado que este CRM no traduce: no se sabe si acepta envíos.",
      };
  }
}

export type Pendiente =
  | { tipo: "plantilla" }
  | { tipo: "variable"; indice: number }
  | { tipo: "etiqueta"; boton: string };

/**
 * Lo que falta para poder seguir al pre-vuelo.
 *
 * Un dato que le falta a un lead **no** es un pendiente: depende de a quién le
 * toque. Acá solo entra lo que falta configurar.
 */
export function pendientesMensaje(
  plantilla: Plantilla | null,
  config: ConfigMensaje | null,
): Pendiente[] {
  if (!plantilla || !config || !disponibilidad(plantilla).elegible) return [{ tipo: "plantilla" }];

  const pendientes: Pendiente[] = [];
  for (const indice of variablesDe(plantilla.cuerpo)) {
    if (!config.variables[indice]?.campo) pendientes.push({ tipo: "variable", indice });
  }
  for (const boton of plantilla.botones) {
    const accion = config.botones[boton.id];
    if (accion?.tipo === "etiquetar" && !accion.etiqueta) {
      pendientes.push({ tipo: "etiqueta", boton: boton.texto });
    }
  }
  return pendientes;
}

export function describirPendiente(pendiente: Pendiente): string {
  switch (pendiente.tipo) {
    case "plantilla":
      return "Falta elegir la plantilla";
    case "variable":
      return `Falta el dato de {{${pendiente.indice}}}`;
    case "etiqueta":
      return `Falta la etiqueta de «${pendiente.boton}»`;
  }
}

/** Los datos que le faltan a un lead y no tienen respaldo, en el orden del texto. */
export function camposFaltantes(
  plantilla: Plantilla,
  config: ConfigMensaje,
  valores: ValoresLead | undefined,
): CampoVariable[] {
  const faltan = new Set<CampoVariable>();
  for (const indice of variablesDe(plantilla.cuerpo)) {
    const r = resolverVariable(config.variables[indice], valores);
    if (r.tipo === "falta") faltan.add(r.campo);
  }
  return [...faltan];
}

/** Cuántos de `ids` no tienen el dato. Un id sin entrada en el mapa tampoco lo tiene. */
export function contarSinDato(
  ids: readonly string[],
  valoresPorLead: Readonly<Record<string, ValoresLead>>,
  campo: CampoVariable,
): number {
  return ids.filter((id) => dato(valoresPorLead[id], campo) === null).length;
}

/**
 * Las dos líneas de costo, en la forma que dibuja `CostoEstimado`. Quien tiene
 * la ventana abierta recibe texto libre y no paga (PRD §7.4, "gratis en vez de
 * paga"); el resto paga la tarifa de la categoría.
 *
 * Sin tarifa, lo que se cobra queda en `null` y la línea lo dice: no hay de
 * dónde sacar el precio, y un cero ahí se leería como "gratis". El importe va
 * a centavos, que es lo que se muestra.
 */
export function lineasCostoMensaje(
  categoria: CategoriaPlantilla,
  porVentanaAbierta: number,
  porPlantilla: number,
  tarifa: TarifaPlantilla | null,
): LineaCosto[] {
  const nombre = CATEGORIA_PLANTILLA[categoria].etiqueta.toLowerCase();
  return [
    { cantidad: porVentanaAbierta, concepto: "Ventana de servicio abierta · texto libre", usd: 0 },
    {
      cantidad: porPlantilla,
      concepto: `Plantilla de ${nombre} · ${tarifa ? tarifa.fuente : "sin tarifa"}`,
      usd: tarifa ? Math.round(porPlantilla * tarifa.usdPorMensaje * 100) / 100 : null,
    },
  ];
}

/**
 * El total, o `null` si algo que se cobra no tiene precio: una suma parcial
 * con una línea sin tarifa se leería como el costo entero.
 */
export function totalCosto(lineas: readonly LineaCosto[]): number | null {
  let total = 0;
  for (const l of lineas) {
    if (l.cantidad === 0) continue;
    if (l.usd === null) return null;
    total += l.usd;
  }
  return total;
}
