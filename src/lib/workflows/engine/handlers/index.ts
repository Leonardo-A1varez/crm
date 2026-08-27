/**
 * Registro centralizado de handlers.
 *
 * Importa este módulo para que todos los handlers queden registrados.
 * Llamar a `inicializarHandlers()` una vez al arrancar la aplicación.
 */

export { registrarHandler, obtenerHandler, tieneHandler, tiposConHandler } from "./registro";
export type { Handler, ResultadoHandler } from "./registro";

import { registrarHandlersTrigger } from "./trigger";
import { registrarHandlersMensajeria } from "./mensajeria";
import { registrarHandlersCrm } from "./crm";
import { registrarHandlersLogica } from "./logica";
import { registrarHandlersIntegracion } from "./integracion";
import { registrarHandlersIa } from "./ia";
import { registrarHandlersInterno } from "./interno";

let inicializado = false;

/**
 * Registra todos los handlers disponibles.
 * Seguro de llamar múltiples veces — solo ejecuta la primera vez.
 */
export function inicializarHandlers(): void {
  if (inicializado) return;

  registrarHandlersTrigger();
  registrarHandlersMensajeria();
  registrarHandlersCrm();
  registrarHandlersLogica();
  registrarHandlersIntegracion();
  registrarHandlersIa();
  registrarHandlersInterno();

  inicializado = true;
}
