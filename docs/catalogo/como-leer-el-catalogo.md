# Cómo leer el catálogo de existencias

> **Para qué sirve.** El listado de existencias no está escrito en español: está en un código comprimido que el personal de la casa entiende y nadie más. Este documento lo traduce, para que el agente pueda buscar bien y sepa qué preguntarle al cliente.
>
> **Fuente actual:** el catálogo del ERP (Oracle), que llega al CRM por las RPC de `docs/integraciones/erp-oracle-contrato-crm.md` y vive en la tabla `productos` de `crm-dev`: 27.187 filas (27.110 activas), medidas el 2026-10-07. Las secciones §3 a §10 se escribieron sobre el export anterior (`catalogo-con-precio-y-stock.csv`, 21.009 filas, 2026-08-28); sus conteos no se rehicieron salvo donde dice «medido el 2026-10-07».
> **Lo que dice acá se verificó contra datos reales.** Lo que falta confirmar está marcado **PENDIENTE** o figura con confianza `media`/`baja` en los CSV de trabajo, y no debe usarse como hecho hasta que el dueño lo cierre.

---

## 1. La fuente: el catálogo del ERP

**27.187 ítems** en la tabla `productos` de `crm-dev` (27.110 activos y 77 inactivos), con **cuatro precios por ítem**, uno por empresa. Llegan por las RPC `erp_sync_cargar` / `erp_sync_borrar`; el detalle de cada campo está en `docs/integraciones/erp-oracle-contrato-crm.md` (fuente de verdad: las migraciones `20261006130000_productos_erp.sql` y `20261006130100_erp_sync.sql`).

| Campo del ERP (contrato) | Columna en `productos`    | Qué es                                                                                      | Vacíos (medido 2026-10-07, sobre 27.187) |
| ------------------------ | ------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `no_item`                | `codigo_interno`          | Número de ítem. Texto, clave del upsert                                                     | 0                                        |
| `codigo`                 | `codigo_fabrica`          | **Código de fábrica**, de la empresa 6 (SAS). Lleva sufijos de medida y origen (§8, §8.bis) | 0                                        |
| `otros_codigos`          | `otros_codigos` (arreglo) | Códigos equivalentes; el CRM parte el texto crudo                                           | 23.068 sin ninguno; 4.119 con alguno     |
| `grupo`                  | `categoria`               | **Qué pieza es.** 334 valores distintos entre los activos (§11)                             | 0                                        |
| `descripcion`            | `nombre`                  | **Para qué vehículo sirve.** Acá está el código comprimido (§3)                             | 0 (obligatorio)                          |
| `descripcion_auxiliar`   | `descripcion`             | **Marca o país del fabricante** (`MOBIS`, `KOREA`, `CHINA`...), no una descripción          | 6.089 sin dato                           |
| `existencias_total`      | `stock`                   | **Stock.** 16.266 ítems con stock mayor a cero                                              | 0 (obligatorio)                          |
| `precio_matriz`          | `precio_matriz`           | Precio de la empresa 1 (Matriz), lista 1                                                    | 19.995 con precio mayor a cero           |
| `precio_magdalena`       | `precio_magdalena`        | Empresa 3 (Magdalena), lista 1                                                              | 21.396 con precio mayor a cero           |
| `precio_koreanos`        | `precio_koreanos`         | Empresa 5 (Koreanos), lista 1                                                               | 19.299 con precio mayor a cero           |
| `precio_sas_repuestos`   | `precio_sas_repuestos`    | Empresa 6 (SAS Repuestos), lista 1                                                          | 19.114 con precio mayor a cero           |
| `codigo_difiere`         | `codigo_difiere` (bool)   | `si` cuando el código de fábrica difiere entre empresas                                     | 801 en `si`                              |
| `n_grupo`                | —                         | Se acepta y se ignora                                                                       | —                                        |

Además la tabla guarda `precio` (el que cotiza el agente), `activo`, `compatibilidad` (jsonb, el resultado del traductor de §3) y `erp_actualizado_at`.

**Precio que cotiza el agente.** `productos.precio` es el de SAS Repuestos si es mayor que cero; si no, el de Matriz; si no, el primero mayor que cero entre Koreanos y Magdalena (contrato §3.1). **1.456 ítems (1.453 activos) quedan sin precio**: el agente dice «a consultar». Los precios incluyen IVA (confirmado por el dueño el 2026-10-01).

**Cosas que el contrato ya resolvió y que antes eran problemas:** los ítems sin precio entran (`precio` puede ser nulo) y el texto llega en UTF-8 (`ARAÑA` y `PIÑON` ya no vienen rotos).

**Cosas que el ERP trae y no eran de repuestos de vehículo** (medido el 2026-10-07): 509 ítems en el grupo `REPUESTO EMG`, 127 en `GASTOS VARIOS`, ítems llamados `XELIM`, nombres con prefijo numérico, marcas de vehículo que no son las diez de §4. Se describen en §4, §11 y §13.

