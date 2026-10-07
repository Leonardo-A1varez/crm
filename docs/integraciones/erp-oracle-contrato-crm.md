# Contrato: catálogo del ERP (Oracle) → CRM

Para el extractor de Bodega Web (`sync-oracle`), que agrega el CRM como **segundo destino**. El CRM nunca se conecta a Oracle: recibe filas JSON por tres funciones RPC de su Supabase.

Fuente de verdad: `supabase/migrations/20261006130100_erp_sync.sql` (las RPC), `20261006130000_productos_erp.sql` (las columnas de `productos`) y `20261007160000_catalogo_marcas.sql` (la tabla `marcas`, §3.4). Probado en `tests/integration/erp-sync.supabase.test.ts` y `tests/integration/erp-sync-marcas.supabase.test.ts`. Ejemplo ejecutable: `scripts/erp/cargar-csv-local.mjs` + `scripts/erp/filas-desde-csv.mjs`.

---

## 1. Conexión

| Qué                     | Valor                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| URL                     | `https://<ref>.supabase.co/rest/v1/rpc/<funcion>` (`POST`)                                                 |
| Headers                 | `apikey: <anon key del CRM>`, `Authorization: Bearer <anon key del CRM>`, `Content-Type: application/json` |
| Clave de sincronización | Parámetro `p_clave` de cada RPC. Es propia del CRM, distinta de la de Bodega Web                           |

Con `supabase-js`: `createClient(url, anonKey).rpc("erp_sync_cargar", { p_clave, p_tabla, p_filas })`.

**No se usa la service role en la PC.** La anon key solo puede ejecutar estas tres funciones, y las tres rechazan todo sin la clave.

## 2. La clave

- 32 bytes aleatorios en base64url (43 caracteres). La RPC exige de 32 a 256 caracteres.
- El CRM guarda solo su sha256 en `private.erp_sync_config` (fuera de la API).
- Se genera en el repo del CRM: `node scripts/erp/configurar-clave.mjs`. El script imprime la clave **una vez** y la sentencia SQL que fija el hash. La sentencia se pega en el SQL editor del proyecto Supabase del CRM. La clave se carga en la PC del dueño con `npm run configurar -- --destino crm` (Bodega Web).
- Rotar es generar otra: la anterior deja de valer en cuanto se fija el hash nuevo.
- No la loguees. Si llegara a `p_error`, el CRM la tacha antes de guardarla.

## 3. `erp_sync_cargar(p_clave text, p_tabla text, p_filas jsonb) → integer`

Upsert por `no_item`. Devuelve cuántas filas **insertó o cambió**. Una fila idéntica a la guardada no se escribe. Recargar el catálogo entero sin cambios devuelve 0 en cada lote y no toca `updated_at`.

- `p_tabla`: `"productos"` o `"marcas"` (lista cerrada; la forma de la fila de `marcas` está en §3.4). Otro valor → `22023`. Es sensible a mayúsculas.
- `p_filas`: arreglo JSON de **0 a 5000** objetos. Más → `54000`. Vacío → `0`.
- **Todo o nada:** la primera fila que no cumple el contrato rechaza el lote entero (`22023`, mensaje `fila N: <motivo>`). No se escribe nada.
- Un `no_item` repetido dentro del mismo lote → `22023` (`fila N: no_item X repetido en el lote`).

### Forma de cada fila

Las claves son una lista cerrada: un campo que no esté acá → `22023 campo desconocido`. Los opcionales pueden faltar o ser `null`.

