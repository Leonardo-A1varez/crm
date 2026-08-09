import { AgenteConsola } from "./_components/AgenteConsola";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { MonoMeta } from "@/components/shared/MonoMeta";
import { getCurrentRol } from "@/server/auth/guards";
import { getAgenteConfigServiceForRequest } from "@/server/bootstrap/agente-bootstrap";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";

export const dynamic = "force-dynamic";

export default async function AgentePage() {
  const [rol, agenteSvc, inboxSvc] = await Promise.all([
    getCurrentRol(),
    getAgenteConfigServiceForRequest(),
    getInboxServiceForRequest(),
  ]);

  const [configActiva, historial, activos] = await Promise.all([
    agenteSvc.activa(),
    agenteSvc.historial(),
    inboxSvc.listActiveLeads(),
  ]);

  // Sesiones candidatas para "Previsualizar": las mismas que ve /inbox, no un
  // listado propio — reusar `listActiveLeads` evita una segunda fuente de
  // verdad sobre "qué sesión existe" dentro de la misma pantalla.
  const sesiones = activos.map((i) => ({ id: i.sessionId, etiqueta: i.nombre }));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-line-layout flex items-center justify-between border-b px-5 py-4">
        <div>
          <Eyebrow>Agente IA</Eyebrow>
          <h1 className="text-ink-primary mt-0.5 text-[17px] font-semibold">Consola del agente</h1>
        </div>
        {configActiva ? (
          <MonoMeta>
            v{configActiva.version} · {configActiva.modelo}
          </MonoMeta>
        ) : null}
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        {configActiva ? (
          <AgenteConsola
            configActiva={configActiva}
            historial={historial}
            sesiones={sesiones}
            esAdmin={rol === "admin"}
          />
        ) : (
          // Defensivo: la migración inicial siembra una fila activa (Task 5),
          // así que esto no debería ocurrir en producción. Si pasa, mejor un
          // mensaje claro que una página en blanco o un crash de tipos.
          <p className="text-ink-faint text-[12.5px]">
            No hay una configuración activa del agente. Contactá a soporte.
          </p>
        )}
      </div>
    </div>
  );
}