---

## 2. Las dos columnas que importan

Toda la búsqueda depende de dos columnas que hacen cosas distintas:

- **`Grupo` responde "qué pieza es"** → PISTONES, RADIADOR, PASTILLAS DE FRENO.
- **`Descripcion` responde "para qué auto sirve"** → CH AVEO 1.4 /0 16V.

Un cliente que dice _"necesito pastillas de freno para mi Aveo"_ está dando un dato para cada columna. **Buscar en una sola nunca alcanza.**

> **Nombres de columna.** En este documento `Grupo` y `Descripcion` son los nombres del export viejo. En la base del CRM son `productos.categoria` (el grupo) y `productos.nombre` (la descripción comprimida del vehículo). En la base, `productos.descripcion` es otra cosa: la marca o el país del fabricante (§1).

---

## 3. Cómo se lee `Descripcion`

Es una cadena de piezas de información pegadas. Ejemplo real del catálogo:

```
HY ACC 06- 1.4 /0 XCITE GETZ 1.4
│  │   │   │   │  └─────────────── otros modelos donde también sirve
│  │   │   │   └────────────────── sobremedida: /0 = estándar
│  │   │   └────────────────────── cilindrada: 1.4 litros
│  │   └────────────────────────── año: desde 2006 en adelante
│  └────────────────────────────── modelo: ACC = Accent
└───────────────────────────────── marca: HY = Hyundai
```

### 3.1 El orden NO es fijo

Importante para quien programe el parser: cilindrada y año intercambian posición según la fila.

| Descripción real       | Orden                                                   |
| ---------------------- | ------------------------------------------------------- |
| `HY ACC 06- 1.4 /0`    | modelo → **año** → **cilindrada** → medida              |
| `CH SAIL 1.4 12- /0`   | modelo → **cilindrada** → **año** → medida              |
| `HY CRETA 1.5 21-`     | modelo → cilindrada → año (sin medida)                  |
| `HY STA FE 2.2 /0 DSL` | modelo (2 palabras) → cilindrada → medida → combustible |

**No se puede leer por posición. Hay que reconocer cada elemento por su forma.**

---

## 4. Las marcas

**Diez siglas cubren 20.683 de 21.009 filas (98,4%).**

| Sigla | Marca      | Filas |
| ----- | ---------- | ----- |
| `HY`  | Hyundai    | 8.418 |
| `CH`  | Chevrolet  | 4.802 |
| `KIA` | Kia        | 3.963 |
| `NS`  | Nissan     | 1.070 |
| `MZ`  | Mazda      | 779   |
| `SZ`  | Suzuki     | 582   |
| `TY`  | Toyota     | 541   |
| `DW`  | Daewoo     | 312   |
| `REN` | Renault    | 109   |
| `MT`  | Mitsubishi | 107   |

Las 326 filas restantes no son de un vehículo específico: `ACEITE`, `GRASA`, `SPRAY`, `SILICON`, `REFRIG`, `UNIV` (universal), y medidas de rin (`16"`, `18"`, `20"`, `24"`).

> **Medido el 2026-10-07 sobre las 27.110 filas activas del ERP.** Las diez siglas de arriba abren **24.943** (92,0%), no el 98,4% del export viejo. Cuántas abre cada una hoy: `HY` 8.638 · `CH` 5.508 · `KIA` 4.033 · `TY` 1.963 · `NS` 1.457 · `MZ` 1.402 · `SZ` 833 · `MT` 584 · `DW` 415 · `REN` 110. Las otras 2.167 empiezan con algo distinto. Las más grandes, con lo que se vio en cada una:
>
> - `DT` (670): filas como `DT 1.3 1.5 JAPONES R/L`, `DT J15 1500`, `DT NS JR`; la categoría `DEVOLUCIONES` tiene una fila `DT NISSAN`. Hipótesis: Datsun. **No confirmado.**
> - `XELIM` (307): no es una marca, es un nombre de ítem (ver §11).
> - `Z` (146): prefijo de gastos y servicios, no repuestos (ver §11).
> - `DAI` (77), `DH` (12): `DAI FEROZA`, `DAI TERIOS`, `DAI CHARADE`, `DH DELTA`; el catálogo escribe `BRAZO DAIHATSU FEROZA`, así que son Daihatsu.
> - `MIT` (53, `MIT MONT`, `MIT L200`): otra sigla para Mitsubishi, distinta de `MT`.
> - `VW` (53, `VW GOL`, `VW SAVEIRO`), `FORD` (17), `FESTIVA` (27), `CN` (6, `CN GREAT WALL`, `CN CHERRY`): marcas que no están entre las diez.
> - `UNIV`, `UNIVERSAL`, `ACEITE`, `ACEI`, `REFRIG`, `SILICON`, `SPRAY`: piezas o insumos sin vehículo.
>
> Las siglas fuera de las diez **no tienen filas en el diccionario de modelos**; el traductor de §3 no las lee como marca. Falta decidir cuáles se agregan (pregunta al dueño).

