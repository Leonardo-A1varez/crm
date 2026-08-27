import { describe, it, expect } from "vitest";
import {
  interpolar,
  interpolarTexto,
  interpolarValor,
} from "@/lib/workflows/engine/interpolador-variables";
import {
  crearContextoVacio,
  type ContextoEjecucion,
} from "@/lib/workflows/engine/contexto-ejecucion";

function crearContextoPrueba(overrides: Partial<ContextoEjecucion> = {}): ContextoEjecucion {
  const base = crearContextoVacio({
    workflowId: "wf-1",
    runId: "run-1",
    versionId: "ver-1",
    trigger: { tipo: "manual", datos: { origen: "test" } },
  });

  return {
    ...base,
    lead: {
      id: "lead-1",
      nombre: "Juan Perez",
      telefono: "+5491155667788",
      email: "juan@test.com",
      direccion: null,
      datos_extra: { empresa: "ACME Corp" },
      vehiculo_marca: "Toyota",
      vehiculo_modelo: "Corolla",
      vehiculo_anio: 2020,
      vehiculo_motor: "1.8",
      empresa_id: null,
      canal_origen: "wa",
      meta_user_ids: {},
      created_at: new Date(),
      updated_at: new Date(),
      nombre_perfil: "Juan",
    },
    sesion: {
      id: "ses-1",
      lead_id: "lead-1",
      current_stage: "cotizado",
      etapa_alcanzada: "cotizado",
      urgencia: "media",
      consulta: "Busco repuesto para Corolla",
      producto_cotizado_id: null,
      codigo_interno: "ABC123",
      precio_cotizado: 150.5,
      cantidad: 2,
      bloqueador: null,
      comprobante_pago_url: null,
      metodo_pago: null,
      resultado: null,
      motivo_perdida: null,
      ia_pausada: false,
      extras: {},
      context_summary: null,
      procedencia: {},
      started_at: new Date(),
      updated_at: new Date(),
      closed_at: null,
    },
    ...overrides,
  };
}

describe("interpolarTexto", () => {
  it("reemplaza variables de lead", () => {
    const ctx = crearContextoPrueba();
    const resultado = interpolarTexto(
      "Hola {{lead.nombre}}, tu telefono es {{lead.telefono}}",
      ctx,
    );

    expect(resultado.texto).toBe("Hola Juan Perez, tu telefono es +5491155667788");
    expect(resultado.noResueltas).toHaveLength(0);
  });

  it("reemplaza variables de sesion", () => {
    const ctx = crearContextoPrueba();
    const resultado = interpolarTexto(
      "Consulta: {{sesion.consulta}}, etapa: {{sesion.current_stage}}",
      ctx,
    );

    expect(resultado.texto).toBe("Consulta: Busco repuesto para Corolla, etapa: cotizado");
    expect(resultado.noResueltas).toHaveLength(0);
  });

  it("reemplaza variables numéricas", () => {
    const ctx = crearContextoPrueba();
    const resultado = interpolarTexto(
      "Precio: {{sesion.precio_cotizado}}, cantidad: {{sesion.cantidad}}",
      ctx,
    );

    expect(resultado.texto).toBe("Precio: 150.5, cantidad: 2");
  });

  it("reemplaza variables del trigger", () => {
    const ctx = crearContextoPrueba();
    const resultado = interpolarTexto("Origen: {{trigger.origen}}", ctx);

    expect(resultado.texto).toBe("Origen: test");
  });

  it("reemplaza variables acumuladas", () => {
    const ctx = crearContextoPrueba();
    ctx.variables.set("resultado_http", "OK");
    ctx.variables.set("contador", 42);

    const resultado = interpolarTexto(
      "HTTP: {{var.resultado_http}}, contador: {{var.contador}}",
      ctx,
    );

    expect(resultado.texto).toBe("HTTP: OK, contador: 42");
  });

  it("soporta paths anidados", () => {
    const ctx = crearContextoPrueba();
    const resultado = interpolarTexto("Empresa: {{lead.datos_extra.empresa}}", ctx);

    expect(resultado.texto).toBe("Empresa: ACME Corp");
  });

  it("devuelve vacío para variables no encontradas", () => {
    const ctx = crearContextoPrueba();
    const resultado = interpolarTexto("Campo: {{lead.campo_inexistente}}", ctx);

    expect(resultado.texto).toBe("Campo: ");
    expect(resultado.noResueltas).toContain("lead.campo_inexistente");
  });

  it("devuelve vacío para namespace inexistente", () => {
    const ctx = crearContextoPrueba();
    const resultado = interpolarTexto("Dato: {{otro.campo}}", ctx);

    expect(resultado.texto).toBe("Dato: ");
    expect(resultado.noResueltas).toContain("otro.campo");
  });

  it("preserva texto sin variables", () => {
    const ctx = crearContextoPrueba();
    const resultado = interpolarTexto("Texto sin variables", ctx);

    expect(resultado.texto).toBe("Texto sin variables");
    expect(resultado.noResueltas).toHaveLength(0);
  });

  it("maneja texto vacío", () => {
    const ctx = crearContextoPrueba();
    const resultado = interpolarTexto("", ctx);

    expect(resultado.texto).toBe("");
    expect(resultado.noResueltas).toHaveLength(0);
  });

  it("maneja variables null como vacío (encontrado, no 'no resuelto')", () => {
    const ctx = crearContextoPrueba();
    const resultado = interpolarTexto("Bloqueador: {{sesion.bloqueador}}", ctx);

    // null es un valor encontrado, se convierte a cadena vacía
    // no es "no resuelto" porque el campo existe
    expect(resultado.texto).toBe("Bloqueador: ");
    expect(resultado.noResueltas).toHaveLength(0);
  });

  it("maneja objetos convirtiéndolos a JSON", () => {
    const ctx = crearContextoPrueba();
    ctx.variables.set("objeto", { a: 1, b: "dos" });

    const resultado = interpolarTexto("Data: {{var.objeto}}", ctx);

    expect(resultado.texto).toBe('Data: {"a":1,"b":"dos"}');
  });
});

