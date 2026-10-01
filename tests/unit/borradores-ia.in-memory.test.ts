import { InMemoryBorradoresIaRepository } from "@/server/repositories/borradores-ia.repo";
import {
  runBorradoresIaContract,
  type BorradoresIaContractFixtures,
} from "../repositories/borradores-ia.contract";

// Qué entrante es el último de cada conversación: el InMemory no tiene la tabla
// `mensajes`, así que la consulta del RPC se inyecta (mismo idioma que
// `resolverLeadId` del repo de mensajes).
const ultimoPorConversacion = new Map<string, string>();
let actual: BorradoresIaContractFixtures;

function fixtures(): BorradoresIaContractFixtures {
  ultimoPorConversacion.clear();
  const f: BorradoresIaContractFixtures = {
    conversacionId: crypto.randomUUID(),
    otraConversacionId: crypto.randomUUID(),
    leadSessionId: crypto.randomUUID(),
    otraLeadSessionId: crypto.randomUUID(),
    usuarioId: crypto.randomUUID(),
    reglaId: crypto.randomUUID(),
    primerEntranteId: crypto.randomUUID(),
    entranteDeOtraId: crypto.randomUUID(),
    nuevoEntrante: async () => {
      const id = crypto.randomUUID();
      ultimoPorConversacion.set(f.conversacionId, id);
      return id;
    },
  };
  ultimoPorConversacion.set(f.conversacionId, f.primerEntranteId);
  ultimoPorConversacion.set(f.otraConversacionId, f.entranteDeOtraId);
  actual = f;
  return f;
}

// Las FK de la base (conversación, sesión, regla, usuario) se simulan con los
// ids de las fixtures: cualquier otro uuid "no existe", como en Postgres.
runBorradoresIaContract(
  () =>
    new InMemoryBorradoresIaRepository(
      (conversacionId) => ultimoPorConversacion.get(conversacionId) ?? null,
      {
        conversacionExiste: (id) =>
          id === actual.conversacionId || id === actual.otraConversacionId,
        leadSessionExiste: (id) => id === actual.leadSessionId || id === actual.otraLeadSessionId,
        reglaExiste: (id) => id === actual.reglaId,
        usuarioExiste: (id) => id === actual.usuarioId,
      },
    ),
  fixtures,
);
