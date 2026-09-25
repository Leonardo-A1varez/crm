/**
 * La cadena de disparos entre flujos: cuántos saltos hubo desde el hecho que
 * vino de afuera del motor (un mensaje, una persona en el panel, el cron) hasta
 * este disparo.
 *
 * ## El problema
 *
 * Una acción de una corrida puede emitir un disparo que arranca otra corrida:
 * hoy "Asignar vendedor" y "Round Robin" emiten "vendedor asignado". Dos flujos
 * "Vendedor asignado" que le pasan el lead cada uno a otra persona se arrancan
 * entre sí sin fin. Ninguna protección previa lo ataja:
 *
 * - `max_pasos` es por corrida, y cada vuelta del bucle es una corrida nueva de
 *   dos pasos.
 * - La concurrencia `ignorar` sólo frena si la corrida anterior del mismo flujo
 *   sigue viva cuando llega el disparo, y un flujo que reasigna y termina ya no
 *   lo está.
 * - La deduplicación de Inngest usa la hora de la asignación, que es nueva en
 *   cada vuelta.
 *
 * ## El corte
 *
 * El disparo lleva `profundidad` (`DispararWorkflowInput`): ausente o 0 si nace
 * afuera del motor; la de la corrida que lo emite más uno si nace de una
 * acción. La corrida guarda la suya en el contexto (`MARCA_PROFUNDIDAD_CADENA`)
 * para pasarla a lo que emita. `arrancarPorDisparador` no arranca un disparo
 * más profundo que `MAX_PROFUNDIDAD_CADENA`: deja por cada flujo que habría
 * arrancado una corrida cancelada con `MOTIVO_CADENA_CORTADA`, que es lo que ve
 * el dueño en el historial de ese flujo.
 *
 * El corte vive en el receptor y no en cada emisor: cualquier disparador que
 * el motor emita en el futuro queda cubierto con sólo mandar la profundidad.
 */

import type { ContextoRun } from "@/types/workflows";

/**
 * Cuántos saltos de flujo a flujo se permiten. Una corrida arrancada por algo
 * de afuera es profundidad 0; la que arranca su acción, 1; y así. Con 5 corren
 * hasta 6 corridas encadenadas y la séptima se corta.
 *
 * Por qué 5 es criterio, no medición: no hay flujos de clientes con qué
 * contar. Los disparadores que emite el motor son eventos del lead (etiqueta,
 * etapa, vendedor), y una cadena que no vuelve sobre sus pasos tiene pocos
 * saltos antes de repetir un evento (ejemplo inventado: reparte → el flujo del
 * vendedor etiqueta → el de la etiqueta mueve la etapa, 3 saltos). 5 deja
 * margen sobre eso y acota un bucle a 6 corridas encadenadas: cada vuelta es
 * una reasignación o un mensaje, y los mensajes además los frena el tope de
 * salientes por 24 h. Más alto sólo alarga cuánto tarda en cortarse un error
 * de configuración.
 *
 * Ojo con el abanico: si varios flujos escuchan el mismo disparo, cada nivel
 * puede arrancar más de una corrida. El límite corta la profundidad, no el
 * ancho; el ancho lo ponen cuántos flujos publicados hay.
 */
export const MAX_PROFUNDIDAD_CADENA = 5;

/**
 * Dónde guarda la corrida su profundidad, en `workflow_runs.contexto`. Clave
 * con `$`, como `$prueba`: no la alcanza ninguna variable ni ningún campo de
 * condición. Sin la marca, la corrida es profundidad 0.
 */
export const MARCA_PROFUNDIDAD_CADENA = "$cadena";

/** Lo que queda en `workflow_runs.error` de la corrida que no arrancó. */
export const MOTIVO_CADENA_CORTADA =
  `No arrancó: la cadena de flujos que se disparan entre sí pasó el límite de ` +
  `${MAX_PROFUNDIDAD_CADENA} saltos. Probablemente dos flujos se disparan ` +
  `mutuamente (por ejemplo, dos «Vendedor asignado» que reasignan).`;

/** La profundidad de una corrida. Un valor que no sea entero no negativo cuenta como 0. */
export function profundidadDeContexto(contexto: ContextoRun): number {
  const valor = contexto[MARCA_PROFUNDIDAD_CADENA];
  return typeof valor === "number" && Number.isInteger(valor) && valor >= 0 ? valor : 0;
}

/** Si un disparo con esta profundidad ya no arranca corridas. */
export function excedeCadena(profundidad: number): boolean {
  return profundidad > MAX_PROFUNDIDAD_CADENA;
}

/**
 * El contexto de la corrida que arranca con esta profundidad. En 0 no agrega la
 * marca: lo que arranca desde afuera del motor queda igual que siempre.
 */
export function conProfundidad(contexto: ContextoRun, profundidad: number): ContextoRun {
  return profundidad > 0 ? { ...contexto, [MARCA_PROFUNDIDAD_CADENA]: profundidad } : contexto;
}
