import type {
  BusquedaSinResultado,
  BusquedasSinResultadoRepository,
} from "@/server/repositories/busquedas-sin-resultado.repo";

/** Las filas de `tool_executions` se borran con la sesión (~29 días): más atrás no hay datos. */
export const DIAS_POR_DEFECTO = 30;
export const LIMITE_POR_DEFECTO = 100;

/**
 * Qué buscaron los clientes que el catálogo no encontró: la lista de lo que
 * falta (siglas, productos). Admin-only; lo exige la función SQL.
 */
export class BusquedasSinResultadoService {
  constructor(
    private readonly repo: BusquedasSinResultadoRepository,
    private readonly ahora: () => Date = () => new Date(),
  ) {}

  async listar(opciones: { dias?: number; limite?: number } = {}): Promise<BusquedaSinResultado[]> {
    const dias = opciones.dias ?? DIAS_POR_DEFECTO;
    const desde = new Date(this.ahora().getTime() - dias * 86_400_000);
    return this.repo.listar(desde, opciones.limite ?? LIMITE_POR_DEFECTO);
  }
}
