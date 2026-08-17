import { porcentajeDe } from "@/lib/ui/metricas";
import { FUNNEL_STAGES } from "@/lib/ui/stage";
import type {
  FilaLlmUsageMetrica,
  FilaMensajeMetrica,
  FilaSesionMetrica,
  FilaToolExecutionMetrica,
  FilaUsuarioMetrica,
  MetricsRepository,
} from "@/server/repositories/metrics.repo";
import { CANAL, CURRENT_STAGE, SENDER, WORKFLOW_LLM } from "@/types/domain";
import type { Canal, CurrentStage, Sender } from "@/types/domain";
import type {
  ConteoCanal,
  ConteoCodigo,
  ConteoHerramienta,
  ConteoMotivo,
  ConteoWorkflow,
  FilaVendedor,
  GastoIa,
  IntentSinRegla,
  Metricas,
  Ventas,
} from "@/types/metricas";
import type { MetricsService } from "./metricas.service";

const MOTIVO_LABEL: Record<string, string> = {
  precio: "Precio",
  stock: "Sin stock",
  tiempo: "Tiempos de entrega",
  no_responde: "No responde",
  otro: "Otro",
};

/** Etapas que no son el embudo: se cuentan aparte para no falsear el progreso. */
const DESVIOS: CurrentStage[] = CURRENT_STAGE.filter(
  (s) => !(FUNNEL_STAGES as readonly string[]).includes(s),
);

const DIA_MS = 24 * 60 * 60 * 1000;

/** Éxito sobre lo ya resuelto: las sesiones abiertas todavía no votaron. */
function tasaCierreDe(sesiones: FilaSesionMetrica[]): number {
  let exito = 0;
  let resueltas = 0;
  for (const s of sesiones) {
    if (s.resultado === null) continue;
    resueltas++;
    if (s.resultado === "exito") exito++;
  }
  return porcentajeDe(exito, resueltas);
}

export class DefaultMetricsService implements MetricsService {
  constructor(private readonly deps: { metrics: MetricsRepository }) {}