> **Trampa: `MT` significa dos cosas.**
> En **primera posición** es Mitsubishi (107 filas). En **cualquier otra** es transmisión manual (214 apariciones).
> Se distingue por posición, nunca por el token solo.

---

## 5. Los modelos — **PARCIAL: falta la confirmación del dueño**

Esta fue la pieza que bloqueaba la carga. Hoy hay un diccionario de trabajo, pero **no está cerrado**.

> **Estado medido el 2026-10-07.**
>
> - `diccionario-modelos-sugerido.csv` tiene **545 filas**: las 401 de antes (con `filas` rehecho sobre el ERP actual) más **144 nuevas** de esta pasada (siglas del ERP que el diccionario no tenía: modelos antiguos como `CRESSIDA`, `COLT`, `JUNIOR`, `PATROL`, códigos de motor como `5R` o `Z24`, marcas pegadas como `ISUZU`, y casos que quedan en `baja` con pregunta).
> - En la tabla `catalogo_modelos` de `crm-dev` hay 366 de las 401 filas anteriores (la carga omite alcances, motores y duplicados); **76 confirmadas por el dueño**. Las 144 nuevas **no están cargadas**.
> - `Niro` **ya estaba** en el diccionario (`KIA NIRO`, 68 filas, confianza alta, activa en `catalogo_modelos`): no es la causa de la falla descrita en §11.bis.
> - Pendiente: el dueño confirma o corrige las filas `media` y `baja` (las dudas sin resolver están en la tabla de abajo y en `investigacion-modelos.md`).

Los modelos van abreviados, y **el mismo auto aparece escrito de varias formas**. Verificado:

| Marca | El mismo auto, escrito distinto                                    |
| ----- | ------------------------------------------------------------------ |
| KIA   | `PICANTO` · `PICANT` · `PIC` · `PICAN` · `PICA` — **cinco formas** |
| KIA   | `SORENT` · `SORENTO` · `SORENT0` (typo, con cero)                  |
| KIA   | `SPORTAG` · `SPORTAGE` · `SPORT` · `SPORTAGUE`                     |
| KIA   | `CERATO` · `CERAT` · `CER` · `CERA`                                |
| KIA   | `PREG` · `PREGIO`                                                  |
| HY    | `TUCS` · `TUC` · `TUCSON`                                          |
| HY    | `ACC` · `ACCENT` · `ACCEN`                                         |
| HY    | `ELANT` · `ELANTRA` · `ELAN` · `ELANTR`                            |
| HY    | `TERRAC` · `TERR` · `TERRACAN` · `TERRA`                           |
| NS    | `SEN` · `SENTRA` · `SENT`                                          |
| NS    | `FRONT` · `FRONTIER`                                               |
| NS    | `XTRAIL` · `X-TRAIL`                                               |
| NS    | `QASHQAI` · `QASQHAI` (typo)                                       |
| DW    | `LANOS` · `LAN` · `LANO`                                           |
| MZ    | `ALEG` · `ALEGRO` · `ALEGR`                                        |
| SZ    | `VIT` · `VITARA` · `VITAR`                                         |

**No alcanza con traducir: hay que unificar variantes.** Si `PIC`, `PICANT` y `PICANTO` no se unifican, un cliente que pregunta por un Picanto ve un tercio del stock real.

**Modelos ya confirmados:**

| Sigla         | Modelo       | Evidencia                                 |
| ------------- | ------------ | ----------------------------------------- |
| `HY STA FE`   | Santa Fe     | 1.020 filas; `HY STA FE 2.2 /0 DSL`       |
| `CH GRAN VIT` | Grand Vitara | 185 filas; `CH GRAN VIT 1.6 /2 STEEM 1.6` |
| `CH LUV DMAX` | LUV D-Max    | 264 filas                                 |

**Sin resolver, todos de alto volumen:**

| Sigla                    | Filas | Duda                                                                     |
| ------------------------ | ----- | ------------------------------------------------------------------------ |
| `HY VER`                 | 335   | Convive con `VERACRUZ` (103) y `VERNA` (54), **que son autos distintos** |
| `CH TAX` / `TAXI`        | 502   | ¿Modelo, o designación de uso?                                           |
| `CH COR`                 | 385   | ¿Corsa? Convive con `CORSA` completo                                     |
| `HY TUCS NX` / `TUCS IX` | 674   | ¿Generaciones del Tucson?                                                |

Archivo de trabajo: `docs/catalogo/diccionario-modelos.csv`.

---

## 6. La cilindrada

Un número con un decimal: `1.6`, `2.4`, `1.5`. **34 valores distintos.**

Más frecuentes: `1.6` (1.495) · `2.4` (1.025) · `1.5` (998) · `1.8` (832) · `2.0` (765) · `1.4` (755) · `1.2` (635) · `2.7` (615).

