# PRD — Motor de Workflows Visuales

> **Producto:** CRM conversacional para venta de repuestos automotrices en Latam.
> **Este documento:** cómo funciona el motor de workflows, de punta a punta.
> **Versión:** 1.0 · 2026-08-28
> **Documento de respaldo:** `docs/prd-workflows-difusion.md` (estado verificado del sistema, análisis competitivo de 25+ plataformas, restricciones de Meta con fuentes).

---

## 1. Resumen ejecutivo

### 1.1 Qué es

Un **constructor visual de automatizaciones** donde el administrador arma flujos arrastrando módulos a un lienzo y conectándolos con líneas. El modelo de interacción es el de **n8n, Make y Zapier**: una paleta de bloques a la izquierda, un lienzo infinito al centro, y un panel de configuración del bloque seleccionado.

La diferencia con n8n no está en el gesto —arrastrar y conectar es correcto y probado— sino en **qué bloques hay dentro y qué se puede escribir en ellos**:

|                            | n8n                                                    | Este producto                                      |
| -------------------------- | ------------------------------------------------------ | -------------------------------------------------- |
| **Usuario objetivo**       | Integrador técnico                                     | Vendedor de repuestos                              |
| **Catálogo**               | ~400 nodos genéricos de cualquier API                  | ~45 nodos del dominio: conversación, difusión, CRM |
| **Condiciones**            | Expresiones JavaScript (`{{ $json.campo }}`)           | `campo → operador → valor`, elegidos de listas     |
| **Datos entre pasos**      | Referencias por nombre de nodo, se rompen al renombrar | IDs internos estables, el nombre es solo etiqueta  |
| **Integraciones externas** | HTTP genérico, código, Sheets, bases externas          | Ninguna. Es un CRM, no un ETL                      |

### 1.2 Para quién

**El administrador** (dueño o encargado): arma las automatizaciones. Sabe de repuestos y de vender. **No programa.** Si algo exige escribir una expresión, no lo va a usar: va a pedir que se lo armen.

**El vendedor:** no toca el constructor. Consume el resultado en su bandeja y necesita entender por qué un lead recibió cierto mensaje.

### 1.3 Qué reemplaza

Cuatro sistemas que hoy viven como código separado, cada uno con su propia forma de configurarse:

| Sistema actual                           | Pasa a ser                            |
| ---------------------------------------- | ------------------------------------- |
| Reglas IF/THEN pre-LLM (`reglas`)        | Plantilla "Responder automático"      |
| Reglas de etiquetado (`reglas_etiqueta`) | Plantilla "Etiquetar automáticamente" |
| Escalado automático (`auto-handoff`)     | Plantilla "Escalar a humano"          |
| Reactivación de perdidos (cron)          | Plantilla "Reactivación"              |

**La migración es gradual y por sistema**, de menor a mayor riesgo. Cada sistema viejo se apaga solo después de que el nuevo corrió en paralelo y se verificó contra la base real. Detalle en §12.

### 1.4 Qué agrega que hoy no existe

**Difusión**: mandarle un mensaje a un grupo de leads a la vez. Hoy no existe en ninguna forma — lo que la base llama `campanias` es solo un rango de fechas para atribuir métricas.

---

## 2. Conceptos

Cinco objetos. Todo el sistema se explica con estos cinco.

**Workflow** — una automatización. Tiene nombre, un estado (borrador / activo / pausado) y una o más versiones. Es lo que el administrador crea y edita.

**Versión** — una foto congelada del flujo. Editar produce un borrador; publicar congela ese borrador como versión inmutable. **Las corridas en marcha terminan en la versión donde arrancaron**, aunque se publique otra.

**Nodo** — un bloque del lienzo. Tiene un tipo (que decide qué hace y cómo se ve), una configuración, y una posición.

**Conexión** — la línea entre dos nodos. Sale de un puerto del nodo origen y entra al nodo destino. Un nodo normal tiene un puerto de salida; una condición tiene dos (Sí / No).

**Corrida** — una ejecución concreta para un lead concreto. Sabe en qué nodo va, cuánto ejecutó, y guarda entrada y salida de cada paso.

```
Workflow "Bienvenida"
 └── Versión 3 (publicada)
      └── Grafo: 5 nodos, 5 conexiones
           └── Corrida #a3f2 · lead Juan Pérez · esperando en "Delegar a IA" · 3 pasos hechos
```

---

## 3. El editor

