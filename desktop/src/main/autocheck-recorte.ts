import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { desktopCapturer, screen, webContents } from "electron";
import type { BaseWindow, NativeImage, WebContents } from "electron";

import { recorteEfectivo } from "./calibracion-recorte";
import { CoordinadorWhatsapp } from "./coordinador-whatsapp";
import type { EstadoCoordinador } from "./coordinador-whatsapp";
import type { ModoUa } from "./vista-whatsapp";

/**
 * Chequeos del recorte izquierdo para SPIKE_AUTOCHECK. Solo se usa la
 * partición de spike (nunca `persist:whatsapp`): a la vista se le carga una
 * página de prueba propia (izquierda roja, resto azul) para que el recorte se
 * pueda medir sin sesión ni red.
 */

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const PAGINA_PRUEBA = `<!doctype html><meta charset="utf-8"><title>prueba-recorte</title>
<body style="margin:0;background:#0000ff">
<div style="position:absolute;left:0;top:0;width:300px;height:100%;background:#ff0000"></div>
<script>window.__clicks=[];addEventListener("mousedown",e=>window.__clicks.push([e.clientX,e.clientY,e.screenX,e.screenY,Math.round(performance.now())]));</script>
</body>`;

export interface ContextoRecorte {
  ventana: BaseWindow;
  crm: WebContents;
  coordinador: CoordinadorWhatsapp;
  invocarPuente<T>(expresion: string): Promise<T>;
  salida: string;
  archivoPreferencias: string;
  particion: string;
  modoUa: ModoUa;
}

type Rgb = readonly [number, number, number];

function pixel(img: NativeImage, x: number, y: number): Rgb {
  const { width } = img.getSize();
  const bmp = img.toBitmap(); // BGRA en Windows
  const i = (y * width + x) * 4;
  return [bmp[i + 2] ?? -1, bmp[i + 1] ?? -1, bmp[i] ?? -1];
}

function contarRojoPuro(img: NativeImage): number {
  const bmp = img.toBitmap();
  let n = 0;
  for (let i = 0; i + 3 < bmp.length; i += 4) {
    if (bmp[i + 2] === 255 && bmp[i + 1] === 0 && bmp[i] === 0) n += 1;
  }
  return n;
}

const esRojo = (c: Rgb): boolean => c[0] === 255 && c[1] === 0 && c[2] === 0;
const esAzul = (c: Rgb): boolean => c[0] === 0 && c[1] === 0 && c[2] === 255;
const esBlanco = (c: Rgb): boolean => c[0] === 255 && c[1] === 255 && c[2] === 255;

/**
 * Captura SOLO la ventana de la app (fuente `window` por su id de medio), no
 * la pantalla: no puede salir contenido ajeno. Devuelve la imagen recortada
 * al área de contenido y los tamaños para poder auditar el recorte.
 */
async function capturarContenido(
  ventana: BaseWindow,
): Promise<{ img: NativeImage; diagnostico: Record<string, unknown> }> {
  const b = ventana.getBounds();
  const cb = ventana.getContentBounds();
  const f = screen.getDisplayMatching(b).scaleFactor;
  const fuentes = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: { width: Math.round(b.width * f), height: Math.round(b.height * f) },
  });
  const fuente = fuentes.find((x) => x.id === ventana.getMediaSourceId());
  if (fuente === undefined) throw new Error("la ventana no aparece como fuente de captura");
  const tam = fuente.thumbnail.getSize();
  const img = fuente.thumbnail.crop({
    x: Math.round((cb.x - b.x) * f),
    y: Math.round((cb.y - b.y) * f),
    width: Math.round(cb.width * f),
    height: Math.round(cb.height * f),
  });
  return {
    img,
    diagnostico: { boundsVentana: b, boundsContenido: cb, escala: f, tamanoCaptura: tam },
  };
}

