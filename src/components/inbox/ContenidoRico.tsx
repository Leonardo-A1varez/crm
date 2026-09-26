import type { MensajeRico } from "@/types/entities";

/**
 * La forma de un saliente con botones, lista, imagen o ubicación
 * (`mensajes.metadata.rico`), como la ve el lead en WhatsApp.
 *
 * Nada es clickeable salvo los enlaces: los botones y las filas son del lead,
 * no del vendedor. El texto lo escribió quien armó el flujo y sale como nodo de
 * React, nunca como HTML.
 */

/** Un enlace a OpenStreetMap: no pide clave, y las coordenadas salen de la base. */
function enlaceMapa(lat: number, lon: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
}

const OPCION =
  "border-current/15 rounded-[9px] border px-2.5 py-1 text-center text-[11.5px] font-medium";

export function ContenidoRico({ rico }: { rico: MensajeRico }) {
  switch (rico.tipo) {
    case "botones":
      return (
        <div className="flex flex-col gap-1.5">
          <p className="break-words whitespace-pre-wrap">{rico.cuerpo}</p>
          <ul aria-label="Botones del mensaje" className="flex flex-col gap-1">
            {rico.botones.map((b) => (
              <li key={b.id} className={OPCION}>
                {b.titulo}
              </li>
            ))}
          </ul>
        </div>
      );
    case "lista":
      return (
        <div className="flex flex-col gap-1.5">
          {rico.encabezado ? <p className="font-semibold">{rico.encabezado}</p> : null}
          <p className="break-words whitespace-pre-wrap">{rico.cuerpo}</p>
          {rico.pie ? <p className="text-[11px] opacity-70">{rico.pie}</p> : null}
          <p className={OPCION}>{rico.boton}</p>
          <ul aria-label="Opciones de la lista" className="flex flex-col gap-0.5 text-[11.5px]">
            {rico.secciones.flatMap((s, i) =>
              s.filas.map((f) => (
                <li key={`${i}-${f.id}`} className="flex flex-col">
                  <span>{f.titulo}</span>
                  {f.descripcion ? (
                    <span className="text-[10.5px] opacity-70">{f.descripcion}</span>
                  ) : null}
                </li>
              )),
            )}
          </ul>
        </div>
      );
    case "imagen":
      return (
        <div className="flex flex-col gap-1">
          <p className="italic">
            [Imagen]
            {rico.url ? (
              <>
                {" "}
                <a
                  href={rico.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  ver
                </a>
              </>
            ) : null}
          </p>
          {rico.caption ? <p className="break-words whitespace-pre-wrap">{rico.caption}</p> : null}
        </div>
      );
    case "ubicacion":
      return (
        <div className="flex flex-col gap-0.5">
          <p className="italic">[Ubicación]</p>
          {rico.nombre ? <p className="font-semibold">{rico.nombre}</p> : null}
          {rico.direccion ? <p>{rico.direccion}</p> : null}
          <a
            href={enlaceMapa(rico.lat, rico.lon)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] underline underline-offset-2"
          >
            Ver en el mapa
          </a>
        </div>
      );
  }
}
