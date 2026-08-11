-- Buscador de conversaciones del Inbox: indice para buscar DENTRO del texto de
-- los mensajes.
--
-- ============================================================================
-- POR QUE HACE FALTA UN INDICE
-- ============================================================================
-- La consulta del buscador es `contenido ilike '%texto%'`. Un LIKE con comodin
-- al principio no puede usar un btree —el btree ordena por prefijo y acá no hay
-- prefijo—, asi que sin indice Postgres resuelve cada busqueda con un scan
-- secuencial de `mensajes` ENTERA. Con los 3 mensajes de dev eso es gratis y no
-- se nota nunca; con un piloto real (30 vendedores, ~5K leads/mes,
-- conversaciones de 5-15 mensajes) la tabla vive en el orden de 10^4-10^5 filas
-- y cada tecleo del buscador se lleva la tabla completa por delante.
--
-- ============================================================================
-- POR QUE TRIGRAM Y NO BUSQUEDA DE TEXTO COMPLETO
-- ============================================================================
-- Un `tsvector` + GIN es mas compacto y mas rapido, pero indexa PALABRAS
-- lematizadas, no subcadenas: buscar "corol" no encontraria "Corolla", y buscar
-- "FRE_1234" no encontraria "FRE_12345". El buscador del hilo
-- (`src/lib/ui/busqueda-hilo.ts`) ya hace coincidencia por subcadena y el
-- resaltado de resultados reusa exactamente esa funcion. Cambiar la semantica
-- en el servidor haria que el server dijera "hay coincidencia" y el resaltado
-- del cliente no encontrara nada que marcar, o al reves.
--
-- Ademas: `pg_trgm` YA esta instalado (migracion 20260512000001) y ya hay cinco
-- indices `gin_trgm_ops` en el proyecto (leads.nombre, leads.telefono,
-- productos.nombre, productos.codigo_interno, intents.nombre). Esta es la misma
-- decision que ya se tomo para todas las busquedas del panel, no una nueva.
--
-- ============================================================================
-- EL LIMITE QUE TIENE, Y QUE EL CODIGO RESPETA
-- ============================================================================
-- Un indice trigram solo sirve si del patron se pueden extraer trigramas: con
-- menos de 3 caracteres NO hay trigrama que buscar y el planner vuelve al scan
-- secuencial. Por eso `DefaultBusquedaService` exige 3 caracteres para tocar
-- `mensajes` (constante `MIN_CARACTERES_CONTENIDO`). Con 1 o 2 caracteres la
-- busqueda sigue funcionando sobre las columnas del lead —que son pocas filas—
-- y no toca la tabla grande.
--
-- Sin predicado parcial (`where contenido is not null`) a proposito: aunque los
-- mensajes de media tienen `contenido` NULL y el indice seria mas chico, que el
-- planner pruebe que `ilike` implica NOT NULL depende de la deduccion de
-- predicados, y un indice que no se usa es peor que uno un poco mas grande.
--
-- COSTO DE ESCRITURA: cada insert de mensaje paga la actualizacion del GIN. Se
-- amortiza con `fastupdate` (default) y el volumen esta acotado hacia arriba
-- por la purga de 29 dias, que borra los mensajes de sesiones cerradas.
--
-- ADITIVA: solo crea un indice. No toca datos, no toca policies (el buscador
-- lee `mensajes` con la policy `mensajes_select` que ya existe desde Slice 3) y
-- no hay ningun `drop`.

create extension if not exists pg_trgm;

create index if not exists mensajes_contenido_trgm_idx
  on public.mensajes using gin (contenido gin_trgm_ops);

comment on index public.mensajes_contenido_trgm_idx is
  'Buscador del Inbox: habilita contenido ILIKE ''%texto%'' sin scan secuencial. Requiere patrones de 3+ caracteres para que haya trigramas que buscar.';