/**
 * Clic de mouse enviado como mensaje de Windows (WM_MOUSEMOVE / WM_LBUTTONDOWN /
 * WM_LBUTTONUP) directo al HWND de la ventana de la app, en coordenadas de
 * cliente (px físicos). Entra por el mismo camino que un clic real —
 * HWNDMessageHandler y el hit-testing de la jerarquía de views de Chromium—
 * pero no mueve el cursor del usuario ni depende de qué ventana esté al frente.
 */
function clicNativo(hwnd: bigint, punto: { x: number; y: number }): Promise<string> {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Msg {
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
}
"@
$h = [IntPtr]${hwnd}
if (-not [Msg]::IsWindow($h)) { Write-Output "sin_ventana"; exit 0 }
$l = [IntPtr](([long]${punto.y} -shl 16) -bor ([long]${punto.x} -band 0xffff))
[Msg]::PostMessage($h, 0x200, [IntPtr]::Zero, $l) | Out-Null
Start-Sleep -Milliseconds 80
[Msg]::PostMessage($h, 0x201, [IntPtr]1, $l) | Out-Null
Start-Sleep -Milliseconds 50
[Msg]::PostMessage($h, 0x202, [IntPtr]::Zero, $l) | Out-Null
Write-Output "clic"
`;
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 20_000 },
      (err, stdout) => (err === null ? resolve(stdout.trim()) : reject(err)),
    );
  });
}

function boundsEsperados(estado: EstadoCoordinador, recorte: number): unknown {
  const b = estado.bounds;
  if (b === null) return null;
  return { x: -recorte, y: 0, width: b.width + recorte, height: b.height };
}

type RespuestaConfig = {
  ok: boolean;
  recorteIzquierdo: number;
  completo: boolean;
  anchoArea?: number | null;
  calibrado?: boolean;
};

export async function chequeosRecorte(ctx: ContextoRecorte): Promise<Record<string, unknown>> {
  const { coordinador, ventana, crm, invocarPuente, salida } = ctx;
  const r: Record<string, unknown> = {};
  const configurar = <T>(cambios: unknown): Promise<T> =>
    invocarPuente<T>(`window.crmEscritorio.configurarVistaWhatsApp(${JSON.stringify(cambios)})`);
  const nuevoCoordinador = (): CoordinadorWhatsapp =>
    new CoordinadorWhatsapp({
      ventana,
      crmWebContents: crm,
      particion: ctx.particion,
      modoUa: ctx.modoUa,
      archivoPreferencias: ctx.archivoPreferencias,
    });

  // (f) valores por defecto: sin archivo -> recorte 0, completo false; la
  // vista ocupa exactamente el contenedor.
  const inicial = await invocarPuente<unknown>("window.crmEscritorio.obtenerVistaWhatsApp()");
  const estadoF = coordinador.estado();
  // El área de (b) es de 300 DIP con zoom 1: anchoArea 300, sin calibración.
  const anchoF = Math.round(300 * crm.getZoomFactor());
  const anchoF10 = Math.round(anchoF / 10) * 10;
  r.f_default = {
    pasa:
      JSON.stringify(inicial) ===
        JSON.stringify({
          recorteIzquierdo: 0,
          completo: false,
          anchoArea: anchoF10,
          calibrado: false,
        }) &&
      JSON.stringify(estadoF.boundsVista) ===
        JSON.stringify({ x: 0, y: 0, width: estadoF.bounds?.width, height: estadoF.bounds?.height }),
    inicial,
    estado: estadoF,
  };

  // (g) recorte por el puente real -> bounds de la hija desplazados; el
  // contenedor no se mueve. Ráfaga de cambios (slider): el último gana.
  for (const v of [50, 120, 200, 300]) await configurar({ recorteIzquierdo: v });
  await esperar(100);
  const estadoG = coordinador.estado();
  r.g_recorte_aplicado_a_bounds = {
    pasa:
      JSON.stringify(estadoG.boundsVista) === JSON.stringify(boundsEsperados(estadoG, 300)) &&
      JSON.stringify(estadoG.bounds) === JSON.stringify(estadoF.bounds),
    estado: estadoG,
  };

  // (h) completo:true quita el recorte sin perderlo; volver a false lo restaura.
  const conCompleto = await configurar<RespuestaConfig>({ completo: true });
  const estadoH1 = coordinador.estado();
  const sinCompleto = await configurar<RespuestaConfig>({ completo: false });
  const estadoH2 = coordinador.estado();
  r.h_completo_quita_recorte = {
    pasa:
      conCompleto.ok &&
      conCompleto.completo &&
      conCompleto.recorteIzquierdo === 300 &&
      JSON.stringify(estadoH1.boundsVista) === JSON.stringify(boundsEsperados(estadoH1, 0)) &&
      sinCompleto.ok &&
      !sinCompleto.completo &&
      JSON.stringify(estadoH2.boundsVista) === JSON.stringify(boundsEsperados(estadoH2, 300)),
    conCompleto,
    sinCompleto,
  };

  // (i) entradas inválidas: se rechazan y el estado no cambia; los límites 0 y 1200 se aceptan.
  const invalidas: string[] = [
    "null",
    "5",
    '"x"',
    "[]",
    "{ recorteIzquierdo: -1 }",
    "{ recorteIzquierdo: 1201 }",
    "{ recorteIzquierdo: 10.5 }",
    '{ recorteIzquierdo: "10" }',
    "{ recorteIzquierdo: NaN }",
    "{ recorteIzquierdo: Infinity }",
    "{ completo: 1 }",
    '{ completo: "true" }',
    "{ otraCosa: 1 }",
    "{ recorteIzquierdo: 10, otraCosa: 1 }",
  ];
  const antesI = JSON.stringify([coordinador.estado(), coordinador.obtenerConfigVista()]);
  const respuestasI: unknown[] = [];
  for (const expr of invalidas) {
    respuestasI.push(
      await invocarPuente<{ ok: boolean }>(`window.crmEscritorio.configurarVistaWhatsApp(${expr})`),
    );
  }
  const despuesI = JSON.stringify([coordinador.estado(), coordinador.obtenerConfigVista()]);
  const limites = [
    await configurar<RespuestaConfig>({ recorteIzquierdo: 0 }),
    await configurar<RespuestaConfig>({ recorteIzquierdo: 1200 }),
  ];
  await configurar({ recorteIzquierdo: 300 });
  r.i_entradas_invalidas_rechazadas = {
    pasa:
      respuestasI.every((x) => (x as { ok: boolean }).ok === false) &&
      antesI === despuesI &&
      limites.every((x) => x.ok),
    respuestasI,
    limitesAceptados: limites,
  };

  // (j) persistencia: debounce, escritura atómica, un coordinador nuevo lee lo
  // escrito; archivo corrupto / fuera de rango / ausente -> default.
  const archivo = ctx.archivoPreferencias;
  await configurar({ recorteIzquierdo: 275 });
  const escritoAntesDelDebounce =
    fs.existsSync(archivo) && fs.readFileSync(archivo, "utf8").includes("275");
  await esperar(700);
  const contenido = fs.existsSync(archivo) ? fs.readFileSync(archivo, "utf8") : null;
  const restosTmp = fs.readdirSync(path.dirname(archivo)).filter((n) => n.endsWith(".tmp"));
  const leido = nuevoCoordinador().obtenerConfigVista();
  fs.writeFileSync(archivo, "{no es json");
  const corrupto = nuevoCoordinador().obtenerConfigVista();
  fs.writeFileSync(archivo, JSON.stringify({ recorteIzquierdo: 99999 }));
  const fueraDeRango = nuevoCoordinador().obtenerConfigVista();
  fs.rmSync(archivo);
  const ausente = nuevoCoordinador().obtenerConfigVista();

  // Migración del formato viejo (un solo valor): sin área se conserva como
  // valor por defecto, sin área no se puede calibrar (sin_area), y con la
  // primera área pasa a ser la calibración de ese ancho y se reescribe el archivo.
  fs.writeFileSync(archivo, JSON.stringify({ recorteIzquierdo: 550 }));
  const migrado = nuevoCoordinador();
  const migradoSinArea = migrado.obtenerConfigVista();
  const sinArea = migrado.configurarVista({ recorteIzquierdo: 10 });
  migrado.reportarArea({ x: 0, y: 0, width: 300, height: 100 });
  const migradoConArea = migrado.obtenerConfigVista();
  migrado.volcarPreferencias();
  const archivoMigrado = JSON.parse(fs.readFileSync(archivo, "utf8")) as Record<string, unknown>;
  const anchoMigrado = migradoConArea.anchoArea;
  fs.rmSync(archivo);
  r.j2_migracion_formato_viejo = {
    pasa:
      migradoSinArea.recorteIzquierdo === 550 &&
      migradoSinArea.anchoArea === null &&
      !migradoSinArea.calibrado &&
      sinArea.ok === false &&
      (sinArea as { motivo: string }).motivo === "sin_area" &&
      migradoConArea.recorteIzquierdo === 550 &&
      migradoConArea.calibrado &&
      anchoMigrado !== null &&
      JSON.stringify(archivoMigrado.calibraciones) ===
        JSON.stringify([{ anchoArea: anchoMigrado, recorte: 550 }]) &&
      !("recorteIzquierdo" in archivoMigrado),
    migradoSinArea,
    sinArea,
    migradoConArea,
    archivoMigrado,
  };

  const calibracionesEscritas = contenido === null ? [] : ((JSON.parse(contenido) as { calibraciones?: Array<{ anchoArea: number; recorte: number }> }).calibraciones ?? []);
  r.j_persistencia = {
    pasa:
      !escritoAntesDelDebounce &&
      contenido !== null &&
      calibracionesEscritas.length === 1 &&
      calibracionesEscritas[0]?.recorte === 275 &&
      calibracionesEscritas[0]?.anchoArea === anchoF10 &&
      restosTmp.length === 0 &&
      leido.recorteIzquierdo === 275 &&
      !leido.completo &&
      corrupto.recorteIzquierdo === 0 &&
      fueraDeRango.recorteIzquierdo === 0 &&
      ausente.recorteIzquierdo === 0,
    escritoAntesDelDebounce,
    contenido,
    leido,
    corrupto,
    fueraDeRango,
    ausente,
  };
  await configurar({ recorteIzquierdo: 300 });
  coordinador.volcarPreferencias();

  // (k) recorte REAL: lo que pinta la ventana y a quién le llegan los clics.
  const idVista = coordinador.estado().webContentsId;
  const wcVista = idVista === null ? undefined : webContents.fromId(idVista);
  if (wcVista === undefined) {
    r.k_recorte_real = { pasa: false, motivo: "sin webContents de la vista" };
    return r;
  }
  await wcVista.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGINA_PRUEBA)}`);
  const area = { x: 400, y: 50, width: 600, height: 500 };
  await invocarPuente(`window.crmEscritorio.reportarAreaWhatsApp(${JSON.stringify(area)})`);
  await invocarPuente(
    `(window.__crmClicks = [], addEventListener("mousedown", (e) => window.__crmClicks.push([e.clientX, e.clientY, e.screenX, e.screenY, Math.round(performance.now())])), 0)`,
  );
  const cb = ventana.getContentBounds();
  const f = screen.getDisplayMatching(cb).scaleFactor;
  const zoom = crm.getZoomFactor();
  const xArea = Math.round(area.x * zoom);
  const yMedio = Math.round((area.y + area.height / 2) * zoom) + 150;
  const aCliente = (x: number, y: number): { x: number; y: number } => ({
    x: Math.round(x * f),
    y: Math.round(y * f),
  });
  const enImagen = (x: number, y: number): [number, number] => [
    Math.round(x * f),
    Math.round(y * f),
  ];
  const hwnd = ventana.getNativeWindowHandle().readBigUInt64LE(0);

  const medir = async (
    nombre: string,
  ): Promise<{ img: NativeImage; rojo: number; diagnostico: Record<string, unknown> }> => {
    await esperar(900);
    const { img, diagnostico } = await capturarContenido(ventana);
    fs.writeFileSync(path.join(salida, `recorte-${nombre}.png`), img.toPNG());
    return { img, rojo: contarRojoPuro(img), diagnostico };
  };

  // Con recorte 300 la franja roja de la izquierda de la página queda fuera.
  await configurar({ recorteIzquierdo: 300, completo: false });
  const conRecorte = await medir("con-recorte-300");
  const pFranja = pixel(conRecorte.img, ...enImagen(xArea - 150, yMedio));
  const pVisible = pixel(conRecorte.img, ...enImagen(xArea + 100, yMedio));

  const clic1 = await clicNativo(hwnd, aCliente(xArea - 150, yMedio));
  await esperar(400);
  const clic2 = await clicNativo(hwnd, aCliente(xArea + 100, yMedio));
  const clic3 = await clicNativo(hwnd, aCliente(xArea + 300, yMedio - 100));
  await esperar(300);
  const clic4 = await clicNativo(hwnd, aCliente(xArea + 500, yMedio + 20));
  await esperar(300);
  await esperar(400);
  const clicsVista = await wcVista.executeJavaScript("window.__clicks");
  const clicsCrm = await invocarPuente<unknown>("window.__crmClicks");

  // Control: sin recorte (completo) el rojo aparece; si no, la captura no sirve.
  await configurar({ completo: true });
  const completo = await medir("completo");
  const pControlRojo = pixel(completo.img, ...enImagen(xArea + 100, yMedio));
  const pControlAzul = pixel(completo.img, ...enImagen(xArea + 450, yMedio));

  r.k_recorte_real = {
    pasa:
      conRecorte.rojo === 0 &&
      esBlanco(pFranja) &&
      esAzul(pVisible) &&
      completo.rojo > 0 &&
      esRojo(pControlRojo) &&
      esAzul(pControlAzul) &&
      clic1 === "clic" &&
      clic2 === "clic" &&
      Array.isArray(clicsVista) &&
      clicsVista.length === 3 &&
      Array.isArray(clicsCrm) &&
      clicsCrm.length === 1,
    escala: f,
    clic1,
    clic2,
    clic3,
    clic4,
    esperadoEnPagina: [[400, yMedio - area.y], [600, yMedio - 100 - area.y], [800, yMedio + 20 - area.y]],
    diagnosticoCaptura: conRecorte.diagnostico,
    pixelesRojosConRecorte: conRecorte.rojo,
    pixelesRojosCompleto: completo.rojo,
    pFranja,
    pVisible,
    pControlRojo,
    pControlAzul,
    clicsQueLlegaronAWhatsApp: clicsVista,
    clicsQueLlegaronAlCrm: clicsCrm,
    nota: "clic 1 a 150 DIP a la izquierda del área (franja recortada), clic 2 a 100 DIP dentro del área; se espera CRM=[1 clic], WhatsApp=[1 clic con x≈400 en coords de página = 100 + recorte 300]",
  };
  await configurar({ completo: false });

  // (l) resize real: la ventana cambia de tamaño, el CRM (emulado con un
  // listener de resize que vuelve a reportar el área, como su ResizeObserver)
  // manda un área de otro ancho y el recorte efectivo se recalcula por
  // interpolación, se aplica a los bounds y llega al CRM por
  // alCambiarVistaWhatsApp. Cambios pedidos por configurarVistaWhatsApp NO
  // generan evento. Calibraciones de partida: 300 -> 300 y 600 -> 500.
  const contentOriginal = ventana.getContentBounds();
  await configurar({ recorteIzquierdo: 500 }); // el área actual (k) mide 600
  const calibs = [
    { anchoArea: 300, recorte: 300 },
    { anchoArea: 600, recorte: 500 },
  ];
  await invocarPuente(
    `(window.__eventosVista = [], window.__desuscribirVista = window.crmEscritorio.alCambiarVistaWhatsApp((e) => window.__eventosVista.push(e)), window.__onResize = () => window.crmEscritorio.reportarAreaWhatsApp({ x: 400, y: 50, width: innerWidth - 1000, height: 500 }), addEventListener("resize", window.__onResize), 0)`,
  );
  const eventos = (): Promise<Array<Record<string, unknown>>> =>
    invocarPuente("window.__eventosVista");
  const pasos: Array<Record<string, unknown>> = [];
  let todosPasan = true;
  const cambiarTamano = async (anchoContenido: number): Promise<void> => {
    const antes = (await eventos()).length;
    ventana.setContentSize(anchoContenido, contentOriginal.height);
    await esperar(700);
    const lista = await eventos();
    const estado = coordinador.estado();
    const cfg = coordinador.obtenerConfigVista();
    const ancho = cfg.anchoArea;
    const esperado = recorteEfectivo(calibs, ancho, 0);
    const ultimo = lista[lista.length - 1];
    const pasa =
      ancho !== null &&
      cfg.recorteIzquierdo === esperado &&
      cfg.calibrado === calibs.some((c) => c.anchoArea === ancho) &&
      estado.boundsVista?.x === -esperado &&
      lista.length > antes &&
      ultimo !== undefined &&
      ultimo.recorteIzquierdo === esperado &&
      ultimo.anchoArea === ancho &&
      ultimo.calibrado === cfg.calibrado &&
      ultimo.completo === false;
    if (!pasa) todosPasan = false;
    pasos.push({
      anchoContenido,
      cfg,
      esperado,
      boundsVista: estado.boundsVista,
      ultimoEvento: ultimo,
      eventosNuevos: lista.length - antes,
      pasa,
    });
  };
  await cambiarTamano(1400); // area 400: entre 300 y 600 -> interpolado (367), no calibrado
  await cambiarTamano(1200); // area 200: fuera del rango -> la calibracion mas cercana (300)
  await cambiarTamano(1600); // area 600: calibracion exacta (500)

  // Un cambio pedido por el CRM (slider) no emite evento.
  const eventosAntesSlider = (await eventos()).length;
  await configurar({ recorteIzquierdo: 480 });
  await esperar(200);
  const sinEventoPorSlider = (await eventos()).length === eventosAntesSlider;
  calibs[1] = { anchoArea: 600, recorte: 480 };
  const cfgSlider = coordinador.obtenerConfigVista();

  // Desuscribirse corta los eventos.
  await invocarPuente("window.__desuscribirVista()");
  const eventosAntesDesuscribir = (await eventos()).length;
  ventana.setContentSize(1400, contentOriginal.height);
  await esperar(700);
  const sinEventosTrasDesuscribir = (await eventos()).length === eventosAntesDesuscribir;
  const estadoTrasDesuscribir = coordinador.obtenerConfigVista();

  await invocarPuente('removeEventListener("resize", window.__onResize)');
  ventana.setContentSize(contentOriginal.width, contentOriginal.height);
  await esperar(300);
  r.l_resize_recalcula_y_avisa = {
    pasa:
      todosPasan &&
      sinEventoPorSlider &&
      cfgSlider.recorteIzquierdo === 480 &&
      cfgSlider.calibrado &&
      sinEventosTrasDesuscribir &&
      estadoTrasDesuscribir.recorteIzquierdo ===
        recorteEfectivo(calibs, estadoTrasDesuscribir.anchoArea, 0),
    pasos,
    sinEventoPorSlider,
    cfgSlider,
    sinEventosTrasDesuscribir,
    estadoTrasDesuscribir,
  };
  return r;
}
