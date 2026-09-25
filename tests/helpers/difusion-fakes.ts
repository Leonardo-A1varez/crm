import type { AudienciaCompilada } from "@/lib/difusion/audiencia";
import type {
  CandidatoResuelto,
  DifusionAudienciaRepository,
} from "@/server/repositories/difusion-audiencia.repo";

/**
 * Doble de test del resolver de audiencia: devuelve candidatos fijos y
 * recuerda qué audiencias le pidieron. No evalúa el árbol a propósito —eso lo
 * hace el SQL y se prueba contra Postgres—; acá se prueba lo que el servicio
 * hace con lo que coincide.
 */
export class FakeDifusionAudienciaRepository implements DifusionAudienciaRepository {
  readonly pedidas: AudienciaCompilada[] = [];

  constructor(
    public candidatos: CandidatoResuelto[] = [],
    public usoCupo = 0,
  ) {}

  async resolver(audiencia: AudienciaCompilada, _ahora: Date): Promise<CandidatoResuelto[]> {
    this.pedidas.push(audiencia);
    return this.candidatos.map((c) => ({ ...c }));
  }

  async usoCupoDesde(_desde: Date): Promise<number> {
    return this.usoCupo;
  }
}

/** Id con forma de UUID v4, armado a mano para los tests. */
export function leadIdDe(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

/** Teléfono E.164 inventado, sin `+`. */
export function telefonoDe(n: number): string {
  return `5939${n.toString().padStart(8, "0")}`;
}

/** Un lead de la audiencia, sin sesión, sin entrantes y sin salientes. */
export function candidato(n: number, over: Partial<CandidatoResuelto> = {}): CandidatoResuelto {
  return {
    leadId: leadIdDe(n),
    nombre: `Lead ${n}`,
    telefono: telefonoDe(n),
    etapaActiva: null,
    ultimoEntranteAt: null,
    salientesAutomaticos24h: 0,
    vehiculo: null,
    ...over,
  };
}
