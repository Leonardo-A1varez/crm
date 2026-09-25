import { beforeEach, describe, expect, test } from "vitest";
import { ConflictError, IllegalStateError, NotFoundError, ValidationError } from "@/lib/errors";
import type {
  DifusionEnvioInsert,
  DifusionEnviosRepository,
} from "@/server/repositories/difusion-envios.repo";
import type { UUID } from "@/types/entities";

export interface DifusionEnviosContractFixtures {
  /** Dos difusiones que existan (la FK lo exige en Supabase). */
  difusiones: { d1: UUID; d2: UUID };
  /** Cuatro leads que existan. */
  leads: { l1: UUID; l2: UUID; l3: UUID; l4: UUID };
  /** Un id que no existe en `difusion_envios`. */
  desconocido: UUID;
}

const DEFAULT_FIXTURES: DifusionEnviosContractFixtures = {
  difusiones: { d1: "difusion-1", d2: "difusion-2" },
  leads: { l1: "lead-1", l2: "lead-2", l3: "lead-3", l4: "lead-4" },
  desconocido: "00000000-0000-4000-8000-000000000999",
};

export type DifusionEnviosContractFixturesArg =
  | DifusionEnviosContractFixtures
  | (() => DifusionEnviosContractFixtures);

const HOY = new Date("2026-09-13T12:00:00.000Z");
const T1 = "593990000001";
const T2 = "593990000002";
const T3 = "593990000003";

function enCola(
  difusionId: UUID,
  leadId: UUID,
  telefono: string,
  over: Partial<DifusionEnvioInsert> = {},
): DifusionEnvioInsert {
  return {
    difusion_id: difusionId,
    lead_id: leadId,
    telefono,
    estado: "en_cola",
    motivo_exclusion: null,
    ruta: "plantilla",
    tanda: 0,
    programado_para: HOY,
    ...over,
  };
}

function excluido(
  difusionId: UUID,
  leadId: UUID,
  telefono: string | null,
  motivo: DifusionEnvioInsert["motivo_exclusion"],
): DifusionEnvioInsert {
  return {
    difusion_id: difusionId,
    lead_id: leadId,
    telefono,
    estado: "excluido",
    motivo_exclusion: motivo,
    ruta: null,
    tanda: null,
    programado_para: null,
  };
}

/** Un wamid distinto por llamada: el índice único es global, no por difusión. */
function wamid(): string {
  return `wamid.contrato.${crypto.randomUUID()}`;
}

