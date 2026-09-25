# Cómo leer el catálogo de existencias

> **Para qué sirve.** El listado de existencias no está escrito en español: está en un código comprimido que el personal de la casa entiende y nadie más. Este documento lo traduce, para que el agente pueda buscar bien y sepa qué preguntarle al cliente.
>
> **Fuente:** `catalogo-con-precio-y-stock.csv`, 21.009 filas, versión del 2026-08-28 18:39.
> **Todo lo que dice acá se verificó contra ese archivo.** Lo que falta confirmar está marcado **PENDIENTE** y no debe usarse hasta que el dueño lo cierre.

---

## 1. El archivo

**Ocho columnas. 21.009 productos.**

| #   | Columna       | Qué es                                                             | Vacíos |
| --- | ------------- | ------------------------------------------------------------------ | ------ |
| 1   | `No.Item`     | Número interno de ítem                                             | 0      |
| 2   | `Codigo`      | **Código del producto.** Único. Incluye la sobremedida como sufijo | 0      |
| 3   | `Otros Cods.` | Códigos equivalentes de otros proveedores                          | 79,5%  |
| 4   | `Grupo`       | **Qué pieza es.** 280 valores distintos                            | 0      |
| 5   | `Descripcion` | **Para qué vehículo sirve.** Acá está el código comprimido         | 0      |
| 6   | `Auxiliar`    | Especificación técnica y marca del fabricante                      | 13%    |
| 7   | `Exist.Tot.`  | **Stock**                                                          | 0      |
| 8   | `Precio`      | **Precio.** Puede venir vacío                                      | 6,5%   |

**Dos problemas del archivo, a resolver al importar:**

- **1.367 filas (6,5%) no tienen precio.** El esquema actual de la base exige precio obligatorio, así que esas filas no entran tal como está. Hay que decidir: se cargan sin precio y el agente dice "a consultar", o no se cargan.
- **El archivo no viene en UTF-8.** `ARAÑA` y `PIÑON` llegan corruptos. Convertir la codificación al importar, o el agente muestra caracteres rotos.

---

## 2. Las dos columnas que importan

Toda la búsqueda depende de dos columnas que hacen cosas distintas:

- **`Grupo` responde "qué pieza es"** → PISTONES, RADIADOR, PASTILLAS DE FRENO.
- **`Descripcion` responde "para qué auto sirve"** → CH AVEO 1.4 /0 16V.

Un cliente que dice _"necesito pastillas de freno para mi Aveo"_ está dando un dato para cada columna. **Buscar en una sola nunca alcanza.**

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

> **Trampa: `MT` significa dos cosas.**
> En **primera posición** es Mitsubishi (107 filas). En **cualquier otra** es transmisión manual (214 apariciones).
> Se distingue por posición, nunca por el token solo.

---

## 5. Los modelos — **PENDIENTE, bloqueante**

Esta es la pieza que falta, y sin ella el catálogo no se puede cargar.

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

> **Trampa:** en algunas filas la cilindrada ocupa el lugar del modelo, porque el modelo no se escribió. Reales: `MZ 2.0` (136 filas), `NS 2.4` (58). En esos casos la descripción **no dice de qué auto es**.

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

**280 grupos distintos**, también abreviados:

| Sigla     | Significa            | Apariciones |
| --------- | -------------------- | ----------- |
| `SEN`     | sensor               | 739         |
| `POST`    | posterior            | 729         |
| `AMORTIG` | amortiguador         | 722         |
| `DELT`    | delantero            | 683         |
| `MANG`    | manguera             | 652         |
| `CHAQ`    | chaqueta             | 549         |
| `BOCIN`   | bocín                | 458         |
| `CILIND`  | cilindro             | 423         |
| `RULIM`   | rulimán / rodamiento | 416         |

Los grupos más poblados: `BASE MOTOR` (495) · `MESA SUSPENSION` (487) · `RINES` (478) · `PISTONES` (440) · `AMORTIG DELT` (409) · `MANG PASO AGUA` (342) · `PASTILLAS DE FRENO` (338).

> **Segunda trampa: `SEN`.**
> En `Grupo` es **sensor** (739). En `Descripcion` es **Sentra**, el Nissan (468 filas).
> Se distingue por columna, nunca por el token solo.

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

**Codificación rota:** `ARAÑA` y `PIÑON`.

---

## 14. Estado

| Pieza                                   | Estado                                |
| --------------------------------------- | ------------------------------------- |
| Estructura del archivo                  | ✅ Verificada                         |
| Marcas (10 siglas)                      | ✅ Confirmadas por el dueño           |
| Sistema de sobremedidas                 | ✅ Verificado contra 1.136 filas      |
| Sistema de años                         | ✅ Verificado contra 11.790 filas     |
| Cilindrada, combustible, válvulas       | ✅ Verificados                        |
| Modelos compatibles al final            | ✅ Verificado                         |
| Conflictos de siglas (`MT`, `SEN`)      | ✅ Documentados                       |
| Basura y typos                          | ✅ Inventariados                      |
| **Diccionario de modelos**              | ❌ **PENDIENTE — bloqueante**         |
| **Unificación de variantes**            | ❌ **PENDIENTE — bloqueante**         |
| Cuatro modelos ambiguos de alto volumen | ❌ **PENDIENTE** (§5)                 |
| Abreviaturas de los 280 grupos          | ⚠️ Parcial — están las más frecuentes |

**Sin el diccionario de modelos el catálogo no se puede cargar**, porque el macheo volvería a fallar como falló antes.

---

## 15. Nota de implementación

Este documento supera los **4.000 caracteres** que hoy admite `agente_config.instrucciones` ([prompt.ts:92](../../src/lib/agente/prompt.ts)), que es donde vive el bloque `INSTRUCCIONES DEL NEGOCIO` del prompt.

Hay que resolverlo de una de dos formas: ampliar ese campo, o partir el documento en un resumen operativo (§12, lo que el agente necesita para conversar) y una referencia técnica (§3-§11, que consume el importador). **No está decidido.**
