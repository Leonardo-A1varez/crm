-- Los leads que nacieron sin nombre teniendo el de WhatsApp guardado al lado.
--
-- `buildPlaceholderLead` los creaba con `nombre: ''` a propósito: la idea era que
-- el nombre que le pone la casa no compitiera con el alias de Meta, que vive en
-- `nombre_perfil`. La separación está bien, pero nadie resolvía el hueco al
-- pintar: la bandeja lee `nombre` y mostraba "Sin nombre" en un lead que tenía
-- "Leonardo Alvarez" en la columna de al lado, y la ficha de Contacto —que sí lee
-- `nombre_perfil`— lo mostraba completo. El mismo lead con y sin nombre según la
-- pantalla.
--
-- El pipeline ya siembra el hueco al crear el lead y al recibir un mensaje de uno
-- viejo. Esto arregla a los que quedaron atrás y que si no seguirían anónimos
-- hasta que el cliente volviera a escribir.
--
-- Solo llena vacíos: un `nombre` cargado lo escribió una persona y no se toca.

-- `leads_bump_updated_at` es BEFORE UPDATE y la bandeja ordena por `updated_at`
-- DESC. Sin desactivarlo, arreglar un nombre equivaldría a decir "este lead tuvo
-- actividad recién" y lo mandaría al tope de la lista por encima de las
-- conversaciones vivas. La corrección es cosmética: no es actividad del lead.
alter table public.leads disable trigger leads_bump_updated_at;

update public.leads
set nombre = btrim(nombre_perfil)
where btrim(nombre) = ''
  and nombre_perfil is not null
  and btrim(nombre_perfil) <> '';

alter table public.leads enable trigger leads_bump_updated_at;