### 3.1 Anatomía

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ← Flujos    Bienvenida  [v3 publicada ▾]      [Probar] [Guardar] [Publicar]│
├────────────┬─────────────────────────────────────────────┬───────────────┤
│  PALETA    │              LIENZO                         │   CONFIGURAR  │
│  (240px)   │                                             │   (320px)     │
│            │        ┌─────────────────┐                  │               │
│ Buscar…    │        │ ▶ Mensaje       │                  │  Enviar       │
│            │        │   recibido      │                  │  mensaje      │
│ ▼ Inicio   │        └────────┬────────┘                  │               │
│   Mensaje  │                 │                           │  Canal        │
│   Etiqueta │        ┌────────▼────────┐                  │  [WhatsApp ▾] │
│   Etapa    │        │ ◇ ¿Es cliente   │                  │               │
│   …        │        │   nuevo?        │                  │  Mensaje      │
│            │        └───┬─────────┬───┘                  │  ┌──────────┐ │
│ ▼ Mensajes │         Sí │      No │                      │  │Hola {{…}}│ │
│   Texto    │      ┌──────▼───┐ ┌──▼──────┐               │  └──────────┘ │
│   Plantilla│      │ Saludar  │ │ Retomar │               │  + Variable   │
│   Botones  │      └──────────┘ └─────────┘               │               │
│   …        │                                             │  Vista previa │
│            │   ─────────────────────────────────────     │  ┌──────────┐ │
│ ▶ CRM      │   [+] [−] [⊡] [⌘K]         ┌────────┐       │  │Hola Juan │ │
│ ▶ Lógica   │                            │ ▪  ▪   │       │  └──────────┘ │
│ ▶ IA       │                            └────────┘       │               │
│ ▶ Difusión │                             minimapa        │  [Eliminar]   │
└────────────┴─────────────────────────────────────────────┴───────────────┘
```

### 3.2 La paleta

Bloques agrupados por categoría, colapsables. Con buscador arriba.

Un bloque de la paleta se lleva al lienzo de dos formas: **arrastrándolo**, o **haciendo doble clic** (se inserta después del nodo seleccionado y se conecta solo).

**Los bloques que no aplican al flujo actual se ven atenuados y no se pueden soltar.** Si el disparador es "Programado (cron)", los bloques que dependen de un mensaje entrante están deshabilitados, con el motivo en el tooltip.

### 3.3 El lienzo

**Gestos:**

| Gesto                                          | Resultado                                                       |
| ---------------------------------------------- | --------------------------------------------------------------- |
| Arrastrar un bloque de la paleta al lienzo     | Lo agrega                                                       |
| **Soltarlo encima de una línea**               | Lo **inserta ahí** y recablea las dos puntas                    |
| Arrastrar desde un puerto y soltar en el vacío | Abre la paleta filtrada por lo que puede seguir                 |
| Arrastrar desde un puerto a otro nodo          | Los conecta                                                     |
| Borrar un nodo del medio                       | **Cose la línea** entre su antecesor y su sucesor               |
| Doble clic en un nodo                          | Abre su configuración                                           |
| Arrastrar en el vacío                          | Mueve el lienzo                                                 |
| Rueda del mouse                                | Zoom                                                            |
| `⌘K` / `Ctrl+K`                                | Buscador de comandos                                            |
| `⌘Z` / `Ctrl+Z`                                | Deshacer — cubre posición **y** configuración                   |
| `⌘C` / `⌘V`                                    | Copiar y pegar nodos, **como JSON al portapapeles del sistema** |
| `Tab`                                          | Acomodar todo automáticamente                                   |
| `1`                                            | Encuadrar el flujo completo                                     |

**Acomodar automáticamente (`Tab`)** reorganiza los nodos en capas de arriba hacia abajo, minimizando cruces de líneas. **Muestra una vista previa antes de aplicar y se deshace con un solo `⌘Z`.** No es opcional que se pueda deshacer: en n8n esta función apiló los nodos unos sobre otros y dejó editores inutilizables.

**El acomodado es determinista.** El mismo grafo produce siempre las mismas coordenadas. Sin eso, comparar dos versiones sería ruido visual.

**Puntos de reenvío:** un nodo especial que solo dobla una línea para evitar cruces. No hace nada en ejecución; existe únicamente para ordenar el dibujo.

### 3.4 El panel de configuración

Aparece a la derecha al seleccionar un nodo. Su contenido depende del tipo.

**Tres reglas transversales:**

**1. Ningún campo acepta código.** Las condiciones se arman con selectores. Los textos aceptan variables mediante un botón `+ Variable` que abre una lista de campos disponibles — nunca escribiendo `{{ }}` a mano, aunque esa sea la representación interna.

**2. Vista previa en vivo con datos reales.** Un mensaje con variables se previsualiza contra un lead real elegible desde el panel, no contra un ejemplo inventado.

**3. Los errores se explican y se ofrecen resueltos.** Nunca _"Can't get data for expression"_. En su lugar:

> ⚠ Este mensaje usa **Marca del vehículo**, pero ningún paso anterior la obtiene.
> [Ver de dónde sale] · [Agregar "Extraer datos" antes] · [Usar otro campo]

### 3.5 Validación

Se valida en vivo, y **los problemas se ven sobre el nodo culpable**, no en una lista aparte.

Tres severidades:

| Marca       | Significado                                                                | ¿Se puede publicar? |
| ----------- | -------------------------------------------------------------------------- | ------------------- |
| 🔴 Rojo     | Error: falta configuración obligatoria, rama sin salida, nodo inalcanzable | **No**              |
| 🟡 Amarillo | Advertencia: el nodo quedó obsoleto porque cambió algo del que lo alimenta | Sí                  |
| 🔵 Azul     | Cambio sin publicar                                                        | Sí                  |

**Las siete reglas** (ya existen en el código como `REGLAS_VALIDACION`):

1. Hay exactamente un disparador.
2. El disparador no recibe conexiones entrantes.
3. Todo nodo es alcanzable desde el disparador.
4. Todo puerto de salida está conectado, salvo en "Detener".
5. Ninguna conexión apunta a un nodo que no existe.
6. Una condición tiene sus dos puertos conectados.
7. No hay ciclos sin una espera adentro. _(Un ciclo sin espera se ejecutaría infinitas veces.)_

**Una conexión inválida no se puede soltar.** Mientras se arrastra, los puertos incompatibles se atenúan y el cursor lo indica. Es preferible impedir el error a reportarlo.

---

## 4. Catálogo de nodos

Cada nodo se describe con: **qué hace**, **qué se configura**, **cuántas salidas tiene**.

### 4.1 Disparadores — arrancan el flujo

Un flujo tiene **exactamente uno**, y es siempre el primer nodo.

| Nodo                    | Qué lo dispara                | Configuración                                    |
| ----------------------- | ----------------------------- | ------------------------------------------------ |
| **Mensaje recibido**    | El lead escribe               | Canal · el texto contiene · trae archivo adjunto |
| **Etiqueta asignada**   | Se le pone una etiqueta       | Cuál etiqueta                                    |
| **Etiqueta quitada**    | Se le saca una etiqueta       | Cuál etiqueta                                    |
| **Etapa cambiada**      | El lead se mueve en el embudo | Etapa de origen · etapa de destino               |
| **Lead creado**         | Aparece un lead nuevo         | Canal de origen                                  |
| **Inactividad**         | Pasa X tiempo sin respuesta   | Cuánto tiempo · desde qué etapa                  |
| **Vendedor asignado**   | Se le asigna un vendedor      | Vendedor específico o cualquiera                 |
| **Programado**          | Reloj                         | Frecuencia · hora · días · zona horaria          |
| **Manual**              | Alguien aprieta un botón      | —                                                |
| **Difusión respondida** | Alguien contesta una campaña  | Cuál campaña                                     |
| **Baja de marketing**   | El lead se da de baja         | —                                                |

**Una propiedad no negociable de todo disparador: `intercepta_llm`.**

Los flujos que **responden** al lead compiten con el agente de IA: gana **uno solo** y corta el LLM ese turno. Los flujos que **etiquetan** o anotan corren **todos los que coincidan** y no cortan nada.

Son semánticas opuestas y no se pueden modelar con la misma regla. El editor lo muestra explícito al elegir el disparador, porque el administrador tiene que entender la diferencia.

### 4.2 Mensajería — hablarle al lead

| Nodo                          | Qué hace                      | Configuración                        | Salidas     |
| ----------------------------- | ----------------------------- | ------------------------------------ | ----------- |
| **Enviar mensaje**            | Texto libre                   | Canal · texto con variables          | 1           |
| **Enviar plantilla**          | Plantilla aprobada por Meta   | Plantilla · valores de sus variables | 1           |
| **Mensaje con botones**       | Hasta 3 botones               | Texto · botones · qué hace cada uno  | 1 por botón |
| **Mensaje de lista**          | Lista desplegable de WhatsApp | Encabezado · secciones · ítems       | 1 por ítem  |
| **Enviar imagen / documento** | Adjunto                       | Archivo o URL · epígrafe             | 1           |
| **Enviar ubicación**          | Punto en el mapa              | Coordenadas · nombre · dirección     | 1           |
| **Reaccionar**                | Emoji sobre un mensaje        | Emoji · a qué mensaje                | 1           |

**Regla de la ventana de 24 horas, aplicada al validar y no al ejecutar:**

WhatsApp solo permite texto libre dentro de las 24 horas siguientes al último mensaje del lead. Fuera de esa ventana hace falta una plantilla aprobada.

**El editor lo resuelve antes de publicar, no cuando falla:** si un flujo puede llegar a "Enviar mensaje" fuera de la ventana —por ejemplo después de una espera de dos días— el nodo se marca en rojo con el motivo y la salida:

> 🔴 Este mensaje sale 2 días después del último contacto. Fuera de la ventana de 24h WhatsApp exige una plantilla aprobada.
> [Cambiar a "Enviar plantilla"] · [Acortar la espera]

Cada nodo de mensajería declara además si es **de servicio** o **de marketing** — decide si se cobra y si cuenta contra el tope de marketing de Meta.

### 4.3 CRM — modificar el lead

| Nodo                       | Qué hace                | Configuración                                         | Salidas     |
| -------------------------- | ----------------------- | ----------------------------------------------------- | ----------- |
| **Poner etiqueta**         | Agrega etiqueta(s)      | Cuáles                                                | 1           |
| **Quitar etiqueta**        | Saca etiqueta(s)        | Cuáles                                                | 1           |
| **Cambiar etapa**          | Mueve en el embudo      | Etapa destino                                         | 1           |
| **Asignar vendedor**       | Asigna a alguien        | Vendedor                                              | 1           |
| **Repartir (round robin)** | Rota entre vendedores   | Lista · saltear los que no están · tope por persona   | 1           |
| **Actualizar campo**       | Escribe en el Lead Twin | Campo · valor                                         | 1           |
| **Agregar nota**           | Nota interna            | Texto                                                 | 1           |
| **Escalar a humano**       | Pausa la IA y avisa     | Motivo (de los 8 tipados) · a quién · mensaje interno | 1           |
| **Marcar como spam**       | —                       | —                                                     | 0 (termina) |
| **Archivar**               | —                       | —                                                     | 0 (termina) |

**"Escalar a humano" tiene una particularidad heredada de una decisión ya tomada:** el escalado **automático** avisa, marca revisión administrativa y pausa la IA de forma visible. La pausa **manual** es silenciosa. No son lo mismo y el nodo respeta esa diferencia.

### 4.4 Lógica — control de flujo

| Nodo                  | Qué hace                              | Configuración                    | Salidas                       |
| --------------------- | ------------------------------------- | -------------------------------- | ----------------------------- |
| **Condición**         | Bifurca                               | Campo · operador · valor         | **2** (Sí / No)               |
| **Según el valor**    | Múltiples ramas                       | Campo · un caso por rama         | 1 por caso + "ninguno"        |
| **Esperar tiempo**    | Pausa                                 | Duración · o hasta un día y hora | 1                             |
| **Esperar respuesta** | Hasta que el lead escriba             | Tiempo máximo                    | **2** (respondió / se venció) |
| **Esperar evento**    | Hasta que pase algo                   | Qué evento · tiempo máximo       | **2**                         |
| **Ir a**              | Salta a otro nodo                     | Nodo destino                     | 0                             |
| **Detener**           | Termina                               | Con qué resultado                | 0                             |
| **Si falla**          | Captura errores del nodo que envuelve | Qué hacer                        | **2** (ok / falló)            |

**La condición es el nodo más importante del sistema, y su diseño es la decisión de producto más fuerte de este documento.**

Se arma con tres selectores. Nunca con texto libre:

```
┌────────────────────────────────────────────────┐
│  Si:                                           │
│  ┌──────────────────┐ ┌──────────┐ ┌─────────┐ │
│  │ Etapa del lead ▾ │ │ es igual▾│ │cotizado▾│ │
│  └──────────────────┘ └──────────┘ └─────────┘ │
│                                                │
│  [+ Y]  [+ O]                                  │
│                                                │
│  Coinciden ahora: 47 leads   [Ver la lista]    │
└────────────────────────────────────────────────┘
```

- **El campo** sale de una lista: datos del lead, campos del Lead Twin, etiquetas, vehículo, intent detectado, historial.
- **El operador** depende del tipo del campo. Un texto ofrece _es / no es / contiene / empieza con / está vacío_. Un número ofrece _mayor / menor / entre_. Una fecha ofrece _antes / después / hace más de_.
- **El valor** sale de una lista cuando el campo es cerrado (etapas, etiquetas, vendedores). Es texto libre solo cuando no hay más remedio.

**Los grupos Y/O son cajas visuales anidadas, no texto.** La causa número uno de "le mandamos a toda la base" en la industria entera es un OR mal agrupado. Acá no se puede escribir mal porque no se escribe.

**Y muestra cuántos coinciden ahora mismo, con la lista a un clic.** Nadie arma una condición a ciegas.

### 4.5 IA — delegar en el agente

| Nodo                     | Qué hace                             | Salidas                  |
| ------------------------ | ------------------------------------ | ------------------------ |
| **Delegar al agente**    | Le cede la conversación por un tramo | **5**                    |
| **Clasificar intent**    | Detecta qué quiere el lead           | 1 por intent + "ninguno" |
| **Extraer datos**        | Llena campos del Lead Twin           | 1                        |
| **Analizar sentimiento** | Positivo / neutro / negativo         | 3                        |
| **Resumir conversación** | Genera un resumen                    | 1                        |
| **Verificar spam**       | Detecta bots                         | 2                        |

**"Delegar al agente" es el nodo con más diseño detrás**, porque es donde el resto del mercado falla.

Mientras está activo, el agente vendedor de siempre sigue respondiendo cada mensaje. El workflow **no lo reemplaza: lo observa**, y espera una de cinco condiciones de salida.

```
Configuración:

  Instrucciones extra para este tramo    [texto libre, opcional]

  Volver cuando:
    ☑ Se detecte el intent:              [consulta_producto ▾]
    ☐ Un campo del Twin cumpla:          [condición]

  Tiempo máximo:                          [1440] minutos   ← OBLIGATORIO
