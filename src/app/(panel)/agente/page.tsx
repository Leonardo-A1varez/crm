import { PageHeader } from "@/components/shared/PageHeader";
import { estaAbierto } from "@/lib/agente/horario";
import { getCurrentRol } from "@/server/auth/guards";
import { getAgenteConfigServiceForRequest } from "@/server/bootstrap/agente-bootstrap";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
import { getReglasAdminServiceForRequest } from "@/server/bootstrap/reglas-bootstrap";
import { AgenteConsola } from "./_components/AgenteConsola";
import { PanelEstadoAgente } from "./_components/PanelEstadoAgente";
import { esTabAgente } from "./_components/tabs";

export const dynamic = "force-dynamic";

export default async function AgentePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const params = await searchParams;
  const pedida = typeof params.tab === "string" ? params.tab : undefined;
  // `reglas` primero: es la pestaña que reemplaza al ítem "Intents y reglas"
  // de la nav, así que es la que tiene que estar arriba al entrar.
  const tabInicial = esTabAgente(pedida) ? pedida : "reglas";

  const [rol, agenteSvc, inboxSvc, reglasSvc] = await Promise.all([
    getCurrentRol(),
    getAgenteConfigServiceForRequest(),
    getInboxServiceForRequest(),
    getReglasAdminServiceForRequest(),
  ]);

  const [configActiva, historial, activos, intents, reglas] = await Promise.all([
    agenteSvc.activa(),
    agenteSvc.historial(),
    inboxSvc.listActiveLeads(),
    reglasSvc.listarIntents(),
    reglasSvc.listarReglas(),
  ]);

  // Sesiones candidatas para "Previsualizar": las mismas que ve /inbox, no un
  // listado propio — reusar `listActiveLeads` evita una segunda fuente de
  // verdad sobre "qué sesión existe" dentro de la misma pantalla.
  const sesiones = activos.map((i) => ({ id: i.sessionId, etiqueta: i.nombre }));

  // Se resuelve en el server: `estaAbierto` depende de la timezone configurada
  // y calcularlo en el cliente daría un estado distinto en el primer render.
  const abierto =
    configActiva !== null
      ? estaAbierto(configActiva.horario, configActiva.horario_timezone, new Date())
      : false;

  return (
    <div className="bg-surface-root flex h-full flex-col overflow-hidden">
      <PageHeader
        title="OpenAI settings"
        subtitle="Reglas, escalado y límites del vendedor automático"
        actions={
          configActiva ? (
            <PanelEstadoAgente
              abierto={abierto}
              version={configActiva.version}
              modelo={configActiva.modelo}
            />
          ) : null
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {configActiva ? (
          <AgenteConsola
            configActiva={configActiva}
            historial={historial}
            sesiones={sesiones}
            esAdmin={rol === "admin"}
            intents={intents}
            reglas={reglas}
            tabInicial={tabInicial}
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
