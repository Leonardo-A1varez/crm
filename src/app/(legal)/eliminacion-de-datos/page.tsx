import type { Metadata } from "next";
import Link from "next/link";
import { CORREO, Documento, VIGENCIA } from "@/components/legal/Documento";

export const metadata: Metadata = {
  title: "Eliminación de datos | El Genuino repuestos",
  description:
    "Cómo pedir que El Genuino repuestos elimine tus datos personales si nos escribiste por WhatsApp, Instagram o Messenger.",
};

export default function EliminacionDeDatosPage() {
  return (
    <Documento titulo="Eliminación de datos" vigencia={VIGENCIA}>
      <p>
        Si nos escribiste por WhatsApp, Instagram o Facebook Messenger, puedes pedir que eliminemos
        tus datos personales. Esta página explica cómo hacerlo. Es tu derecho de eliminación según
        la Ley Orgánica de Protección de Datos Personales de Ecuador (LOPDP).
      </p>

      <h2>Cómo pedir la eliminación</h2>
      <ol>
        <li>
          Escribe un correo a <strong>{CORREO}</strong> con el asunto{" "}
          <strong>“Eliminación de datos”</strong>.
        </li>
        <li>
          Indica el <strong>número de teléfono</strong> con el que nos escribiste por WhatsApp (con
          código de país, por ejemplo +593...). Si nos escribiste por Instagram o Messenger, indica
          tu <strong>nombre de usuario</strong> en esa red.
        </li>
        <li>Escribe tu nombre y, si lo recuerdas, la fecha aproximada de tu conversación.</li>
        <li>Escribe desde el correo que quieras que usemos para responderte.</li>
      </ol>
      <p>
        Para proteger tu información, podemos pedirte que confirmes que eres el titular, por ejemplo
        enviando un mensaje desde ese mismo número o cuenta.
      </p>

      <h2>Plazo</h2>
      <p>
        Responderemos a tu solicitud dentro del plazo que establece la Ley Orgánica de Protección de
        Datos Personales. Cuando terminemos, te enviaremos una confirmación por correo.
      </p>

      <h2>Qué eliminamos</h2>
      <ul>
        <li>Tu número de teléfono, nombre de perfil e identificadores de Instagram o Messenger.</li>
        <li>El contenido de tus conversaciones con nosotros.</li>
        <li>Los datos de tu consulta y de tu vehículo que guardamos en tu ficha.</li>
        <li>Tus datos de contacto o facturación, si los hubiera.</li>
      </ul>
      <p>
        En algunos casos, en lugar de borrar un registro lo anonimizamos, de modo que ya no pueda
        relacionarse contigo.
      </p>

      <h2>Qué puede conservarse</h2>
      <ul>
        <li>
          <strong>Documentos que la ley nos obliga a guardar</strong>, como facturas y comprobantes
          de pago vinculados a compras (obligaciones tributarias y contables), durante el plazo
          legal.
        </li>
        <li>
          <strong>Datos necesarios para defender derechos</strong> en un proceso judicial o
          administrativo en curso, o exigidos por una orden de autoridad competente.
        </li>
        <li>
          <strong>Tu baja de promociones</strong>, si te diste de baja: guardamos un código
          irreversible que no permite identificarte, solo para no volver a enviarte promociones.
        </li>
        <li>
          <strong>Copias de respaldo:</strong> la eliminación se aplica a los datos en uso y a las
          copias nuevas. Las copias antiguas conservan los datos hasta su vencimiento y no se usan
          para otra cosa.
        </li>
      </ul>
      <p>Si no podemos eliminar algún dato, te diremos cuál y por qué.</p>

      <h2>Más información</h2>
      <p>
        Consulta nuestra <Link href="/privacidad">Política de privacidad</Link> para conocer qué
        datos tratamos y tus otros derechos (acceso, rectificación, oposición y portabilidad).
        También puedes ejercerlos escribiendo al mismo correo.
      </p>

      <p>
        El Genuino repuestos
        <br />
        Contacto: {CORREO}
      </p>
    </Documento>
  );
}
