// @vitest-environment node
import nodePath from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ArchivadorMedia,
  parsearListado,
  type EstadoArchivador,
  type ItemArchivo,
  type RespuestaListado,
} from "../../../desktop/src/main/archivador-media";

const path = nodePath.win32;
const HOME = "C:\\Users\\Tinki";
const BASE = path.join(HOME, "CRM Genuino", "Archivos");
const fecha = new Date(2026, 9, 12, 12).toISOString();

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function item(n: number, over: Partial<ItemArchivo> = {}): ItemArchivo {
  return {
    mensajeId: uuid(n),
    cliente: "Rita Agenda",
    fecha,
    archivo: `foto-${n}.jpg`,
    mime: "image/jpeg",
    bytes: 100,
    ...over,
  };
}

/** Un disco en memoria y un servidor que pagina `items` de a `pagina`. */
function montar(items: ItemArchivo[], opciones: { pagina?: number; env?: Record<string, string> } = {}) {
  const disco = new Set<string>();
  const carpetas = new Set<string>();
  let estadoGuardado: EstadoArchivador = { cursor: null, hechos: [] };
  const pagina = opciones.pagina ?? 2;
  const listar = vi.fn(async (cursor: string | null): Promise<RespuestaListado> => {
    const desde = cursor === null ? 0 : Number(cursor);
    const trozo = items.slice(desde, desde + pagina);
    return {
      tipo: "ok",
      items: trozo,
      siguiente: trozo.length === 0 ? cursor : String(desde + trozo.length),
    };
  });
  const descargar = vi.fn(async (_id: string, destino: string) => {
    disco.add(destino);
  });
  const avisar = vi.fn();
  const archivador = new ArchivadorMedia({
    base: BASE,
    listar,
    descargar,
    fs: {
      crearCarpeta: (r) => void carpetas.add(r),
      existe: (r) => disco.has(r),
      renombrar: (a, b) => {
        disco.delete(a);
        disco.add(b);
      },
      borrar: (r) => void disco.delete(r),
    },
    estado: { leer: () => structuredClone(estadoGuardado), guardar: (e) => (estadoGuardado = structuredClone(e)) },
    entorno: { homedir: HOME, env: { USERPROFILE: HOME, ...opciones.env }, realpath: () => null },
    avisar,
    log: () => {},
  });
  return { archivador, disco, carpetas, listar, descargar, avisar, estado: () => estadoGuardado };
}

let m: ReturnType<typeof montar>;
beforeEach(() => {
  m = montar([item(1), item(2), item(3), item(4), item(5)]);
});

