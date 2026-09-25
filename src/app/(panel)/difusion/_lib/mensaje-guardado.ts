import { campoDeToken, tokenDeCampo, type ParametroPlantilla } from "@/lib/difusion/parametros";
import {
  configInicial,
  variablesDe,
  type ConfigMensaje,
  type Plantilla,
} from "@/components/difusion";

/**
 * De lo que se elige en el paso «Mensaje» a lo que se guarda en
 * `difusiones.plantilla_parametros`, y de vuelta. Funciones puras, con test
 * (`tests/unit/difusion/mensaje-guardado.test.ts`).
 *
 * Lo guardado usa la sintaxis de variables de los workflows (`{{lead.nombre}}`)
 * y lo resuelve el mismo `interpolarVariables` en el motor de envío. En
 * pantalla se sigue eligiendo de una lista: nadie escribe la variable.
 */

/**
 * Una entrada por `{{n}}` del cuerpo, en orden. `null` si alguna variable no
 * tiene dato elegido: eso lo bloquea `pendientesMensaje` antes de guardar.
 */
export function parametrosDesdeConfig(
  plantilla: Plantilla,
  config: ConfigMensaje,
): ParametroPlantilla[] | null {
  const numeros = [...new Set(variablesDe(plantilla.cuerpo))].sort((a, b) => a - b);
  const parametros: ParametroPlantilla[] = [];
  for (const n of numeros) {
    const asignacion = config.variables[n];
    if (!asignacion?.campo) return null;
    parametros.push({
      valor: tokenDeCampo(asignacion.campo),
      respaldo: asignacion.respaldo.trim(),
    });
  }
  return parametros;
}

/** La configuración del paso «Mensaje» a partir de lo que ya estaba guardado. */
export function configDesdeGuardada(
  plantilla: Plantilla,
  parametros: readonly ParametroPlantilla[],
): ConfigMensaje {
  const base = configInicial(plantilla);
  const numeros = [...new Set(variablesDe(plantilla.cuerpo))].sort((a, b) => a - b);
  const variables = { ...base.variables };
  numeros.forEach((n, i) => {
    const guardado = parametros[i];
    const campo = guardado ? campoDeToken(guardado.valor) : null;
    variables[n] = campo
      ? { campo, respaldo: guardado?.respaldo ?? "" }
      : { campo: null, respaldo: "" };
  });
  return { ...base, variables };
}