```

**`Tiempo máximo` no es opcional y el nodo no se guarda sin él.** Ningún tramo delegado queda sin destino final definido en el momento de diseñarlo.

Esto no es celo: es la falla documentada de Intercom, donde su agente toma la conversación desde un procedimiento y el retorno a veces no vuelve. Y respond.io directamente eliminó la posibilidad — _"The Workflow stops once the AI Agent takes over"_. Infobip no puede volver en absoluto: _"Chats cannot be sent back to the chatbot."_

**Las cinco salidas** son ramas visibles que el administrador conecta:

| Salida            | Cuándo                               |
| ----------------- | ------------------------------------ |
| **Resuelto**      | Se cumplió la condición de contenido |
| **Pidió humano**  | El lead pidió hablar con una persona |
| **No pudo**       | El agente no supo responder          |
| **Sin respuesta** | Se venció el tiempo máximo           |
| **Error**         | Falla técnica                        |

### 4.6 Difusión — hablarle a muchos

Ver §7 para el subsistema completo.

| Nodo                              | Qué hace                        | Salidas    |
| --------------------------------- | ------------------------------- | ---------- |
| **Definir audiencia**             | Arma el grupo de destinatarios  | 1          |
| **Enviar difusión**               | Manda a ese grupo               | 1          |
| **Excluir**                       | Saca gente del grupo            | 1          |
| **Esperar respuesta de difusión** | Espera a que contesten          | 2          |
| **Dividir audiencia**             | Prueba A/B con grupo de control | 1 por rama |

### 4.7 Internos — hablarle al equipo

| Nodo                   | Qué hace                  | Configuración       |
| ---------------------- | ------------------------- | ------------------- |
| **Avisar al vendedor** | Notifica al asignado      | Mensaje · por dónde |
| **Avisar al equipo**   | Notifica a un grupo       | Grupo · mensaje     |
| **Comentario interno** | Nota que el cliente no ve | Texto               |

---

## 5. Ciclo de vida

```
   Crear ──> Editar ──> Validar ──> Probar ──> Publicar ──> Ejecutar ──> Monitorear
     │          ↑                                  │                          │
     │          └──────────── nueva versión ───────┘                          │
     └── desde plantilla o en blanco                                          │
                                                    reanudar desde el fallo ──┘
