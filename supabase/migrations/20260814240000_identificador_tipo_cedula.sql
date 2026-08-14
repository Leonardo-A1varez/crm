-- La persona física tiene cédula, no RUC.
--
-- `identificador_tipo_enum` nació con `ruc`, que es el nombre del documento de
-- una EMPRESA registrada. Pero la mitad de los que compran repuestos son
-- personas: un mecánico independiente, el dueño del auto. Pedirle el RUC a
-- alguien que no factura es pedirle un dato que no tiene, y el resultado es un
-- campo vacío donde había un identificador perfectamente bueno.
--
-- Va `after 'ruc'` para que los dos documentos queden juntos al leer el tipo.

alter type public.identificador_tipo_enum add value if not exists 'cedula' after 'ruc';

-- =========================================================================
-- `placa` y `vin` quedan huérfanos
-- =========================================================================

-- Fueron un error de ubicación: identifican al AUTO, no a la persona. Un taller
-- tiene un documento fiscal y tres camionetas, y la placa de una de ellas no es
-- un dato del taller. Desde la migración 20260814230000 viven en
-- `lead_vehiculos`, que además guarda marca, modelo, año y motor del mismo auto.
--
-- NO se quitan del enum. Postgres no permite eliminar un valor de un enum: hay
-- que crear el tipo nuevo, reescribir cada columna que lo usa, recrear los
-- índices, las policies y las funciones que lo mencionan, y borrar el viejo.
-- Todo eso por dos valores que nadie escribió nunca —verificado con
-- `select tipo, count(*) from public.lead_identificadores group by tipo`, cero
-- filas de ambos— cuesta más riesgo que dejarlos documentados.
--
-- Lo que sí se garantiza es que no entren filas nuevas: el schema Zod de la
-- Server Action y el selector de la ficha ofrecen sólo los cuatro tipos de la
-- persona (`IDENTIFICADOR_TIPO_PERSONA` en `src/types/domain.ts`).

comment on type public.identificador_tipo_enum is
  'Tipos de identificador. Vigentes: telefono, email, ruc, cedula. OBSOLETOS: placa y vin identifican al auto y viven en lead_vehiculos desde 20260814230000; siguen en el enum porque Postgres no permite quitar valores sin recrear el tipo y todas sus dependencias, y nunca se escribio ninguna fila con ellos.';

comment on table public.lead_identificadores is
  'Datos que identifican a la PERSONA detras de un lead: telefono, email, ruc, cedula. Varios por lead: fusionar acumula en vez de descartar. Los datos del AUTO (placa, VIN, marca, modelo, anio, motor) viven en lead_vehiculos. Sin UNIQUE global sobre (tipo, valor) porque el valor compartido es la senal que usa el detector de duplicados.';