describe("ArchivadorMedia.ciclo", () => {
  it("baja todo en <base>\\<cliente>\\<dia>\\<archivo>, creando las carpetas", async () => {
    const r = await m.archivador.ciclo();
    expect(r).toMatchObject({ estado: "al_dia", descargados: 5 });
    const esperado = path.join(BASE, "Rita Agenda", "2026-10-12", "foto-3.jpg");
    expect(m.disco.has(esperado)).toBe(true);
    expect(m.carpetas.has(path.dirname(esperado))).toBe(true);
    // Se baja a un .part y se renombra: nunca queda un archivo a medias con el nombre final.
    expect(m.descargar.mock.calls.every((c) => String(c[1]).endsWith(".part"))).toBe(true);
    expect([...m.disco].every((p) => !p.endsWith(".part"))).toBe(true);
  });

  it("idempotente: un segundo ciclo no vuelve a bajar nada", async () => {
    await m.archivador.ciclo();
    m.descargar.mockClear();
    const r = await m.archivador.ciclo();
    expect(r.descargados).toBe(0);
    expect(m.descargar).not.toHaveBeenCalled();
  });

  it("si la app se cierra a mitad, retoma sin repetir lo ya guardado", async () => {
    // Páginas de a 2: [1,2] [3,4] [5]. El primer ciclo baja 1, 2 y 3 y se cae en el 4.
    m.descargar.mockImplementation(async (id: string, destino: string) => {
      if (id === uuid(4)) throw new Error("se cortó la red");
      m.disco.add(destino);
    });
    await m.archivador.ciclo();
    // El cursor quedó al inicio de la página en curso y el 3 anotado como hecho.
    expect(m.estado()).toEqual({ cursor: "2", hechos: [uuid(3)] });

    m.descargar.mockClear();
    m.descargar.mockImplementation(async (_id: string, destino: string) => void m.disco.add(destino));
    await m.archivador.ciclo();
    const bajados = m.descargar.mock.calls.map((c) => c[0]);
    expect(bajados).toEqual([uuid(4), uuid(5)]);
  });

  it("un fallo corta el ciclo y se reintenta en el siguiente (sin saltear el archivo)", async () => {
    m.descargar.mockRejectedValueOnce(new Error("503"));
    const r1 = await m.archivador.ciclo();
    expect(r1.estado).toBe("error");
    expect(m.disco.size).toBe(0);
    const r2 = await m.archivador.ciclo();
    expect(r2).toMatchObject({ estado: "al_dia", descargados: 5 });
  });

  it("tras 5 fallos seguidos del mismo archivo lo deja y sigue con los demas", async () => {
    m.descargar.mockImplementation(async (id: string, destino: string) => {
      if (id === uuid(2)) throw new Error("404");
      m.disco.add(destino);
    });
    for (let i = 0; i < 5; i++) await m.archivador.ciclo();
    const r = await m.archivador.ciclo();
    expect(r.estado).toBe("al_dia");
    expect(m.disco.size).toBe(4);
  });

  it("dos clientes con el mismo nombre y el mismo archivo no se pisan", async () => {
    const dos = montar([
      item(1, { archivo: "lista.pdf", mime: "application/pdf" }),
      item(2, { archivo: "lista.pdf", mime: "application/pdf" }),
    ]);
    await dos.archivador.ciclo();
    const dir = path.join(BASE, "Rita Agenda", "2026-10-12");
    expect(dos.disco.has(path.join(dir, "lista.pdf"))).toBe(true);
    expect([...dos.disco].filter((p) => p.startsWith(dir)).length).toBe(2);
  });

  it("nombres hostiles quedan adentro de la carpeta base", async () => {
    const h = montar([
      item(1, { cliente: "../../../Windows", archivo: "..\\..\\evil.exe" }),
      item(2, { cliente: "C:\\Windows\\System32", archivo: "/etc/passwd" }),
    ]);
    await h.archivador.ciclo();
    expect(h.disco.size).toBe(2);
    for (const ruta of h.disco) {
      expect(ruta.startsWith(BASE + "\\"), ruta).toBe(true);
      expect(path.relative(BASE, ruta).startsWith(".."), ruta).toBe(false);
    }
  });

  it("sin sesion en el CRM no hace nada y no pierde el cursor", async () => {
    m.listar.mockResolvedValueOnce({ tipo: "sin_sesion" });
    expect(await m.archivador.ciclo()).toMatchObject({ estado: "sin_sesion", descargados: 0 });
    expect(m.estado().cursor).toBeNull();
  });
});

describe("ArchivadorMedia: carpeta dentro de OneDrive", () => {
  it("se niega a guardar, avisa UNA vez con el motivo y no baja nada", async () => {
    const o = montar([item(1)], { env: { OneDrive: HOME } });
    const r1 = await o.archivador.ciclo();
    const r2 = await o.archivador.ciclo();
    expect(r1.estado).toBe("bloqueado");
    expect(r2.estado).toBe("bloqueado");
    expect(o.avisar).toHaveBeenCalledTimes(1);
    expect(o.avisar.mock.calls[0]![0]).toMatch(/OneDrive/);
    expect(o.listar).not.toHaveBeenCalled();
    expect(o.descargar).not.toHaveBeenCalled();
    expect(o.disco.size).toBe(0);
  });
});

describe("parsearListado (la respuesta del servidor no se cree a ciegas)", () => {
  const bueno = { mensajeId: uuid(1), cliente: "R", fecha, archivo: "a.jpg", mime: "image/jpeg", bytes: 3 };

  it("acepta la forma esperada", () => {
    expect(parsearListado({ items: [bueno], siguiente: "x" })).toEqual({
      tipo: "ok",
      items: [bueno],
      siguiente: "x",
    });
  });

  it("descarta los items con forma rara y deja los buenos", () => {
    const r = parsearListado({
      items: [
        bueno,
        { ...bueno, mensajeId: "../../x" },
        { ...bueno, cliente: 5 },
        { ...bueno, bytes: "mucho" },
        null,
        "texto",
      ],
      siguiente: null,
    });
    expect(r).toMatchObject({ tipo: "ok", items: [bueno] });
  });

  it("una respuesta que no es un listado es un error", () => {
    expect(parsearListado(null)).toEqual({ tipo: "error" });
    expect(parsearListado({ items: "no" })).toEqual({ tipo: "error" });
  });
});