```

### 5.1 Crear

Crear un workflow **abre una galería de plantillas**, nunca un lienzo vacío. "Empezar en blanco" existe pero es la opción secundaria.

**Las seis plantillas de arranque:**

| Plantilla                     | Disparador           | Pasos                                                               |
| ----------------------------- | -------------------- | ------------------------------------------------------------------- |
| **Responder automático**      | Mensaje recibido     | Condición (intent) → Enviar mensaje → Detener                       |
| **Etiquetar automáticamente** | Mensaje recibido     | Condición → Poner etiqueta                                          |
| **Escalar a humano**          | Mensaje recibido     | Condición → Escalar → Avisar al vendedor                            |
| **Reactivar perdidos**        | Programado (semanal) | Audiencia (motivo de pérdida) → Enviar plantilla → Etiquetar        |
| **Bienvenida + agente**       | Lead creado          | Enviar bienvenida → Delegar a IA → (5 ramas)                        |
| **Seguimiento de cotización** | Etapa → cotizado     | Esperar 2d → Condición → Mensaje → Esperar 3d → Condición → Escalar |

Elegir una plantilla abre un **formulario de parámetros**, no el lienzo: qué intent, qué etiqueta, qué texto. El lienzo aparece después, ya armado, y se puede modificar.

### 5.2 Editar

Editar **siempre trabaja sobre un borrador**. La versión publicada sigue corriendo intacta mientras tanto.

Se guarda solo, con indicador de estado. `⌘S` fuerza el guardado.

### 5.3 Probar

**"Probar" ejecuta el mismo motor que producción**, con los efectos externos interceptados.

Esto es una decisión explícita y es la corrección de una falla real: hoy existen dos motores distintos, y el simulador conoce 21 acciones mientras el ejecutor real conoce 4. **Un producto que promete "probá antes de mandar" y prueba contra otro motor es peor que no ofrecer la prueba.**

Al ejecutar:

- Se elige un lead real.
- El flujo corre paso a paso **pintándose sobre el lienzo**.
- Los mensajes salientes **no se envían**: se muestran en un panel como se verían.
- Cada nodo ejecutado muestra qué entró y qué salió.
- Las esperas se pueden saltear.

### 5.4 Publicar

Publicar congela el borrador como versión inmutable y la pone a correr.

**Antes de confirmar se muestra el diff sobre el propio lienzo:**

- Nodos agregados en verde.
- Nodos eliminados en rojo, en su posición original.
- Nodos con configuración cambiada en ámbar, y al pasar el mouse: valor viejo → valor nuevo.

Ninguna plataforma investigada ofrece esto. Zapier tiene borradores pero no diff; n8n no tiene borradores en absoluto y su historial dura 24 horas en el plan base, con casos documentados de pérdida de trabajo.

**Las corridas en marcha terminan en la versión donde arrancaron.** Publicar nunca las mueve ni las rompe.

### 5.5 Estados

| Estado          | Qué significa                             | Cómo llegó          |
| --------------- | ----------------------------------------- | ------------------- |
| **Borrador**    | Nunca se publicó                          | Recién creado       |
| **Activo**      | Publicado y disparándose                  | Se publicó          |
| **Con cambios** | Publicado, y además hay un borrador nuevo | Se editó uno activo |
| **Pausado**     | Publicado pero no se dispara              | Alguien lo pausó    |
| **Con errores** | Las últimas corridas fallaron             | Falla repetida      |

**Pausar frena disparos nuevos y no toca las corridas en curso.** Se dice explícitamente en la UI, porque la ambigüedad entre esas dos cosas es una queja documentada del mercado.

---

## 6. Ejecución

### 6.1 Cómo arranca

1. Pasa algo en el CRM: llega un mensaje, cambia una etiqueta, se cumple un horario.
2. El sistema emite un evento.
3. Se buscan los workflows **activos** cuyo disparador coincide.
4. Para cada uno, se crea una corrida y se ejecuta.

**De los que interceptan al LLM gana uno solo** y corta la respuesta del agente ese turno. **De los que no interceptan, corren todos.**

### 6.2 Cómo avanza

La corrida ejecuta nodo por nodo. Cada paso guarda su entrada y su salida.

Un paso puede terminar de tres formas:

| Resultado     | Qué pasa                                           |
| ------------- | -------------------------------------------------- |
| **Continuar** | Sigue al nodo conectado por el puerto que devolvió |
| **Esperar**   | La corrida se duerme hasta que se cumpla la espera |
| **Terminar**  | La corrida cierra                                  |

**Tope de pasos por corrida: 500.** Es la red contra un ciclo mal armado. Al alcanzarlo, la corrida falla con motivo `tope_pasos` y avisa.

### 6.3 Cuando algo falla

**Se reintenta el paso, nunca el flujo entero.** Con espera creciente entre intentos.

Esto no es un detalle técnico: re-ejecutar un flujo completo significa **volver a mandarle el mismo WhatsApp a un cliente real**. Zapier tiene esa función y su propio foro tiene un hilo titulado _"Replay Zap Run is misleading"_, porque llamó igual a dos cosas distintas.

**Acá son dos acciones separadas, con dos nombres y dos íconos:**

| Acción                                   | Qué hace                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| **Reanudar desde el fallo**              | Sigue desde el paso que falló. Los anteriores no se repiten                         |
| **Ejecutar de nuevo desde el principio** | Corre todo otra vez. **Pide confirmación enumerando qué mensajes se van a repetir** |

**Al reanudar, el lienzo muestra qué se va a reusar y qué se va a re-ejecutar** — los pasos memoizados en gris con su hora, los que van a correr en color. Antes de confirmar.

**Y el arreglo llega a la corrida rota.** Si se corrige el flujo y se reanuda una corrida fallada, la corrida usa el arreglo. La queja número uno de Make es exactamente lo contrario: editás el escenario y la ejecución guardada sigue con el módulo viejo — _"build the fixes twice"_.

### 6.4 Esperas

Un flujo puede dormir días. Al despertar:

- **Se revalida que el lead sigue calificando.** Si en el medio se dio de baja, cerró la venta o pasó a "requiere humano", el flujo se detiene y lo registra.
- Si la espera venció fuera de la ventana de 24 horas, un "Enviar mensaje" **no se manda**: se registra el motivo. Esto ya se marca en rojo al validar (§4.2), pero la ejecución también lo protege.

### 6.5 Concurrencia

Cada workflow define qué hacer si un lead ya tiene una corrida viva del mismo flujo:

| Política              | Comportamiento                      |
| --------------------- | ----------------------------------- |
| **Ignorar** (default) | No arranca otra                     |
| **Reiniciar**         | Cancela la vieja y arranca de nuevo |
| **Permitir**          | Corren en paralelo                  |

**El default es "Ignorar"**, que es el seguro.

### 6.6 Topes de seguridad

Aplican **siempre**, por encima de lo que diga cualquier flujo:

- **Máximo 3 mensajes automáticos salientes por lead cada 24 horas.** Configurable, ya existe en el esquema.
- **Un lead en "requiere humano" no recibe mensajes automáticos.** Hay una persona a cargo.
- **Un lead dado de baja no recibe marketing.** Nunca.

**Cuando un tope salta un mensaje, el lead sale del flujo** — no avanza en silencio al paso siguiente. Braze documenta este bug contra sí mismo: _"global frequency capping alone doesn't exit users from a Canvas"_, y el paso siguiente le pega igual.

**Cada mensaje saltado deja un registro con su motivo** (`tope_frecuencia`, `dado_de_baja`, `sin_ventana`, `conversacion_activa`, `requiere_humano`). Sin eso no hay forma de auditar por qué alguien no recibió.

---

## 7. Difusión

### 7.1 Qué es

Mandar un mensaje a un grupo de leads a la vez. **Hoy no existe en el producto en ninguna forma.**

### 7.2 Por qué es difícil

WhatsApp no es email. Mandar de más no cuesta plata: **cuesta el número.**

Los límites que gobiernan el diseño, todos verificados contra la documentación de Meta:

| Límite                                   | Valor                                                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Destinatarios únicos fuera de la ventana | **250 → 2.000 → 10.000 → 100.000 → ilimitado**, en ventana móvil de 24h                              |
| Alcance del límite                       | **Por portfolio, compartido entre todos los números.** Comprar números no multiplica nada            |
| Al mismo destinatario                    | **1 mensaje cada 6 segundos**                                                                        |
| Global                                   | 80 mensajes/segundo                                                                                  |
| Tope de marketing por persona            | **Impuesto por Meta, entre negocios, por orden de llegada, ventana de 7 días.** Aplica en toda Latam |
| Sanción                                  | Advertencia → 1-3 días → 5-30 días → bloqueo indefinido → permanente                                 |

**El tope de marketing es el más contraintuitivo y el que nadie modela:** una persona recibe plantillas de marketing de una cantidad limitada de negocios por semana, repartida por orden de llegada. **La hora a la que sale la difusión decide si entrás o si otro negocio ya se comió su cupo.**

### 7.3 Qué hace la competencia

Nueve plataformas investigadas. **Ninguna encola y drena respetando el cupo:**

| Plataforma       | Al exceder                                               |
| ---------------- | -------------------------------------------------------- |
| respond.io       | _"the entire broadcast will not be sent"_ — falla entero |
| Wati             | Campaña a "Stopped", sin reintento, recreación manual    |
| Twilio           | Encola 4 horas y después falla                           |
| Take Blip        | Muestra el cupo pero no lo administra                    |
| Callbell         | Ni menciona los tiers                                    |
| Zenvia           | Envío por lotes manual                                   |
| Meta, por debajo | **Falla mensaje por mensaje.** No encola nada            |

### 7.4 Cómo funciona acá

**Ninguna difusión escribe directo a Meta.** Todas pasan por un planificador:

```
Audiencia (4.320 leads)
   │
   ├─ 1. Quitar dados de baja (propios y de Meta)          −180
   ├─ 2. Quitar saturados por el tope de Meta               −95
   ├─ 3. Quitar con conversación activa ahora              −210
   ├─ 4. Quitar en negociación o esperando pago             −88
   ├─ 5. Quitar duplicados por teléfono                     −34
   ├─ 6. Aplicar tope de frecuencia propio                 −140
   │                                                    ────────
   │   Destinatarios finales                              3.573
   │
   ├─ 7. Consultar cupo restante (leído por API)      1.850 hoy
   ├─ 8. Reservar para conversaciones vivas             −300
   │                                                    ────────
   │   Sale hoy                                          1.550
   │   Sale mañana                                       1.550
   │   Sale pasado                                         473
   │
   └─ 9. Repartir respetando 80/s global y 1 cada 6s por persona