| Campo                  | Tipo JSON                | Obligatorio | Va a `productos.`        | Regla                                                      |
| ---------------------- | ------------------------ | ----------- | ------------------------ | ---------------------------------------------------------- |
| `no_item`              | string, 1–50             | sí          | `codigo_interno`         | Clave del upsert. **Texto**, no número: `"7"`, no `7`      |
| `descripcion`          | string, 1–500            | sí          | `nombre`                 | No vacío después de recortar                               |
| `existencias_total`    | number ≥ 0               | sí          | `stock`                  | Se guarda la parte entera (`19.5` → `19`). Tope 2147483647 |
| `codigo`               | string \| null           | no          | `codigo_fabrica`         | De la empresa 6 (SAS)                                      |
| `otros_codigos`        | string \| null           | no          | `otros_codigos` (text[]) | Texto crudo de `OTROS_COD`; lo parte el CRM (§3.2)         |
| `n_grupo`              | string \| null           | no          | —                        | Se acepta y se ignora                                      |
| `grupo`                | string \| null           | no          | `categoria`              |                                                            |
| `descripcion_auxiliar` | string \| null           | no          | `descripcion` (la marca) |                                                            |
| `precio_matriz`        | number ≥ 0 \| null       | no          | `precio_matriz`          | Empresa 1, lista 1                                         |
| `precio_magdalena`     | number ≥ 0 \| null       | no          | `precio_magdalena`       | Empresa 3, lista 1                                         |
| `precio_koreanos`      | number ≥ 0 \| null       | no          | `precio_koreanos`        | Empresa 5, lista 1                                         |
| `precio_sas_repuestos` | number ≥ 0 \| null       | no          | `precio_sas_repuestos`   | Empresa 6, lista 1                                         |
| `codigo_difiere`       | `"si"` \| `"no"` \| null | no          | `codigo_difiere` (bool)  | `null` = `"no"`                                            |

Los textos se recortan y un texto vacío queda en `null`, salvo `no_item` y `descripcion`, que no pueden quedar vacíos. Los precios se redondean a 2 decimales (`22.5542857142857` → `22.55`) y tienen como tope `9999999999.99`. Los números van como **números JSON**: `"5.74"` como texto se rechaza.

**Valores crudos.** El apóstrofo que el export CSV pone delante de `= + - @` (`'+20`) es del CSV, no del ERP. En el JSON va `"+20"`. El CRM no lo saca.

Además, cada fila cargada queda con `activo = true` (recargar reactiva lo dado de baja) y `erp_actualizado_at = now()` si algo cambió.

### 3.1 Precio que cotiza el agente

`productos.precio` = el de **SAS Repuestos** (empresa 6) si es mayor que cero; si no, el de **Matriz** (empresa 1); si no, el primero mayor que cero entre Koreanos y Magdalena. Si ninguno es mayor que cero, queda `null` y se lee "a consultar". Los cuatro se guardan tal cual, ceros incluidos.

| Fila real (2026-10-05) | matriz | magdalena | koreanos | sas  | → `precio` |
| ---------------------- | ------ | --------- | -------- | ---- | ---------- |
| `1`                    | 5.74   | 5.95      | 5.79     | 2.61 | 2.61       |
| `12`                   | 6      | 0         | 5.04     | 6    | 5.04       |
| `13`                   | 0      | 0         | 0        | 0    | null       |
| `7`                    | null   | 40.5      | 12.29    | null | 12.29      |

### 3.2 Cómo se parte `otros_codigos`

1. Por blancos, coma y punto y coma: `22311-22360 EGHNH00069` → `22311-22360`, `EGHNH00069`.
2. Por `/` solo si todas las partes parecen códigos (al menos 5 letras o dígitos, y algún dígito): `13028-ED000/15041-ED000` se parte. `SZC-519/USA`, `4T-L68149/11` y `SIN_1/2_LUNA` no se parten.
3. Lo que no se parte pierde las `/` de los bordes: `K972-12-205/` → `K972-12-205`.
4. Se descartan los pedazos con menos de 2 letras o dígitos (`.....`, `0`, `A`), y también los repetidos. Tope: 50 códigos.

### 3.3 Ejemplo: la fila 7 del export real