export function runDifusionEnviosContract(
  makeRepo: () => DifusionEnviosRepository,
  fixturesArg: DifusionEnviosContractFixturesArg = DEFAULT_FIXTURES,
) {
  describe("DifusionEnviosRepository contract", () => {
    let repo: DifusionEnviosRepository;
    let f: DifusionEnviosContractFixtures;
    let d1: UUID;
    let d2: UUID;

    beforeEach(() => {
      repo = makeRepo();
      f = typeof fixturesArg === "function" ? fixturesArg() : fixturesArg;
      ({ d1, d2 } = f.difusiones);
    });

    async function unoEnCola(): Promise<UUID> {
      await repo.registrarPlan([enCola(d1, f.leads.l1, T1)]);
      const [fila] = await repo.listarPorDifusion(d1, { limite: 10 });
      if (!fila) throw new Error("no se registró");
      return fila.id;
    }

    test("registrarPlan guarda una fila por lead, con su tanda o su motivo", async () => {
      await repo.registrarPlan([
        enCola(d1, f.leads.l1, T1),
        enCola(d1, f.leads.l2, T2, { ruta: "ventana_abierta" }),
        excluido(d1, f.leads.l3, T3, "baja_propia"),
        excluido(d1, f.leads.l4, null, "sin_telefono"),
      ]);

      const filas = await repo.listarPorDifusion(d1, { limite: 10 });

      expect(filas).toHaveLength(4);
      const porLead = new Map(filas.map((x) => [x.lead_id, x]));
      expect(porLead.get(f.leads.l1)?.estado).toBe("en_cola");
      expect(porLead.get(f.leads.l1)?.programado_para?.toISOString()).toBe(HOY.toISOString());
      expect(porLead.get(f.leads.l2)?.ruta).toBe("ventana_abierta");
      expect(porLead.get(f.leads.l3)?.motivo_exclusion).toBe("baja_propia");
      expect(porLead.get(f.leads.l4)?.telefono).toBeNull();
    });

    // Reintentar la persistencia de un plan (un step de Inngest que se repite)
    // no puede duplicar filas ni pisar lo que ya avanzó.
    test("registrarPlan es idempotente: repetirlo no duplica ni pisa", async () => {
      const plan = [enCola(d1, f.leads.l1, T1), enCola(d1, f.leads.l2, T2)];
      await repo.registrarPlan(plan);
      const [primera] = await repo.listarPorDifusion(d1, { limite: 10 });
      await repo.marcarAceptado(primera!.id, wamid());

      await repo.registrarPlan(plan);

      const filas = await repo.listarPorDifusion(d1, { limite: 10 });
      expect(filas).toHaveLength(2);
      expect(filas.find((x) => x.id === primera!.id)?.estado).toBe("aceptado");
    });

    test("dos envíos al mismo teléfono en la misma difusión chocan", async () => {
      await expect(
        repo.registrarPlan([enCola(d1, f.leads.l1, T1), enCola(d1, f.leads.l2, T1)]),
      ).rejects.toThrow(ConflictError);
    });

    test("el duplicado excluido sí comparte el teléfono del que sale", async () => {
      await repo.registrarPlan([
        enCola(d1, f.leads.l1, T1),
        excluido(d1, f.leads.l2, T1, "duplicado_telefono"),
      ]);
      expect(await repo.listarPorDifusion(d1, { limite: 10 })).toHaveLength(2);
    });

    test("el mismo teléfono puede salir en dos difusiones distintas", async () => {
      await repo.registrarPlan([enCola(d1, f.leads.l1, T1), enCola(d2, f.leads.l1, T1)]);
      expect(await repo.listarPorDifusion(d2, { limite: 10 })).toHaveLength(1);
    });

    test("un envío no nace aceptado", async () => {
      await expect(
        repo.registrarPlan([
          { ...enCola(d1, f.leads.l1, T1), estado: "aceptado" as DifusionEnvioInsert["estado"] },
        ]),
      ).rejects.toThrow(ValidationError);
    });

    test("un envío en cola sin tanda se rechaza", async () => {
      await expect(
        repo.registrarPlan([enCola(d1, f.leads.l1, T1, { tanda: null, programado_para: null })]),
      ).rejects.toThrow(ValidationError);
    });

    test("un teléfono sin normalizar se rechaza", async () => {
      await expect(repo.registrarPlan([enCola(d1, f.leads.l1, "+593990000001")])).rejects.toThrow(
        ValidationError,
      );
    });

    test("contarPorDifusion desglosa por estado y por motivo", async () => {
      await repo.registrarPlan([
        enCola(d1, f.leads.l1, T1),
        enCola(d1, f.leads.l2, T2),
        excluido(d1, f.leads.l3, T3, "baja_meta"),
        excluido(d1, f.leads.l4, T1, "duplicado_telefono"),
      ]);

      const c = await repo.contarPorDifusion(d1);

      expect(c.total).toBe(4);
      expect(c.porEstado.en_cola).toBe(2);
      expect(c.porEstado.excluido).toBe(2);
      expect(c.porMotivo.baja_meta).toBe(1);
      expect(c.porMotivo.duplicado_telefono).toBe(1);
      expect(c.porMotivo.baja_propia).toBe(0);
    });

    test("contarPorDifusion de una difusión sin envíos da ceros", async () => {
      const c = await repo.contarPorDifusion(d2);
      expect(c.total).toBe(0);
      expect(c.porEstado.en_cola).toBe(0);
    });

    // El 200 de la Cloud API es "aceptado", nunca "enviado" (§6.6).
    test("marcarAceptado guarda el wamid y es idempotente con el mismo", async () => {
      const id = await unoEnCola();
      const w = wamid();

      const a = await repo.marcarAceptado(id, w);
      expect(a.estado).toBe("aceptado");
      expect(a.meta_message_id).toBe(w);

      expect((await repo.marcarAceptado(id, w)).estado).toBe("aceptado");
    });

    test("marcarAceptado sobre un excluido es un estado ilegal", async () => {
      await repo.registrarPlan([excluido(d1, f.leads.l1, T1, "baja_propia")]);
      const [fila] = await repo.listarPorDifusion(d1, { limite: 10 });
      await expect(repo.marcarAceptado(fila!.id, wamid())).rejects.toThrow(IllegalStateError);
    });

    test("marcarAceptado de un envío inexistente lanza NotFoundError", async () => {
      await expect(repo.marcarAceptado(f.desconocido, wamid())).rejects.toThrow(NotFoundError);
    });

    test("marcarFallido guarda el código de Meta", async () => {
      const id = await unoEnCola();

      const x = await repo.marcarFallido(id, { codigo: "131026", detalle: "sin WhatsApp" });

      expect(x.estado).toBe("fallido");
      expect(x.error_codigo).toBe("131026");
    });

    test("el webhook avanza aceptado → entregado → leído y nunca retrocede", async () => {
      const id = await unoEnCola();
      const w = wamid();
      await repo.marcarAceptado(id, w);

      expect((await repo.aplicarEstadoMeta(w, "entregado"))?.estado).toBe("entregado");
      expect((await repo.aplicarEstadoMeta(w, "leido"))?.estado).toBe("leido");
      // Meta no garantiza el orden de los webhooks: un "entregado" tardío llega
      // después del "leído" y no puede deshacerlo.
      expect((await repo.aplicarEstadoMeta(w, "entregado"))?.estado).toBe("leido");
    });

    test("el webhook de un wamid que no es de una difusión devuelve null", async () => {
      expect(await repo.aplicarEstadoMeta("wamid.de.otra.cosa", "entregado")).toBeNull();
    });

    test("un fallido que informa Meta después de aceptar guarda el código", async () => {
      const id = await unoEnCola();
      const w = wamid();
      await repo.marcarAceptado(id, w);

      const x = await repo.aplicarEstadoMeta(w, "fallido", { codigo: "131049" });

      expect(x?.estado).toBe("fallido");
      expect(x?.error_codigo).toBe("131049");
    });

    test("un fallido sin código se rechaza", async () => {
      const id = await unoEnCola();
      const w = wamid();
      await repo.marcarAceptado(id, w);
      await expect(repo.aplicarEstadoMeta(w, "fallido")).rejects.toThrow(ValidationError);
    });

    // "Detener frena lo pendiente y dice qué ya no se puede recuperar" (§8.5).
    test("cancelarPendientes frena lo que está en cola y cuenta lo que ya salió", async () => {
      await repo.registrarPlan([
        enCola(d1, f.leads.l1, T1),
        enCola(d1, f.leads.l2, T2),
        enCola(d1, f.leads.l3, T3),
      ]);
      const [a, b] = await repo.listarPorDifusion(d1, { limite: 10 });
      const w = wamid();
      await repo.marcarAceptado(a!.id, w);
      await repo.aplicarEstadoMeta(w, "entregado");
      await repo.marcarAceptado(b!.id, wamid());

      const r = await repo.cancelarPendientes(d1);

      expect(r).toEqual({ cancelados: 1, yaSalieron: 2 });
      expect((await repo.contarPorDifusion(d1)).porEstado.cancelado).toBe(1);
    });

    // Si estaba en vuelo cuando se detuvo y Meta lo aceptó, salió: la fila
    // tiene que decirlo, aunque diga "cancelado".
    test("un cancelado que Meta aceptó en vuelo termina aceptado", async () => {
      const id = await unoEnCola();
      await repo.cancelarPendientes(d1);

      expect((await repo.marcarAceptado(id, wamid())).estado).toBe("aceptado");
    });

    test("saturadosDesde devuelve el último 131049 por teléfono desde la fecha", async () => {
      await repo.registrarPlan([enCola(d1, f.leads.l1, T1), enCola(d1, f.leads.l2, T2)]);
      const [a, b] = await repo.listarPorDifusion(d1, { limite: 10 });
      const wa = wamid();
      const wb = wamid();
      await repo.marcarAceptado(a!.id, wa);
      await repo.marcarAceptado(b!.id, wb);
      await repo.aplicarEstadoMeta(wa, "fallido", { codigo: "131049" });
      await repo.aplicarEstadoMeta(wb, "fallido", { codigo: "131026" });
      const telA = a!.telefono!;

      // Margen de una hora a cada lado: la fecha la pone la base, no este reloj.
      const recientes = await repo.saturadosDesde([T1, T2], new Date(Date.now() - 3_600_000));
      expect([...recientes.keys()]).toEqual([telA]);
      expect(recientes.get(telA)).toBeInstanceOf(Date);

      expect((await repo.saturadosDesde([T1, T2], new Date(Date.now() + 3_600_000))).size).toBe(0);
    });

    test("saturadosDesde con una lista vacía no consulta nada", async () => {
      expect((await repo.saturadosDesde([], new Date(0))).size).toBe(0);
    });

    // Las lecturas agregadas del listado y del envío en curso: la base cuenta,
    // la app no trae la audiencia entera para contarla.
    test("resumenPorDifusiones cuenta por estado, una entrada por difusión con envíos", async () => {
      await repo.registrarPlan([
        enCola(d1, f.leads.l1, T1),
        enCola(d1, f.leads.l2, T2),
        excluido(d1, f.leads.l3, T3, "baja_propia"),
        enCola(d2, f.leads.l1, T1),
      ]);
      const [primera] = await repo.listarPorDifusion(d1, { limite: 10 });
      await repo.marcarAceptado(primera!.id, wamid());

      const r = await repo.resumenPorDifusiones([d1, d2, f.desconocido]);

      expect(r.get(d1)?.total).toBe(3);
      expect(r.get(d1)?.porEstado.aceptado).toBe(1);
      expect(r.get(d1)?.porEstado.en_cola).toBe(1);
      expect(r.get(d1)?.porEstado.excluido).toBe(1);
      expect(r.get(d1)?.porEstado.entregado).toBe(0);
      expect(r.get(d2)?.total).toBe(1);
      expect(r.has(f.desconocido)).toBe(false);
    });

    test("resumenPorDifusiones sin ids devuelve un mapa vacío", async () => {
      expect((await repo.resumenPorDifusiones([])).size).toBe(0);
    });

    test("tandasPorDifusion devuelve el plan persistido por tanda, en orden", async () => {
      const manana = new Date(HOY.getTime() + 86_400_000);
      await repo.registrarPlan([
        enCola(d1, f.leads.l1, T1, { tanda: 1, programado_para: manana }),
        enCola(d1, f.leads.l2, T2, { ruta: "ventana_abierta" }),
        enCola(d1, f.leads.l3, T3),
        excluido(d1, f.leads.l4, null, "sin_telefono"),
      ]);
      const filas = await repo.listarPorDifusion(d1, { limite: 10 });
      const deL3 = filas.find((x) => x.lead_id === f.leads.l3);
      await repo.marcarAceptado(deL3!.id, wamid());

      expect(await repo.tandasPorDifusion(d1)).toEqual([
        { tanda: 0, desde: HOY, total: 2, enCola: 1, porPlantilla: 1 },
        { tanda: 1, desde: manana, total: 1, enCola: 1, porPlantilla: 1 },
      ]);
    });

    test("fallosPorCodigo agrupa por código de Meta, el más frecuente primero", async () => {
      await repo.registrarPlan([
        enCola(d1, f.leads.l1, T1),
        enCola(d1, f.leads.l2, T2),
        enCola(d1, f.leads.l3, T3),
      ]);
      const filas = await repo.listarPorDifusion(d1, { limite: 10 });
      await repo.marcarFallido(filas[0]!.id, { codigo: "131026" });
      await repo.marcarFallido(filas[1]!.id, { codigo: "131049" });
      await repo.marcarFallido(filas[2]!.id, { codigo: "131049" });

      expect(await repo.fallosPorCodigo(d1)).toEqual([
        { codigo: "131049", cantidad: 2 },
        { codigo: "131026", cantidad: 1 },
      ]);
    });

    test("fallosPorCodigo sin fallidos devuelve una lista vacía", async () => {
      await repo.registrarPlan([enCola(d1, f.leads.l1, T1)]);
      expect(await repo.fallosPorCodigo(d1)).toEqual([]);
    });

    test("listarPorDifusion con un límite fuera de rango se rechaza", async () => {
      await expect(repo.listarPorDifusion(d1, { limite: 0 })).rejects.toThrow(ValidationError);
      await expect(repo.listarPorDifusion(d1, { limite: 1001 })).rejects.toThrow(ValidationError);
    });

    test("listarPorDifusion pagina en orden estable", async () => {
      await repo.registrarPlan([
        enCola(d1, f.leads.l1, T1, { tanda: 1 }),
        enCola(d1, f.leads.l2, T2, { tanda: 0 }),
        excluido(d1, f.leads.l3, T3, "cap_frecuencia"),
      ]);

      const primera = await repo.listarPorDifusion(d1, { limite: 2 });
      const segunda = await repo.listarPorDifusion(d1, { limite: 2, desde: 2 });

      expect(primera.map((x) => x.tanda)).toEqual([0, 1]);
      expect(segunda.map((x) => x.estado)).toEqual(["excluido"]);
    });
  });
}
