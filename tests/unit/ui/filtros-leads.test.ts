import { describe, expect, test } from "vitest";
import {
  contarFiltrosActivos,
  parseFiltrosLeads,
  resultadoLabel,
  vehiculoLabel,
} from "@/lib/ui/filtros-leads";
import { motivoPerdidaLabel } from "@/lib/ui/motivo-perdida";

const UUID_OK = "11111111-2222-4333-8444-555555555555";

describe("parseFiltrosLeads", () => {
  test("sin params no filtra por nada", () => {
    const f = parseFiltrosLeads({});
    expect(contarFiltrosActivos(f)).toBe(0);
    expect(f.q).toBeUndefined();
    expect(f.etapa).toBeUndefined();
  });

  test("lee los filtros combinados de la URL", () => {
    const f = parseFiltrosLeads({
      q: "  corolla ",
      canal: "wa",
      etapa: "negociando",
      etiqueta: UUID_OK,
      resultado: "perdido",
      motivo: "precio",
      sin_responder: "1",
      duplicados: "1",
      marca: "Toyota",
      modelo: "Corolla",
      anio: "2018",
    });

    expect(f).toEqual({
      q: "corolla",
      canal: "wa",
      etapa: "negociando",
      etiquetaId: UUID_OK,
      resultado: "perdido",
      motivoPerdida: "precio",
      sinResponder: true,
      soloDuplicados: true,
      vehiculoMarca: "Toyota",
      vehiculoModelo: "Corolla",
      vehiculoAnio: 2018,
    });
    // `q` no cuenta como chip: tiene su propia caja en el encabezado.
    // 7 dimensiones sueltas + el vehículo, que cuenta uno con sus tres params.
    expect(contarFiltrosActivos(f)).toBe(8);
  });

  test("actividad y sesión ya no se leen de la URL: salieron de la barra", () => {
    const f = parseFiltrosLeads({ actividad: "semana", sesion: "activa" });
    expect(contarFiltrosActivos(f)).toBe(0);
    expect(f).toEqual({
      q: undefined,
      soloDuplicados: undefined,
      canal: undefined,
      etapa: undefined,
      etiquetaId: undefined,
      resultado: undefined,
      motivoPerdida: undefined,
      sinResponder: undefined,
      vehiculoMarca: undefined,
      vehiculoModelo: undefined,
      vehiculoAnio: undefined,
    });
  });

  test("valor desconocido o param repetido se ignora, no rompe", () => {
    const f = parseFiltrosLeads({
      etapa: "etapa_que_no_existe",
      canal: ["wa", "ig"],
      resultado: "",
      sin_responder: "true",
      anio: "dos mil",
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

  test("el año son cuatro dígitos: cualquier otra cosa es una URL vieja", () => {
    expect(parseFiltrosLeads({ anio: "2018" }).vehiculoAnio).toBe(2018);
    expect(parseFiltrosLeads({ anio: "18" }).vehiculoAnio).toBeUndefined();
    expect(parseFiltrosLeads({ anio: "-2018" }).vehiculoAnio).toBeUndefined();
  });
});

describe("vehiculoLabel", () => {
  test("junta lo que haya, aunque el link traiga solo la marca", () => {
    const completo = parseFiltrosLeads({ marca: "Toyota", modelo: "Corolla", anio: "2018" });
    expect(vehiculoLabel(completo)).toBe("Toyota Corolla 2018");
    // Los links de cuando el vehículo eran dos `<select>` siguen diciendo qué
    // filtran, aunque ninguna opción de la lista actual coincida.
    expect(vehiculoLabel(parseFiltrosLeads({ marca: "Ford" }))).toBe("Ford");
    expect(vehiculoLabel(parseFiltrosLeads({}))).toBeUndefined();
  });

  test("el vehículo suma uno al contador aunque venga incompleto", () => {
    expect(contarFiltrosActivos(parseFiltrosLeads({ marca: "Ford" }))).toBe(1);
    expect(contarFiltrosActivos(parseFiltrosLeads({ anio: "2018" }))).toBe(1);
  });
});

describe("etiquetas de los chips", () => {
  test("cada opción tiene nombre en castellano", () => {
    expect(resultadoLabel("exito")).toBe("Ganado");
    expect(motivoPerdidaLabel("no_responde")).toBe("No responde");
  });
});