```json
{
  "no_item": "7",
  "codigo": "AU0826-1LL",
  "otros_codigos": "43210-8H300",
  "n_grupo": "162",
  "grupo": "RULIMANES RD/RP",
  "descripcion": "NS XTRAIL 2.0 4*2 T30 QR20 RP",
  "descripcion_auxiliar": "38*79*45 NTN",
  "existencias_total": 0,
  "precio_matriz": null,
  "precio_magdalena": 40.5,
  "precio_koreanos": 12.29,
  "precio_sas_repuestos": null,
  "codigo_difiere": "si"
}
```

Queda así: `codigo_interno "7"`, `codigo_fabrica "AU0826-1LL"`, `otros_codigos {43210-8H300}`, `categoria "RULIMANES RD/RP"`, `nombre "NS XTRAIL 2.0 4*2 T30 QR20 RP"`, `descripcion "38*79*45 NTN"`, `stock 0`, `precio 12.29`, `codigo_difiere true`.

### 3.4 Tabla `marcas`: de qué marca es la pieza y de dónde viene

**Para qué.** El ERP no tiene una columna de procedencia. `productos.descripcion` (DESCRIP_AUX) mezcla **marcas** (MOBIS, GM, MANDO, CTR, JUNGWOO…) con **países** (CHINA, KOREA…). Lo único que sabe de qué país es cada marca es la base de Bodega Web (`public.marcas` + `marca_alias`). El CRM guarda una copia de solo lectura (`public.catalogo_marcas`) para que el agente cotice «MOBIS (Original) $96,66 · JUNGWOO (Korea) $21,51 (IVA incluido)».

**Cómo la usa el CRM.** Dada `productos.descripcion` de una pieza: (1) si es un país (CHINA, KOREA, JAPON, COLOMBIA, HY INDIA…) esa es la procedencia y no hay marca; (2) si coincide con el `nombre` o con un `alias` de una marca (sin mayúsculas ni tildes) la marca es el `nombre` y la procedencia, la de la fila; (3) si no, el sufijo del código de fábrica (`/K` Korea, `/JP` Japón, `/FR` Francia, `/DE` Alemania, `/CH` China, `/ORG` Original); (4) si no, solo la marca (el texto tal cual, si parece una marca) y **sin procedencia**: nunca se supone. Una marca con `procedencia: null` queda sin procedencia (salvo que el código traiga el sufijo). Las filas con `activa = false` se ignoran.

**Llamada.** Las mismas dos RPC, con `p_tabla = "marcas"`: `erp_sync_cargar` (upsert por `nombre`) y `erp_sync_borrar` (da de baja). Misma clave, mismos límites (0 a 5000 por lote, `statement_timeout` de 60 s), mismos errores (§7). Mandá primero las marcas y después los productos, o al revés: no dependen entre sí.

**Forma de cada fila de `erp_sync_cargar`.** Lista cerrada de claves; una que no esté acá → `22023 campo desconocido`. Todo o nada, igual que `productos`. Los textos se recortan (`btrim`).

| Campo         | Tipo JSON                         | Obligatorio | Regla                                                                                                                                |
| ------------- | --------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `nombre`      | string, 1–100                     | sí          | Nombre canónico (`nombre_canonico` de Bodega Web). Clave del upsert. Dos nombres que difieren solo en mayúsculas son la misma marca  |
| `tipo`        | string, 1–50 \| null              | no          | Se guarda tal cual (`original`, `alterna`…). El CRM no decide nada con él                                                            |
| `procedencia` | string, 1–50 \| null              | no          | Un país o `ORIGINAL`, como lo escribe Bodega Web (`KOREA`, `JAPON`, `FRANCIA`, `ALEMANIA`, `CHINA`, `ORIGINAL`). `null` = no se sabe |
| `activa`      | boolean \| null                   | no          | `null` o ausente = `true`. `false` = el agente la ignora                                                                             |
| `alias`       | arreglo de strings (0–50) \| null | no          | Las abreviaturas de `marca_alias`. Cada una: texto de 1–100 caracteres. `null` o ausente = `[]`                                      |

