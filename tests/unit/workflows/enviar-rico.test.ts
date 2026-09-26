import { describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import { CLAVE_ESPERA_OPCION } from "@/lib/workflows/respuesta-interactiva";
import { crearAccionesDeMensajeriaRica } from "@/server/services/workflows/acciones/enviar-rico";
import type { Horario } from "@/types/agente";
import type { Nodo, NodoTipo } from "@/types/workflows";

/**
 * Botones, lista, imagen y ubicación. Pasan por los mismos topes que "Enviar
 * mensaje" y, como el texto libre, sólo salen con la ventana de 24 h abierta.
 * Botones y lista, además, esperan la respuesta: la primera pasada manda y
 * pide esperar; la segunda —al reanudar— sale por la opción elegida.
 */

const TODO_EL_DIA = [{ desde: "00:00", hasta: "23:59" }];
const ABIERTO: Horario = {
  lun: TODO_EL_DIA,
  mar: TODO_EL_DIA,
  mie: TODO_EL_DIA,
  jue: TODO_EL_DIA,
  vie: TODO_EL_DIA,
  sab: TODO_EL_DIA,
  dom: TODO_EL_DIA,
};

const AHORA = new Date("2026-09-22T15:00:00Z");
const HACE_UNA_HORA = new Date("2026-09-22T14:00:00Z");

const entorno = (contexto: Record<string, unknown> = {}) => ({
  leadId: "l1",
  leadSessionId: "s1",
  runId: "r1",
  orden: 5,
  contexto,
  ahora: AHORA,
});

function nodo(tipo: NodoTipo, config: Record<string, unknown>, id = "n1"): Nodo {
  return { id, tipo, config, posicion: { x: 0, y: 0 } };
}

const BOTONES = {
  mensaje: "Hola {{lead.nombre}}, ¿te lo reservo?",
  botones: [
    { id: "si", texto: "Sí" },
    { id: "no", texto: "No" },
  ],
  timeout: 2,
  unidadTimeout: "horas",
};

interface Opciones {
  canal?: string;
  ultimoEntrante?: Date | null;
  etapaActiva?: string;
  salientes?: number;
}

function deps(o: Opciones = {}) {
  const sendRico = vi.fn(async () => ({ id: "m-rico", meta_message_id: "wamid.OUT" }));
  const urlFirmada = vi.fn(async (ruta: string) => `https://storage.test/firmada/${ruta}?t=x`);
  return {
    sendRico,
    urlFirmada,
    d: {
      plantillasSinSesion: { contarNoAnotadasDesde: vi.fn(async () => 0) },
      messages: { contarSalientesAutomaticos: vi.fn(async () => o.salientes ?? 0) },
      metaApi: { sendRico },
      imagenesDeFlujo: { urlFirmada },
      conversations: {
        findActivaByLead: vi.fn(async () => ({
          id: "c1",
          canal: o.canal ?? "wa",
          ultimo_entrante_at: o.ultimoEntrante === undefined ? HACE_UNA_HORA : o.ultimoEntrante,
        })),
      },
      leads: {
        findById: vi.fn(async () => ({
          id: "l1",
          nombre: "Ana",
          telefono: "+5491155550000",
          email: null,
          canal_origen: "wa",
        })),
      },
      sessions: {
        findById: vi.fn(async () => ({ id: "s1", current_stage: "cotizado" })),
        findActiveByLeadId: vi.fn(async () => ({
          id: "s1",
          current_stage: o.etapaActiva ?? "cotizado",
        })),
      },
      users: { findById: vi.fn(async () => null) },
      supresiones: { activasPorTelefonos: vi.fn(async () => []) },
      configProvider: {
        activa: vi.fn(async () => ({
          max_salientes_automaticos_24h: 3,
          horario: ABIERTO,
          horario_timezone: "UTC",
        })),
      },
    } as never,
  };
}

describe("enviar_botones — primera pasada", () => {
  it("manda los botones con el texto resuelto y pide esperar la respuesta", async () => {
    const { d, sendRico } = deps();
    const r = await crearAccionesDeMensajeriaRica(d).enviar_botones(
      nodo("msg_botones", BOTONES),
      entorno(),
    );

    expect(sendRico).toHaveBeenCalledWith({
      conversacionId: "c1",
      leadSessionId: "s1",
      to: "+5491155550000",
      contenido: {
        tipo: "botones",
        cuerpo: "Hola Ana, ¿te lo reservo?",
        botones: [
          { id: "si", titulo: "Sí" },
          { id: "no", titulo: "No" },
        ],
      },
      sender: "sistema",
      idempotencyKey: "wf:r1:5",
    });
    expect(r.esperarRespuesta).toEqual({
      hasta: new Date("2026-09-22T17:00:00Z"),
      respondeA: "wamid.OUT",
    });
    expect(r.contexto).toEqual({
      [CLAVE_ESPERA_OPCION]: { nodoId: "n1", respondeA: "wamid.OUT" },
    });
    expect(r.salida).toEqual({ mensaje_id: "m-rico" });
  });

  it("con la ventana de 24 h cerrada salta con sin_ventana y no manda", async () => {
    const { d, sendRico } = deps({ ultimoEntrante: new Date("2026-09-20T10:00:00Z") });
    const r = await crearAccionesDeMensajeriaRica(d).enviar_botones(
      nodo("msg_botones", BOTONES),
      entorno(),
    );
    expect(r.salto?.motivo).toBe("sin_ventana");
    expect(sendRico).not.toHaveBeenCalled();
  });

  it("un lead que nunca escribió tampoco tiene ventana", async () => {
    const { d, sendRico } = deps({ ultimoEntrante: null });
    const r = await crearAccionesDeMensajeriaRica(d).enviar_botones(
      nodo("msg_botones", BOTONES),
      entorno(),
    );
    expect(r.salto?.motivo).toBe("sin_ventana");
    expect(sendRico).not.toHaveBeenCalled();
  });

  it("los topes compartidos van antes: requiere humano salta sin mandar", async () => {
    const { d, sendRico } = deps({ etapaActiva: "requiere_humano" });
    const r = await crearAccionesDeMensajeriaRica(d).enviar_botones(
      nodo("msg_botones", BOTONES),
      entorno(),
    );
    expect(r.salto?.motivo).toBe("requiere_humano");
    expect(sendRico).not.toHaveBeenCalled();
  });

  it("fuera de WhatsApp falla sin reintento: Instagram y Messenger no tienen estos mensajes", async () => {
    const { d, sendRico } = deps({ canal: "ig" });
    await expect(
      crearAccionesDeMensajeriaRica(d).enviar_botones(nodo("msg_botones", BOTONES), entorno()),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(sendRico).not.toHaveBeenCalled();
  });

  it("sin sesión no manda: no hay hilo donde anotarlo", async () => {
    const { d } = deps();
    await expect(
      crearAccionesDeMensajeriaRica(d).enviar_botones(nodo("msg_botones", BOTONES), {
        ...entorno(),
        leadSessionId: null,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("enviar_botones — al reanudar", () => {
  const pendiente = (respuesta?: { id: string; titulo: string }) => ({
    [CLAVE_ESPERA_OPCION]: {
      nodoId: "n1",
      respondeA: "wamid.OUT",
      ...(respuesta ? { respuesta } : {}),
    },
  });

  it("con la respuesta sale por la línea de esa opción, sin volver a mandar", async () => {
    const { d, sendRico } = deps();
    const r = await crearAccionesDeMensajeriaRica(d).enviar_botones(
      nodo("msg_botones", BOTONES),
      entorno(pendiente({ id: "no", titulo: "No" })),
    );
    expect(sendRico).not.toHaveBeenCalled();
    expect(r.puerto).toBe("opcion:no");
    expect(r.salida).toEqual({ respuesta: "no", titulo: "No" });
    expect(r.contexto).toEqual({ [CLAVE_ESPERA_OPCION]: null });
  });

  it("sin respuesta (venció el tiempo) sale por «sin respuesta»", async () => {
    const { d, sendRico } = deps();
    const r = await crearAccionesDeMensajeriaRica(d).enviar_botones(
      nodo("msg_botones", BOTONES),
      entorno(pendiente()),
    );
    expect(sendRico).not.toHaveBeenCalled();
    expect(r.puerto).toBe("sin_respuesta");
  });

  it("una respuesta que no es ninguna opción sale por «sin respuesta» y queda anotada", async () => {
    const { d } = deps();
    const r = await crearAccionesDeMensajeriaRica(d).enviar_botones(
      nodo("msg_botones", BOTONES),
      entorno(pendiente({ id: "otra", titulo: "Otra" })),
    );
    expect(r.puerto).toBe("sin_respuesta");
    expect(r.salida).toEqual({ respuesta_desconocida: "otra" });
  });

  it("la espera de OTRO nodo no cuenta: este manda como primera pasada", async () => {
    const { d, sendRico } = deps();
    const otro = { [CLAVE_ESPERA_OPCION]: { nodoId: "otro", respondeA: "wamid.X" } };
    const r = await crearAccionesDeMensajeriaRica(d).enviar_botones(
      nodo("msg_botones", BOTONES),
      entorno(otro),
    );
    expect(sendRico).toHaveBeenCalledOnce();
    expect(r.esperarRespuesta).toBeDefined();
  });
});

describe("enviar_lista", () => {
  it("manda la lista con sus filas y espera", async () => {
    const { d, sendRico } = deps();
    const r = await crearAccionesDeMensajeriaRica(d).enviar_lista(
      nodo("msg_lista", {
        header: "Repuestos",
        body: "¿Qué buscás, {{lead.nombre}}?",
        secciones: [{ titulo: "Motor", items: [{ id: "f", titulo: "Filtro", descripcion: "" }] }],
      }),
      entorno(),
    );
    expect(sendRico).toHaveBeenCalledWith(
      expect.objectContaining({
        contenido: {
          tipo: "lista",
          encabezado: "Repuestos",
          cuerpo: "¿Qué buscás, Ana?",
          pie: null,
          boton: "Ver opciones",
          secciones: [
            { titulo: "Motor", filas: [{ id: "f", titulo: "Filtro", descripcion: null }] },
          ],
        },
      }),
    );
    // 24 h por defecto.
    expect(r.esperarRespuesta?.hasta).toEqual(new Date("2026-09-23T15:00:00Z"));
  });
});

describe("enviar_imagen", () => {
  it("por URL: manda el link y sigue por «salida», sin esperar", async () => {
    const { d, sendRico, urlFirmada } = deps();
    const r = await crearAccionesDeMensajeriaRica(d).enviar_imagen(
      nodo("msg_imagen", { url: "https://x.test/a.jpg", caption: "Para {{lead.nombre}}" }),
      entorno(),
    );
    expect(urlFirmada).not.toHaveBeenCalled();
    expect(sendRico).toHaveBeenCalledWith(
      expect.objectContaining({
        contenido: { tipo: "imagen", url: "https://x.test/a.jpg", caption: "Para Ana" },
      }),
    );
    expect(r).toEqual({ puerto: "salida", salida: { mensaje_id: "m-rico" } });
  });

  it("por archivo: firma la ruta de Storage y la pasa aparte para el hilo", async () => {
    const { d, sendRico, urlFirmada } = deps();
    const ruta = "flujos/0f8fad5b-d9cb-469f-a165-70867728950e.jpg";
    await crearAccionesDeMensajeriaRica(d).enviar_imagen(
      nodo("msg_imagen", { tipoMedia: "archivo", archivo: ruta }),
      entorno(),
    );
    expect(urlFirmada).toHaveBeenCalledWith(ruta);
    expect(sendRico).toHaveBeenCalledWith(
      expect.objectContaining({
        contenido: {
          tipo: "imagen",
          url: `https://storage.test/firmada/${ruta}?t=x`,
          caption: null,
        },
        archivo: ruta,
      }),
    );
  });
});

describe("enviar_ubicacion", () => {
  it("manda el punto y sigue por «salida»", async () => {
    const { d, sendRico } = deps();
    const r = await crearAccionesDeMensajeriaRica(d).enviar_ubicacion(
      nodo("msg_ubicacion", { lat: -2.17, lon: -79.92, nombre: "Local" }),
      entorno(),
    );
    expect(sendRico).toHaveBeenCalledWith(
      expect.objectContaining({
        contenido: { tipo: "ubicacion", lat: -2.17, lon: -79.92, nombre: "Local", direccion: null },
      }),
    );
    expect(r.puerto).toBe("salida");
  });
});