> **Trampa:** en algunas filas la cilindrada ocupa el lugar del modelo, porque el modelo no se escribió. Reales: `MZ 2.0` (136 filas), `NS 2.4` (58). En esos casos la descripción **no dice de qué auto es**. Medido el 2026-10-07 en el ERP: `MZ 2.0` 197 · `MZ 1.6` 191 · `MZ 2.6` 169 · `MZ 2.2` 122 · `TY 2.0` 144 · `TY 2.7` 134 · `TY 1.6` 82 · `NS 2.4` 80.

---

## 7. Los años

**11.790 filas (56%) llevan año.** Tres formas:

| Forma   | Significa                               | Apariciones | Ejemplo real                          |
| ------- | --------------------------------------- | ----------- | ------------------------------------- |
| `AA-`   | **Desde AA en adelante.** Sigue vigente | 10.965      | `CH 6VD1 LUV /0 3.2 00-` = desde 2000 |
| `AA-BB` | **Rango cerrado**, de AA a BB           | 1.374       | `HY ACC 12-18 1.6` = 2012 a 2018      |
| `-AA`   | **Hasta AA.** Generación anterior       | 926         | `CH 6VD1 TRO /0 3.2 -98` = hasta 1998 |

### 7.1 Regla de siglo

Valores observados: **`00` a `25`, y `72` a `99`. No existe ninguno entre 39 y 71.** Ese hueco vuelve segura la regla:

- **≥ 50 → 19XX.** `98` = 1998, `72` = 1972.
- **< 50 → 20XX.** `06` = 2006, `25` = 2025.

### 7.2 Trampa: `AA-BB` no siempre es año

El mismo patrón se usa para medidas en milímetros. Caso real:

```
272 ABRAZ METAL PEQ 25-38 mm
```

Acá `25-38` es el rango de diámetro de una abrazadera, no los años 2025-2038. **Se distingue porque va seguido de `mm`.**

---

## 8. Las sobremedidas

Cuando un motor se rectifica el cilindro queda más ancho y hace falta un pistón más grande. El catálogo lo marca con `/N` en la descripción y con un sufijo en el código.

**Regla aritmética: `/N` = N × 0,25 mm.**

| En `Descripcion` | En `Codigo` | Significa                           | Filas que lo confirman |
| ---------------- | ----------- | ----------------------------------- | ---------------------- |
| `/0`             | `/STD`      | **Estándar** — motor sin rectificar | 316 de 347             |
| `/1`             | `/0.25`     | Rectificado 0,25 mm                 | 184 de 193             |
| `/2`             | `/0.50`     | Rectificado 0,50 mm                 | 245 de 257             |
| `/3`             | `/0.75`     | Rectificado 0,75 mm                 | 185 de 190             |
| `/4`             | `/1.00`     | Rectificado 1,00 mm                 | 138 de 144             |
| `/5`             | `/1.25`     | Rectificado 1,25 mm                 | 3 de 3                 |
| `/6`             | `/1.50`     | Rectificado 1,50 mm                 | 2 de 2                 |

**Solo 1.136 filas llevan sobremedida** — es propia de piezas rectificables: pistones, chaquetas de biela y bancada, anillos.

> **Crítico para vender.** Un pistón `/0` no sirve en un motor rectificado a 0,50, y uno `/2` no entra en un motor estándar. **Si el cliente pide pistones y no dice la medida, no se le puede cotizar.** Ver §12.

---

## 8.bis El sufijo de origen del código

El `Codigo` no es solo el número de fábrica: la casa le pega dos sufijos encima.

```
96389106 / STD / K
└──────┘  └─┘  └┘
 número   medida origen (Corea)
 de fábrica
```

**Sufijos de origen observados:** `/ORG` genuino · `/OEM` · `/K` o `/KR` Corea · `/CH` China · `/JP` Japón · `/TW` Taiwán · `/BR` Brasil · `/IND` India · `/USA`.

Esto importa para vender: el cliente suele preguntar si la pieza es **genuina o alterna**, y la respuesta está en ese sufijo. Dos filas con el mismo número de fábrica y distinto origen son **la misma pieza en distinta gama de precio**, no piezas distintas.

> **Trampa:** `/CH` como origen significa **China**, no Chevrolet. La marca va al principio de `Descripcion`; el origen va al final de `Codigo`. Nunca se confunden si se mira en qué columna está.

**Cuando un taller dicta el número grabado en la pieza vieja** —`96389106`— hay que buscar sin los sufijos. Esa es la búsqueda que cierra la venta más rápido, y sin pelar el código no encuentra nada.

Ya existe la función que lo hace: `src/lib/catalogo/normalizar-codigo.ts`. Está escrita y testeada, pero **no está conectada a la búsqueda**.

---

## 9. Los atributos técnicos

