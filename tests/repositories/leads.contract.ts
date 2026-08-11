import { describe, expect, test, beforeEach } from "vitest";
import type { LeadsRepository, LeadInsert } from "@/server/repositories/leads.repo";

const baseInsert: LeadInsert = {
  nombre: "Juan Pérez",
  telefono: "+595981000111",
  email: null,
  direccion: null,
  vehiculo_marca: "Toyota",
  vehiculo_modelo: "Corolla",
  vehiculo_anio: 2015,
  vehiculo_motor: null,
  empresa_id: null,
  canal_origen: "wa",
  meta_user_ids: { wa: "wa_111" },
};

export function runLeadsContract(makeRepo: () => LeadsRepository) {
  describe("LeadsRepository contract", () => {
    let repo: LeadsRepository;

    beforeEach(() => {
      repo = makeRepo();
    });

    test("create assigns id + timestamps + persists", async () => {
      const lead = await repo.create(baseInsert);

      expect(lead.id).toBeTypeOf("string");
      expect(lead.id.length).toBeGreaterThan(0);
      expect(lead.created_at).toBeInstanceOf(Date);
      expect(lead.updated_at).toBeInstanceOf(Date);
      expect(lead.nombre).toBe(baseInsert.nombre);
      expect(lead.telefono).toBe(baseInsert.telefono);

      const fetched = await repo.findById(lead.id);
      expect(fetched).toEqual(lead);
    });

    test("create rejects duplicate telefono", async () => {
      await repo.create(baseInsert);
      await expect(repo.create(baseInsert)).rejects.toThrow(/telefono/i);
    });

    test("findById returns null when missing", async () => {
      expect(await repo.findById("missing-id")).toBeNull();
    });

    test("findByTelefono matches exact value", async () => {
      const created = await repo.create(baseInsert);
      const found = await repo.findByTelefono(baseInsert.telefono);
      expect(found?.id).toBe(created.id);
      expect(await repo.findByTelefono("+595999999999")).toBeNull();
    });

    test("findByMetaUserId matches canal-specific id", async () => {
      const wa = await repo.create({
        ...baseInsert,
        telefono: "+595981000001",
        meta_user_ids: { wa: "wa_001" },
      });
      const ig = await repo.create({
        ...baseInsert,
        telefono: "+595981000002",
        canal_origen: "ig",
        meta_user_ids: { ig: "ig_002" },
      });

      expect((await repo.findByMetaUserId("wa", "wa_001"))?.id).toBe(wa.id);
      expect((await repo.findByMetaUserId("ig", "ig_002"))?.id).toBe(ig.id);
      expect(await repo.findByMetaUserId("wa", "ig_002")).toBeNull();
      expect(await repo.findByMetaUserId("fb", "wa_001")).toBeNull();
    });

    test("update applies patch + bumps updated_at + preserves id/created_at", async () => {
      const created = await repo.create(baseInsert);
      const beforeUpdated = created.updated_at.getTime();

      await new Promise((r) => setTimeout(r, 5));
      const patched = await repo.update(created.id, { nombre: "Juan Modificado" });

      expect(patched.id).toBe(created.id);
      expect(patched.created_at).toEqual(created.created_at);
      expect(patched.nombre).toBe("Juan Modificado");
      expect(patched.updated_at.getTime()).toBeGreaterThan(beforeUpdated);
    });

    test("update throws when id missing", async () => {
      await expect(repo.update("missing", { nombre: "x" })).rejects.toThrow();
    });

    test("nombre_perfil y datos_extra tienen default y no exigen el insert", async () => {
      const lead = await repo.create({ ...baseInsert, telefono: "+595981000900" });
      expect(lead.nombre_perfil).toBeNull();
      expect(lead.datos_extra).toEqual({});
    });

    test("nombre_perfil viaja aparte de nombre en create y update", async () => {
      const lead = await repo.create({
        ...baseInsert,
        telefono: "+595981000901",
        nombre_perfil: "Juanchi",
      });
      expect(lead.nombre_perfil).toBe("Juanchi");
      expect(lead.nombre).toBe(baseInsert.nombre);

      const patched = await repo.update(lead.id, { nombre_perfil: "Juanchi 🏁" });
      expect(patched.nombre_perfil).toBe("Juanchi 🏁");
      // El nombre de la casa no lo toca el pipeline.
      expect(patched.nombre).toBe(baseInsert.nombre);
    });

    test("datos_extra persiste el objeto entero y se puede vaciar", async () => {
      const lead = await repo.create({
        ...baseInsert,
        telefono: "+595981000902",
        datos_extra: { Cumpleaños: "12/03" },
      });
      expect(lead.datos_extra).toEqual({ Cumpleaños: "12/03" });

      const patched = await repo.update(lead.id, {
        datos_extra: { Cumpleaños: "12/03", Taller: "El Rápido" },
      });
      expect(patched.datos_extra).toEqual({ Cumpleaños: "12/03", Taller: "El Rápido" });

      const vaciado = await repo.update(lead.id, { datos_extra: {} });
      expect(vaciado.datos_extra).toEqual({});
    });

    test("datos_extra devuelto no es el mismo objeto que el guardado", async () => {
      // Sin clone, mutar lo que devuelve el repo contaminaría el storage.
      const lead = await repo.create({
        ...baseInsert,
        telefono: "+595981000903",
        datos_extra: { Taller: "El Rápido" },
      });
      lead.datos_extra.Taller = "otro";

      const fetched = await repo.findById(lead.id);
      expect(fetched?.datos_extra).toEqual({ Taller: "El Rápido" });
    });

    test("delete borra y es no-op si no existe (replay-safe)", async () => {
      const l = await repo.create({ ...baseInsert, telefono: "+5491100000009" });
      await repo.delete(l.id);
      expect(await repo.findById(l.id)).toBeNull();
      await expect(repo.delete(l.id)).resolves.toBeUndefined(); // replay
      await expect(repo.delete(crypto.randomUUID())).resolves.toBeUndefined();
      await expect(repo.delete("missing-id")).resolves.toBeUndefined(); // no-UUID no-op
    });

    test("list returns all when no filter", async () => {
      await repo.create(baseInsert);
      await repo.create({ ...baseInsert, telefono: "+595981000222" });
      const all = await repo.list();
      expect(all).toHaveLength(2);
    });

    test("list filters by q against nombre/telefono substring", async () => {
      await repo.create({ ...baseInsert, nombre: "Ana López", telefono: "+595981000010" });
      await repo.create({ ...baseInsert, nombre: "Beto Sosa", telefono: "+595981000020" });
      const ana = await repo.list({ q: "ana" });
      expect(ana).toHaveLength(1);
      expect(ana[0].nombre).toBe("Ana López");
      const tel = await repo.list({ q: "000020" });
      expect(tel).toHaveLength(1);
      expect(tel[0].nombre).toBe("Beto Sosa");
    });

    test("list respects limit + offset", async () => {
      for (let i = 0; i < 5; i++) {
        await repo.create({ ...baseInsert, telefono: `+5959810001${i}${i}` });
      }
      const page1 = await repo.list({ limit: 2, offset: 0 });
      const page2 = await repo.list({ limit: 2, offset: 2 });
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page1[0].id).not.toBe(page2[0].id);
    });

    test("meta_user_ids no comparte ref con storage (defense vs caller mutation)", async () => {
      const lead = await repo.create(baseInsert);
      // Mutar el meta_user_ids retornado no debe afectar storage interno.
      lead.meta_user_ids.wa = "MUTADO";
      lead.meta_user_ids.ig = "INJECTADO";

      const refetch = await repo.findById(lead.id);
      expect(refetch?.meta_user_ids.wa).toBe("wa_111");
      expect(refetch?.meta_user_ids.ig).toBeUndefined();
    });

    test("input meta_user_ids no compartido con storage (defense vs input mutation post-create)", async () => {
      const meta = { wa: "wa_seed" };
      const lead = await repo.create({
        ...baseInsert,
        telefono: "+595981000999",
        meta_user_ids: meta,
      });
      // Mutar el input post-create no debe afectar storage.
      meta.wa = "MUTADO_INPUT";

      const refetch = await repo.findById(lead.id);
      expect(refetch?.meta_user_ids.wa).toBe("wa_seed");
    });

    test("list ordena por updated_at desc con tiebreak id asc", async () => {
      const a = await repo.create({
        ...baseInsert,
        telefono: "+5491100000001",
        nombre: "Ana",
      });
      await new Promise((r) => setTimeout(r, 5));
      const b = await repo.create({
        ...baseInsert,
        telefono: "+5491100000002",
        nombre: "Beto",
      });
      await new Promise((r) => setTimeout(r, 5));
      await repo.update(b.id, { nombre: "Beto Actualizado" });

      const all = await repo.list();
      expect(all[0]?.id).toBe(b.id); // updated más reciente primero
      expect(all[1]?.id).toBe(a.id);
    });

    test("list q trata coma y paréntesis como literales", async () => {
      await repo.create({
        ...baseInsert,
        telefono: "+5491100000003",
        nombre: "Perez, Juan (taller)",
      });
      await repo.create({
        ...baseInsert,
        telefono: "+5491100000004",
        nombre: "Otra Persona",
      });
      const r = await repo.list({ q: "perez, juan (" });
      expect(r).toHaveLength(1);
      expect(r[0]?.telefono).toBe("+5491100000003");
    });

    test("list q matchea telefono parcial y % literal", async () => {
      await repo.create({
        ...baseInsert,
        telefono: "+549115550001",
        nombre: "Tel Uno",
      });
      await repo.create({
        ...baseInsert,
        telefono: "+549116660002",
        nombre: "Tel 100% Dos",
      });
      await repo.create({
        ...baseInsert,
        telefono: "+549117770003",
        nombre: "Tel 1005 Tres",
      });
      const porTel = await repo.list({ q: "115550" });
      expect(porTel).toHaveLength(1);
      expect(porTel[0]?.nombre).toBe("Tel Uno");
      const porPct = await repo.list({ q: "100%" });
      expect(porPct).toHaveLength(1);
      expect(porPct[0]?.nombre).toBe("Tel 100% Dos");
    });

    test("list q alcanza nombre_perfil, marca y modelo", async () => {
      await repo.create({
        ...baseInsert,
        telefono: "+549118880001",
        nombre: "",
        nombre_perfil: "Chelo del Taller",
      });
      await repo.create({
        ...baseInsert,
        telefono: "+549118880002",
        nombre: "Con Peugeot",
        vehiculo_marca: "Peugeot",
        vehiculo_modelo: "Partner",
      });

      expect((await repo.list({ q: "chelo" }))[0]?.telefono).toBe("+549118880001");
      expect((await repo.list({ q: "peugeot" }))[0]?.telefono).toBe("+549118880002");
      expect((await repo.list({ q: "partner" }))[0]?.telefono).toBe("+549118880002");
    });

    test("idsExtra suma leads que q no matchea, y sin q no filtra nada", async () => {
      const porTexto = await repo.create({
        ...baseInsert,
        telefono: "+549119990001",
        nombre: "Ana Buscada",
      });
      const porId = await repo.create({
        ...baseInsert,
        telefono: "+549119990002",
        nombre: "Nada Que Ver",
      });

      const conExtra = await repo.list({ q: "ana buscada", idsExtra: [porId.id] });
      expect(conExtra.map((l) => l.id).sort()).toEqual([porTexto.id, porId.id].sort());

      // Sin `q` la lista de ids no es un filtro: la búsqueda es lo que la activa.
      expect(await repo.list({ idsExtra: [porId.id] })).toHaveLength(2);
    });

    test("list filtra por canal de origen", async () => {
      await repo.create({ ...baseInsert, telefono: "+549120000001", canal_origen: "wa" });
      const ig = await repo.create({
        ...baseInsert,
        telefono: "+549120000002",
        canal_origen: "ig",
        meta_user_ids: { ig: "ig_1" },
      });

      const soloIg = await repo.list({ canal: "ig" });
      expect(soloIg).toHaveLength(1);
      expect(soloIg[0]?.id).toBe(ig.id);
    });

    test("las cotas de updated_at son desde inclusiva y hasta exclusiva", async () => {
      const lead = await repo.create({ ...baseInsert, telefono: "+549121110001" });
      const sello = lead.updated_at;

      expect(await repo.list({ actualizadoDesde: sello })).toHaveLength(1);
      expect(await repo.list({ actualizadoHasta: sello })).toHaveLength(0);
      expect(await repo.list({ actualizadoDesde: new Date(sello.getTime() + 1) })).toHaveLength(0);
      expect(await repo.list({ actualizadoHasta: new Date(sello.getTime() + 1) })).toHaveLength(1);
    });
  });
}
