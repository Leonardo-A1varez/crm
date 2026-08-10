import { Bolt } from "@/components/icons";
import { NuevaRegla } from "@/components/reglas/NuevaRegla";
import { ToggleActivo } from "@/components/reglas/ToggleActivo";
import { EmptyState } from "@/components/shared/EmptyState";
import { MonoMeta } from "@/components/shared/MonoMeta";
import { PageHeader } from "@/components/shared/PageHeader";
import { getCurrentRol } from "@/server/auth/guards";
import { getReglasAdminServiceForRequest } from "@/server/bootstrap/reglas-bootstrap";
import { crearReglaAction, setReglaActivaAction } from "../_actions/reglas.actions";

export const dynamic = "force-dynamic";

const TIPO_LABEL: Record<string, string> = {
  text: "Texto fijo",
  template: "Plantilla",
  handoff: "Escala a un humano",
};

export default async function ReglasPage() {
  const [rol, svc] = await Promise.all([getCurrentRol(), getReglasAdminServiceForRequest()]);
  const [filas, intents] = await Promise.all([svc.listarReglas(), svc.listarIntents()]);
  const isAdmin = rol === "admin";
  const activos = intents.filter((i) => i.intent.activo).map((i) => i.intent);

  return (
    <div className="bg-surface-root flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Reglas"
        subtitle={`${filas.length} reglas`}
        actions={isAdmin ? <NuevaRegla intents={activos} onCrear={crearReglaAction} /> : null}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filas.length === 0 ? (
          <EmptyState
            icon={<Bolt size={34} strokeWidth={1.4} />}
            title="Sin reglas cargadas"
            description="Una regla contesta sola cuando el clasificador reconoce su intent con confianza, y el turno no llega al LLM."
          />
        ) : (
          <ul className="divide-line-layout divide-y">
            {filas.map(({ regla, intentNombre }) => (
              <li key={regla.id} className="flex items-start gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-ink-primary font-mono text-[12px] font-semibold">
                      {intentNombre}
                    </span>
                    <span className="text-ink-dim bg-surface-avatar rounded px-[6px] py-px text-[10px] font-semibold">
                      {TIPO_LABEL[regla.respuesta_tipo] ?? regla.respuesta_tipo}
                    </span>
                    <MonoMeta>prioridad {regla.prioridad}</MonoMeta>
                  </div>
                  <p className="text-ink-secondary mt-1 text-[12px] break-words whitespace-pre-wrap">
                    {regla.respuesta_contenido}
                  </p>
                </div>
                {isAdmin ? (
                  <ToggleActivo
                    id={regla.id}
                    activo={regla.activa}
                    etiqueta={`regla de ${intentNombre}`}
                    onToggle={setReglaActivaAction}
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
