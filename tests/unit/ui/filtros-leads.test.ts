import { describe, expect, test } from "vitest";
import {
  actividadLabel,
  contarFiltrosActivos,
  parseFiltrosLeads,
  resultadoLabel,
} from "@/lib/ui/filtros-leads";
import { motivoPerdidaLabel } from "@/lib/ui/motivo-perdida";

const UUID_OK = "11111111-2222-4333-8444-555555555555";

describe("parseFiltrosLeads", () => {
  test("sin params no filtra por nada", () => {
    const f = parseFiltrosLeads({});
    expect(contarFiltrosActivos(f)).toBe(0);
    expect(f.q).toBeUndefined();
    expect(f.conSesionActiva).toBeUndefined();
  });

  test("lee los filtros combinados de la URL", () => {
    const f = parseFiltrosLeads({
      q: "  corolla ",
      canal: "wa",
      etapa: "negociando",
      etiqueta: UUID_OK,
      sesion: "activa",
      resultado: "perdido",
      motivo: "precio",
      actividad: "semana",
      sin_responder: "1",
      duplicados: "1",
      marca: "Toyota",
      modelo: "Corolla",
    });

    expect(f).toEqual({
      q: "corolla",
      canal: "wa",
      etapa: "negociando",
      etiquetaId: UUID_OK,
      conSesionActiva: true,
      resultado: "perdido",
      motivoPerdida: "precio",
      actividad: "semana",
      sinResponder: true,
      soloDuplicados: true,
      vehiculoMarca: "Toyota",
      vehiculoModelo: "Corolla",
    });
    // `q` no cuenta como chip: tiene su propia caja en el encabezado.
    expect(contarFiltrosActivos(f)).toBe(11);
  });

  test("sesion=cerrada es el filtro opuesto, no la ausencia de filtro", () => {
    expect(parseFiltrosLeads({ sesion: "cerrada" }).conSesionActiva).toBe(false);
    expect(contarFiltrosActivos(parseFiltrosLeads({ sesion: "cerrada" }))).toBe(1);
  });

  test("valor desconocido o param repetido se ignora, no rompe", () => {
    const f = parseFiltrosLeads({
      etapa: "etapa_que_no_existe",
      canal: ["wa", "ig"],
      actividad: "ayer",
      resultado: "",
      sesion: "quizas",
      sin_responder: "true",
    });
    expect(contarFiltrosActivos(f)).toBe(0);
  });

  test("una etiqueta que no es UUID no viaja a la consulta", () => {
    expect(parseFiltrosLeads({ etiqueta: "vip" }).etiquetaId).toBeUndefined();
    expect(parseFiltrosLeads({ etiqueta: UUID_OK }).etiquetaId).toBe(UUID_OK);
  });

  test("el texto libre del vehículo se recorta y se acota", () => {
    const f = parseFiltrosLeads({ marca: `  ${"A".repeat(200)}  ` });
    expect(f.vehiculoMarca).toHaveLength(80);
  });
});

describe("etiquetas de los chips", () => {
  test("cada opción tiene nombre en castellano", () => {
    expect(actividadLabel("mas_30")).toBe("Hace más de 30 días");
    expect(resultadoLabel("exito")).toBe("Ganado");
    expect(motivoPerdidaLabel("no_responde")).toBe("No responde");
  });
});
