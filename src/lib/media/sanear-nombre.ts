const MAX_LARGO_NOMBRE = 80;
const NOMBRE_VACIO = "archivo";

/** Nombres que Windows reserva (con o sin extensión). */
const RESERVADOS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Deja un nombre de archivo que un tercero eligió en algo que se puede mostrar,
 * mandar a Meta como `filename` o guardar en una carpeta sin sorpresas.
 *
 * Qué garantiza: es un nombre y no una ruta (sin `/`, `\` ni `..`), sin
 * caracteres de control ni de los que Windows y los headers HTTP no admiten, sin
 * puntos ni espacios al final, sin nombre reservado de Windows, y de a lo sumo
 * 80 caracteres conservando la extensión. Qué NO hace: no lo vuelve ASCII (un
 * nombre con tildes o en japonés es legítimo) ni valida el contenido.
 *
 * La ruta en Storage nunca sale de acá: se arma con ids (`rutaDeMedia`).
 */
export function sanearNombreArchivo(crudo: string, max: number = MAX_LARGO_NOMBRE): string {
  // Sólo el último tramo: `../../etc/passwd` y `C:\x\y.exe` son rutas, y de una
  // ruta se queda con el nombre.
  const ultimo = crudo.normalize("NFC").split(/[\\/]/).pop() ?? "";

  let n = ultimo
    .replace(/[\t\r\n]+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    // Sin puntos al principio (archivo oculto) ni al final (Windows los borra).
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");

  if (n === "") return NOMBRE_VACIO;

  const punto = n.lastIndexOf(".");
  const base = punto > 0 ? n.slice(0, punto) : n;
  if (RESERVADOS.test(base)) n = `_${n}`;

  if (n.length > max) {
    const ext = punto > 0 && n.length - punto <= 11 ? n.slice(n.lastIndexOf(".")) : "";
    n = n.slice(0, max - ext.length) + ext;
  }
  return n;
}
