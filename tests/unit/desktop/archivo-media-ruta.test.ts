// @vitest-environment node
import nodePath from "node:path";
import { describe, expect, it } from "vitest";
import {
  carpetaBase,
  carpetaDeDia,
  rutaDestino,
  sanearSegmento,
  verificarBaseSegura,
} from "../../../desktop/src/main/archivo-media-ruta";

// La app de escritorio es de Windows: las rutas se manejan con semántica win32
// siempre, así este test da lo mismo en la CI de Linux.
const path = nodePath.win32;

const HOME = "C:\\Users\\Tinki";
const sinRealpath = () => null;

describe("sanearSegmento (nombres de cliente y de archivo que escribio un tercero)", () => {
  it.each([
    ["Rita Agenda", "Rita Agenda"],
    ["José Núñez", "José Núñez"],
    ["../../Windows/System32", "System32"],
    ["C:\\Users\\x\\y.exe", "y.exe"],
    ['a<b>c:d"e|f?g*h', "a_b_c_d_e_f_g_h"],
    ["con", "_con"],
    ["NUL.txt", "_NUL.txt"],
    ["lpt1", "_lpt1"],
    ["  espacios  ", "espacios"],
    ["punto.", "punto"],
    ["..", "Sin nombre"],
    ["", "Sin nombre"],
    ["\u0000\u0001", "Sin nombre"],
    ["linea1\r\nlinea2", "linea1 linea2"],
  ])("%j -> %j", (entrada, esperado) => {
    expect(sanearSegmento(entrada, "Sin nombre")).toBe(esperado);
  });

  it("nunca deja separadores de ruta ni segmentos .. o .", () => {
    for (const x of ["a/b", "a\\b", "..", ".", "/", "\\", "a/../b", "...."]) {
      const s = sanearSegmento(x, "x");
      expect(s, x).not.toMatch(/[\\/]/);
      expect(s, x).not.toBe("..");
      expect(s, x).not.toBe(".");
    }
  });

  it("recorta a 80 conservando la extension", () => {
    const s = sanearSegmento(`${"a".repeat(300)}.pdf`, "x");
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s.endsWith(".pdf")).toBe(true);
  });
});

describe("carpetaDeDia", () => {
  it("arma YYYY-MM-DD con la zona horaria de la PC, no la del servidor", () => {
    const d = new Date(2026, 9, 12, 23, 59); // 12 de octubre, hora local
    expect(carpetaDeDia(d.toISOString())).toBe("2026-10-12");
    const d2 = new Date(2026, 0, 3, 0, 1);
    expect(carpetaDeDia(d2.toISOString())).toBe("2026-01-03");
  });
  it("una fecha rota no se inventa", () => {
    expect(() => carpetaDeDia("ayer")).toThrow();
  });
});

describe("carpetaBase: directo en la carpeta del usuario, no en Documentos ni Escritorio", () => {
  it("<USERPROFILE>\\CRM Genuino\\Archivos", () => {
    expect(carpetaBase({ homedir: "x", env: { USERPROFILE: HOME }, realpath: sinRealpath })).toBe(
      path.join(HOME, "CRM Genuino", "Archivos"),
    );
  });
  it("sin USERPROFILE usa el home del sistema", () => {
    expect(carpetaBase({ homedir: HOME, env: {}, realpath: sinRealpath })).toBe(
      path.join(HOME, "CRM Genuino", "Archivos"),
    );
  });
});

describe("verificarBaseSegura: nunca guardar dentro de OneDrive", () => {
  const base = path.join(HOME, "CRM Genuino", "Archivos");
  const ok = { homedir: HOME, env: { USERPROFILE: HOME }, realpath: sinRealpath };

  it("una carpeta normal pasa", () => {
    expect(verificarBaseSegura(base, ok)).toEqual({ ok: true });
  });

  it("variable OneDrive, OneDriveConsumer u OneDriveCommercial que contiene la carpeta", () => {
    for (const v of ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]) {
      const r = verificarBaseSegura(base, { ...ok, env: { USERPROFILE: HOME, [v]: HOME } });
      expect(r.ok, v).toBe(false);
    }
  });

  it("la comparacion ignora mayusculas y barra final", () => {
    const r = verificarBaseSegura(base.toUpperCase(), {
      ...ok,
      env: { USERPROFILE: HOME, OneDrive: `${HOME.toLowerCase()}\\` },
    });
    expect(r.ok).toBe(false);
  });

  it("un directorio hermano con nombre parecido NO cuenta como adentro", () => {
    const r = verificarBaseSegura(base, {
      ...ok,
      env: { USERPROFILE: HOME, OneDrive: "C:\\Users\\Tink" },
    });
    expect(r.ok).toBe(true);
  });

  it("cualquier tramo de la ruta que diga OneDrive", () => {
    for (const p of [
      "C:\\Users\\Tinki\\OneDrive\\CRM Genuino\\Archivos",
      "C:\\Users\\Tinki\\OneDrive - Empresa SA\\CRM Genuino\\Archivos",
      "D:\\onedrive\\x",
    ]) {
      expect(verificarBaseSegura(p, ok).ok, p).toBe(false);
    }
  });

  it("un perfil de usuario que Windows movio a OneDrive tambien se rechaza", () => {
    const home = "C:\\Users\\Tinki\\OneDrive - Empresa";
    const r = verificarBaseSegura(path.join(home, "CRM Genuino", "Archivos"), {
      homedir: home,
      env: { USERPROFILE: home },
      realpath: sinRealpath,
    });
    expect(r.ok).toBe(false);
  });

  it("una junction o enlace que apunta a OneDrive se detecta por la ruta real", () => {
    const r = verificarBaseSegura(base, {
      ...ok,
      realpath: (p) => (p === base ? "C:\\Users\\Tinki\\OneDrive\\Destino" : null),
    });
    expect(r.ok).toBe(false);
  });

  it("si la carpeta aun no existe se mira el ancestro que si existe", () => {
    const r = verificarBaseSegura(base, {
      ...ok,
      realpath: (p) => (p === HOME ? "C:\\Users\\Tinki\\OneDrive" : null),
    });
    expect(r.ok).toBe(false);
  });

  it("el motivo es legible para mostrarle al usuario", () => {
    const r = verificarBaseSegura("C:\\Users\\Tinki\\OneDrive\\x", ok);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/OneDrive/);
  });
});

describe("rutaDestino", () => {
  const base = path.join(HOME, "CRM Genuino", "Archivos");
  const fecha = new Date(2026, 9, 12, 12).toISOString();

  it("<base>\\<cliente>\\<YYYY-MM-DD>\\<archivo>", () => {
    expect(rutaDestino(base, "Rita Agenda", fecha, "lista.pdf")).toBe(
      path.join(base, "Rita Agenda", "2026-10-12", "lista.pdf"),
    );
  });

  it("un cliente o archivo con traversal queda adentro de la carpeta base", () => {
    for (const [cliente, archivo] of [
      ["../../../Windows", "..\\..\\evil.exe"],
      ["C:\\Windows\\System32", "/etc/passwd"],
      ["..", ".."],
      ["a/../../b", "x/../../y"],
    ] as const) {
      const r = rutaDestino(base, cliente, fecha, archivo);
      const rel = path.relative(base, r);
      expect(rel.startsWith(".."), `${cliente} ${archivo}`).toBe(false);
      expect(path.isAbsolute(rel)).toBe(false);
      expect(r.startsWith(base + path.sep)).toBe(true);
    }
  });
});
