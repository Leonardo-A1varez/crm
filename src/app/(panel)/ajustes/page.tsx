import {
  AvisoLectura,
  DatosEmpresa,
  HorarioAtencion,
  PESTANAS_AJUSTES,
  PanelSalud,
  PantallaAjustes,
  TopesSeguridad,
  UsuariosYRoles,
} from "@/components/ajustes";
import { getLogger } from "@/lib/observability/get-logger";
import { getCurrentRol } from "@/server/auth/guards";
import { getAgenteConfigServiceForRequest } from "@/server/bootstrap/agente-bootstrap";
import {
  getEmpresaServiceForRequest,
  getRegistrosWhatsAppServiceForRequest,
  getSaludWhatsAppService,
} from "@/server/bootstrap/ajustes-bootstrap";
import { getUsuariosServiceForRequest } from "@/server/bootstrap/usuarios-bootstrap";
import { getWorkflowsAdminServiceForRequest } from "@/server/bootstrap/workflows-bootstrap";
import { asignarEmpresaErpAction } from "./_actions/empresa-erp.action";
import { guardarRolNumeroAction } from "./_actions/rol-numero.action";
import { leerSeccion } from "./_lib/leer-seccion";
import { NOTA_SANCIONES } from "./_lib/politica-meta";
import {
  textoFueraDeHorario,
  vistaEmpresa,
  vistaHorario,
  vistaSaltos,
  vistaSalud,
  vistaUsuarios,
  type RegistrosDeLaBase,
  type VistaSalud,
} from "./_lib/vistas";
import type { Lectura, PestanaAjustes } from "@/components/ajustes";
import type { Logger } from "@/lib/observability/logger";
import type { AgenteConfig } from "@/types/agente";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

/**
 * De dónde sale cada pestaña, sin datos de ejemplo:
 *
 *   - Salud de WhatsApp → Graph API de Meta, sólo GET, con el token del
 *     servidor (`getSaludWhatsAppService`). Lo que Meta no expone por API
 *     sale de la base (`getRegistrosWhatsAppServiceForRequest`): la escalera
 *     de sanciones de los webhooks `account_update`, el uso del cupo de los
 *     envíos propios y el rol que el admin le pone a cada número.
 *   - Empresa → tabla `empresas`. La zona horaria es la del agente.
 *   - Usuarios y roles → tabla `usuarios`.
 *   - Horario de atención → `agente_config` activa (horario + timezone).
 *   - Topes de seguridad → `agente_config` activa (tope de mensajes por lead)
 *     y `contar_saltos_workflow` (mensajes saltados en 7 días, contados en la
 *     base).
 *
 * Cada lectura falla por su lado y la pestaña dibuja el motivo en su lugar.
 */

/**
 * El horario y el tope de mensajes automáticos se editan en la consola del
 * agente, pestaña Límites: ahí está el versionado de esa configuración.
 */
const EDITOR_DE_LIMITES = {
  href: "/agente?tab=limites",
  texto: "Editar en Agente › Límites y costo",
};

/** La ventana de "Mensajes saltados". */
const DIAS_DE_SALTOS = 7;

function esPestanaAjustes(v: string | undefined): v is PestanaAjustes {
  return (PESTANAS_AJUSTES as readonly string[]).includes(v ?? "");
}

function zonaDe(agente: Lectura<AgenteConfig | null>): string | null {
  return agente.estado === "ok" && agente.datos !== null ? agente.datos.horario_timezone : null;
}

/**
 * Lo que la salud lee de la base, cada cosa por su lado: que no se pueda
 * calcular el uso no apaga la escalera, ni al revés.
 */
async function leerRegistros(zona: string, logger: Logger): Promise<RegistrosDeLaBase> {
  const servicio = await getRegistrosWhatsAppServiceForRequest();
  const [sanciones, uso, roles] = await Promise.all([
    leerSeccion("sanciones", () => servicio.sanciones(), logger),
    leerSeccion("uso-cupo", () => servicio.usoDelCupo(zona), logger),
    leerSeccion("roles-numeros", () => servicio.roles(), logger),
  ]);
  return { sanciones, uso, roles };
}