```

**Preferir lo gratis sobre lo pago:** si un lead tiene la ventana de servicio abierta, se le manda un mensaje libre — es gratis y no cuenta contra el tope de marketing — en vez de la plantilla paga. Es una decisión por destinatario. **Ninguna plataforma lo hace.**

**Invariante del pipeline:** los destinatarios finales **nunca** pueden superar el tamaño del grupo inicial. Si se rompe, el envío se aborta **antes de la primera llamada a Meta**.

Esto viene de un postmortem real: Buttondown, 16 de octubre de 2025, un bug de rate limiting rompió esa invariante y mandó duplicados masivos en cinco newsletters. Detectaron en 8 minutos gracias a esa alerta.

### 7.5 La pantalla de pre-vuelo

Lo último antes de confirmar. Es el diferenciador más visible del producto.

```
┌──────────────────────────────────────────────────────────────┐
│  Revisar antes de enviar                                     │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  DESTINATARIOS                                               │
│  3.573 leads          [Ver la lista completa] [Comparar]     │
│                                                              │
│  Excluidos (747):                                            │
│    180  dados de baja           95  saturados en Meta        │
│    210  conversación activa     88  en negociación           │
│     34  duplicados             140  tope de frecuencia       │
│                                                              │
│  ─────────────────────────────────────────────────────────   │
│  CUPO                                                        │
│  Usado hoy      ████████░░░░░░░░  1.150 / 3.000              │
│  Esta difusión  ░░░░░░░░████████  1.550                      │
│  Reservado      ░░░░░░░░░░░░░░██    300  (conversaciones)    │
│                                                              │
│  ⚠ No entra en un día. Plan: 1.550 hoy · 1.550 mañana ·      │
│    473 el viernes. Termina el 30/08 a las 14:20.             │
│                                                              │
│  ─────────────────────────────────────────────────────────   │
│  COSTO ESTIMADO                                              │
│  2.847 con plantilla de marketing   USD 71,18                │
│    726 dentro de ventana abierta    USD  0,00  (gratis)      │
│                                     ──────────               │
│                                     USD 71,18                │
│                                                              │
│  ─────────────────────────────────────────────────────────   │
│  SALUD DEL NÚMERO                                            │
│  Calidad          ● Alta                                     │
│  Nivel            2.000/día · faltan 4 días de uso para      │
│                   subir a 10.000                             │
│  Sanciones        Sin restricciones                          │
│  Plantillas       ⚠ "promo_agosto" pausada — requiere        │
│                     despausado manual  [Despausar]           │
│                                                              │
│  ─────────────────────────────────────────────────────────   │
│  ☑ Enviar primero a 200 y revisar antes de seguir            │
│                                                              │
│  [Enviar de prueba a mi número]   [Cancelar]  [Confirmar]    │
└──────────────────────────────────────────────────────────────┘
```

**Cuatro cosas de esta pantalla que ninguna plataforma investigada ofrece:**

1. **La lista exacta**, no un estimado. Braze samplea con margen de error del 1%.
2. **El diff contra el envío anterior** — quién es nuevo, quién repite.
3. **El costo**, separando lo gratis de lo pago. **Ningún vendor previsualiza el costo.**
4. **El canary**: mandar a los primeros 200, mirar bloqueos y calidad, y recién entonces seguir o abortar. Meta hace esto con sus plantillas; ningún vendor lo ofrece.

### 7.6 Durante y después

**Mientras corre:** progreso en vivo, con entregados, fallidos y pendientes. **Botón de detener siempre visible**, que frena lo pendiente y **dice con precisión qué ya salió y no se puede recuperar** — a diferencia de Braze, que deja creer que detuvo.

**Frenado automático** ante `368` (cuenta restringida), `131031` (violación de política) o `131048` (calidad degradada).

**Al terminar:** entregados, leídos, respondidos, fallidos por motivo, bajas generadas, y conversaciones abiertas.

**Las respuestas entran a la bandeja normal.** No hay bandeja separada de campaña: es una conversación como cualquier otra, con la campaña de origen anotada. El agente puede atenderla y dispara el trigger "Difusión respondida".

**Si la plantilla tiene botones**, cada botón se configura con su propia acción **dentro del mismo asistente de campaña** — el mejor patrón encontrado en toda la investigación (Wati).

---

## 8. Monitoreo

### 8.1 Listado de flujos

Cada flujo como tarjeta: nombre, estado, resumen en una línea, corridas de los últimos 30 días, tasa de éxito, última ejecución.

Filtros por estado y por disparador. Orden por actividad, nombre o fecha.

### 8.2 Historial de un flujo

Lista de corridas con lead, cuándo, cuánto tardó, en qué terminó.

**Filtro "Fallidas" como atajo de un clic**, porque es lo que se busca el 90% de las veces.

### 8.3 Detalle de una corrida

El flujo dibujado con el camino recorrido resaltado: verde lo que pasó, gris lo que no, rojo donde falló.

Al costado, la línea de tiempo paso por paso. Clic en un paso muestra qué entró, qué salió, cuánto tardó y cuántos intentos hizo.

**Y desde acá se reanuda desde el fallo.**

### 8.4 En vivo sobre el lienzo

**Una corrida de producción se ve moverse sobre el lienzo, en tiempo real.**

Este es el agujero más citado de n8n: sus ejecuciones disparadas no actualizan el canvas porque _"non-manual executions don't have access to the Websocket/SSE connection"_. Justo cuando más se necesita ver el flujo corriendo, no se ve.

Acá la infraestructura ya está: Inngest emite por paso y Supabase tiene Realtime.

### 8.5 Estados de entrega honestos

**Un mensaje no está "enviado" porque la API devolvió 200.**

Los estados son cinco y se muestran distintos:

| Estado        | Qué significa de verdad                       |
| ------------- | --------------------------------------------- |
| **En cola**   | Todavía no salió                              |
| **Aceptado**  | Meta recibió el pedido. **No garantiza nada** |
| **Entregado** | Llegó al teléfono                             |
| **Leído**     | Lo abrió                                      |
| **Falló**     | Con el motivo                                 |

Es la queja técnica más reproducible del mercado — cinco hilos independientes documentan lo mismo: _"WhatsApp accepts the request and returns a `wamid`, but it silently blocks delivery"_. **Ningún vendor lo expone.**

Y es la misma clase de falla que ya mordió a este proyecto: PostgREST cortaba en 1.000 filas sin un error en ningún log, y el agente respondía "no tenemos" sobre un catálogo de 19.731 productos.

---

## 9. Pantallas

| Ruta                        | Qué es                     | Estado                                       |
| --------------------------- | -------------------------- | -------------------------------------------- |
| `/workflows`                | Listado                    | Existe                                       |
| `/workflows/[id]`           | Editor                     | Existe. **Corre contra el motor equivocado** |
| `/workflows/[id]/historial` | Corridas                   | **Construido, sin cablear**                  |
| `/difusion`                 | Listado de campañas        | **No existe**                                |
| `/difusion/[id]`            | Armado + pre-vuelo         | **No existe**                                |
| `/ajustes`                  | Config + salud de WhatsApp | **Placeholder**                              |

**Cambios en la navegación:**

- Renombrar **"OpenAI settings" a "Agente"** — nombra al proveedor en vez de a la función.
- Agregar **"Difusión"**. La barra pasa de 7 a 8 entradas.

**Aprovechar lo que ya está escrito:** `PublishDialog`, `VersionHistory`, `VersionSelector`, `VersionBadge` y las ocho piezas de `components/workflows/history/` **existen y no las importa nadie**. Cuatro Server Actions también. Hay que cablearlas, no rehacerlas.

---

## 10. Lenguaje visual

**Los nodos usan los tokens del sistema de diseño existente** (`src/app/globals.css`), no una paleta nueva.

Existe un `docs/design-system/workflow-nodes.md` sin commitear que define colores propios por categoría —esmeralda, azul, violeta, ámbar, cyan, rosa, gris— que **no salen de los tokens del sistema**. Hay que reconciliarlo antes de implementar, no después.

**Anatomía de un nodo:**

```
        ○  ← entrada
