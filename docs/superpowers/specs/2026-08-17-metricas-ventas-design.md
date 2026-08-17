# Métricas: ventas realizadas, demanda de catálogo y campañas

> Foco de sesión: pantalla Métricas (AGENTS.md §5.1). Diseño acordado por chat.

## 1. Por qué

`docs/next-session.md` dejaba dos huecos ya vencidos ("1ra respuesta", "por qué se escaló") y dos bloqueados de verdad (costo/lead, ticket promedio). Al abrir la conversación de rediseño se encontró:

- `razonesEscalado` está calculado en `default-metricas.service.ts` desde el commit `480bc53` y **ningún componente lo consume** — `PanelVendedores.tsx` sigue mostrando el `BloqueFaltante` que dice que el dato no existe. Es falso desde ese mismo commit.
- `lead_session` ya tiene `producto_cotizado_id` + `codigo_interno` + `precio_cotizado` + `cantidad` + `closed_at` desde la migración fundacional. "Ticket promedio" y "ventas realizadas" no estaban bloqueados por falta de schema — estaban bloqueados por falta de decisión de negocio sobre qué significa "vendido". Esa decisión ya se tomó: **`resultado = 'exito'`** es la venta, **`precio_cotizado` es el monto total de esa venta** (no unitario).

## 2. Decisiones tomadas en la conversación