Una fila idéntica a la guardada no se escribe: recargar todo sin cambios devuelve `0`. Un nombre repetido dentro del lote (comparado sin mayúsculas) → `22023 fila N: nombre X repetido en el lote`. Un nombre que difiere solo en mayúsculas de uno ya guardado → error de índice único y no se escribe nada: el extractor tiene que mandar siempre el mismo `nombre` para la misma marca.

```json
[
  {
    "nombre": "MOBIS",
    "tipo": "original",
    "procedencia": "ORIGINAL",
    "activa": true,
    "alias": ["HYUNDAI MOBIS"]
  },
  { "nombre": "JUNGWOO", "tipo": "alterna", "procedencia": "KOREA", "activa": true, "alias": [] },
  { "nombre": "TAIHO", "tipo": null, "procedencia": null, "activa": true, "alias": [] }
]
```

(Ejemplo con la forma del contrato: los valores de MOBIS y JUNGWOO son los que el dueño confirmó el 2026-10-07; `TAIHO` y el alias `HYUNDAI MOBIS` son inventados para ilustrar la forma, no salen de la base de Bodega Web.)

**Baja.** `erp_sync_borrar` con `p_tabla = "marcas"` y `p_claves` = arreglo de 0 a 5000 objetos `{"nombre": "<texto>"}`, sin otras claves (otra forma → `22023 clave N: ...`). Pone `activa = false`; **nunca borra**. Devuelve cuántas desactivó (una ya inactiva o inexistente no cuenta). Recargar la marca con `activa: true` la reactiva. La comparación del `nombre` es exacta (sin mayúsculas distintas).

**Permisos.** `catalogo_marcas`: el CRM la lee con la service role y un vendedor o admin autenticado puede leerla; **nadie la escribe directo**, solo estas RPC con la clave. Una carga de `marcas` no toca `productos`.

## 4. `erp_sync_borrar(p_clave text, p_tabla text, p_claves jsonb) → integer`

Da de baja lo que ya no está en el ERP: `activo = false`. **Nunca borra**, porque un producto puede estar cotizado en una sesión. Devuelve cuántas filas desactivó. Una que ya estaba inactiva no cuenta, y un `no_item` que no existe tampoco.

- `p_tabla`: `"productos"` o `"marcas"`. Con `"marcas"` las claves son `{"nombre": "..."}` (§3.4).
- `p_claves`: arreglo de 0 a 5000 objetos `{"no_item": "<texto>"}`, sin otras claves. Otra forma → `22023 clave N: ...`. Más de 5000 → `54000`.

Mandá solo los `no_item` que el extractor **vio desaparecer** del ERP. El CRM tiene productos que no vinieron del ERP, y esos no se tocan si no se los nombra.

## 5. `erp_sync_estado_fijar(p_clave, p_fase, p_ok?, p_error?, p_filas_cargadas?) → void`

| Parámetro          | Tipo                  | Uso                                                                       |
| ------------------ | --------------------- | ------------------------------------------------------------------------- |
| `p_fase`           | `"inicio"` \| `"fin"` | Otro valor → `22023`                                                      |
| `p_ok`             | boolean               | Solo en `fin`. `null` cuenta como `false`                                 |
| `p_error`          | text                  | Solo en `fin` con `p_ok = false`. Se guardan los primeros 2000 caracteres |
| `p_filas_cargadas` | integer ≥ 0           | Solo en `fin`: la suma de lo que devolvió `erp_sync_cargar` en el ciclo   |

Las horas las pone la base. La pantalla del CRM lee `public.erp_sync_estado`, una sola fila con estos campos: `ultimo_inicio`, `ultimo_fin`, `ultimo_ok`, `ultimo_exito` (fin del último ciclo que terminó bien, que es lo que muestra «Actualizado hace X min»), `ultimo_error`, `filas_cargadas` y `actualizado_at`.

