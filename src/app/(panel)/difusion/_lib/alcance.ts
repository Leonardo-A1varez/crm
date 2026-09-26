import { fechaLegibleEnZona } from "@/lib/zona-horaria";
import type {
  AlcanceAudiencia,
  Cupo,
  DiffContraAnterior,
  TandaReparto,
} from "@/components/difusion";
import type { Alcance } from "@/server/services/difusion/difusion.service";

export interface VistaAlcance {
  audiencia: AlcanceAudiencia;
  cupo: Cupo;
  tandas: TandaReparto[];
  diff: DiffContraAnterior | null;
  /** Cuándo se calculó, en la hora del negocio. */
  calculado: string;
}

/**
 * El alcance que devuelve `calcularAlcanceAction`, en la forma del asistente.
 *
 * No recalcula nada: destinatarios, exclusiones, rutas, cupo y tandas son los
 * del planificador. Lo único que hace es escribir las fechas en la hora del
 * negocio. Separado de `vistas.ts` porque lo usa el asistente, que es un
 * componente de cliente, y ese módulo arrastra la traducción de Ajustes.
 */
export function vistaAlcance(a: Alcance, tz: string): VistaAlcance {
  return {
    audiencia: {
      coinciden: a.audienciaInicial,
      destinatarios: a.destinatarios,
      exclusiones: a.exclusiones,
      porVentanaAbierta: a.porRuta.ventana_abierta,
      porPlantilla: a.porRuta.plantilla,
      porTextoLibre: a.porContenido.texto_libre,
      muestra: a.muestra,
      categoriaSupuesta: a.categoriaSupuesta,
    },
    cupo: a.cupo,
    tandas: a.tandas.map((t) => ({ ...t, desde: fechaLegibleEnZona(tz, new Date(t.desde)) })),
    diff: a.diff,
    calculado: fechaLegibleEnZona(tz, new Date(a.calculadoAt)),
  };
}