  async obtener(desde: Date, hasta: Date, ahora: Date = new Date()): Promise<Metricas> {
    const ventana = hasta.getTime() - desde.getTime();
    // La ventana anterior se pide solo para sesiones y leads, que son tablas
    // chicas. Mensajes es el corte más caro de la pantalla y duplicarlo para
    // poder dibujar un delta más no lo justifica: por eso las métricas que
    // dependen de mensajes viajan con `anterior: null` y la UI no muestra delta.
    const desdeAnterior = new Date(desde.getTime() - ventana);

    const [
      sesionesAmbas,
      mensajes,
      leadsAmbos,
      reglas,
      tools,
      intents,
      reglasActivas,
      clasificaciones,
      usuarios,
      gastos,
      handoffs,
    ] = await Promise.all([
      this.deps.metrics.listSesionesDesde(desdeAnterior),
      this.deps.metrics.listMensajesDesde(desde),
      this.deps.metrics.listLeadsDesde(desdeAnterior),
      this.deps.metrics.listRuleExecutionsDesde(desde),
      this.deps.metrics.listToolExecutionsDesde(desde),
      this.deps.metrics.listIntentsActivos(),
      this.deps.metrics.listReglasActivas(),
      this.deps.metrics.listTurnClassificationsDesde(desde),
      this.deps.metrics.listUsuarios(),
      this.deps.metrics.listLlmUsageDesde(desde),
      this.deps.metrics.listHandoffsDesde(desde),
    ]);

    const corte = desde.getTime();
    const dias = Math.round(ventana / DIA_MS);
    const sesiones = sesionesAmbas.filter((s) => s.started_at.getTime() >= corte);
    const sesionesAnteriores = sesionesAmbas.filter((s) => s.started_at.getTime() < corte);
    const leadsNuevos = leadsAmbos.filter((l) => l.created_at.getTime() >= corte).length;
    const leadsAnteriores = leadsAmbos.length - leadsNuevos;

    const porEtapa = new Map<CurrentStage, number>();
    const motivos = new Map<string, number>();
    const codigosMap = new Map<
      string,
      { apariciones: number; unidades: number; unidadesConDato: number }
    >();
    const tiemposCierre: number[] = [];
    let exito = 0;
    let perdido = 0;
    let ventasConPrecio = 0;
    let ventasMontoTotal = 0;

    for (const s of sesiones) {
      porEtapa.set(s.current_stage, (porEtapa.get(s.current_stage) ?? 0) + 1);

      if (s.closed_at !== null && s.resultado !== null) {
        tiemposCierre.push((s.closed_at.getTime() - s.started_at.getTime()) / 1000);
      }

      if (s.resultado === "exito") {
        exito++;
        if (s.precio_cotizado !== null) {
          ventasConPrecio++;
          ventasMontoTotal += s.precio_cotizado;
        }
        if (s.codigo_interno !== null) {
          const fila = codigosMap.get(s.codigo_interno) ?? {
            apariciones: 0,
            unidades: 0,
            unidadesConDato: 0,
          };
          fila.apariciones++;
          if (s.cantidad !== null) {
            fila.unidades += s.cantidad;
            fila.unidadesConDato++;
          }
          codigosMap.set(s.codigo_interno, fila);
        }
      } else if (s.resultado === "perdido") {
        perdido++;
        // El motivo puede venir null incluso en una sesión perdida: se cierra
        // sin motivo desde la UI y contarlo como "otro" mentiría sobre el dato.
        const clave = s.motivo_perdida ?? "sin_motivo";
        motivos.set(clave, (motivos.get(clave) ?? 0) + 1);
      }
    }

    const ventas: Ventas = {
      conteo: exito,
      conPrecio: ventasConPrecio,
      montoTotalUsd: ventasConPrecio > 0 ? ventasMontoTotal : null,
      ticketPromedioUsd: ventasConPrecio > 0 ? ventasMontoTotal / ventasConPrecio : null,
    };

    const codigosMasVendidos: ConteoCodigo[] = [...codigosMap.entries()]
      .map(([codigoInterno, v]) => ({ codigoInterno, ...v }))
      .sort(
        (a, b) => b.apariciones - a.apariciones || a.codigoInterno.localeCompare(b.codigoInterno),
      );

    const tiempoCierre = {
      medianaSegundos: medianaSegundos(tiemposCierre),
      muestras: tiemposCierre.length,
    };

    const porMotivo: ConteoMotivo[] = [...motivos.entries()]
      .map(([motivo, cantidad]) => ({
        motivo:
          motivo === "sin_motivo" ? "Sin motivo registrado" : (MOTIVO_LABEL[motivo] ?? motivo),
        cantidad,
      }))
      .sort((a, b) => b.cantidad - a.cantidad || a.motivo.localeCompare(b.motivo));

    const autoria = Object.fromEntries(SENDER.map((s) => [s, 0])) as Record<Sender, number>;
    const porCanalConteo = new Map<Canal, number>();
    // Un humano que escribió es la señal de que alguien intervino; quién fue
    // sale de `sender_user_id`, que el envío del panel ahora sí propaga.
    const sesionesConHumano = new Set<string>();
    // El hilo de cada sesión, para poder mirar el orden de los mensajes: quién
    // contestó primero y cuánto esperó el cliente antes de esa respuesta.
    const hilos = new Map<string, FilaMensajeMetrica[]>();
    for (const m of mensajes) {
      autoria[m.sender]++;
      porCanalConteo.set(m.canal, (porCanalConteo.get(m.canal) ?? 0) + 1);
      if (m.sender === "humano") sesionesConHumano.add(m.lead_session_id);
      const hilo = hilos.get(m.lead_session_id);
      if (hilo) hilo.push(m);
      else hilos.set(m.lead_session_id, [m]);
    }
    for (const hilo of hilos.values()) {
      hilo.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
    }

    // Orden canónico y no por cantidad: la barra apilada se lee comparando
    // períodos, y reordenarla según quién ganó esta semana rompe esa lectura.
    const porCanal: ConteoCanal[] = CANAL.map((canal) => ({
      canal,
      cantidad: porCanalConteo.get(canal) ?? 0,
    })).filter((c) => c.cantidad > 0);

    let escaladas = 0;
    let tomadas = 0;
    let resueltasPorIa = 0;
    let cierresIa = 0;
    let cierresVendedor = 0;
    for (const s of sesiones) {
      const escribioHumano = sesionesConHumano.has(s.id);
      if (escribioHumano) tomadas++;
      if (escribioHumano || s.current_stage === "requiere_humano") escaladas++;
      if (!escribioHumano && s.resultado !== null) resueltasPorIa++;
      if (s.resultado === "exito") {
        // La atribución del cierre mira solo si un humano llegó a escribir:
        // una sesión parada en `requiere_humano` que nadie atendió la cerró la IA.
        if (escribioHumano) cierresVendedor++;
        else cierresIa++;
      }
    }

    // Cada fila de `rule_executions` es un turno que contestó una regla IF/THEN
    // en vez del LLM, así que el resto de lo que mandó la IA se resolvió con
    // modelo. El clamp cubre el desfase de borde: la regla se audita contra el
    // mensaje entrante y su saliente puede haber caído fuera de la ventana.
    const turnosRegla = Math.min(reglas.length, autoria.ia);
    const herramientas: ConteoHerramienta[] = agruparHerramientas(tools);
    const repuestosMasPreguntados = medirDemandaCatalogo(tools);

    // Turnos que el LLM resolvió con cada intent. Los de `intent_id: null` son
    // los que no reconoció ninguno: no pertenecen a ninguna fila de la lista.
    const usosPorIntent = new Map<string, number>();
    for (const c of clasificaciones) {
      if (c.intent_id === null) continue;
      usosPorIntent.set(c.intent_id, (usosPorIntent.get(c.intent_id) ?? 0) + 1);
    }

    // Un intent sin regla activa es uno que hoy contesta el LLM. Ordenados por
    // uso: el de arriba es el que más turnos está pagando, y por eso el que más
    // rinde cubrir con una regla. A igual uso, el más nuevo primero.
    const conRegla = new Set(reglasActivas.map((r) => r.intent_id));
    const intentsSinRegla: IntentSinRegla[] = intents
      .filter((i) => !conRegla.has(i.id))
      .map((i) => ({
        id: i.id,
        nombre: i.nombre,
        descripcion: i.descripcion,
        autoDetectado: i.auto_detectado,
        detectadoEl: i.created_at,
        usos: usosPorIntent.get(i.id) ?? 0,
      }))
      .sort(
        (a, b) =>
          b.usos - a.usos ||
          b.detectadoEl.getTime() - a.detectadoEl.getTime() ||
          a.nombre.localeCompare(b.nombre),
      );

    const vendedores = repartirPorVendedor(sesiones, hilos, usuarios);
    const tiempoPrimeraRespuesta = medirPrimerasRespuestas(hilos);
    const etiquetasHandoff: Record<string, string> = {
      unknown_intents: "Intents desconocidos",
      sensitive_keyword: "Palabra sensible",
      quote_limit: "Límite de cotización",
      discount_limit: "Límite de descuento",
      rule_handoff: "Regla de revisión",
      manual_pause: "Pausa manual",
      manual_resume: "Reanudación manual",
      other: "Otro",
    };
    const razonConteo = new Map<string, number>();
    for (const event of handoffs) {
      if (event.action !== "pause") continue;
      const label = etiquetasHandoff[event.reason_code] ?? "Sin motivo registrado";
      razonConteo.set(label, (razonConteo.get(label) ?? 0) + 1);
    }

    return {
      desde,
      dias,
      totalSesiones: sesiones.length,
      leadsNuevos: { valor: leadsNuevos, anterior: leadsAnteriores },
      tasaCierre: {
        valor: tasaCierreDe(sesiones),
        anterior: tasaCierreDe(sesionesAnteriores),
      },
      embudo: FUNNEL_STAGES.map((stage) => ({ stage, cantidad: porEtapa.get(stage) ?? 0 })),
      desvios: DESVIOS.map((stage) => ({ stage, cantidad: porEtapa.get(stage) ?? 0 })),
      porCanal,
      resultado: {
        abiertas: sesiones.length - exito - perdido,
        exito,
        perdido,
        porMotivo,
      },
      autoria,
      agente: {
        sinIntervencionHumana: sesiones.length - tomadas,
        resueltasPorIa,
        escaladas,
      },
      tomadasPorHumano: tomadas,
      tiempoPrimeraRespuesta,
      razonesEscalado: [...razonConteo.entries()]
        .map(([motivo, cantidad]) => ({ motivo, cantidad }))
        .sort((a, b) => b.cantidad - a.cantidad || a.motivo.localeCompare(b.motivo, "es")),
      vendedores,
      cierres: { ia: cierresIa, vendedor: cierresVendedor },
      turnos: {
        regla: turnosRegla,
        llm: autoria.ia - turnosRegla,
        escalado: autoria.humano,
      },
      gasto: resumirGasto(gastos, ahora, leadsNuevos, turnosRegla),
      herramientas,
      intentsSinRegla,
      ventas,
      codigosMasVendidos,
      repuestosMasPreguntados,
      tiempoCierre,
    };
  }
}

