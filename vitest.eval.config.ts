import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Config de los evals de comportamiento (`tests/evals/**`): llaman a OpenAI de
 * verdad y cuestan centavos por corrida. Trigger explícito, nunca en `npm test`:
 *
 *   npm run test:eval:agente
 *
 * Lee `.env.local` del directorio actual y, si ahí no hay key (un git worktree
 * no copia los archivos ignorados), del de la raíz del repo: el worktree vive en
 * `<raiz>/.claude/worktrees/<id>`. Solo se inyecta `OPENAI_API_KEY`; no se
 * imprime nunca.
 */
export default defineConfig(({ mode }) => {
  const raiz = path.resolve(process.cwd(), "../../..");
  const envLocal = loadEnv(mode, process.cwd(), "");
  const envRaiz = existsSync(path.join(raiz, ".env.local")) ? loadEnv(mode, raiz, "") : {};
  const apiKey = envLocal["OPENAI_API_KEY"] || envRaiz["OPENAI_API_KEY"] || "";

  return {
    test: {
      environment: "node",
      globals: true,
      include: ["tests/evals/**/*.eval.test.ts"],
      exclude: ["**/node_modules/**"],
      testTimeout: 180_000,
      hookTimeout: 60_000,
      env: { OPENAI_API_KEY: apiKey },
    },
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
    },
  };
});
