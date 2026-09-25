import { InMemoryDifusionEnviosRepository } from "@/server/repositories/difusion-envios.repo";
import { hasherBajasEfimero } from "@/server/repositories/difusion-supresiones.hash";
import {
  InMemoryDifusionSupresionesRepository,
  type AlmacenSupresionesEnMemoria,
  type SesionSimulada,
} from "@/server/repositories/difusion-supresiones.repo";
import { InMemoryDifusionesRepository } from "@/server/repositories/difusiones.repo";
import { runDifusionEnviosContract } from "../repositories/difusion-envios.contract";
import {
  runDifusionSupresionesContract,
  type MakeDifusionSupresionesRepo,
} from "../repositories/difusion-supresiones.contract";
import { runDifusionesContract } from "../repositories/difusiones.contract";

runDifusionesContract(() => new InMemoryDifusionesRepository());

runDifusionEnviosContract(() => new InMemoryDifusionEnviosRepository());

/**
 * Todos los repos de una fábrica comparten filas, como los procesos que usan
 * la misma tabla: la rotación se prueba con un repo por configuración de claves.
 */
function fabricaEnMemoria(sesion?: SesionSimulada): MakeDifusionSupresionesRepo {
  const almacen: AlmacenSupresionesEnMemoria = new Map();
  const porDefecto = hasherBajasEfimero();
  return (hasher) =>
    new InMemoryDifusionSupresionesRepository({ almacen, sesion, hasher: hasher ?? porDefecto });
}

// Sin persona: es lo que ve el motor con service-role. La base rechaza la
// reactivación y el in-memory tiene que rechazarla igual.
runDifusionSupresionesContract(fabricaEnMemoria(), { comoAdmin: false });

runDifusionSupresionesContract(
  fabricaEnMemoria({ usuarioId: "00000000-0000-4000-8000-00000000a001", rol: "admin" }),
  { comoAdmin: true },
);
