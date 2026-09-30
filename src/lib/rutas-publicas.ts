/**
 * Páginas legales que se sirven sin sesión. Meta exige URLs públicas para la
 * política de privacidad, las condiciones y la eliminación de datos. Vive en
 * `lib` porque la consumen el proxy (server-auth) y la navegación (components).
 */
export const RUTAS_PUBLICAS = ["/privacidad", "/condiciones", "/eliminacion-de-datos"] as const;
