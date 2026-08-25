/**
 * Cómo este proyecto decide que un valor de configuración es un relleno y no
 * una credencial de verdad.
 *
 * Vive suelto y no adentro de quien lo usa por una razón concreta: durante
 * meses `makeCostTracker` tuvo esta lógica **privada**, y `makeRateLimiterFromEnv`
 * —que necesitaba exactamente la misma decisión— sólo miraba si el valor
 * estaba vacío. Las dos fábricas leen las mismas dos variables de Upstash y
 * se comportaban distinto ante el mismo escenario: una degradaba con un warn,
 * la otra construía un cliente Redis contra un host inexistente y tumbaba el
 * webhook de Meta con 500, haciendo que Meta reintentara en loop.
 *
 * El defecto no fue descuido: fue que la regla no se podía compartir. Por eso
 * ahora es un módulo y no una copia.
 *
 * Un valor cuenta como placeholder si está vacío, si dice `placeholder`, o si
 * arranca con `test-`. Ese último caso cubre los fixtures de los tests, que
 * no deben abrir conexiones reales.
 */
export function esPlaceholder(value: string | undefined): boolean {
  return !value || value.includes("placeholder") || value.startsWith("test-");
}
