import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotFoundError } from "@/lib/errors";
import { InMemoryAdminAuditRepository } from "@/server/repositories/admin-audit.repo";
import { InMemoryLeadIdentificadoresRepository } from "@/server/repositories/lead-identificadores.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryLeadVehiculosRepository } from "@/server/repositories/lead-vehiculos.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryMergeCandidatesRepository } from "@/server/repositories/merge-candidates.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { InMemoryTagsRepository } from "@/server/repositories/tags.repo";
import { DefaultAdminAuditService } from "@/server/services/admin-audit.service";
import { DefaultLeadsService } from "@/server/services/leads/default-leads.service";
import type { Lead } from "@/types/entities";

describe("vehículos del lead", () => {
  let leads: InMemoryLeadsRepository;
  let vehiculos: InMemoryLeadVehiculosRepository;
  let svc: DefaultLeadsService;
  let lead: Lead;

  beforeEach(async () => {
    leads = new InMemoryLeadsRepository();
    vehiculos = new InMemoryLeadVehiculosRepository();
    svc = new DefaultLeadsService({
      leads,
      sessions: new InMemoryLeadSessionRepository(),
      candidates: new InMemoryMergeCandidatesRepository(),
      tags: new InMemoryTagsRepository(),
      messages: new InMemoryMessagesRepository(),
      audit: new DefaultAdminAuditService(new InMemoryAdminAuditRepository()),
      identificadores: new InMemoryLeadIdentificadoresRepository(),
      vehiculos,
    });
    lead = await leads.create({
      nombre: "Taller Sur",
      telefono: "+5491100000001",
      email: null,
      direccion: null,
      vehiculo_marca: null,
      vehiculo_modelo: null,
      vehiculo_anio: null,
      vehiculo_motor: null,
      empresa_id: null,
      canal_origen: "wa",
      meta_user_ids: { wa: "w-1" },
    });
  });

  test("la placa se guarda normalizada y también como se escribió", async () => {
    // Es lo que hace que "AB-123-CD" y "AB123CD" sean el mismo auto para el
    // detector de duplicados, sin perder cómo lo dictó el cliente.
    const v = await svc.agregarVehiculo({
      leadId: lead.id,
      marca: "Toyota",
      placa: "ab-123-cd",
    });
    expect(v.placa).toBe("AB123CD");
    expect(v.placa_original).toBe("ab-123-cd");
  });

  test("el primer auto queda principal y el segundo no le saca el puesto", async () => {
    const uno = await svc.agregarVehiculo({ leadId: lead.id, marca: "Toyota" });
    const dos = await svc.agregarVehiculo({ leadId: lead.id, marca: "Ford" });
    expect(uno.principal).toBe(true);
    expect(dos.principal).toBe(false);
  });

  test("un lead puede tener varios autos", async () => {
    await svc.agregarVehiculo({ leadId: lead.id, marca: "Toyota", modelo: "Hilux" });
    await svc.agregarVehiculo({ leadId: lead.id, marca: "Ford", modelo: "Focus" });
    const lista = await vehiculos.listByLeadId(lead.id);
    expect(lista).toHaveLength(2);
    // El principal primero: es el que la ficha muestra como el auto del lead.
    expect(lista[0]?.marca).toBe("Toyota");
  });

  test("cadena vacía borra la placa; no mandarla la deja como está", async () => {
    const v = await svc.agregarVehiculo({
      leadId: lead.id,
      placa: "AB123CD",
      vin: "8AJFA3CD1K0123456",
    });

    const sinPlaca = await svc.editarIdentidadVehiculo({
      leadId: lead.id,
      vehiculoId: v.id,
      placa: "",
    });
    expect(sinPlaca.placa).toBeNull();
    // El VIN no viajó en el patch, así que sobrevive.
    expect(sinPlaca.vin).toBe("8AJFA3CD1K0123456");
  });

  test("no se puede editar el auto de otro lead con un id suelto", async () => {
    // La RLS deja a un vendedor tocar la fila de cualquier lead: la guarda de
    // pertenencia vive en el service y es la única que frena esto.
    const otro = await leads.create({
      nombre: "Otro",
      telefono: "+5491100000002",
      email: null,
      direccion: null,
      vehiculo_marca: null,
      vehiculo_modelo: null,
      vehiculo_anio: null,
      vehiculo_motor: null,
      empresa_id: null,
      canal_origen: "wa",
      meta_user_ids: { wa: "w-2" },
    });
    const ajeno = await svc.agregarVehiculo({ leadId: otro.id, marca: "Ajeno" });
    const borrar = vi.spyOn(vehiculos, "delete");

    await expect(
      svc.quitarVehiculo({ leadId: lead.id, vehiculoId: ajeno.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(borrar).not.toHaveBeenCalled();
  });

  test("getLeadDetail devuelve los autos del lead", async () => {
    await svc.agregarVehiculo({ leadId: lead.id, marca: "Toyota", modelo: "Hilux" });
    const detalle = await svc.getLeadDetail(lead.id);
    expect(detalle.vehiculos).toHaveLength(1);
    expect(detalle.vehiculos[0]?.modelo).toBe("Hilux");
  });
});
