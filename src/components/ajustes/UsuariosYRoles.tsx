import { Done, Remove } from "@/components/icons";
import {
  EmpresaErpDelUsuario,
  type AsignarEmpresaDeUsuario,
} from "@/components/ajustes/EmpresaErpDelUsuario";
import { SeccionAjuste } from "@/components/ajustes/SeccionAjuste";
import { InitialsAvatar } from "@/components/shared/InitialsAvatar";

export const ROLES = ["admin", "vendedor"] as const;
export type Rol = (typeof ROLES)[number];

export const ROL_LABEL: Record<Rol, string> = {
  admin: "Administrador",
  vendedor: "Vendedor",
};

/**
 * La última vez que alguien entró. Tres casos y no dos: "nunca entró" es un
 * dato, y "no se sabe" es otro. Mostrar el segundo como el primero le dice a
 * quien reparte accesos que una persona que entra todos los días no usa el
 * sistema.
 */
export type UltimoAcceso =
  | { estado: "conocido"; texto: string }
  | { estado: "nunca" }
  | { estado: "sin-dato" };

export interface UsuarioDelPanel {
  id: string;
  nombre: string;
  email: string;
  rol: Rol;
  ultimoAcceso: UltimoAcceso;
  activo: boolean;
  /** La empresa del ERP (1, 3, 5 o 6): su columna de precio se le resalta en /productos. */
  empresaErp?: number | null;
}

function textoDeAcceso(acceso: UltimoAcceso): string {
  switch (acceso.estado) {
    case "conocido":
      return acceso.texto;
    case "nunca":
      return "nunca entró";
    case "sin-dato":
      return "sin dato";
  }
}

/**
 * Qué puede hacer cada rol, en las palabras de la pantalla y no en las de la
 * base.
 *
 * Sale de las políticas RLS que ya están aplicadas (`docs/data-model.md`), no
 * de una idea de lo que debería pasar. Está escrito acá porque un rol llamado
 * "vendedor" no dice nada por sí solo: al momento de asignárselo a alguien, la
 * pregunta es qué va a poder tocar, y esa respuesta hoy vive en un archivo SQL
 * que quien reparte los accesos no lee.
 */
const PERMISOS: readonly { que: string; admin: boolean; vendedor: boolean }[] = [
  { que: "Leer y responder conversaciones", admin: true, vendedor: true },
  { que: "Editar leads, sesiones y etiquetas", admin: true, vendedor: true },
  { que: "Subir comprobantes de pago", admin: true, vendedor: true },
  { que: "Ver el catálogo, los intents y las reglas", admin: true, vendedor: true },
  { que: "Editar el catálogo, los intents y las reglas", admin: true, vendedor: false },
  { que: "Configurar el agente y publicar flujos", admin: true, vendedor: false },
  { que: "Fusionar y eliminar leads", admin: true, vendedor: false },
  { que: "Administrar usuarios y ajustes", admin: true, vendedor: false },
];

/**
 * El equipo, leído de la tabla `usuarios`. Invitar, cambiar un rol o desactivar
 * tocan `auth.users` y no existen todavía. Lo único que un admin edita acá es la
 * empresa del ERP de cada usuario.
 */
export function UsuariosYRoles({
  usuarios,
  asignarEmpresa = null,
}: {
  usuarios: readonly UsuarioDelPanel[];
  /** Solo para un admin: sin ella, la empresa del ERP se muestra y no se edita. */
  asignarEmpresa?: AsignarEmpresaDeUsuario | null;
}) {
  const algunoSinDato = usuarios.some((u) => u.ultimoAcceso.estado === "sin-dato");

  return (
    <div className="flex max-w-[900px] flex-col gap-3.5">
      <SeccionAjuste
        titulo="Usuarios"
        extra={`${usuarios.length}`}
        nota={
          algunoSinDato
            ? "Cada cuenta de acceso nueva aparece acá. El último acceso todavía no se muestra: por eso dice «sin dato»."
            : "Cada cuenta de acceso nueva aparece acá."
        }
      >
        {usuarios.length === 0 ? (
          <p className="text-ink-faint text-[11.5px]">La tabla usuarios no tiene ninguna fila.</p>
        ) : (
          <ul className="flex flex-col">
            {usuarios.map((u) => (
              <li
                key={u.id}
                className="border-line-row flex items-center gap-3 border-b py-2.5 first:pt-0 last:border-b-0 last:pb-0"
              >
                <InitialsAvatar nombre={u.nombre} size={28} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-ink-primary truncate text-[12px] font-[650]">
                    {u.nombre}
                    {u.activo ? null : (
                      <span className="text-ink-ghost font-normal"> · desactivado</span>
                    )}
                  </span>
                  <span className="text-ink-faint truncate font-mono text-[10.5px]">{u.email}</span>
                </span>
                <span className="bg-surface-input text-ink-secondary shrink-0 rounded-[6px] px-2 py-1 text-[10.5px] leading-none font-semibold">
                  {ROL_LABEL[u.rol]}
                </span>
                <EmpresaErpDelUsuario
                  usuarioId={u.id}
                  nombre={u.nombre}
                  empresaErp={u.empresaErp ?? null}
                  asignar={asignarEmpresa}
                />
                <span className="text-ink-ghost w-[104px] shrink-0 text-right font-mono text-[10.5px] tabular-nums">
                  {textoDeAcceso(u.ultimoAcceso)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SeccionAjuste>

      <SeccionAjuste
        titulo="Qué puede hacer cada rol"
        nota="Lo aplica la base con políticas por fila, no la interfaz. Un vendedor que llegue a una pantalla que no le toca ve el error de permiso, no una pantalla vacía."
      >
        <table className="w-full">
          <thead>
            <tr className="border-line-row border-b">
              <th className="text-ink-faint pb-2 text-left font-mono text-[9px] font-semibold tracking-[0.08em] uppercase">
                acción
              </th>
              {ROLES.map((rol) => (
                <th
                  key={rol}
                  className="text-ink-faint w-[104px] pb-2 text-center font-mono text-[9px] font-semibold tracking-[0.08em] uppercase"
                >
                  {rol}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISOS.map((p) => (
              <tr key={p.que} className="border-line-row border-b last:border-b-0">
                <td className="text-ink-secondary py-2 text-[11.5px]">{p.que}</td>
                <td className="py-2 text-center">
                  <Marca puede={p.admin} />
                </td>
                <td className="py-2 text-center">
                  <Marca puede={p.vendedor} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SeccionAjuste>
    </div>
  );
}

/**
 * Puede o no puede. Tilde contra guión, no verde contra rojo: en una grilla de
 * dos columnas por ocho filas, la forma se escanea mucho más rápido que el
 * tono, y el texto alternativo dice la palabra para quien no ve ninguno de los
 * dos.
 */
function Marca({ puede }: { puede: boolean }) {
  return puede ? (
    <>
      <Done size={13} strokeWidth={2.5} className="inline" style={{ color: "var(--color-ok)" }} />
      <span className="sr-only">puede</span>
    </>
  ) : (
    <>
      <Remove size={13} strokeWidth={2.5} className="text-ink-ghost inline" />
      <span className="sr-only">no puede</span>
    </>
  );
}
