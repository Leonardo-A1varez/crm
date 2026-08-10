import { DatabaseSearch } from "@/components/icons";
import { NuevoIntent } from "@/components/reglas/NuevoIntent";
import { ToggleActivo } from "@/components/reglas/ToggleActivo";
import { EmptyState } from "@/components/shared/EmptyState";
import { MonoMeta } from "@/components/shared/MonoMeta";
import { PageHeader } from "@/components/shared/PageHeader";
import { getCurrentRol } from "@/server/auth/guards";
import { getReglasAdminServiceForRequest } from "@/server/bootstrap/reglas-bootstrap";
import { crearIntentAction, setIntentActivoAction } from "../_actions/reglas.actions";

export const dynamic = "force-dynamic";

export default async function IntentsPage() {
  const [rol, svc] = await Promise.all([getCurrentRol(), getReglasAdminServiceForRequest()]);
  const filas = await svc.listarIntents();
  const isAdmin = rol === "admin";

  return (
    <div className="bg-surface-root flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Intents"
        meta={`${filas.length} intents`}
        actions={isAdmin ? <NuevoIntent onCrear={crearIntentAction} /> : null}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filas.length === 0 ? (
          <EmptyState
            icon={<DatabaseSearch size={34} strokeWidth={1.4} />}
            title="Sin intents cargados"
            description="Mientras esta tabla esté vacía, cada mensaje —incluido un saludo— pasa por el LLM. Un intent con su regla resuelve el turno sin llamar al modelo."
          />
        ) : (
          <ul className="divide-line-layout divide-y">
            {filas.map(({ intent, reglasActivas, reglasTotales }) => (
              <li key={intent.id} className="flex items-start gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-ink-primary font-mono text-[12.5px] font-semibold">
                      {intent.nombre}
                    </span>
                    {intent.auto_detectado ? (
                      <span className="text-info bg-info/12 rounded px-1 py-px font-mono text-[9px] tracking-wide uppercase">
                        detectado por la IA
                      </span>
                    ) : null}
                  </div>
                  {intent.descripcion ? (
                    <p className="text-ink-dim mt-0.5 text-[11.5px]">{intent.descripcion}</p>
                  ) : null}
                  <MonoMeta className="mt-1 block">
                    {intent.ejemplos.length} ejemplos · {reglasActivas}/{reglasTotales} reglas
                    activas
                  </MonoMeta>
                </div>
                {isAdmin ? (
                  <ToggleActivo
                    id={intent.id}
                    activo={intent.activo}
                    etiqueta={`intent ${intent.nombre}`}
                    onToggle={setIntentActivoAction}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
