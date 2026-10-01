import fs from "node:fs";
import path from "node:path";

import {
  MAXIMO_CALIBRACIONES,
  guardarCalibracion,
  hayCalibracionExacta,
  recorteEfectivo,
  redondearAncho,
} from "./calibracion-recorte";
import type { Calibracion } from "./calibracion-recorte";
import { escribirPreferencias, leerPreferencias } from "./preferencias-vista";

/**
 * Chequeos de la calibración por ancho (matemática y archivo de preferencias).
 * No importan electron: corren dentro de SPIKE_AUTOCHECK y también con `node`
 * plano sobre `dist/` (no hay otro runner de tests en `desktop/`). Escriben
 * solo dentro de `directorio`, nunca el vista-whatsapp.json real.
 */

const cal = (anchoArea: number, recorte: number): Calibracion => ({ anchoArea, recorte });
const igual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function chequeosCalibracion(directorio: string): Record<string, unknown> {
  const r: Record<string, unknown> = {};

  // 0, 1 y 2+ calibraciones
  const dos = [cal(300, 300), cal(600, 500)];
  const tres = [cal(900, 100), cal(300, 300), cal(600, 500)]; // sin ordenar a propósito
  const casos: Array<[string, number, number]> = [
    ["0 calibraciones -> 0", recorteEfectivo([], 500), 0],
    ["0 calibraciones con valor por defecto", recorteEfectivo([], 500, 550), 550],
    ["1 calibracion, ancho menor", recorteEfectivo([cal(600, 480)], 100), 480],
    ["1 calibracion, ancho mayor", recorteEfectivo([cal(600, 480)], 2000), 480],
    ["2, exacto en el primero", recorteEfectivo(dos, 300), 300],
    ["2, exacto en el segundo", recorteEfectivo(dos, 600), 500],
    ["2, punto medio", recorteEfectivo(dos, 450), 400],
    ["2, interpolacion con redondeo (366.67)", recorteEfectivo(dos, 400), 367],
    ["2, por debajo del rango (sin extrapolar)", recorteEfectivo(dos, 100), 300],
    ["2, por encima del rango (sin extrapolar)", recorteEfectivo(dos, 1500), 500],
    ["3 desordenadas, entre 2do y 3ro", recorteEfectivo(tres, 750), 300],
    ["3 desordenadas, entre 1ro y 2do", recorteEfectivo(tres, 450), 400],
    ["acotado a 1200", recorteEfectivo([cal(300, 1200), cal(600, 1200)], 450), 1200],
    ["sin area usa la mas reciente", recorteEfectivo(dos, null), 500],
  ];
  r.calibracion_recorte_efectivo = {
    pasa: casos.every(([, obtenido, esperado]) => obtenido === esperado),
    fallidos: casos
      .filter(([, obtenido, esperado]) => obtenido !== esperado)
      .map(([nombre, obtenido, esperado]) => ({ nombre, obtenido, esperado })),
    casos: casos.length,
  };

  // redondeo del ancho y calibracion exacta
  r.calibracion_redondeo_y_exacta = {
    pasa:
      redondearAncho(604) === 600 &&
      redondearAncho(605) === 610 &&
      redondearAncho(1584) === 1580 &&
      hayCalibracionExacta(dos, 600) &&
      !hayCalibracionExacta(dos, 610) &&
      !hayCalibracionExacta(dos, null),
  };

  // guardar: reemplaza el mismo ancho (y lo hace la mas nueva), tope de 20 descarta la mas vieja
  const base = [cal(300, 1), cal(400, 2), cal(500, 3)];
  const reemplazada = guardarCalibracion(base, cal(300, 9));
  let llena: Calibracion[] = [];
  for (let i = 1; i <= MAXIMO_CALIBRACIONES + 1; i += 1) {
    llena = guardarCalibracion(llena, cal(i * 10, i));
  }
  r.calibracion_guardar = {
    pasa:
      igual(reemplazada, [cal(400, 2), cal(500, 3), cal(300, 9)]) &&
      igual(base, [cal(300, 1), cal(400, 2), cal(500, 3)]) &&
      llena.length === MAXIMO_CALIBRACIONES &&
      llena[0]?.anchoArea === 20 &&
      llena[llena.length - 1]?.anchoArea === (MAXIMO_CALIBRACIONES + 1) * 10,
    reemplazada,
    largoLlena: llena.length,
    primeraLlena: llena[0],
  };

  // archivo de preferencias: formato viejo, nuevo, corrupto, fuera de rango
  fs.rmSync(directorio, { recursive: true, force: true });
  fs.mkdirSync(directorio, { recursive: true });
  const archivo = path.join(directorio, "vista-whatsapp.json");

  fs.writeFileSync(archivo, JSON.stringify({ recorteIzquierdo: 550 }));
  const viejo = leerPreferencias(archivo);

  const ida = { calibraciones: [cal(300, 300), cal(600, 500)], recortePorDefecto: null };
  escribirPreferencias(archivo, ida);
  const vuelta = leerPreferencias(archivo);
  const restos = fs.readdirSync(directorio).filter((n) => n.endsWith(".tmp"));
  const escrito = JSON.parse(fs.readFileSync(archivo, "utf8")) as Record<string, unknown>;

  fs.writeFileSync(archivo, "{no es json");
  const corrupto = leerPreferencias(archivo);
  fs.rmSync(archivo);
  const ausente = leerPreferencias(archivo);

  fs.writeFileSync(
    archivo,
    JSON.stringify({
      calibraciones: [
        cal(300, 100),
        cal(300, 200), // repetido: gana el ultimo
        { anchoArea: 0, recorte: 10 },
        { anchoArea: 400, recorte: 1201 },
        { anchoArea: 400.5, recorte: 10 },
        { anchoArea: "500", recorte: 10 },
        null,
        "x",
        cal(700, 50),
      ],
      recorteIzquierdo: 99999,
    }),
  );
  const filtrado = leerPreferencias(archivo);

  fs.writeFileSync(
    archivo,
    JSON.stringify({
      calibraciones: Array.from({ length: 25 }, (_, i) => cal((i + 1) * 10, i)),
    }),
  );
  const recortado = leerPreferencias(archivo);
  fs.rmSync(directorio, { recursive: true, force: true });

  r.calibracion_archivo = {
    pasa:
      igual(viejo, { calibraciones: [], recortePorDefecto: 550 }) &&
      igual(vuelta, ida) &&
      restos.length === 0 &&
      escrito.version === 2 &&
      !("recorteIzquierdo" in escrito) &&
      igual(corrupto, { calibraciones: [], recortePorDefecto: null }) &&
      igual(ausente, { calibraciones: [], recortePorDefecto: null }) &&
      igual(filtrado, { calibraciones: [cal(300, 200), cal(700, 50)], recortePorDefecto: null }) &&
      recortado.calibraciones.length === MAXIMO_CALIBRACIONES &&
      recortado.calibraciones[0]?.anchoArea === 60,
    viejo,
    vuelta,
    restos,
    corrupto,
    ausente,
    filtrado,
    largoRecortado: recortado.calibraciones.length,
  };

  return r;
}