## 6. Ciclo recomendado

1. `erp_sync_estado_fijar(clave, 'inicio')`.
2. `erp_sync_cargar` con todo el catálogo en lotes de **hasta 5000**, en serie. Se puede mandar todo cada vez: lo que no cambió no se escribe.
3. `erp_sync_borrar` con los `no_item` que desaparecieron del ERP, si hay.
   Las marcas (`p_tabla = "marcas"`, §3.4) se cargan igual, en el mismo ciclo, antes del paso 4. No cuentan en `p_filas_cargadas`, que es solo de `productos`.
4. `erp_sync_estado_fijar(clave, 'fin', p_ok => true, p_filas_cargadas => <suma>)`. Si algo falló: `p_ok => false, p_error => <mensaje sin la clave>`.

## 7. Errores

| SQLSTATE   | Cuándo                                                                                                                                 | Qué hacer                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `42501`    | Clave nula, de menos de 32 caracteres, equivocada, o el hash no está configurado. Se valida **antes** que todo lo demás                | No reintentar. Revisar la clave                                                        |
| `22023`    | Tabla distinta de `productos`/`marcas`, lote que no es arreglo, fila o clave mal formada, `no_item` o `nombre` repetido, fase inválida | No reintentar. El mensaje dice qué fila y qué campo. El lote entero quedó sin escribir |
| `54000`    | Más de 5000 filas o claves en un lote                                                                                                  | Partir el lote                                                                         |
| `57014`    | El lote superó el `statement_timeout` (60 s, propio de `erp_sync_cargar`/`erp_sync_borrar`)                                            | Reintentar con lotes más chicos (2000)                                                 |
| `PGRST202` | La función no existe                                                                                                                   | Las migraciones del CRM no están aplicadas en ese proyecto                             |

Ningún mensaje de error incluye la clave.

## 8. Tiempos medidos

Medido en el stack local del CRM (Docker en la PC de desarrollo) con `crm_catalogo_erp.csv` (27.187 filas). Todo pasó por la anon key y `erp_sync_cargar`, en lotes de 5000:

| Fecha      | Corrida                     | Filas escritas | Por lote de 5000 | Total  |
| ---------- | --------------------------- | -------------- | ---------------- | ------ |
| 2026-10-05 | Primera carga (tabla vacía) | 27.187         | 1,3–1,8 s        | 8,6 s  |
| 2026-10-05 | Recarga sin cambios         | 0              | 0,69–0,75 s      | 3,9 s  |
| 2026-10-06 | Primera carga (tabla vacía) | 27.187         | 1,7–2,5 s        | 11,0 s |
| 2026-10-06 | Recarga sin cambios         | 0              | 1,0–1,4 s        | 6,3 s  |

El tiempo por lote varía con la carga de la máquina. El 2026-10-06, antes de agregar el tope propio, otra corrida tardó 2,4–3,2 s por lote y el quinto lote cortó con `57014` al llegar a los 3 s que Supabase le da al rol anon. Por eso `erp_sync_cargar` y `erp_sync_borrar` llevan `statement_timeout = 60s` en la propia función. Se verificó en el stack local: con ese ajuste, una RPC de anon de 4 s termina; sin él, corta a los 3,0 s.

Conteos después de la carga: 27.187 productos, 16.266 con stock > 0, 1.456 con precio a consultar, 801 con `codigo_difiere`, y 4.119 con `otros_codigos`. De las 4.411 filas con algo en esa columna, 290 traían solo `0`, una solo puntos y una solo un blanco. Son 2 menos con stock que en el CSV porque esas 2 filas tienen entre 0 y 1 unidad.

Para reproducirlo: `node scripts/con-stack-local.mjs -- node scripts/erp/cargar-csv-local.mjs --archivo=<ruta sin espacios>`.

**No está medido contra el Supabase en la nube.** Si aparece `57014` o un timeout del gateway HTTP, bajá el lote a 2000.
