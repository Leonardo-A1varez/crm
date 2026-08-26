import { NodoDisparador } from "./NodoDisparador";
import { NodoAccion } from "./NodoAccion";
import { NodoCondicion } from "./NodoCondicion";
import { NodoEspera } from "./NodoEspera";
import { NodoFin } from "./NodoFin";

export const nodeTypes = {
  disparador: NodoDisparador,
  accion: NodoAccion,
  condicion: NodoCondicion,
  espera: NodoEspera,
  fin: NodoFin,
} as const;

export { NodoBase } from "./NodoBase";
