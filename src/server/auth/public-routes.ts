import { RUTAS_PUBLICAS } from "@/lib/rutas-publicas";

export { RUTAS_PUBLICAS };

/** True si la ruta se sirve sin sesión; el resto del panel sigue protegido (`src/proxy.ts`). */
export function esRutaPublica(pathname: string): boolean {
  const limpio = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return (RUTAS_PUBLICAS as readonly string[]).includes(limpio);
}
