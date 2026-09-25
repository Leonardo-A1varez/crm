import { describe, expect, test } from "vitest";
import { ValidationError } from "@/lib/errors";
import {
  elegirVendedorRoundRobin,
  type CandidatoRoundRobin,
  type EleccionRoundRobin,
  type HistorialVendedor,
} from "@/lib/round-robin";

const ANA = "vendedor-ana";
const BETO = "vendedor-beto";
const CAMI = "vendedor-cami";

const T0 = new Date("2026-09-01T12:00:00.000Z");

/** `m` minutos después de T0 (negativo = antes). */
function minuto(m: number): Date {
  return new Date(T0.getTime() + m * 60_000);
}

function disponibles(...ids: string[]): CandidatoRoundRobin[] {
  return ids.map((id) => ({ id, disponible: true }));
}

function recibio(vendedorId: string, cuando: Date, sesionesAbiertas = 0): HistorialVendedor {
  return { vendedorId, ultimaAsignacionAt: cuando, sesionesAbiertas };
}

function elegido(vendedorId: string): EleccionRoundRobin {
  return { tipo: "elegido", vendedorId };
}

const SIN_TOPE = { tope: null };

describe("elegirVendedorRoundRobin", () => {
  describe("a quién le toca", () => {
    test("si nadie recibió todavía, al primero de la lista", () => {
      expect(elegirVendedorRoundRobin(disponibles(BETO, ANA, CAMI), [], SIN_TOPE)).toEqual(
        elegido(BETO),
      );
    });

    test("al que hace más tiempo que no recibe", () => {
      const historial = [
        recibio(ANA, minuto(10)),
        recibio(BETO, minuto(5)),
        recibio(CAMI, minuto(7)),
      ];
      expect(elegirVendedorRoundRobin(disponibles(ANA, BETO, CAMI), historial, SIN_TOPE)).toEqual(
        elegido(BETO),
      );
    });

    test("el que nunca recibió le gana a cualquiera que ya recibió", () => {
      // ANA recibió hace diez horas, pero CAMI no recibió nunca: le toca a CAMI
      // aunque esté última en la lista.
      const historial = [recibio(ANA, minuto(-600)), recibio(BETO, minuto(5))];
      expect(elegirVendedorRoundRobin(disponibles(ANA, BETO, CAMI), historial, SIN_TOPE)).toEqual(
        elegido(CAMI),
      );
    });

    test("con la misma fecha desempata el orden de la lista", () => {
      const historial = [recibio(ANA, minuto(5)), recibio(BETO, minuto(5))];
      expect(elegirVendedorRoundRobin(disponibles(BETO, ANA), historial, SIN_TOPE)).toEqual(
        elegido(BETO),
      );
      expect(elegirVendedorRoundRobin(disponibles(ANA, BETO), historial, SIN_TOPE)).toEqual(
        elegido(ANA),
      );
    });

    test("el orden en que llega el historial no cambia la elección", () => {
      const a = recibio(ANA, minuto(9));
      const b = recibio(BETO, minuto(3));
      const c = recibio(CAMI, minuto(3));
      const candidatos = disponibles(CAMI, ANA, BETO);
      // BETO y CAMI empatan en el minuto 3; CAMI va antes en la lista.
      for (const historial of [
        [a, b, c],
        [c, b, a],
        [b, a, c],
      ]) {
        expect(elegirVendedorRoundRobin(candidatos, historial, SIN_TOPE)).toEqual(elegido(CAMI));
      }
    });
  });

  describe("saltea a los que no están", () => {
    test("un no disponible no recibe aunque le tocara", () => {
      // ANA no recibió nunca y encabeza la lista: sería la primera. No está.
      const candidatos = [
        { id: ANA, disponible: false },
        { id: BETO, disponible: true },
      ];
      expect(elegirVendedorRoundRobin(candidatos, [recibio(BETO, minuto(5))], SIN_TOPE)).toEqual(
        elegido(BETO),
      );
    });

    test("si no hay nadie disponible no elige y dice por qué", () => {
      const candidatos = [
        { id: ANA, disponible: false },
        { id: BETO, disponible: false },
      ];
      expect(elegirVendedorRoundRobin(candidatos, [], SIN_TOPE)).toEqual({
        tipo: "sin_vendedor",
        motivo: "ninguno_disponible",
      });
    });

    test("una lista vacía no es lo mismo que nadie disponible", () => {
      expect(elegirVendedorRoundRobin([], [], SIN_TOPE)).toEqual({
        tipo: "sin_vendedor",
        motivo: "sin_candidatos",
      });
    });
  });

  describe("tope por persona", () => {
    test("el que llegó al tope se saltea aunque sea el que más espera", () => {
      const historial = [recibio(ANA, minuto(1), 3), recibio(BETO, minuto(5), 0)];
      expect(elegirVendedorRoundRobin(disponibles(ANA, BETO), historial, { tope: 3 })).toEqual(
        elegido(BETO),
      );
    });

    test("por debajo del tope sigue en la rotación", () => {
      const historial = [recibio(ANA, minuto(1), 2), recibio(BETO, minuto(5), 0)];
      expect(elegirVendedorRoundRobin(disponibles(ANA, BETO), historial, { tope: 3 })).toEqual(
        elegido(ANA),
      );
    });

    test("sin tope la carga no importa", () => {
      const historial = [recibio(ANA, minuto(1), 500), recibio(BETO, minuto(5), 0)];
      expect(elegirVendedorRoundRobin(disponibles(ANA, BETO), historial, SIN_TOPE)).toEqual(
        elegido(ANA),
      );
    });

    test("quien no tiene historial no tiene carga: entra aunque el tope sea 1", () => {
      expect(elegirVendedorRoundRobin(disponibles(ANA), [], { tope: 1 })).toEqual(elegido(ANA));
    });

    test("si todos los disponibles están en el tope no elige", () => {
      const historial = [recibio(ANA, minuto(1), 2), recibio(BETO, minuto(5), 2)];
      expect(elegirVendedorRoundRobin(disponibles(ANA, BETO), historial, { tope: 2 })).toEqual({
        tipo: "sin_vendedor",
        motivo: "todos_en_tope",
      });
    });

    test("con unos ausentes y el resto lleno, el motivo es el tope", () => {
      // Lo que hay que resolver es la capacidad: los que están no dan abasto.
      const candidatos = [
        { id: ANA, disponible: false },
        { id: BETO, disponible: true },
      ];
      expect(
        elegirVendedorRoundRobin(candidatos, [recibio(BETO, minuto(5), 1)], { tope: 1 }),
      ).toEqual({ tipo: "sin_vendedor", motivo: "todos_en_tope" });
    });

    test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      "un tope de %s es un error de configuración",
      (tope) => {
        expect(() => elegirVendedorRoundRobin(disponibles(ANA), [], { tope })).toThrow(
          ValidationError,
        );
      },
    );
  });

  describe("entradas que no son las ideales", () => {
    test("el historial de vendedores fuera de la lista no influye", () => {
      const historial = [
        recibio("otro-vendedor", minuto(-1000), 99),
        recibio(ANA, minuto(5)),
        recibio(BETO, minuto(9)),
      ];
      expect(elegirVendedorRoundRobin(disponibles(ANA, BETO), historial, { tope: 1 })).toEqual(
        elegido(ANA),
      );
    });

    test("un candidato repetido vale lo que dice su primera aparición", () => {
      // La segunda aparición de ANA dice que está disponible; la primera, que no.
      const candidatos = [
        { id: ANA, disponible: false },
        { id: BETO, disponible: true },
        { id: ANA, disponible: true },
      ];
      expect(elegirVendedorRoundRobin(candidatos, [recibio(BETO, minuto(5))], SIN_TOPE)).toEqual(
        elegido(BETO),
      );
    });

    test("dos entradas del mismo vendedor se combinan: cuenta la más reciente", () => {
      // Mirando solo la primera, ANA habría recibido antes que BETO; su última
      // asignación fue en el minuto 9.
      const historial = [
        recibio(ANA, minuto(1)),
        recibio(ANA, minuto(9)),
        recibio(BETO, minuto(5)),
      ];
      expect(elegirVendedorRoundRobin(disponibles(ANA, BETO), historial, SIN_TOPE)).toEqual(
        elegido(BETO),
      );
    });

    test("dos entradas del mismo vendedor suman sus sesiones abiertas", () => {
      const historial = [
        recibio(ANA, minuto(1), 1),
        recibio(ANA, minuto(1), 1),
        recibio(BETO, minuto(5), 0),
      ];
      expect(elegirVendedorRoundRobin(disponibles(ANA, BETO), historial, { tope: 2 })).toEqual(
        elegido(BETO),
      );
    });

    test("no modifica lo que recibe", () => {
      const candidatos = Object.freeze(disponibles(ANA, BETO).map((c) => Object.freeze(c)));
      const historial = Object.freeze([
        Object.freeze(recibio(ANA, minuto(1), 1)),
        Object.freeze(recibio(ANA, minuto(2), 1)),
      ]);
      // Congelados: cualquier escritura lanza TypeError en modo estricto.
      expect(elegirVendedorRoundRobin(candidatos, historial, { tope: 2 })).toEqual(elegido(BETO));
      expect(historial).toEqual([recibio(ANA, minuto(1), 1), recibio(ANA, minuto(2), 1)]);
    });
  });

  describe("sin estado oculto: todo sale del historial", () => {
    /**
     * Reparte `veces` sesiones aplicando cada elección como lo haría la base:
     * el elegido pasa a ser el último en recibir y suma una sesión abierta. No
     * hay otro estado que el historial.
     */
    function repartir(
      candidatos: CandidatoRoundRobin[],
      veces: number,
      tope: number | null,
    ): (string | null)[] {
      const historial = new Map<string, HistorialVendedor>();
      const turnos: (string | null)[] = [];
      for (let i = 0; i < veces; i++) {
        const eleccion = elegirVendedorRoundRobin(candidatos, [...historial.values()], { tope });
        if (eleccion.tipo === "sin_vendedor") {
          turnos.push(null);
          continue;
        }
        const previo = historial.get(eleccion.vendedorId);
        historial.set(
          eleccion.vendedorId,
          recibio(eleccion.vendedorId, minuto(i), (previo?.sesionesAbiertas ?? 0) + 1),
        );
        turnos.push(eleccion.vendedorId);
      }
      return turnos;
    }

    test("seis sesiones entre tres rotan en el orden de la lista", () => {
      expect(repartir(disponibles(ANA, BETO, CAMI), 6, null)).toEqual([
        ANA,
        BETO,
        CAMI,
        ANA,
        BETO,
        CAMI,
      ]);
    });

    test("con tope 1, cuando los tres tienen una abierta deja de asignar", () => {
      expect(repartir(disponibles(ANA, BETO, CAMI), 5, 1)).toEqual([ANA, BETO, CAMI, null, null]);
    });

    test("el mismo historial da siempre la misma respuesta", () => {
      const historial = [recibio(ANA, minuto(2), 1), recibio(BETO, minuto(2), 0)];
      const candidatos = disponibles(BETO, ANA, CAMI);
      const primera = elegirVendedorRoundRobin(candidatos, historial, { tope: 3 });
      expect(primera).toEqual(elegido(CAMI));
      for (let i = 0; i < 20; i++) {
        expect(elegirVendedorRoundRobin(candidatos, historial, { tope: 3 })).toEqual(primera);
      }
    });
  });
});
