import { beforeAll } from "vitest";

/**
 * Cuánto se le da a una carga pesada de un test: el `import()` del grafo del
 * motor (`@/inngest/bootstrap`, `tests/smoke/smoke-bootstrap`: todos los repos
 * de Supabase, los servicios y las funciones de Inngest, más inngest, ai,
 * supabase-js y pino) o recorrer los archivos de `src/` para leerlos.
 *
 * No es un bug: es el tamaño del grafo, y cada archivo de test lo vuelve a
 * cargar en su worker. Lo que lo vuelve lento es la competencia por CPU: la
 * suite completa corre un worker por núcleo, y el hook `pre-commit` corre
 * además `tsc` dos veces y lint-staged en paralelo (`lefthook.yml`).
 *
 * Medido el 2026-09-25 en la máquina del dueño (16 núcleos):
 *
 * | carga                                      | solo   | suite  | suite + tsc + eslint |
 * | ------------------------------------------ | ------ | ------ | -------------------- |
 * | `import("@/inngest/bootstrap")`            | 2,2 s  | 9,8 s  | 14,0 s               |
 * | leer los 661 `.ts/.tsx` de `src/` (1 vez)  | 0,24 s | —      | 7,7 s                |
 *
 * Solo:        npx vitest run --reporter=verbose tests/unit/workflows/registro-puertos-completos.test.ts
 * Suite:       npx vitest run --reporter=verbose
 * Con carga:   `npm run typecheck` y `npx eslint src tests` en segundo plano, y la suite.
 * La tabla sale de las duraciones que imprime `--reporter=verbose` (la de la
 * lectura de `src/`, de su test en `registro-unico.test.ts` antes de mudarla a
 * un `beforeAll`).
 *
 * Con el default de 5 s fallaron el caso del bootstrap (2 de 4 corridas de la
 * suite, medido antes) y el recorrido de `src/` (con carga). 30 s es el doble
 * del peor caso medido.
 *
 * Los tests que importan el grafo con un `import` estático no lo necesitan: ese
 * costo se paga al cargar el archivo, fuera de cualquier timeout de test o de
 * hook. Son `registro-unico`, `disponibilidad`, `inngest/bootstrap`,
 * `inngest-functions-factory` y el smoke `inbound-recv-loop`.
 */
export const TIMEOUT_CARGA_PESADA_MS = 30_000;

/**
 * Corre `cargar` una sola vez por archivo, en un `beforeAll` con
 * `TIMEOUT_CARGA_PESADA_MS`, y devuelve con qué leer el resultado. Se llama en
 * el nivel del archivo o de un `describe`, nunca adentro de un test.
 *
 * Una sola vez y no por test: el costo es el mismo en cada llamada, y pagarlo
 * en cada test lo multiplica sin probar nada nuevo.
 */
export function cargaPesada<T>(cargar: () => Promise<T> | T): () => T {
  let cargado: { valor: T } | undefined;
  beforeAll(async () => {
    cargado = { valor: await cargar() };
  }, TIMEOUT_CARGA_PESADA_MS);
  return () => {
    if (!cargado) {
      throw new Error("cargaPesada: se leyó antes de que corriera su beforeAll");
    }
    return cargado.valor;
  };
}
