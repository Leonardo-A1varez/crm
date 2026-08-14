import { NotFoundError } from "@/lib/errors";
import type { LeadIdentificadoresRepository } from "@/server/repositories/lead-identificadores.repo";
import type { LeadsRepository } from "@/server/repositories/leads.repo";
import type { MergeCandidatesRepository } from "@/server/repositories/merge-candidates.repo";
import { CERTEZA_IDENTIFICADOR } from "@/types/domain";
import type { IdentificadorTipo } from "@/types/domain";
import type { MergeCandidate, UUID } from "@/types/entities";

/**
 * Qué suma que además se llamen igual.
 *
 * El nombre nunca dispara una propuesta por sí solo —hay cientos de "Carlos
 * Gómez"— pero si dos leads ya comparten un teléfono, llamarse igual confirma.
 */
const BONUS_MISMO_NOMBRE = 0.05;

export interface DetectCandidatesInput {
  leadId: UUID;
}

export interface CandidateProposal {
  src_lead_id: UUID;
  dst_lead_id: UUID;
  similarity_score: number;
  reasons: string[];
}

export interface LeadMergeDetectorService {
  // Detecta candidates para un lead específico sin persistir. Caller decide
  // si llamar `recordCandidate` por cada match.
  findCandidatesFor(input: DetectCandidatesInput): Promise<CandidateProposal[]>;
  recordCandidate(proposal: CandidateProposal): Promise<MergeCandidate | null>;
}

/**
 * Propone fusiones a partir de identificadores compartidos.
 *
 * La versión anterior exigía nombre exacto, canales distintos y que alguno de
 * los dos leads tuviera menos de 7 días. Fallaba de las dos maneras posibles:
 * proponía a cualquier par de homónimos, y no encontraba a la misma persona si
 * escribía dos veces por el mismo canal o si el duplicado tenía ocho días.
 * Además descartaba el par cuando los vehículos no coincidían, con lo cual una
 * persona con dos autos quedaba partida en dos leads para siempre.
 *
 * Ahora la señal es compartir algo que no se comparte por casualidad: un VIN,
 * un RUC, una placa, un teléfono o un correo. El nombre solo suma certeza.
 */
export class DefaultLeadMergeDetectorService implements LeadMergeDetectorService {
  constructor(
    private readonly leads: LeadsRepository,
    private readonly candidates: MergeCandidatesRepository,
    private readonly identificadores: LeadIdentificadoresRepository,
  ) {}

  async findCandidatesFor(input: DetectCandidatesInput): Promise<CandidateProposal[]> {
    const target = await this.leads.findById(input.leadId);
    if (!target) {
      throw new NotFoundError(`lead no encontrado: ${input.leadId}`, "lead", input.leadId);
    }

    const coincidencias = await this.identificadores.findCoincidencias(target.id);
    const out: CandidateProposal[] = [];

    for (const coincidencia of coincidencias) {
      if (coincidencia.leadId === target.id) continue;
      if (coincidencia.tipos.length === 0) continue;

      const other = await this.leads.findById(coincidencia.leadId);
      // Sin el lead no se puede evaluar el nombre ni mostrar la propuesta. La
      // FK con CASCADE lo hace improbable; es defensa, no un caso esperado.
      if (!other) continue;

      const existing = await this.candidates.findAnyPair(target.id, other.id);
      if (existing && (existing.status === "approved" || existing.status === "pending")) continue;

      const mismoNombre =
        normalize(target.nombre).length > 0 && normalize(target.nombre) === normalize(other.nombre);

      out.push({
        src_lead_id: target.id,
        dst_lead_id: other.id,
        similarity_score: puntaje(coincidencia.tipos, mismoNombre),
        reasons: motivos(coincidencia.tipos, mismoNombre),
      });
    }

    return out;
  }

  async recordCandidate(proposal: CandidateProposal): Promise<MergeCandidate | null> {
    const existing = await this.candidates.findAnyPair(proposal.src_lead_id, proposal.dst_lead_id);
    // pending = dedup; rejected = decisión humana, no insistir. approved no
    // sobrevive (CASCADE al borrar el perdedor); superseded es re-proponible.
    if (existing && (existing.status === "pending" || existing.status === "rejected")) {
      return null;
    }
    return this.candidates.create({
      src_lead_id: proposal.src_lead_id,
      dst_lead_id: proposal.dst_lead_id,
      similarity_score: proposal.similarity_score,
      reasons: proposal.reasons,
    });
  }
}

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * El más fuerte de los tipos compartidos, más el bonus del nombre.
 *
 * Se toma el máximo y no la suma: compartir el VIN ya es certeza, y sumarle el
 * teléfono no la hace mayor que 1. Lo que cambia la decisión es el tipo más
 * confiable, no cuántos coincidan.
 */
function puntaje(tipos: readonly IdentificadorTipo[], mismoNombre: boolean): number {
  const mejor = Math.max(...tipos.map((t) => CERTEZA_IDENTIFICADOR[t]));
  return Math.min(1, mejor + (mismoNombre ? BONUS_MISMO_NOMBRE : 0));
}

/** Por qué se propuso, en el orden en que se lee: lo más fuerte primero. */
function motivos(tipos: readonly IdentificadorTipo[], mismoNombre: boolean): string[] {
  const ordenados = [...tipos].sort(
    (a, b) => CERTEZA_IDENTIFICADOR[b] - CERTEZA_IDENTIFICADOR[a] || a.localeCompare(b),
  );
  const out = ordenados.map((t) => `mismo_${t}`);
  if (mismoNombre) out.push("mismo_nombre");
  return out;
}