┌──────────────────────┐
│ 🏷  Poner etiqueta   │  ← encabezado: ícono + nombre
├──────────────────────┤
│ Etiqueta: Pide       │  ← cuerpo: resumen legible
│ factura              │     de la configuración
└──────────●───────────┘
           ↑ salida
```

- Ancho fijo, alto según contenido.
- El encabezado lleva el color de la categoría.
- El cuerpo resume la configuración **en lenguaje natural**, no en JSON.
- Estados: normal, seleccionado, error, ejecutándose, memoizado.

**Reglas heredadas del sistema:** Geist y Geist Mono, con **todo dato que se compara o se escanea en mono**. Escala de espaciado de 2px, `gap` en flex y grid. Radio base `0.5625rem`. Marca `#d61f1f`, que no se invierte entre temas.

**Rendimiento:** **80 nodos a 60fps, medido en CI.** n8n se degrada a los ~50 y congela el navegador con 100+; ninguna herramienta publica un número. Si un flujo pasa de ~20 nodos en pantalla, la interfaz empuja a extraer un subflujo.

**Sin layout móvil.** El panel asume escritorio, igual que el resto del producto.

---

## 11. Modelo de datos

Ya existe y es correcto. No se cambia.

```ts
interface Grafo {
  nodos: Nodo[];
  aristas: Arista[];
}
interface Nodo {
  id: string;
  tipo: NodoTipo;
  config: Record<string, unknown>;
  posicion: { x; y };
}
interface Arista {
  desde: string;
  hasta: string;
  puerto: "salida" | "verdadero" | "falso";
}
```

