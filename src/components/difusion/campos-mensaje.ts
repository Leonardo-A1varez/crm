import type { CampoVariable } from "./tipos";

interface DescriptorCampo {
  id: CampoVariable;
  etiqueta: string;
  /** Encabezado del desplegable: se busca en el bloque y no en la lista entera. */
  grupo: string;
}

/**
 * Los datos del lead que pueden completar una variable de plantilla.
 *
 * Cada uno sale de una columna que existe hoy, anotada al lado. Es la promesa
 * que el motor de envío tiene que cumplir: si una variable apunta a un dato
 * que el modelo no guarda, sale vacía para todos los destinatarios.
 *
 * **No hay «vendedor asignado».** El modelo no tiene ninguna columna que le
 * asigne un vendedor a un lead, así que no hay de dónde leer ese nombre.
 *
 * La etiqueta tiene que leerse sola, sin el grupo al lado ("Modelo del
 * vehículo" y no "Modelo"), porque también aparece suelta: en el aviso de la
 * vista previa y en la cuenta de quién no tiene el dato.
 */
export const CAMPOS_VARIABLE: readonly DescriptorCampo[] = [
  // `leads.nombre`: lo escribe la casa, y nace vacío.
  { id: "nombre", etiqueta: "Nombre", grupo: "Lead" },
  // `leads.nombre_perfil`: como se llama a sí mismo en WhatsApp.
  { id: "nombre_perfil", etiqueta: "Nombre de WhatsApp", grupo: "Lead" },
  // `lead_vehiculos`, el marcado como `principal`.
  { id: "vehiculo_marca", etiqueta: "Marca del vehículo", grupo: "Vehículo principal" },
  { id: "vehiculo_modelo", etiqueta: "Modelo del vehículo", grupo: "Vehículo principal" },
  { id: "vehiculo_anio", etiqueta: "Año del vehículo", grupo: "Vehículo principal" },
  // `lead_session.consulta` de la sesión activa. Una sesión cerrada se purga a
  // los 29 días y se lleva el dato: en una audiencia de inactivos, este campo
  // va a faltar más que ningún otro.
  { id: "consulta", etiqueta: "Lo que consultó", grupo: "Sesión" },
];

export function etiquetaCampo(id: CampoVariable): string {
  return CAMPOS_VARIABLE.find((c) => c.id === id)?.etiqueta ?? id;
}