| Qué es          | Valores reales                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| **Combustible** | `DSL` (863) diesel · `GAS` (438) gasolina · `CRDI` (13) · `TURBO` (29) · `DIESEL` (12)                     |
| **Válvulas**    | `16V` (496) · `8V` (183) · `12V` (119) · `24V` (25)                                                        |
| **Transmisión** | `MT` (214) · `T/M` (85) manual · `T/A` (47) automática                                                     |
| **Tracción**    | `4X4` (11) · `4X2` (10)                                                                                    |
| **Con / Sin**   | `C/ABS` (116) · `C/CAM` (95) · `C/BASE` (41) · `C/AIRBAG` (18) · `S/BASE` (36) · `S/ABS` (25) · `S/R` (22) |

`C/` es "con" y `S/` es "sin". Son diferenciadores reales: una mesa de suspensión `C/ABS` no es la misma pieza que una `S/ABS`.

---

## 10. Los modelos compatibles al final

**Lo más valioso del catálogo, y lo más fácil de pasar por alto.**

Muchas descripciones terminan listando **otros vehículos donde la misma pieza sirve**:

```
HY ACC 06- 1.4 /0 XCITE GETZ 1.4
                  └──────────────  también sirve para Xcite y Getz

HY TUCS IX 2.0 -13 /0 KIA SPORTG R CARENS 16-
                      └────────────────────────  también para Kia Sportage R y Carens

KIA RIO 18- SOLUTO 19- /0
            └──────────────  también para Soluto desde 2019
```

Notar que **cruza marcas**: una pieza catalogada como Hyundai Tucson sirve también para Kia Sportage.

**Para el agente:** si un cliente pregunta por un Getz y la búsqueda no devuelve nada catalogado como Getz, igual puede haber stock — guardado bajo Accent. La búsqueda tiene que mirar la descripción completa, no solo el modelo principal.

---

## 10.bis Las piezas que sirven para todos

**`TODOS` no es un modelo: es un modificador de alcance.** Aparece en 86 filas, en dos formas:

| Forma                | Filas | Significa                                        | Ejemplo real                     |
| -------------------- | ----- | ------------------------------------------------ | -------------------------------- |
| `MARCA MODELO TODOS` | 71    | **Todo ese modelo**, sin importar año ni versión | `CH COR TODOS` = todos los Corsa |
| `MARCA TODOS`        | 15    | **Toda la marca**                                | `DW TODOS` = todos los Daewoo    |

Hay tres modificadores más con el mismo sentido:

- **`UNIV`** (16 filas) — universal. Ejemplo: `UNIV 3.0 PUL HY MZ 323`
- **`TODAS`** (8 filas) — variante femenina. Ejemplo: `TY TODAS`
- **`VARIOS`** (5 filas) — ejemplo: `SOCKET VARIOS`

### Se combinan con la lista de compatibles

```
HY TODOS CH LUV 2.3 MOTRIZ B/H
└──────┘ └──────────────────┘
todos los   más la Chevrolet LUV 2.3
Hyundai

TY TODOS MT L200 92-95
└──────┘ └───────────┘
todos los  más el Mitsubishi L200 del 92 al 95
Toyota

CH AVEO TODOS DW LAN CIEL NUB
└───────────┘ └─────────────┘
todos los Aveo  más Daewoo Lanos, Cielo y Nubira
```

### Por qué esto rompe la búsqueda por texto

Un cliente pregunta por un **Accent**. La fila `HY TODOS ORING` **le sirve**, pero la búsqueda por coincidencia de texto **no la encuentra**, porque la fila no contiene la palabra "accent".

Son ~116 piezas que sirven para muchos vehículos y que hoy quedan invisibles salvo que el cliente escriba exactamente la palabra escrita en la fila.

**La búsqueda tiene que expandir el alcance:** cuando el cliente da una marca, además de las filas de ese modelo hay que traer las de `MARCA TODOS` y las universales. Es un segundo problema de macheo, independiente del de las siglas, y también hace perder ventas fáciles.

---

## 11. Los grupos (qué pieza es)

**334 grupos distintos** entre los ítems activos (`productos.categoria`, medido el 2026-10-07), casi todos con palabras abreviadas o cortadas. El nombre del grupo aparece **cortado a 31 caracteres**: el más largo mide 31 y hay 8 grupos de 28 o más (`RESORTES Y ASIENTOS DE VALVUL`, `SEN EGR/CUERPO ACER/VAL CVVT`).

**El diccionario de abreviaturas está en `docs/catalogo/abreviaturas-sugeridas.csv`** (234 filas): cada palabra o sigla de los grupos y de los nombres con su expansión, tipo (`pieza`, `posicion`, `atributo`, `ruido`), dónde aparece (`categoria`, `nombre` o `ambos`), cuántas filas la usan, ejemplos reales y confianza. Es de trabajo: la columna `CONFIRMADO` es del dueño y está vacía.

Las nueve que más pesan en los grupos, con las filas que tienen la palabra en `categoria`:

