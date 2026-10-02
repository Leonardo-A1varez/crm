# Lecciones de proceso

Movido desde `AGENTS.md` §2 para mantener ese archivo corto. Aplicables a todo lo que
siga; casi todas vienen de bugs que sólo aparecieron con uso real, no con tests.

1. Los defectos de layout no se encuentran leyendo diffs: se miden en el navegador.
2. El review de rama completa encuentra lo que los reviews por tarea no pueden (código
   construido, testeado y sin un solo consumidor).
3. Un mock que acepta cualquier schema esconde incompatibilidades con la API real; y una
   suite de contrato que nadie corre no es una red — se verifica corriéndola, no
   leyéndola.
4. No correr `npm run build` con el dev server levantado: corrompe `.next/`.
5. Los briefs no se regeneran solos: si se corrige el plan a mitad de ejecución, hay que
   volver a extraer el brief.
6. Con el panel del navegador sin componer frames (`document.hidden`), React no revela
   los boundaries de Suspense — se puede medir igual pidiendo el HTML del server por
   `fetch` e inyectando la raíz de la página en el slot del panel.
7. Verificar por uso, no por existencia: un componente que no aparece importado en
   ninguna pantalla no está hecho.
8. Un número en un comentario es una afirmación de hecho que nadie va a re-chequear: o se
   deja el comando que lo produce, o no se escribe el número.
9. Con un agente trabajando en el árbol, `git add` va con rutas explícitas, nunca `-A`
   (ídem `git commit -a`, `git stash` sin `--`).
10. Los integration tests corren contra el stack local, nunca contra `crm-dev`:
    `npm run test:integration:local` (`scripts/con-stack-local.mjs` aborta si alguna URL
    no es de loopback). `npm run test:integration` a secas sigue prohibido.
11. Un wrapper de lock no prueba exclusión mutua: una transición multi-tabla crítica
    comparte transacción y locks en Postgres, no sólo una interfaz con nombre correcto.
12. PostgREST corta en 1.000 filas y no avisa: un `.list()` sin `.range()` explícito
    miente sobre el total en cuanto la tabla crece, y filtrar en memoria lo que la DB
    puede filtrar cambia el resultado, no sólo la velocidad.
13. Un fixture vacío puede tapar un bug que sólo aparece con datos: los campos que viven
    fuera del snapshot que ve el LLM necesitan instrucción explícita.
14. La única prueba que vale de un cambio de comportamiento es dispararlo de verdad:
    `curl` al dev server de Inngest con el evento real + `SELECT` a Supabase cierra el
    lazo entero sin tocar WhatsApp.
15. El MCP `mcp__supabase__*` de esta máquina no es crm-dev: apunta a otro proyecto
    (`fgqjwxpayndfeilzexid`). crm-dev (`emubzkouwvuzlrtsgorx`) se toca por el CLI
    enlazado o se lee con `mcp__plugin_supabase_supabase__execute_sql` pasando ese
    `project_id`.
16. No se aplican migraciones mientras haya un agente que pueda estar escribiendo una:
    primero se frena a los agentes, después `supabase db push --dry-run`, se compara la
    lista y recién ahí se aplica.
17. `npm run db:gen-types` falla con `Unauthorized` en esta máquina.
    `scripts/gen-types.mjs` escribe a un temporal y sólo reemplaza si el CLI salió con 0.
    Mientras el CLI no autentique, los tipos se generan con `generate_typescript_types`
    del MCP de solo lectura y se copian a mano.
18. Next 16 imprimía en el log de dev los argumentos de las Server Actions, contraseñas
    incluidas. Se apagó con `logging: { serverFunctions: false }` en `next.config.ts`
    (`tests/unit/next-config.test.ts`).
19. El typecheck se volvía inestable con el dev server del stack local corriendo:
    `tsconfig.json` ya no incluye `next-env.d.ts` y excluye `.next-local`; las dos
    referencias globales de Next viven en `src/types/next-globales.d.ts`.
20. Un test que falla de a ratos por carga no se arregla subiendo el timeout a ciegas:
    `cargaPesada()` (`tests/helpers/carga-pesada.ts`) lo paga una vez por archivo con
    `TIMEOUT_CARGA_PESADA_MS`.
21. Stack local aislado: Supabase en Docker (API 55321, Postgres 55322), la app en 3002,
    Inngest en 8298, mock de la Graph API en 55390. `.env.local` no se cuela.
    `supabase db reset --local` falla siempre por una migración: se usa
    `npm run stack:reset`. Cómo levantarlo → `docs/runbooks/como-correr-el-crm.md` §4.1.
