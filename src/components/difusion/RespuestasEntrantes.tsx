import { Nota } from "./primitivas";

/**
 * Las respuestas a una difusión.
 *
 * Hoy no hay ninguna que mostrar, y no por falta de respuestas: nada registra
 * qué mensaje entrante vino por qué difusión. Una respuesta entra a la Bandeja
 * como cualquier otro mensaje. La pantalla lo dice en vez de mostrar un cero
 * que se leería como "no contestó nadie".
 */
export function RespuestasEntrantes() {
  return (
    <Nota>
      Las respuestas a una difusión todavía no se registran: entran a la Bandeja como cualquier otro
      mensaje, y nada las asocia a esta difusión. Por eso acá no hay conteo de respuestas ni lista.
    </Nota>
  );
}