| Sigla     | Significa            | Filas |
| --------- | -------------------- | ----- |
| `POST`    | posterior            | 955   |
| `MANG`    | manguera             | 824   |
| `DELT`    | delantero            | 798   |
| `AMORTIG` | amortiguador         | 794   |
| `CHAQ`    | chaqueta             | 792   |
| `SEN`     | sensor               | 757   |
| `CILIND`  | cilindro             | 599   |
| `BOCIN`   | bocín                | 594   |
| `RULIM`   | rulimán / rodamiento | 574   |

Los grupos más poblados hoy: `RINES` (673) · `BASE MOTOR` (583) · `PISTONES` (577) · `MESA SUSPENSION` (497) · `REPUESTO EMG` (457, **no es una pieza**, ver abajo) · `AMORTIG DELT` (442) · `CHAQ BANCADA` (412) · `PASTILLAS DE FRENO` (388) · `CHAQ BIELA` (380) · `MANG PASO AGUA` (377).

> **Segunda trampa: `SEN`.**
> En el grupo es **sensor** (757 filas). En el nombre (`productos.nombre`) es **Sentra**, el Nissan (530 filas con ese token, `NS SEN B13`).
> Se distingue por columna, nunca por el token solo.

> **Tercera trampa: `DEL`.**
> En el nombre es **delantero** (`KIA CERATO 19- DEL`, 266 filas). En el grupo es la preposición «del» (`POLEA DEL CIGUEÑAL`, `BENDIX DEL ARRANQUE`), no una posición.

**Hay grupos que no son repuestos de vehículo.** Medido el 2026-10-07 sobre los activos:

| Grupo                                                 | Filas                      | Qué se vio                                                                                                                                                                                | Estado                                                    |
| ----------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `REPUESTO EMG`                                        | 457 activas (509 en total) | 272 se llaman exactamente `XELIM`; 166 llevan prefijo numérico (`001 CAMISAS KIA K2700`); incluye el encabezado `# GRUPO NOMBRE AUTO` y el relleno `XXXXXXXXXXXXXX`. Solo 11 tienen stock | **No sé qué es EMG.** Pregunta al dueño                   |
| `GASTOS VARIOS`                                       | 127                        | `Z AD VALOREM`, `Z PUBLICIDAD Y MARKETING`, `BROCHAS`. 112 con stock y 117 con precio                                                                                                     | Son gastos de la empresa: hoy el agente podría cotizarlos |
| `OTROS`, `OTROS INGRESOS`, `ACTIVOS FIJOS`            | 26, 1, 8                   | `Z SERVICIO DE WHATICKET`, `Z ARRIENDO DEL MES`, `COMPUTADORA PORTATIL`                                                                                                                   | No son repuestos                                          |
| `DISPONIBLE`, `A DISPONIBLE ...`, `DEVOLUCIONES`, `Z` | 12, 30, 6, 4               | Contienen nombres de repuestos reales (`DT 1200 71-79`, `DW RACER CIELO SIN FIN`)                                                                                                         | **Significado sin confirmar**                             |

Por nombre: **307 ítems activos se llaman exactamente `XELIM`** (314 lo contienen) y otros 76 lo traen en la descripción y ya están inactivos. Parece «eliminar», pero no está confirmado; mientras tanto siguen activos y cotizables.

---

## 11.bis Búsqueda: las palabras del cliente pasan por dos diccionarios

El catálogo está escrito en el idioma de la casa, no en el del cliente. Para buscar, cada palabra del cliente tiene que traducirse **por el diccionario que le corresponde**, y se buscan las dos cosas a la vez (§2):

- **La pieza** (lo que dice el cliente: «amortiguadores», «delanteros») se traduce con `abreviaturas-sugeridas.csv` hacia lo que escribe el catálogo en `categoria` y en `nombre`: `AMORTIG`, `DELT`. Hay que cubrir plurales, tildes (`PIÑON` y `PINON` conviven) y los dos órdenes (`DELT` en el grupo, `DEL` en el nombre).
- **El vehículo** («Kia Niro 2020») se traduce con `diccionario-modelos-sugerido.csv` hacia la sigla de marca y de modelo: `KIA` + `NIRO`, y el año se compara con el rango de la fila (`17-` = desde 2017).

**Falla real que motiva esta sección.** Reporte del caso: el cliente pide _«amortiguadores delanteros para el Kia Niro 2020»_ y no sale nada. Lo que sí se verificó contra `crm-dev` el 2026-10-07 es que las filas `23868` y `23869` existen y cómo están guardadas; **no se ejecutó la búsqueda**:

| Código | Nombre                | Grupo          | Stock | Compatibilidad guardada |
| ------ | --------------------- | -------------- | ----- | ----------------------- |
| 23868  | `KIA NIRO HYB 17- LH` | `AMORTIG DELT` | 11    | Kia Niro, desde 2017    |
| 23869  | `KIA NIRO HYB 17- RH` | `AMORTIG DELT` | 7     | Kia Niro, desde 2017    |