describe("interpolar (versión simple)", () => {
  it("devuelve solo el texto interpolado", () => {
    const ctx = crearContextoPrueba();
    const texto = interpolar("Hola {{lead.nombre}}", ctx);

    expect(texto).toBe("Hola Juan Perez");
  });
});

describe("interpolarValor", () => {
  it("interpola strings", () => {
    const ctx = crearContextoPrueba();
    const { valor, noResueltas } = interpolarValor("Hola {{lead.nombre}}", ctx);

    expect(valor).toBe("Hola Juan Perez");
    expect(noResueltas).toHaveLength(0);
  });

  it("interpola objetos recursivamente", () => {
    const ctx = crearContextoPrueba();
    const { valor } = interpolarValor(
      {
        mensaje: "Hola {{lead.nombre}}",
        etapa: "{{sesion.current_stage}}",
      },
      ctx,
    );

    expect(valor).toEqual({
      mensaje: "Hola Juan Perez",
      etapa: "cotizado",
    });
  });

  it("interpola arrays", () => {
    const ctx = crearContextoPrueba();
    const { valor } = interpolarValor(["{{lead.nombre}}", "{{lead.telefono}}"], ctx);

    expect(valor).toEqual(["Juan Perez", "+5491155667788"]);
  });

  it("interpola estructuras anidadas", () => {
    const ctx = crearContextoPrueba();
    const { valor } = interpolarValor(
      {
        lead: {
          nombre: "{{lead.nombre}}",
          vehiculo: {
            marca: "{{lead.vehiculo_marca}}",
            modelo: "{{lead.vehiculo_modelo}}",
          },
        },
        items: ["{{sesion.codigo_interno}}"],
      },
      ctx,
    );

    expect(valor).toEqual({
      lead: {
        nombre: "Juan Perez",
        vehiculo: {
          marca: "Toyota",
          modelo: "Corolla",
        },
      },
      items: ["ABC123"],
    });
  });

  it("preserva valores no string", () => {
    const ctx = crearContextoPrueba();
    const { valor } = interpolarValor(
      {
        texto: "{{lead.nombre}}",
        numero: 42,
        booleano: true,
        nulo: null,
      },
      ctx,
    );

    expect(valor).toEqual({
      texto: "Juan Perez",
      numero: 42,
      booleano: true,
      nulo: null,
    });
  });

  it("acumula variables no resueltas de toda la estructura", () => {
    const ctx = crearContextoPrueba();
    const { noResueltas } = interpolarValor(
      {
        a: "{{lead.inexistente1}}",
        b: ["{{sesion.inexistente2}}"],
      },
      ctx,
    );

    expect(noResueltas).toContain("lead.inexistente1");
    expect(noResueltas).toContain("sesion.inexistente2");
  });
});

describe("contextos especiales", () => {
  it("funciona sin lead", () => {
    const ctx = crearContextoVacio({
      workflowId: "wf-1",
      runId: "run-1",
      versionId: "ver-1",
      trigger: { tipo: "cron", datos: {} },
    });

    const resultado = interpolarTexto("Lead: {{lead.nombre}}", ctx);

    expect(resultado.texto).toBe("Lead: ");
    expect(resultado.noResueltas).toContain("lead.nombre");
  });

  it("funciona sin sesion", () => {
    const ctx = crearContextoVacio({
      workflowId: "wf-1",
      runId: "run-1",
      versionId: "ver-1",
      trigger: { tipo: "manual", datos: {} },
    });

    const resultado = interpolarTexto("Etapa: {{sesion.current_stage}}", ctx);

    expect(resultado.texto).toBe("Etapa: ");
    expect(resultado.noResueltas).toContain("sesion.current_stage");
  });

  it("busca en variables directamente si el namespace no existe", () => {
    const ctx = crearContextoVacio({
      workflowId: "wf-1",
      runId: "run-1",
      versionId: "ver-1",
      trigger: { tipo: "manual", datos: {} },
    });
    // El fallback busca el path completo en variables
    ctx.variables.set("custom.valor", "dato directo");

    const resultado = interpolarTexto("Custom: {{custom.valor}}", ctx);

    // custom no es un namespace conocido, así que hace fallback a variables
    // con el path completo "custom.valor" y LO ENCUENTRA
    expect(resultado.texto).toBe("Custom: dato directo");
    expect(resultado.noResueltas).toHaveLength(0);
  });
});