**Tablas:** `workflows` · `workflow_versiones` · `workflow_runs` · `workflow_run_pasos`, con control de concurrencia optimista por `pasos_ejecutados` y política de concurrencia por flujo.

**Las conexiones referencian IDs de nodo, no nombres.** Renombrar un nodo no rompe nada — a diferencia de n8n, donde `$('Nodo').item.json.x` se rompe al renombrar.

**Tablas nuevas para difusión:** audiencias, difusiones, envíos (uno por destinatario con su estado y motivo de exclusión), y lista de supresión.

---

## 12. Plan de implementación

### Fase 0 — Reunificar el motor · **bloqueante**

Nada nuevo se construye antes de esto.

1. **Un solo registro de acciones.** El de `engine/handlers/` absorbe al de `acciones/registro.ts`.
2. **Un solo mecanismo de disparo.** `disparadorDe()` reconoce los `trigger_*` en vez del tipo legacy.
3. **Emisores reales.** El pipeline de mensajes, el cambio de etiqueta y el cambio de etapa emiten el evento que hoy nadie emite.
4. **Un test que falla si vuelven a existir dos registros.**

**Criterio de salida, no negociable:** un flujo armado en el canvas, publicado, se dispara con un mensaje real de WhatsApp y deja filas en `workflow_runs` y `workflow_run_pasos`. Verificado con `SELECT` contra Postgres. **No con tests.**

### Fase 1 — Editor

Catálogo completo, condición sin código, validación sobre el nodo, insertar sobre línea, acomodado automático, deshacer, plantillas de arranque.

### Fase 2 — Ejecución visible

Cablear el historial ya construido. Corrida en vivo sobre el lienzo. Reanudar desde el fallo con memoización visible. Estados de entrega honestos.

### Fase 3 — Difusión

Audiencias, planificador, pre-vuelo, canary, monitoreo, lista de supresión con keywords en español y portugués.

### Fase 4 — Migrar los cuatro sistemas

De menor a mayor riesgo. **Cada uno es su propia sesión con su propio plan:**

1. **Etiquetado** — no contesta, no corta el LLM. El peor caso de un bug es una etiqueta de más.
2. **Reactivación** — cron, no compite con conversaciones en curso.
3. **Escalado** — camino crítico, pero lógica acotada.
4. **Respuestas automáticas** — el de mayor riesgo, compite con el LLM en cada mensaje. Sin urgencia: hoy hay 0 reglas activas.

**Cada migración:** el flujo nuevo corre en paralelo al sistema viejo → se dispara al menos una vez contra el pipeline real → se verifica el resultado en la base → recién entonces se apaga el viejo, con período de gracia.

---

## 13. Criterios de aceptación

Ninguno se cumple con tests unitarios. Todos exigen ejecución real.

### Motor

- [ ] Un flujo del canvas, publicado, se dispara con un WhatsApp real y deja filas en las dos tablas. Verificado con `SELECT`.
- [ ] "Probar" ejecuta el mismo motor que producción. Un test falla si reaparecen dos registros.
- [ ] Publicar no altera las corridas en curso.
- [ ] Un paso que falla se reintenta solo a sí mismo.
- [ ] Corregir el flujo y reanudar aplica el arreglo a esa corrida.
- [ ] Una espera de 3 días revalida al lead antes de seguir.

### Editor

- [ ] Un administrador no técnico arma un flujo de 6 pasos con dos ramas, sin escribir una expresión y sin ayuda.
- [ ] Ninguna condición se expresa como código.
- [ ] Soltar un nodo sobre una línea lo inserta; borrar uno del medio cose la línea.
- [ ] Los errores se ven sobre el nodo culpable, con la solución a un clic.
- [ ] El acomodado automático se deshace con un solo `⌘Z`.
- [ ] Un "Enviar mensaje" después de una espera larga se marca en rojo antes de publicar.
- [ ] "Delegar a IA" no se guarda sin tiempo máximo.
- [ ] 80 nodos a 60fps, medido en CI.

### Ejecución

- [ ] Una corrida de producción se ve en vivo sobre el lienzo.
- [ ] "Reanudar desde el fallo" y "Ejecutar de nuevo" son dos acciones con nombres e íconos distintos.
- [ ] Reanudar muestra qué se reusa y qué se re-ejecuta antes de confirmar.
- [ ] Un mensaje saltado por tope deja registro con motivo, y el lead **sale** del flujo.
- [ ] La UI distingue _aceptado_ de _entregado_. Un 200 nunca se muestra como "enviado".

### Difusión

- [ ] 5.000 destinatarios con cupo de 2.000 se reparte en el tiempo, no falla, y muestra el plan antes de arrancar.
- [ ] Un lead con conversación activa **no recibe** la difusión. Demostrado con una corrida real.
- [ ] Un lead dado de baja no vuelve a entrar a ninguna audiencia, **ni por import de CSV ni por API**.
- [ ] Dos leads que comparten teléfono reciben **un** mensaje.
- [ ] La invariante aborta el envío antes de la primera llamada a Meta si se rompe.
- [ ] El pre-vuelo muestra lista exacta, exclusiones con motivo, cupo, costo y salud.
- [ ] El canary corta antes de seguir.
- [ ] Detener frena lo pendiente y dice qué ya no se puede recuperar.
- [ ] "BAJA", "SALIR", "PARAR", "SAIR" dan de baja y responden confirmación.