- **El vehículo no es el problema:** `NIRO` ya estaba en el diccionario (`KIA NIRO`, alta) y el traductor ya guardó `Kia Niro` con `anio_desde: 2017` en las dos filas.
- **La pieza es el sospechoso:** «amortiguadores» no es `AMORTIG` ni «delanteros» es `DELT`. La columna `busqueda` de esas filas contiene `kia niro hyb 17- lh amortig delt mando`, sin la palabra «amortiguador».
- **Causa probable (no probada ejecutando la búsqueda):** las palabras de pieza y de posición del cliente no se traducen con el diccionario de abreviaturas antes de buscar. **No está resuelto en este documento ni en los CSV.**

Qué no hace este documento: no implementa la búsqueda. Los CSV son la entrada; cargarlos y usarlos en la consulta es trabajo de código aparte.

**Reglas al usar los dos diccionarios:**

- Usar `alta` sin preguntar; `media` solo si el resultado no empeora (se puede ofrecer la pieza y confirmar); `baja` **nunca** como hecho: sigue siendo una pregunta para el dueño.
- Respetar el `ambito`: `SEN` es sensor solo en `categoria`; `DEL` es delantero solo en `nombre`; `MT` es Mitsubishi solo en primera posición.
- Un cliente que dice «derecho/izquierdo» pide `RH`/`LH`; si la fila dice `R/L` o `L/R` sirve para ambos lados.

---

## 12. Qué tiene que preguntar el agente

Sale directamente de cómo está armado el catálogo. **Con marca y modelo no alcanza para cotizar casi nada.**

### 12.1 Siempre

1. **¿Qué pieza necesita?** → determina el `Grupo`.
2. **¿Marca y modelo del vehículo?** → determina marca y modelo.
3. **¿Año?** → el 56% de las filas discrimina por año, y las generaciones no son intercambiables.

### 12.2 Según la pieza

4. **Cilindrada** — obligatoria cuando el modelo tiene varias. Un Accent viene en 1.4 y 1.6, y los pistones no son los mismos.
5. **Combustible** — obligatoria cuando hay diesel y gasolina. `HY STA FE 2.2 DSL` es otra pieza que la de gasolina.
6. **Sobremedida** — **obligatoria en pistones, chaquetas y anillos.** Si el cliente no sabe, preguntarle si el motor fue rectificado y a cuánto. Sin ese dato no se cotiza: hay hasta siete versiones de la misma pieza.
7. **Con o sin** — cuando el grupo tiene variantes `C/ABS` vs `S/ABS`, `C/BASE` vs `S/BASE`.
8. **Delantero o posterior** — cuando el grupo lo distingue (`AMORTIG DELT` vs `AMORTIG POST`).

### 12.3 Reglas de conducta

- **Nunca cotizar un pistón sin la sobremedida.** Es el error más caro: el cliente recibe una pieza que no entra.
- **Si hay varios candidatos que difieren solo en un atributo**, preguntar por ese atributo en vez de elegir uno.
- **Si `Precio` viene vacío**, no inventar precio: decir que hay que consultarlo.
- **Si `Exist.Tot.` es 0**, decirlo. No ofrecerlo como disponible.
- **Si no hay resultado con el modelo que dijo el cliente**, buscar igual en las descripciones completas: la pieza puede estar catalogada bajo otro modelo compatible (§10).

---

## 13. Basura conocida en los datos

Limpiar al importar, no después.

**Errores de tipeo:**

- `SORENT0` — cero en vez de la letra O (2 filas)
- `VERACRIZ` — por Veracruz (1)
- `SPORTAGUE`, `SPORTGG` — por Sportage (2)
- `QASQHAI` — por Qashqai (4)

**Medida pegada al modelo:**

- `SPORTAGE/4`, `SPORTAG/0`, `SPORTAG/1`
- `CARRY/2`, `CARRY/0`, `CARRY/1`, `CARRY/3`, `CARRY/4`
- `22R/0`, `22R/1`, `22R/2`, `22R/3`, `22R/4`

**Dos modelos en un token:** `VERACRUZ/SORENT` · `K2700/K300` · `COROLLA2E,3E`

**Cilindrada pegada:** `TRACKER1.8`

**Codificación rota:** `ARAÑA` y `PIÑON` llegaban corruptos en el export viejo. En el ERP actual llegan bien (verificado el 2026-10-07).

**Basura nueva del ERP** (medido el 2026-10-07 sobre los 27.110 activos):