/**
 * Reduce las filas de `llm_usage` a lo que muestran los §3.1 y §3.2.
 *
 * El corte de "hoy" usa el día UTC, el mismo que usa el contador diario del
 * `CostTracker`: si acá se usara la hora local del server, el número de la
 * pantalla y el que decide el kill switch discreparían durante horas.
 *
 * `ahorroReglasUsd` es una estimación, y su base está elegida a conciencia: un
 * turno que contestó una regla es exactamente un turno que, sin esa regla,
 * habría ido al agente —el pipeline consulta reglas antes del LLM y sigue de
 * largo si ninguna matchea—. Lo que la estimación no puede corregir es que el
 * promedio se calcula sobre turnos que ninguna regla cubrió, que tienden a ser
 * los más caros; el número queda por encima del ahorro real y la UI lo dice.
 */
function resumirGasto(
  gastos: FilaLlmUsageMetrica[],
  ahora: Date,
  leadsNuevos: number,
  turnosRegla: number,
): GastoIa {
  const hoy = ahora.toISOString().slice(0, 10);
  const porWorkflow = new Map<string, ConteoWorkflow>();

  let totalUsd = 0;
  let hoyUsd = 0;
  let tokensEntrada = 0;
  let tokensSalida = 0;
  let usdAgente = 0;
  let turnosAgente = 0;

  for (const g of gastos) {
    totalUsd += g.costo_usd;
    tokensEntrada += g.input_tokens;
    tokensSalida += g.output_tokens;
    if (g.created_at.toISOString().slice(0, 10) === hoy) hoyUsd += g.costo_usd;
    if (g.workflow === WORKFLOW_LLM.agente) {
      usdAgente += g.costo_usd;
      turnosAgente++;
    }
    const fila = porWorkflow.get(g.workflow) ?? { workflow: g.workflow, usd: 0, llamadas: 0 };
    fila.usd += g.costo_usd;
    fila.llamadas++;
    porWorkflow.set(g.workflow, fila);
  }

  const promedioTurnoUsd = turnosAgente > 0 ? usdAgente / turnosAgente : null;

  return {
    totalUsd,
    hoyUsd,
    porLeadUsd: leadsNuevos > 0 ? totalUsd / leadsNuevos : null,
    tokensEntrada,
    tokensSalida,
    llamadas: gastos.length,
    porWorkflow: [...porWorkflow.values()].sort(
      (a, b) => b.usd - a.usd || a.workflow.localeCompare(b.workflow),
    ),
    promedioTurnoUsd,
    ahorroReglasUsd: promedioTurnoUsd === null ? null : promedioTurnoUsd * turnosRegla,
  };
}

