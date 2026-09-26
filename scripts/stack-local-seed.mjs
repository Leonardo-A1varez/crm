#!/usr/bin/env node
/**
 * Seed del stack LOCAL. Aborta si la URL de Supabase no es 127.0.0.1/localhost.
 *
 * Idempotente: se puede correr las veces que haga falta. Hace falta después de
 * `test:integration`, que vacía `usuarios`, `leads`, `empresas`, etc. Los
 * usuarios de Auth sobreviven a ese TRUNCATE y el trigger `on_auth_user_created`
 * ya no vuelve a disparar, así que `public.usuarios` se reescribe acá a mano.
 *
 * Todo es inventado: nombres con "(prueba)" y teléfonos del rango ficticio de
 * NANP +1 202 555-0100…0199. Las contraseñas vienen de `.env.stack-local`
 * (generadas por stack-local-env.mjs) y no se imprimen.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const archivo = resolve(raiz, ".env.stack-local");
if (!existsSync(archivo)) {
  console.error("Falta .env.stack-local: npm run stack:env");
  process.exit(1);
}
process.loadEnvFile(archivo);

const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const host = (() => {
  try {
    return new URL(URL_SUPABASE).hostname;
  } catch {
    return "";
  }
})();
if (!["127.0.0.1", "localhost"].includes(host)) {
  console.error(
    `El seed solo corre contra el stack local; NEXT_PUBLIC_SUPABASE_URL apunta a "${host}".`,
  );
  process.exit(1);
}

const db = createClient(URL_SUPABASE, process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

function ok({ data, error }, que) {
  if (error) throw new Error(`${que}: ${error.message}`);
  return data;
}

async function usuario(email, password, rol, nombre) {
  const lista = ok(await db.auth.admin.listUsers({ page: 1, perPage: 200 }), "listUsers");
  const existente = lista.users.find((u) => u.email === email);
  let id;
  if (existente) {
    ok(
      await db.auth.admin.updateUserById(existente.id, {
        password,
        app_metadata: { rol, nombre },
        email_confirm: true,
      }),
      `update ${rol}`,
    );
    id = existente.id;
  } else {
    const creado = ok(
      await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { rol, nombre },
      }),
      `create ${rol}`,
    );
    id = creado.user.id;
  }
  ok(
    await db
      .from("usuarios")
      .upsert({ id, nombre, email, rol, activo: true }, { onConflict: "id" }),
    `usuarios ${rol}`,
  );
  return id;
}

async function main() {
  // --- Empresa (single-org: una sola fila) ---
  const empresas = ok(await db.from("empresas").select("id").limit(1), "empresas");
  if (empresas.length === 0) {
    ok(await db.from("empresas").insert({ nombre: "Repuestos Demo (local)" }), "empresa");
  }

  // --- Usuarios ---
  const adminId = await usuario(
    process.env.SEED_ADMIN_EMAIL,
    process.env.SEED_ADMIN_PASSWORD,
    "admin",
    "Admin Local (prueba)",
  );
  const vendedorId = await usuario(
    process.env.SEED_VENDEDOR_EMAIL,
    process.env.SEED_VENDEDOR_PASSWORD,
    "vendedor",
    "Vendedora Local (prueba)",
  );

  // --- Config del agente: versión nueva activa con horario y zona ---
  // Abierto todo el día a propósito: con un horario comercial el agente no
  // contesta fuera de hora (`skipped: fuera_de_horario`) y el entorno no sirve
  // para probar de noche. Para probar ese camino, cambiar el horario en /agente.
  const NOTA = "seed stack local";
  const TODO_EL_DIA = [{ desde: "00:00", hasta: "23:59" }];
  const HORARIO = Object.fromEntries(
    ["lun", "mar", "mie", "jue", "vie", "sab", "dom"].map((d) => [d, TODO_EL_DIA]),
  );
  const ZONA = "America/Guayaquil";
  const activa = ok(
    await db.from("agente_config").select("*").eq("activa", true).maybeSingle(),
    "agente_config activa",
  );
  const vigente =
    activa?.nota === NOTA &&
    activa.horario_timezone === ZONA &&
    Object.keys(HORARIO).every(
      (d) => JSON.stringify(activa.horario?.[d]) === JSON.stringify(HORARIO[d]),
    );
  if (!vigente) {
    const ultima = ok(
      await db
        .from("agente_config")
        .select("version")
        .order("version", { ascending: false })
        .limit(1),
      "agente_config version",
    );
    const base = activa ?? {};
    const { id: _id, created_at: _c, activa: _a, rollback_de: _r, ...resto } = base;
    if (activa) {
      ok(
        await db.from("agente_config").update({ activa: false }).eq("id", activa.id),
        "desactivar",
      );
    }
    ok(
      await db.from("agente_config").insert({
        ...resto,
        version: (ultima[0]?.version ?? 0) + 1,
        activa: true,
        nota: NOTA,
        creada_por: adminId,
        horario: HORARIO,
        horario_timezone: ZONA,
      }),
      "agente_config insert",
    );
  }

  // --- Etiquetas ---
  ok(
    await db.from("tags").upsert(
      [
        { nombre: "Pide factura", color: "#1565C0", descripcion: "Seed local" },
        { nombre: "Cliente frecuente", color: "#2E7D32", descripcion: "Seed local" },
      ],
      { onConflict: "nombre" },
    ),
    "tags",
  );
  const tags = ok(await db.from("tags").select("id, nombre"), "tags select");
  const tagId = (n) => tags.find((t) => t.nombre === n).id;

  // --- Leads, sesión activa, conversación WA, mensajes ---
  const LEADS = [
    {
      nombre: "Carla Mendoza (prueba)",
      telefono: "12025550101",
      etapa: "cotizado",
      consulta: "Radiador para Aveo 2012",
      vehiculo: { marca: "Chevrolet", modelo: "Aveo", anio: 2012, principal: true },
      tags: ["Pide factura", "Cliente frecuente"],
      vendedor: vendedorId,
    },
    {
      nombre: "Jorge Salinas (prueba)",
      telefono: "12025550102",
      etapa: "identificando",
      consulta: "Pastillas de freno delanteras",
      tags: [],
    },
    {
      nombre: "Lucía Paredes (prueba)",
      telefono: "12025550103",
      etapa: "nuevo",
      consulta: null,
      tags: ["Cliente frecuente"],
    },
  ];

  for (const l of LEADS) {
    const [lead] = ok(
      await db
        .from("leads")
        .upsert(
          { nombre: l.nombre, telefono: l.telefono, canal_origen: "wa", nombre_perfil: l.nombre },
          { onConflict: "telefono" },
        )
        .select("id"),
      `lead ${l.telefono}`,
    );

    let sesion = ok(
      await db
        .from("lead_session")
        .select("id")
        .eq("lead_id", lead.id)
        .is("resultado", null)
        .maybeSingle(),
      "sesion activa",
    );
    if (!sesion) {
      [sesion] = ok(
        await db
          .from("lead_session")
          .insert({
            lead_id: lead.id,
            current_stage: l.etapa,
            ...(l.consulta ? { consulta: l.consulta } : {}),
            ...(l.vendedor ? { vendedor_asignado_id: l.vendedor } : {}),
          })
          .select("id"),
        "sesion insert",
      );
    }

    const [conv] = ok(
      await db
        .from("conversaciones")
        .upsert(
          { lead_id: lead.id, canal: "wa", canal_thread_id: l.telefono },
          { onConflict: "canal,canal_thread_id" },
        )
        .select("id"),
      "conversacion",
    );

    const idEntrante = `wamid.SEED-IN-${l.telefono}`;
    const yaHay = ok(
      await db.from("mensajes").select("id").eq("meta_message_id", idEntrante).limit(1),
      "mensajes select",
    );
    if (yaHay.length === 0) {
      ok(
        await db.from("mensajes").insert([
          {
            conversacion_id: conv.id,
            lead_session_id: sesion.id,
            direction: "in",
            sender: "lead",
            tipo: "text",
            contenido: l.consulta ?? "Hola, ¿tienen repuestos?",
            meta_message_id: idEntrante,
          },
          {
            conversacion_id: conv.id,
            lead_session_id: sesion.id,
            direction: "out",
            sender: "ia",
            tipo: "text",
            contenido: "¡Hola! ¿Para qué vehículo lo necesitás? (mensaje de prueba)",
            meta_message_id: `wamid.SEED-OUT-${l.telefono}`,
            estado_entrega: "entregado",
          },
        ]),
        "mensajes insert",
      );
    }

    if (l.vehiculo) {
      const autos = ok(
        await db.from("lead_vehiculos").select("id").eq("lead_id", lead.id).limit(1),
        "vehiculos",
      );
      if (autos.length === 0) {
        ok(await db.from("lead_vehiculos").insert({ lead_id: lead.id, ...l.vehiculo }), "vehiculo");
      }
    }

    for (const nombre of l.tags) {
      ok(
        await db
          .from("lead_tags")
          .upsert(
            { lead_id: lead.id, tag_id: tagId(nombre), source: "manual", assigned_by: adminId },
            { onConflict: "lead_id,tag_id", ignoreDuplicates: true },
          ),
        "lead_tags",
      );
    }
  }

  // --- Flujo de ejemplo: borrador sin publicar (no dispara nada) ---
  const NOMBRE_FLUJO = "Bienvenida de ejemplo (seed)";
  const flujos = ok(
    await db.from("workflows").select("id").eq("nombre", NOMBRE_FLUJO),
    "workflows",
  );
  if (flujos.length === 0) {
    const [wf] = ok(
      await db
        .from("workflows")
        .insert({
          nombre: NOMBRE_FLUJO,
          descripcion: "Grafo de la plantilla bienvenida-agente",
          activo: false,
        })
        .select("id"),
      "workflow insert",
    );
    ok(
      await db.from("workflow_versiones").insert({
        workflow_id: wf.id,
        version: 1,
        publicada: false,
        created_by: adminId,
        grafo: {
          nodos: [
            { id: "n1", tipo: "trigger_lead_creado", config: {}, posicion: { x: 0, y: 0 } },
            {
              id: "n2",
              tipo: "msg_texto",
              config: {
                mensaje:
                  "¡Hola! Gracias por escribirnos. ¿Qué repuesto estás buscando y para qué vehículo (marca, modelo y año)?",
              },
              posicion: { x: 0, y: 144 },
            },
            { id: "n3", tipo: "logica_detener", config: {}, posicion: { x: 0, y: 288 } },
          ],
          aristas: [
            { desde: "n1", hasta: "n2", puerto: "salida" },
            { desde: "n2", hasta: "n3", puerto: "salida" },
          ],
        },
      }),
      "workflow_versiones insert",
    );
  }

  const cuenta = async (t) => (await db.from(t).select("*", { count: "exact", head: true })).count;
  const resumen = {};
  for (const t of [
    "empresas",
    "usuarios",
    "leads",
    "lead_session",
    "conversaciones",
    "mensajes",
    "lead_vehiculos",
    "tags",
    "lead_tags",
    "workflows",
  ]) {
    resumen[t] = await cuenta(t);
  }
  console.log("seed local OK", JSON.stringify(resumen));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