- **181 nombres con prefijo numérico** (`003  VALVULAS ESCAPE KIA STONIC 21- 1.0`, `340 RADIADOR H100 PORTER`); 150 están en `REPUESTO EMG`. La marca ya no es el primer token y el traductor de §3 no la lee.
- **364 nombres con minúsculas** (`HY VER temp tubo post R/L`) y **2.415 con doble espacio** (`HY TUCS 05-  RH`). Comparar siempre con mayúsculas y espacios colapsados.
- **Dos escrituras de la misma palabra conviven:** `PINON`/`PIÑON`, `CIGUENAL`/`CIGUEÑAL`, `SWICH`/`SWICHE`, `TRICETA`/`TRIZETA`. Hay que buscar las dos.
- **Descripciones auxiliares sin explicar:** `(7A)`, `[7A]`, `(8B)` en `RULIM VARIOS`; medidas en lugar de marca (`75mm_1.2*1.5*2.8`, `38*79*45 NTN`). 6.089 ítems no traen ninguna marca o país.
- **5.045 ítems activos sin compatibilidad guardada** (`compatibilidad` vacío): causas probables, sin desglosar una por una: marcas fuera de las diez (2.167 ítems), nombres con marca pero sin modelo reconocido (2.507 ítems de las diez marcas, muchos empiezan por la cilindrada: `MZ 2.0`, `TY 2.7`) y nombres con prefijo numérico.
- **Grupos que no son repuestos y nombres de marcador** (`REPUESTO EMG`, `GASTOS VARIOS`, `XELIM`, prefijo `Z`): ver §11.

---

## 14. Estado

Actualizado el 2026-10-07. «Verificado» = comprobado contra datos reales; las filas con fecha del export viejo no se rehicieron sobre el ERP.

| Pieza                                                                                | Estado                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fuente del ERP: 27.187 ítems, 4 precios, columnas del contrato (§1)                  | Verificado contra `crm-dev` el 2026-10-07                                                                                                                                                                   |
| Estructura del texto de `nombre` (§3)                                                | Verificada (export viejo); el ERP trae además prefijos numéricos y minúsculas (§13)                                                                                                                         |
| Marcas: las 10 siglas                                                                | Confirmadas por el dueño (export viejo). Abren 92,0% de los activos; **faltan decisiones sobre `DT`, `DAI`, `DH`, `MIT`, `VW`, `FORD`, `FESTIVA`, `CN`** (§4)                                               |
| Sistema de sobremedidas                                                              | Verificado contra 1.136 filas (export viejo)                                                                                                                                                                |
| Sistema de años                                                                      | Verificado contra 11.790 filas (export viejo)                                                                                                                                                               |
| Cilindrada, combustible, válvulas                                                    | Verificados (export viejo)                                                                                                                                                                                  |
| Modelos compatibles al final                                                         | Verificado (export viejo)                                                                                                                                                                                   |
| Conflictos de siglas (`MT`, `SEN`, `DEL`)                                            | Documentados (§4, §11)                                                                                                                                                                                      |
| Basura y typos                                                                       | Inventariados, incluida la del ERP (§13)                                                                                                                                                                    |
| **Diccionario de modelos**                                                           | **Parcial.** 545 filas sugeridas; 76 confirmadas por el dueño; las filas `media` y `baja` y las 144 nuevas esperan al dueño; las 144 nuevas no están cargadas en `catalogo_modelos` (§5)                    |
| Unificación de variantes                                                             | Hecha en el CSV de modelos (varias escrituras apuntan al mismo nombre), sujeta a lo anterior                                                                                                                |
| Cuatro modelos ambiguos de alto volumen (§5)                                         | Pendiente; ver `investigacion-modelos.md`                                                                                                                                                                   |
| **Diccionario de abreviaturas** (`abreviaturas-sugeridas.csv`)                       | **Parcial.** 234 filas: 131 `alta`, 73 `media`, 30 `baja`. `CONFIRMADO` vacío en todas; el dueño no ha revisado ninguna                                                                                     |
| Significado de `REPUESTO EMG`, `XELIM`, `DISPONIBLE`, prefijo `Z` y prefijo numérico | **Pendiente: pregunta al dueño** (§11)                                                                                                                                                                      |
| Traducción de las palabras del cliente antes de buscar (§11.bis)                     | **Sin mapeo de abreviaturas en `src/` del árbol principal** (busqué `AMORTIG`, `abreviatura`, `sinonimo` y no hay nada de catálogo); otro trabajo en curso puede estar tocándolo. No se ejecutó la búsqueda |

**El diccionario de modelos sigue sin estar cerrado**, y el de abreviaturas no se probó contra la búsqueda. Mientras eso no esté, el macheo puede volver a fallar como falló antes.

---

## 15. Nota de implementación

Este documento supera los **4.000 caracteres** que hoy admite `agente_config.instrucciones` ([prompt.ts:92](../../src/lib/agente/prompt.ts)), que es donde vive el bloque `INSTRUCCIONES DEL NEGOCIO` del prompt.

Hay que resolverlo de una de dos formas: ampliar ese campo, o partir el documento en un resumen operativo (§12, lo que el agente necesita para conversar) y una referencia técnica (§3-§11, que consume el importador). **No está decidido.**
