// Los tipos globales de Next que antes entraban por `next-env.d.ts`.
//
// `next-env.d.ts` lo reescribe el `next dev` que haya corrido último, e importa
// los tipos de SU directorio de build: con el stack local (`npm run dev:local`)
// apunta a `.next-local/dev/types/routes.d.ts`, que ese dev server reescribe
// mientras corre. Si `tsc` lo leía a mitad de escritura, `npm run typecheck`
// —y el hook de pre-commit— fallaban al azar. `exclude` no alcanza: saca
// archivos del `include`, no los que llegan por un `import`.
//
// Por eso `tsconfig.json` ya no incluye `next-env.d.ts` y las dos referencias
// que el proyecto sí usa viven acá. Los tipos de rutas (`PageProps`,
// `LayoutProps`) no los usa ningún archivo: `typedRoutes` está apagado.
/// <reference types="next" />
/// <reference types="next/image-types/global" />