---

## 14. Fuera de alcance

- **Integraciones genéricas** (HTTP, código, Sheets, bases externas). Si aparece un caso real, se agrega como nodo curado; no se reabre un catálogo genérico.
- **Layout móvil.**
- **Difusión por Instagram y Messenger.** Solo WhatsApp en la primera versión: los otros canales tienen ventanas y límites distintos, y hoy no hay activos configurados.
- **Editor de plantillas de WhatsApp.** Se crean en el administrador de Meta y se sincronizan.
- **Multi-idioma de la interfaz.** Español.

---

## 15. Dependencias y riesgos

| Bloqueante                                   | Estado                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Catálogo de productos**                    | **Vacío a propósito.** Espera el documento de siglas del dueño. Sin catálogo el agente no vende y una difusión no tiene sentido |
| **Proyecto Supabase aislado**                | Resuelto el 2026-09-25 con el stack local: `npm run test:integration:local` (ver `AGENTS.md` lección 10)                        |
| **Confirmar el pacing de portfolio de Meta** | Dato de fuente tercera. **Si se confirma, cambia el diseño del planificador**                                                   |

| Riesgo                                                                       | Mitigación                                                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Bloqueo del número — la pérdida más cara del segmento, 18 casos documentados | Planificador con presupuesto de riesgo · canary · solo API oficial                    |
| Enviar dos veces                                                             | Invariante · deduplicación por teléfono encendida · alerta por entrega duplicada      |
| Enviar a toda la base                                                        | Agrupamiento visual · separar "ya califican" de "futuros" · lista exacta en pre-vuelo |
| El bot pisa al humano                                                        | Pausa con vencimiento · la difusión respeta conversaciones vivas                      |
| Plantilla pausada que nadie despausa                                         | Alerta en salud, marcada como acción manual                                           |

---

## 16. Decisiones del dueño

Registro de lo que el dueño decidió después de escrito este documento. **Si algo de acá contradice una sección anterior, manda esta sección.** El mismo registro está en `docs/prd-workflows.md` y en `docs/prd-workflows-difusion.md`; se actualizan juntos.

### Aceptadas en el chat el 2026-09-26

1. **Texto libre gratis a quien tiene la ventana de 24 h abierta.**
   - En difusión, el paso Mensaje pide también una versión en texto libre. El motor la manda a los destinatarios con la ventana abierta y la plantilla al resto, y el costo estimado lo refleja.
   - En flujos, "Enviar mensaje" tiene categoría Servicio o Marketing. La categoría decide si se puede mandar texto libre o si hace falta plantilla.
2. **Un flujo puede interceptar al agente.** Si el mensaje cumple la condición del disparador "Mensaje recibido", responde el flujo y el agente de IA no contesta ese turno. Queda registrado en `turnos_interceptados` y marcado en el hilo del Inbox.
3. **"Avisar al equipo" es una notificación en el panel.** No es WhatsApp ni email, así que no depende de Meta ni del cupo.
4. **Audiencia dinámica:** antes de cada tanda se vuelve a evaluar la audiencia. Los leads que empezaron a coincidir se suman a las tandas siguientes hasta que la difusión termina.

### Aceptadas antes (la fuente no registra la fecha)

- El tope del round robin cuenta las sesiones abiertas a la vez.
- Un flujo no mueve una sesión a `perdido` ni a `requiere_humano`.
- Valores de difusión: 15 % de reserva del cupo, audiencia de hasta 50.000, conversación activa de 60 min y margen de ventana de 60 min.
- Las bajas se guardan como HMAC del teléfono.
- Confirmación de baja: «Listo, no te enviaremos más promociones. Si fue un error, escríbenos y lo revertimos.»
- Una BAJA corta al agente de IA en ese turno.
- "Seguimiento de cotización": a las 72 h escala a una persona, no marca perdido.

### Pendientes de confirmación del dueño

Están implementadas en la rama `feat/workflows-difusion` (commit `d95c3cb`), pero **las decidió el agente, no el dueño.** Hasta que el dueño las confirme, cualquiera se puede cambiar.

**«Delegar al agente» (`ia_delegar`).** El bloque no contesta nada: el agente del pipeline sigue respondiendo cada mensaje, con las instrucciones del tramo sumadas al prompt antes de las reglas inviolables. El flujo observa y sale por una de cinco salidas. Valores en `src/lib/workflows/config-nodos.ts` y `src/lib/workflows/delegacion.ts`:

| Decisión                                   | Qué quedó                                                                                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Condición de vuelta                        | Un intent, una condición del Twin o las dos. **Al menos una es obligatoria**: sin ninguna, «Resuelto» sería inalcanzable.                       |
| Tiempo máximo                              | Positivo, **arranca en 1440 minutos** y no puede pasar de 7 días.                                                                               |
| Topes del tramo                            | 20 turnos por defecto (de 1 a 50) y USD 0,50 por defecto (hasta USD 20). Pasado cualquiera, sale por «No pudo».                                 |
| Instrucciones                              | Hasta 1000 caracteres.                                                                                                                          |
| Pausa → salida                             | `unknown_intents`, `quote_limit` y `discount_limit` salen por «No pudo». Cualquier otro motivo de pausa y la sesión cerrada salen por «Humano». |
| No pudo                                    | El agente no respondió, se llegó al tope de turnos o de gasto del tramo, o se llegó al tope de gasto diario del agente.                         |
| Error                                      | El turno del agente falló después de agotar los reintentos.                                                                                     |
| Baja durante el tramo                      | La corrida termina sin seguir por ninguna salida: un flujo no le vuelve a escribir a quien pidió que no.                                        |
| Orden si pasan varias cosas en un turno    | baja → error → sesión cerrada → pausa → resuelto → no pudo → vencido.                                                                           |
| Turno interceptado por otro flujo          | No cuenta como turno del tramo.                                                                                                                 |
| Varias delegaciones activas del mismo lead | Sus instrucciones se suman, en orden de arranque.                                                                                               |

**Auto-handoff por intents desconocidos.** El pipeline mandaba siempre una sola clasificación, así que con el umbral de fábrica (2) nunca pausaba. Ahora:

- la racha se arma con los turnos anteriores de la sesión, leídos de la base;
- un turno sin intent suma a la racha;
- la cortan un turno con intent, un turno resuelto por una regla IF/THEN y un turno sin clasificación (interceptado por un flujo, con la IA pausada o fuera de horario);
- el umbral viaja en el evento, para que el pipeline y `auto-handoff` usen el mismo valor.

Probado contra el stack local: con umbral 2, el segundo mensaje sin intent pausó la IA y dejó un `handoff_events` con `unknown_intents`.