| Pregunta                                                     | Decisión                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ¿Qué es "venta realizada"?                                   | Sesión con `resultado = 'exito'`.                                                                                                                                                                                                                                                                                          |
| ¿`precio_cotizado` es unitario o total?                      | **Total** de la cotización. `montoTotalUsd = sum(precio_cotizado)`, sin multiplicar por `cantidad`.                                                                                                                                                                                                                        |
| ¿Ownership/asignación de leads por vendedor?                 | Fuera de alcance. Cola abierta (quien escribe primero, toma) sigue siendo el modelo — no diseñar para 30 vendedores con 3-4 reales (AGENTS regla #8, YAGNI).                                                                                                                                                               |
| ¿Conteo crudo de "quién contestó más mensajes"?              | Fuera de alcance como KPI propio — ya existe `tomadas` + `cierre` por vendedor, que mide rendimiento sin premiar volumen de mensajes.                                                                                                                                                                                      |
| ¿Series temporales con gráfico de tendencia (día/semana)?    | **No por ahora.** Sigue el patrón actual: KPI agregado del rango elegido, sin gráfico de barras por sub-período. Fast-follow si el agregado se queda corto en el uso real.                                                                                                                                                 |
| ¿Atribución de campaña real (Meta `ctwa_clid`) ya?           | No. Se prepara el schema (`campanias` + `leads.campania_id` nullable) sin que ningún código lo escriba todavía. El filtro por campaña usa `leads.created_at` dentro de `[desde, hasta]` como proxy, y la UI lo declara explícitamente como "por fecha, sin atribución" — mismo principio de honestidad que `Faltante.tsx`. |
| ¿Estado vacío para "por qué se escaló" (hoy 0 filas reales)? | Estado propio, sin borde punteado — mismo patrón que ya usa `Seccion` para "Ninguna sesión perdida en el período." Distinto de `Faltante` (que es "no se puede medir"), porque acá sí se puede medir, solo no pasó nunca.                                                                                                  |

## 3. Limitación de schema que hay que aceptar conscientemente

`lead_session` es **1 producto cotizado por sesión** (una sola FK, un solo precio, una sola cantidad). No hay carrito ni líneas de ítem. Si una conversación negocia varios repuestos distintos, solo el último que el extractor escribió queda registrado. Para conversaciones de 5-15 mensajes (AGENTS §1) es aceptable como v1, pero **"códigos más vendidos" refleja "producto principal por venta", no unidades reales de un carrito**. Se documenta en la UI con una nota, no se esconde.

## 4. Schema — una migración nueva

```sql
create table public.campanias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  desde timestamptz not null,
  hasta timestamptz not null,
  created_at timestamptz not null default now(),
  constraint campanias_rango_valido check (hasta > desde)
);

alter table public.leads
  add column campania_id uuid references public.campanias(id) on delete set null;

comment on column public.leads.campania_id is
  'Atribución real (ctwa_clid u otro), poblada cuando el webhook de Meta la capture. NULL hoy: ningún código la escribe todavía. Métricas usa leads.created_at dentro del rango de la campaña como proxy mientras tanto.';
```

`lead_session` no cambia — ya tiene todo lo necesario. RLS de `campanias`: mismo patrón admin RW / vendedor R que el resto de catálogo/config (a confirmar en el plan contra `docs/data-model.md`).

## 5. Repositorio (`metrics.repo.ts`)

- `FilaSesionMetrica` gana `precio_cotizado: number | null`, `codigo_interno: string | null`, `closed_at: Date | null`.
- `FilaToolExecutionMetrica` gana `args: { query?: string; marca?: string; modelo?: string } | null` (hoy `args jsonb` en `tool_executions`, parseado con el schema `BuscarRepuestoInputSchema` ya existente en `src/lib/validation/ai.ts`).
- Nuevo: `FilaCampaniaMetrica { id, nombre, desde: Date, hasta: Date }` + `listCampanias(): Promise<FilaCampaniaMetrica[]>`.
- `obtener(dias)` pasa a `obtener(desde: Date, hasta: Date)`. Los atajos 7/30/90 siguen existiendo en la UI y calculan ese rango antes de llamar al service. **El delta contra el período anterior solo se calcula para los 3 atajos fijos** (rango simétrico); en rango custom o campaña, `anterior: null` — mismo patrón ya usado para métricas que dependen de `mensajes`.
- Contract test (`tests/repositories/metrics.contract.ts`) se extiende con los campos nuevos. **No corre contra Postgres real hoy** — mismo aviso que ya existe en AGENTS.md sobre la base de test congelada. Se corre contra InMemory, que es lo único disponible.

## 6. Servicio (`default-metricas.service.ts`)

Nuevo bloque en `Metricas`:

```ts
ventas: {
  /** Todas las resultado=exito, tengan o no precio_cotizado registrado. */
  conteo: number;
  /** De esas, cuántas tienen precio_cotizado no nulo — denominador real del monto/ticket. */
  conPrecio: number;
  /** sum(precio_cotizado) sobre las que tienen precio. null si conPrecio = 0. */
  montoTotalUsd: number | null;
  /** montoTotalUsd / conPrecio. null si conPrecio = 0. */
  ticketPromedioUsd: number | null;
};
codigosMasVendidos: Array<{
  codigoInterno: string;
  /** Sesiones ganadas que cotizaron este código — la métrica primaria, siempre disponible. */
  apariciones: number;
  /** sum(cantidad) solo sobre las que registraron cantidad. */
  unidades: number;
  /** Denominador de `unidades`, para no fingir precisión que no hay. */
  unidadesConDato: number;
}>;
repuestosMasPreguntados: {
  /** args.marca de buscar_repuesto, agrupado — dato categórico limpio. */
  porMarca: ConteoMotivo[];
  /** args.query normalizado (trim + lowercase) — texto libre, puede fragmentar variantes de la misma pieza. */
  porTermino: ConteoMotivo[];
};
tiempoCierre: TiempoRespuestaMedible; // mediana de closed_at - started_at, sobre TODAS las sesiones resueltas (exito + perdido) con closed_at no nulo.
```

`razonesEscalado` (ya existe, `default-metricas.service.ts:249`) se deja tal cual — el trabajo acá es de consumo, no de cálculo.

Nota sobre `tiempoCierre`: se mide sobre **cualquier sesión resuelta**, no solo las ganadas — es "cuánto tarda en resolverse una conversación", no "cuánto tarda en venderse". Si el dueño quiere solo sobre ganadas, es un filtro de una línea — se deja explícito acá para que si está mal el supuesto se corrija antes de codear.

## 7. UI

**Total:**

- KPI "Ventas realizadas" (conteo) + "Monto total" + "Ticket promedio" — reemplaza el `KpiFaltante` de "1ra respuesta" ya resuelto por separado (`platform_created_at`, hueco previo) y agrega estos tres nuevos donde había espacio.
- Sección nueva "Códigos más vendidos" — lista ordenada por `apariciones`, con nota de la limitación de carrito (§3) y de `unidadesConDato` cuando sea parcial.
- Sección nueva "Repuestos más preguntados" — dos listas chicas (marca / término), no depende de catálogo cargado.
- Selector de rango: los 3 atajos actuales + rango libre (date pickers) + dropdown de campañas activas (si hay alguna creada). Elegir una campaña fija `desde/hasta` a la de esa campaña.

**Vendedores:**

- `BloqueFaltante` de "Por qué se escaló a humano" se reemplaza por el desglose real (`razonesEscalado`), con el estado vacío propio decidido en la tabla de §2 para cuando `handoff_events` no tenga filas en el rango.
- `TICKET PROMEDIO` dentro de `PanelVendedores` (hoy `KpiFaltante`) se resuelve igual que en Total.
- Se corrige la discrepancia de fuente ya detectada: la tarjeta "Tiempo hasta tomar" usa `m.vendedores.tomaEnSegundos` para el valor pero `m.tiempoPrimeraRespuesta.personas.muestras` para el subtítulo — dos cálculos distintos en la misma tarjeta. El subtítulo pasa a usar el mismo denominador que el valor (`m.vendedores` trae su propio conteo de muestras, o se agrega).
- Nuevo KPI "Tiempo promedio en cerrar" (`tiempoCierre`).

**Campañas:** modal liviano desde el selector de fecha (mismo patrón que la administración de Tags: nombre + desde + hasta, sin pantalla nueva).

## 8. Fuera de alcance de este spec

- Asignación/ownership de leads por vendedor.
- KPI de "quién contestó más" como conteo crudo de mensajes.
- Gráfico de tendencia por sub-período (día/semana dentro del rango).
- Atribución real de campaña vía Meta `ctwa_clid` — solo se prepara el schema.
- Costo IA por lead vendido — bajo impacto al volumen actual (1 lead real), se agrega después si hace falta.
- Catálogo — sigue vacío a propósito, esperando el documento de siglas del dueño. "Repuestos más preguntados" funciona igual sin catálogo porque lee de `tool_executions`, no de `productos`.

## 9. Testing

- Unit: `tests/unit/metricas-service.test.ts` gana casos para `ventas` (con/sin `precio_cotizado`), `codigosMasVendidos`, `repuestosMasPreguntados`, `tiempoCierre`.
- Contract: `tests/repositories/metrics.contract.ts` extendido con los campos nuevos — corre contra InMemory (Postgres real sigue congelado, AGENTS.md lección 10).
- Sin plan de UI visual automatizado — sigue la misma limitación del resto del proyecto (panel del navegador no compone frames sin estar desplegado). Verificación visual manual del dueño al cierre de pantalla.
