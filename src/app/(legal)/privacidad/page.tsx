import type { Metadata } from "next";
import Link from "next/link";
import { CORREO, Documento, VIGENCIA } from "@/components/legal/Documento";

export const metadata: Metadata = {
  title: "Política de privacidad | El Genuino repuestos",
  description:
    "Cómo El Genuino repuestos trata tus datos personales cuando nos escribes por WhatsApp, Instagram o Messenger.",
};

export default function PrivacidadPage() {
  return (
    <Documento titulo="Política de privacidad" vigencia={VIGENCIA}>
      <p>
        Esta política explica cómo <strong>El Genuino repuestos</strong> trata tus datos personales
        cuando nos escribes por WhatsApp o por otros canales de mensajería de Meta (Instagram y
        Facebook Messenger, cuando estén habilitados) para consultar o comprar repuestos
        automotrices. La redactamos conforme a la Ley Orgánica de Protección de Datos Personales de
        Ecuador (LOPDP).
      </p>

      <h2>1. Quién es el responsable</h2>
      <ul>
        <li>
          <strong>Responsable del tratamiento:</strong> El Genuino repuestos
        </li>
        <li>
          <strong>Sitio web:</strong> https://elgenuinorepuestos.com
        </li>
        <li>
          <strong>Contacto para temas de datos personales:</strong> {CORREO}
        </li>
      </ul>

      <h2>2. Qué datos tratamos</h2>
      <p>
        Tratamos los datos que nos entregas al escribirnos y los que se generan durante la
        conversación:
      </p>
      <ul>
        <li>
          <strong>Datos de contacto:</strong> tu número de teléfono y el nombre de perfil que tengas
          en WhatsApp, Instagram o Messenger. En Instagram y Messenger recibimos un identificador de
          usuario asignado por Meta.
        </li>
        <li>
          <strong>Contenido de los mensajes:</strong> lo que escribes y lo que te respondemos
          (personas o asistente automático).
        </li>
        <li>
          <strong>Datos de tu consulta:</strong> qué repuesto buscas, producto cotizado, urgencia y
          estado de la conversación.
        </li>
        <li>
          <strong>Datos del vehículo:</strong> marca, modelo, año, motor y, si nos los das, placa o
          VIN.
        </li>
        <li>
          <strong>Datos de identificación y facturación:</strong> nombre, correo, RUC o cédula, si
          los necesitas para una factura y nos los das.
        </li>
        <li>
          <strong>Comprobantes de pago:</strong> la imagen del comprobante, si nos lo envías.
        </li>
        <li>
          <strong>Datos técnicos de entrega:</strong> estado de los mensajes (enviado, entregado,
          leído) y registros de operación del sistema.
        </li>
      </ul>
      <p>
        No te pedimos datos sensibles (salud, opinión política, origen étnico, orientación sexual,
        biometría). Por favor no los incluyas en tus mensajes.
      </p>

      <h2>3. Para qué los usamos</h2>
      <ul>
        <li>Atender tu consulta, cotizar y venderte repuestos.</li>
        <li>Consultar disponibilidad y precios en nuestro catálogo.</li>
        <li>
          Dar seguimiento a tu consulta y responder tus mensajes, con apoyo de un asistente de
          inteligencia artificial (ver punto 5).
        </li>
        <li>Emitir facturas y cumplir obligaciones tributarias y contables.</li>
        <li>
          Enviarte promociones o avisos comerciales, solo si aplica y siempre con la posibilidad de
          darte de baja (ver punto 9).
        </li>
        <li>Mantener la seguridad del servicio, detectar errores y medir su funcionamiento.</li>
      </ul>

      <h2>4. Base legal</h2>
      <p>
        Tratamos tus datos porque tú nos escribes e inicias la conversación (tu consentimiento),
        porque los necesitamos para atender tu consulta o ejecutar la compra que solicitas (relación
        comercial), y porque la ley nos obliga a conservar ciertos documentos, como los tributarios.
        Puedes retirar tu consentimiento cuando quieras, escribiéndonos (ver punto 8).
      </p>

      <h2>5. Uso de inteligencia artificial</h2>
      <p>
        Parte de la atención la hace un asistente automático. Este asistente lee tus mensajes,
        consulta nuestro catálogo, redacta respuestas y extrae datos de tu consulta (por ejemplo, el
        repuesto y el vehículo) para organizarlos en una ficha interna.
      </p>
      <ul>
        <li>
          Las respuestas automáticas pueden tener errores. Los precios, el stock y las condiciones
          se confirman con una persona antes de cerrar una compra.
        </li>
        <li>Cuando la conversación lo requiere, la pasamos a una persona de nuestro equipo.</li>
        <li>
          No tomamos decisiones que tengan efectos jurídicos sobre ti basadas únicamente en el
          asistente automático.
        </li>
      </ul>

      <h2>6. Con quién compartimos tus datos</h2>
      <p>
        No vendemos tus datos. Usamos proveedores tecnológicos que los procesan por cuenta nuestra y
        solo para prestar el servicio:
      </p>
      <ul>
        <li>
          <strong>Meta</strong> (WhatsApp Business Platform, Instagram, Messenger): transporta los
          mensajes.
        </li>
        <li>
          <strong>OpenAI:</strong> procesa el texto de los mensajes para generar respuestas y
          extraer datos de la consulta.
        </li>
        <li>
          <strong>Supabase:</strong> aloja la base de datos y los archivos.
        </li>
        <li>
          <strong>Vercel:</strong> aloja nuestra aplicación.
        </li>
        <li>
          <strong>Inngest:</strong> ejecuta los procesos automáticos del sistema.
        </li>
        <li>
          <strong>Sentry:</strong> registra errores técnicos del sistema (configurado para ocultar
          datos personales).
        </li>
      </ul>
      <p>
        Estos proveedores operan fuera de Ecuador, por lo que tus datos pueden ser transferidos y
        tratados en otros países. Solicitamos a nuestros proveedores medidas de protección
        adecuadas. También podemos entregar datos a autoridades cuando una norma o una orden legal
        nos lo exija.
      </p>

      <h2>7. Cuánto tiempo los conservamos</h2>
      <ul>
        <li>
          <strong>Conversaciones de sesiones cerradas:</strong> se eliminan automáticamente a los 29
          días de cerrada la sesión.
        </li>
        <li>
          <strong>Ficha del cliente (datos de contacto y de la relación comercial):</strong> hasta 5
          años sin actividad, por razones comerciales y de posibles consultas tributarias.
        </li>
        <li>
          <strong>Comprobantes de pago:</strong> hasta 5 años, por requisitos tributarios.
        </li>
        <li>
          <strong>Registros de auditoría de solicitudes sobre datos personales:</strong> hasta 5
          años.
        </li>
        <li>
          <strong>Registros técnicos del sistema:</strong> hasta 90 días.
        </li>
        <li>
          <strong>Copias de respaldo:</strong> se conservan hasta su propio vencimiento; una
          eliminación se aplica a los datos en uso y a las copias nuevas.
        </li>
      </ul>

      <h2>8. Tus derechos y cómo ejercerlos</h2>
      <p>Puedes pedirnos, gratis:</p>
      <ul>
        <li>
          <strong>Acceso:</strong> saber qué datos tuyos tenemos.
        </li>
        <li>
          <strong>Rectificación:</strong> corregir datos inexactos.
        </li>
        <li>
          <strong>Eliminación:</strong> que borremos tus datos.
        </li>
        <li>
          <strong>Oposición:</strong> que dejemos de usar tus datos para una finalidad, por ejemplo
          promociones.
        </li>
        <li>
          <strong>Portabilidad:</strong> recibir tus datos en un formato de uso común.
        </li>
      </ul>
      <p>
        Escríbenos a <strong>{CORREO}</strong> indicando el número de teléfono o usuario con el que
        nos escribiste y qué quieres pedir. Para eliminar tus datos, sigue las instrucciones en{" "}
        <Link href="/eliminacion-de-datos">Eliminación de datos</Link>. Podemos pedirte que
        confirmes tu identidad antes de entregar o borrar información. Responderemos dentro del
        plazo que establece la Ley Orgánica de Protección de Datos Personales. Si no estás conforme
        con nuestra respuesta, puedes acudir a la autoridad de protección de datos personales de
        Ecuador.
      </p>

      <h2>9. Promociones y baja</h2>
      <p>
        Si te enviamos mensajes promocionales por WhatsApp, puedes dejar de recibirlos respondiendo{" "}
        <strong>BAJA</strong> (también funcionan SALIR y PARAR). Guardamos tu baja de forma que no
        pueda usarse para reconocer tu número, y la respetamos aunque después pidas eliminar tus
        datos.
      </p>

      <h2>10. Seguridad</h2>
      <p>
        Aplicamos medidas técnicas y de organización para proteger tus datos: conexiones cifradas,
        verificación de la autenticidad de los mensajes que recibimos de Meta, acceso restringido
        por rol, archivos en almacenamiento privado, ocultamiento de datos personales en registros
        técnicos y rotación periódica de claves. Ningún sistema es infalible; si ocurre un incidente
        que afecte tus datos, actuaremos y te avisaremos conforme a la ley.
      </p>

      <h2>11. Cambios a esta política</h2>
      <p>
        Podemos actualizar esta política. Publicaremos la versión vigente en esta página con su
        fecha. Si el cambio es importante, te lo comunicaremos por un medio razonable.
      </p>

      <h2>12. Contacto</h2>
      <p>
        El Genuino repuestos
        <br />
        Correo: {CORREO}
        <br />
        Sitio web: https://elgenuinorepuestos.com
      </p>
    </Documento>
  );
}