/** Llamadas y fallas por herramienta, de la más usada a la menos. */
function agruparHerramientas(tools: FilaToolExecutionMetrica[]): ConteoHerramienta[] {
  const acc = new Map<string, ConteoHerramienta>();
  for (const t of tools) {
    const fila = acc.get(t.tool_name) ?? { nombre: t.tool_name, llamadas: 0, fallidas: 0 };
    fila.llamadas++;
    if (t.error !== null) fila.fallidas++;
    acc.set(t.tool_name, fila);
  }
  return [...acc.values()].sort(
    (a, b) => b.llamadas - a.llamadas || a.nombre.localeCompare(b.nombre),
  );
}

/**
 * Demanda de catálogo desde `buscar_repuesto`, sin depender de que haya
 * productos cargados. `porTermino` es texto libre y se capea a 15 para que una
 * cola larga de variantes de la misma pieza no ahogue la lista; `porMarca` es
 * categórico y acotado (un puñado de marcas de auto), no necesita cap.
 */
function medirDemandaCatalogo(
  tools: FilaToolExecutionMetrica[],
): Metricas["repuestosMasPreguntados"] {
  const marcas = new Map<string, number>();
  const terminos = new Map<string, number>();
  for (const t of tools) {
    if (t.tool_name !== "buscar_repuesto" || !t.args) continue;
    if (t.args.marca) {
      const clave = t.args.marca.trim().toLowerCase();
      if (clave) marcas.set(clave, (marcas.get(clave) ?? 0) + 1);
    }
    if (t.args.query) {
      const clave = t.args.query.trim().toLowerCase();
      if (clave) terminos.set(clave, (terminos.get(clave) ?? 0) + 1);
    }
  }
  const aConteo = (mapa: Map<string, number>) =>
    [...mapa.entries()]
      .map(([motivo, cantidad]) => ({ motivo, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad || a.motivo.localeCompare(b.motivo));
  return {
    porMarca: aConteo(marcas),
    porTermino: aConteo(terminos).slice(0, 15),
  };
}

/** Acumulador mutable de una fila mientras se recorren las sesiones. */
interface AcumuladorVendedor {
  nombre: string;
  tomadas: number;
  cerradas: number;
  esperas: number[];
}

/**
 * Mediana en segundos, redondeada. Con cantidad par promedia los dos del medio.
 * Mediana y no promedio: una sola sesión que quedó abierta de un viernes a un
 * lunes corre el promedio de todos y no dice nada del vendedor.
 */
function medianaSegundos(esperas: number[]): number | null {
  if (esperas.length === 0) return null;
  const orden = [...esperas].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  const alto = orden[medio] ?? 0;
  const valor = orden.length % 2 === 1 ? alto : ((orden[medio - 1] ?? 0) + alto) / 2;
  return Math.round(valor);
}

function medirPrimerasRespuestas(
  hilos: Map<string, FilaMensajeMetrica[]>,
): Metricas["tiempoPrimeraRespuesta"] {
  const muestras = {
    ia: [] as number[],
    revisionAdministrativa: [] as number[],
    personas: [] as number[],
  };
  for (const hilo of hilos.values()) {
    let esperandoDesde: Date | null = null;
    for (const mensaje of hilo) {
      if (mensaje.sender === "lead") {
        if (esperandoDesde === null && mensaje.platform_created_at) {
          esperandoDesde = mensaje.platform_created_at;
        }
        continue;
      }
      if (esperandoDesde === null) continue;
      const delta = (mensaje.created_at.getTime() - esperandoDesde.getTime()) / 1000;
      esperandoDesde = null;
      if (!Number.isFinite(delta) || delta < 0) continue;
      if (mensaje.sender === "humano") muestras.personas.push(delta);
      else if (mensaje.sender === "sistema") muestras.revisionAdministrativa.push(delta);
      else muestras.ia.push(delta);
    }
  }
  const resumen = (values: number[]) => ({
    medianaSegundos: medianaSegundos(values),
    muestras: values.length,
  });
  return {
    ia: resumen(muestras.ia),
    revisionAdministrativa: resumen(muestras.revisionAdministrativa),
    personas: resumen(muestras.personas),
  };
}

/**
 * Quién tomó cada sesión, cuánto tardó y cuántas cerró.
 *
 * "Tomó" es haber sido **la primera persona en escribir** en esa sesión: si
 * después entra otro vendedor a rematar, la sesión sigue contando para quien la
 * levantó — repartirla entre los dos haría que la suma de las filas no dé el
 * total de tomadas.
 *
 * La espera se mide contra el último mensaje del cliente anterior a esa primera
 * respuesta humana: es lo que el cliente tenía sin contestar en el momento en
 * que alguien entró. Las sesiones cuyo hilo empieza dentro de la ventana ya
 * respondido (no hay mensaje del cliente antes) no se miden en vez de contarse
 * como cero, que rebajaría la mediana de quien atendió rápido.
 */
function repartirPorVendedor(
  sesiones: FilaSesionMetrica[],
  hilos: Map<string, FilaMensajeMetrica[]>,
  usuarios: FilaUsuarioMetrica[],
): Metricas["vendedores"] {
  const nombrePorId = new Map(usuarios.map((u) => [u.id, u.nombre]));
  const acc = new Map<string, AcumuladorVendedor>();
  const esperasGlobales: number[] = [];
  let sinAtribuir = 0;

  for (const sesion of sesiones) {
    const hilo = hilos.get(sesion.id);
    if (!hilo) continue;
    const indice = hilo.findIndex((m) => m.sender === "humano");
    if (indice === -1) continue;

    const primeraHumana = hilo[indice];
    if (!primeraHumana) continue;

    // Espera del cliente: se mide igual esté o no atribuida la sesión, porque
    // la mediana global cuenta todo lo que una persona atendió.
    let espera: number | null = null;
    for (let i = indice - 1; i >= 0; i--) {
      const previo = hilo[i];
      if (previo?.sender !== "lead") continue;
      if (!previo.platform_created_at) continue;
      const delta =
        (primeraHumana.created_at.getTime() - previo.platform_created_at.getTime()) / 1000;
      if (delta >= 0) espera = delta;
      break;
    }
    if (espera !== null) esperasGlobales.push(espera);

    // Mensaje humano sin usuario: es de antes de que el envío del panel
    // propagara `sender_user_id`. Se cuenta aparte para que las filas no
    // pretendan cubrir el total.
    const usuarioId = primeraHumana.sender_user_id;
    if (usuarioId === null) {
      sinAtribuir++;
      continue;
    }

    const fila = acc.get(usuarioId) ?? {
      nombre: nombrePorId.get(usuarioId) ?? "Usuario dado de baja",
      tomadas: 0,
      cerradas: 0,
      esperas: [],
    };
    fila.tomadas++;
    if (sesion.resultado === "exito") fila.cerradas++;
    if (espera !== null) fila.esperas.push(espera);
    acc.set(usuarioId, fila);
  }

  const filas: FilaVendedor[] = [...acc.entries()]
    .map(([usuarioId, fila]) => ({
      usuarioId,
      nombre: fila.nombre,
      tomadas: fila.tomadas,
      tomaEnSegundos: medianaSegundos(fila.esperas),
      cerradas: fila.cerradas,
      cierre: porcentajeDe(fila.cerradas, fila.tomadas),
    }))
    .sort(
      (a, b) =>
        b.tomadas - a.tomadas || b.cerradas - a.cerradas || a.nombre.localeCompare(b.nombre),
    );

  return { filas, sinAtribuir, tomaEnSegundos: medianaSegundos(esperasGlobales) };
}