async function contenidoDe(
  pestana: PestanaAjustes,
  ctx: {
    salud: VistaSalud;
    agente: Lectura<AgenteConfig | null>;
    esAdmin: boolean;
    logger: Logger;
  },
): Promise<ReactNode> {
  const { salud, agente, esAdmin, logger } = ctx;

  switch (pestana) {
    case "salud":
      return (
        <PanelSalud
          cupo={salud.cupo}
          escalones={salud.escalones}
          posicion={salud.posicion}
          historial={salud.historial}
          notaHistorial={salud.notaHistorial}
          envio={salud.envio}
          notaSanciones={NOTA_SANCIONES}
          numeros={salud.numeros}
          guardarRol={esAdmin ? guardarRolNumeroAction : null}
          plantillas={salud.plantillas}
          fuente={salud.fuente}
        />
      );

    case "empresa": {
      const empresa = await leerSeccion(
        "empresa",
        async () => (await getEmpresaServiceForRequest()).obtener(),
        logger,
      );
      if (empresa.estado !== "ok") return <AvisoLectura titulo="Empresa" lectura={empresa} />;
      return (
        <DatosEmpresa
          datos={vistaEmpresa(empresa.datos, zonaDe(agente))}
          hrefZonaHoraria={EDITOR_DE_LIMITES.href}
        />
      );
    }

    case "usuarios": {
      const usuarios = await leerSeccion(
        "usuarios",
        async () => (await getUsuariosServiceForRequest()).listar(),
        logger,
      );
      if (usuarios.estado !== "ok") return <AvisoLectura titulo="Usuarios" lectura={usuarios} />;
      return (
        <UsuariosYRoles
          usuarios={vistaUsuarios(usuarios.datos)}
          asignarEmpresa={esAdmin ? asignarEmpresaErpAction : null}
        />
      );
    }

    case "horario": {
      if (agente.estado !== "ok") {
        return <AvisoLectura titulo="Horario de atención" lectura={agente} />;
      }
      if (agente.datos === null) {
        return (
          <AvisoLectura
            titulo="Horario de atención"
            lectura={{
              estado: "no-disponible",
              motivo: "No hay una configuración activa del agente, que es donde vive el horario.",
            }}
          />
        );
      }
      return (
        <HorarioAtencion
          franjas={vistaHorario(agente.datos.horario)}
          zonaHoraria={agente.datos.horario_timezone}
          fueraDeHorario={textoFueraDeHorario(agente.datos.plantilla_fuera_horario)}
          editarEn={EDITOR_DE_LIMITES}
        />
      );
    }

    case "topes": {
      const saltos = await leerSeccion(
        "topes",
        async () =>
          vistaSaltos(
            await (await getWorkflowsAdminServiceForRequest()).saltosRecientes(DIAS_DE_SALTOS),
          ),
        logger,
      );
      const maximoPorLead: Lectura<number> =
        agente.estado !== "ok"
          ? agente
          : agente.datos === null
            ? {
                estado: "no-disponible",
                motivo:
                  "No hay una configuración activa del agente, que es donde vive el tope de mensajes por lead.",
              }
            : { estado: "ok", datos: agente.datos.max_salientes_automaticos_24h };
      return (
        <TopesSeguridad
          maximoPorLead={maximoPorLead}
          editarEn={EDITOR_DE_LIMITES}
          saltos={saltos}
        />
      );
    }
  }
}

export default async function AjustesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const params = await searchParams;
  const pedida = typeof params.tab === "string" ? params.tab : undefined;
  // `salud` por defecto: es la única pestaña que decide si mañana se puede
  // vender. El razonamiento completo está en el encabezado de `PantallaAjustes`.
  const pestana: PestanaAjustes = esPestanaAjustes(pedida) ? pedida : "salud";
  const logger = getLogger({ scope: "ajustes" });

  // La salud se lee en las cuatro pestañas porque el badge de la suya está en
  // todas. La config del agente, porque de ella sale la zona horaria.
  const [salud, agente, rol] = await Promise.all([
    getSaludWhatsAppService().leer(),
    leerSeccion("agente", async () => (await getAgenteConfigServiceForRequest()).activa(), logger),
    getCurrentRol(),
  ]);
  const zona = zonaDe(agente) ?? "UTC";
  const vista = vistaSalud(salud, zona, await leerRegistros(zona, logger));
  const contenido = await contenidoDe(pestana, {
    salud: vista,
    agente,
    esAdmin: rol === "admin",
    logger,
  });

  return (
    <div className="bg-surface-root flex h-full flex-col overflow-hidden">
      <PantallaAjustes
        pestana={pestana}
        hrefPestana={(p) => `/ajustes?tab=${p}`}
        pendientesDeSalud={vista.pendientes}
      >
        {contenido}
      </PantallaAjustes>
    </div>
  );
}
