import { AvisoLectura } from "@/components/ajustes/AvisoLectura";
import { EscaleraSanciones } from "@/components/ajustes/EscaleraSanciones";
import { MedidorCupo } from "@/components/ajustes/MedidorCupo";
import type { GuardarRolDeNumero } from "@/components/ajustes/RolDelNumero";
import { TablaNumeros } from "@/components/ajustes/TablaNumeros";
import { TablaPlantillas } from "@/components/ajustes/TablaPlantillas";
import type {
  EnvioSegunMeta,
  EscalonSancion,
  EstadoCupo,
  EventoDeSancion,
  Lectura,
  NumeroWhatsApp,
  PlantillaMeta,
  PosicionEnEscalera,
} from "@/components/ajustes/tipos";

/**
 * El panel de salud de WhatsApp.
 *
 * El orden de arriba hacia abajo es el orden en que se pierde la capacidad de
 * vender, no el orden en que los datos salen de la API:
 *
 *   1. Cupo — cuánto podés mandar hoy y qué hace falta para poder mandar más.
 *   2. Sanciones — qué tan cerca estás de no poder mandar nada.
 *   3. Números — de dónde sale cada cosa.
 *   4. Plantillas — qué está frenado ahora mismo.
 *
 * Cupo y sanciones van arriba y lado a lado porque son las dos caras del mismo
 * riesgo: una mide el techo, la otra el piso. Números y plantillas van a lo
 * ancho porque son tablas y una tabla angosta se lee mal.
 *
 * Cada bloque llega por su lado. Si Meta no devolvió uno, en su lugar va el
 * motivo y los demás se dibujan igual: una lectura caída no apaga el panel.
 */
export function PanelSalud({
  cupo,
  escalones,
  posicion,
  historial,
  notaHistorial,
  envio,
  notaSanciones,
  numeros,
  guardarRol,
  plantillas,
  fuente,
}: {
  cupo: Lectura<EstadoCupo>;
  escalones: readonly EscalonSancion[];
  posicion: PosicionEnEscalera;
  historial: readonly EventoDeSancion[];
  notaHistorial: string | null;
  /** El `health_status` agregado de la cuenta. */
  envio: EnvioSegunMeta;
  notaSanciones: string;
  numeros: Lectura<{ numeros: readonly NumeroWhatsApp[]; nota: string | null }>;
  /** `null` si quien mira no es admin. */
  guardarRol: GuardarRolDeNumero | null;
  plantillas: Lectura<{ plantillas: readonly PlantillaMeta[]; nota: string | null }>;
  /** De dónde y cuándo se leyó todo esto. */
  fuente: string;
}) {
  return (
    <div className="flex max-w-[1120px] flex-col gap-3.5">
      <div className="grid grid-cols-[1.25fr_1fr] items-start gap-3.5">
        {cupo.estado === "ok" ? (
          <MedidorCupo estado={cupo.datos} />
        ) : (
          <AvisoLectura titulo="Nivel del portfolio" lectura={cupo} />
        )}
        <EscaleraSanciones
          escalones={escalones}
          posicion={posicion}
          historial={historial}
          notaHistorial={notaHistorial}
          envio={envio}
          nota={notaSanciones}
        />
      </div>

      {numeros.estado === "ok" ? (
        <TablaNumeros
          numeros={numeros.datos.numeros}
          nota={numeros.datos.nota}
          guardarRol={guardarRol}
        />
      ) : (
        <AvisoLectura titulo="Números" lectura={numeros} />
      )}

      {plantillas.estado === "ok" ? (
        <TablaPlantillas plantillas={plantillas.datos.plantillas} nota={plantillas.datos.nota} />
      ) : (
        <AvisoLectura titulo="Plantillas sincronizadas desde Meta" lectura={plantillas} />
      )}

      <p className="text-ink-ghost text-[10.5px] leading-relaxed">{fuente}</p>
    </div>
  );
}
