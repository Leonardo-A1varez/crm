import { ValidationError } from "@/lib/errors";
import type {
  CampaniaInsert,
  CampaniaUpdate,
  CampaniasRepository,
} from "@/server/repositories/campanias.repo";
import type { Campania, UUID } from "@/types/entities";

export interface CampaniasAdminService {
  listar(): Promise<Campania[]>;
  crear(input: CampaniaInsert): Promise<Campania>;
  editar(id: UUID, patch: CampaniaUpdate): Promise<Campania>;
  borrar(id: UUID): Promise<void>;
}

/** Rango inválido es error de negocio, no solo del formulario: la API se llama también desde fuera del form. */
function validarRango(desde: Date, hasta: Date): void {
  if (hasta <= desde) {
    throw new ValidationError(
      "la fecha de fin tiene que ser posterior a la de inicio",
      "campania_rango_invalido",
    );
  }
}

export class DefaultCampaniasAdminService implements CampaniasAdminService {
  constructor(private readonly deps: { campanias: CampaniasRepository }) {}

  async listar(): Promise<Campania[]> {
    const campanias = await this.deps.campanias.list();
    return [...campanias].sort((a, b) => b.desde.getTime() - a.desde.getTime());
  }

  async crear(input: CampaniaInsert): Promise<Campania> {
    validarRango(input.desde, input.hasta);
    return this.deps.campanias.create(input);
  }

  async editar(id: UUID, patch: CampaniaUpdate): Promise<Campania> {
    if (patch.desde !== undefined && patch.hasta !== undefined) {
      validarRango(patch.desde, patch.hasta);
    } else if (patch.desde !== undefined || patch.hasta !== undefined) {
      const actual = await this.deps.campanias.findById(id);
      if (!actual) throw new ValidationError("campaña no encontrada", "campania_no_encontrada");
      validarRango(patch.desde ?? actual.desde, patch.hasta ?? actual.hasta);
    }
    return this.deps.campanias.update(id, patch);
  }

  async borrar(id: UUID): Promise<void> {
    await this.deps.campanias.delete(id);
  }
}
