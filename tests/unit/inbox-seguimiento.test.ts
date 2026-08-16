import { describe, expect, test } from "vitest";
import type { InboxItem } from "@/types/inbox";

/**
 * El filtro de Seguimiento del panel de la bandeja.
 *
 * La lógica vive en `PanelLista`, que es un componente de cliente y no se
 * renderiza en esta suite. Lo que se clava acá es la **regla**: a quién deja
 * pasar y en qué orden. Si mañana alguien la reescribe adentro del componente,
 * estos tests siguen siendo la definición de qué tiene que hacer.
 */

function item(nombre: string, recordarEn: Date | null): InboxItem {
  return {
    leadId: `lead-${nombre}`,
    sessionId: `sess-${nombre}`,
    nombre,
    currentStage: "nuevo",
    iaPausada: false,
    ultimaActividad: new Date(2026, 7, 20, 10, 0),
    ultimoMensaje: null,
    canales: ["wa"],
    canalActivo: "wa",
    sinResponder: 0,
    esperandoDesde: null,
    urgencia: "media",
    motivo: null,
    recordatorio: recordarEn ? { at: recordarEn, nota: "" } : null,
  };
}

/** Misma regla que aplica `PanelLista` en el modo Seguimiento. */
function soloConSeguimientoOrdenados(items: InboxItem[]): InboxItem[] {
  return items
    .filter((i) => i.recordatorio !== null)
    .sort((a, b) => a.recordatorio!.at.getTime() - b.recordatorio!.at.getTime());
}

describe("filtro de Seguimiento", () => {
  const AYER = new Date(2026, 7, 19, 18, 0);
  const HOY = new Date(2026, 7, 20, 16, 0);
  const MANANA = new Date(2026, 7, 21, 9, 0);
  const PASADO = new Date(2026, 7, 22, 9, 0);

  test("deja fuera a los que no tienen nada agendado", () => {
    const lista = [item("Ana", MANANA), item("Beto", null), item("Cami", PASADO)];

    expect(soloConSeguimientoOrdenados(lista).map((i) => i.nombre)).toEqual(["Ana", "Cami"]);
  });

  // Lo que pidió el dueño: el de mañana antes que el de pasado mañana.
  test("ordena del más próximo al más lejano", () => {
    const lista = [item("Pasado", PASADO), item("Manana", MANANA), item("Hoy", HOY)];

    expect(soloConSeguimientoOrdenados(lista).map((i) => i.nombre)).toEqual([
      "Hoy",
      "Manana",
      "Pasado",
    ]);
  });

  // Un seguimiento atrasado es el más urgente de todos, y el orden ascendente
  // lo pone arriba sin necesidad de una regla aparte.
  test("los vencidos quedan primeros", () => {
    const lista = [item("Manana", MANANA), item("Vencido", AYER), item("Hoy", HOY)];

    expect(soloConSeguimientoOrdenados(lista)[0]?.nombre).toBe("Vencido");
  });

  test("sin seguimientos la lista queda vacía", () => {
    expect(soloConSeguimientoOrdenados([item("Ana", null)])).toEqual([]);
  });

  // El contador es el aviso: cuenta leads, no recordatorios, y por eso sale de
  // la lista completa y no de la filtrada por canal.
  test("el contador cuenta los leads con seguimiento", () => {
    const lista = [item("Ana", MANANA), item("Beto", null), item("Cami", AYER)];

    expect(lista.filter((i) => i.recordatorio !== null).length).toBe(2);
  });
});
