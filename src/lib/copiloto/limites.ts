/**
 * Largo máximo de un borrador: el mismo que acepta `abrirChat` del puente de
 * escritorio (`LARGO_MAXIMO_TEXTO`, `desktop/src/main/seguridad.ts`) y el límite
 * del composer (`SendMessageSchema`). Un borrador más largo no se puede enviar
 * por ningún camino.
 */
export const LARGO_MAXIMO_BORRADOR = 4096;
