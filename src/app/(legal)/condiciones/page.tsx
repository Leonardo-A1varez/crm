import type { Metadata } from "next";
import Link from "next/link";
import { CORREO, Documento, VIGENCIA } from "@/components/legal/Documento";

export const metadata: Metadata = {
  title: "Condiciones del servicio | El Genuino repuestos",
  description:
    "Condiciones de uso de los canales de atención por mensajería de El Genuino repuestos.",
};

export default function CondicionesPage() {
  return (
    <Documento titulo="Condiciones del servicio" vigencia={VIGENCIA}>
      <p>
        Estas condiciones regulan el uso de nuestros canales de atención por mensajería (WhatsApp y,
        cuando estén habilitados, Instagram y Facebook Messenger) operados por{" "}
        <strong>El Genuino repuestos</strong>. Al escribirnos aceptas estas condiciones. Si no estás
        de acuerdo, no uses el canal.
      </p>

      <h2>1. Qué ofrecemos</h2>
      <p>
        Un canal de atención para consultar, cotizar y comprar repuestos automotrices. La atención
        la brinda nuestro equipo y un asistente automático de inteligencia artificial.
      </p>

      <h2>2. Precios, disponibilidad y compra</h2>
      <ul>
        <li>
          Los precios, el stock y los plazos de entrega que se mencionen en la conversación son
          referenciales hasta que una persona de nuestro equipo los confirme.
        </li>
        <li>
          Una compra se considera acordada cuando la confirmamos con una persona y, si corresponde,
          recibimos el pago.
        </li>
        <li>
          Verifica con nosotros que el repuesto sea compatible con tu vehículo antes de pagar. Para
          ello es útil que nos des marca, modelo, año y, si puedes, placa o VIN.
        </li>
      </ul>

      <h2>3. Respuestas automáticas</h2>
      <p>
        El asistente automático puede equivocarse o no entender un pedido. No es asesoría técnica
        vinculante. Si algo no te parece correcto, pídenos hablar con una persona y la conversación
        se pasa a nuestro equipo.
      </p>

      <h2>4. Uso aceptable</h2>
      <p>Al usar el canal te comprometes a no:</p>
      <ul>
        <li>enviar contenido ilegal, ofensivo, amenazante o que vulnere derechos de otros;</li>
        <li>enviar spam, publicidad ajena o mensajes masivos;</li>
        <li>
          intentar engañar o manipular al asistente automático, ni extraer información del sistema;
        </li>
        <li>enviar datos de terceros sin su permiso, ni datos sensibles innecesarios;</li>
        <li>usar el canal para fraude, suplantación o cualquier actividad contraria a la ley.</li>
      </ul>
      <p>
        Podemos limitar o bloquear el acceso a quien incumpla estas reglas. También aplican las
        políticas de Meta para WhatsApp, Instagram y Messenger.
      </p>

      <h2>5. Mensajes promocionales</h2>
      <p>
        Si recibes promociones nuestras por WhatsApp, puedes dejar de recibirlas en cualquier
        momento respondiendo <strong>BAJA</strong> (también funcionan SALIR y PARAR).
      </p>

      <h2>6. Datos personales</h2>
      <p>
        Tratamos tus datos según nuestra <Link href="/privacidad">Política de privacidad</Link>.
        Para pedir la eliminación de tus datos, consulta{" "}
        <Link href="/eliminacion-de-datos">Eliminación de datos</Link>.
      </p>

      <h2>7. Servicios de terceros</h2>
      <p>
        El canal depende de plataformas de terceros, como Meta (WhatsApp, Instagram, Messenger). No
        controlamos su disponibilidad ni sus condiciones. Su uso está sujeto a los términos de cada
        plataforma.
      </p>

      <h2>8. Limitación de responsabilidad</h2>
      <p>
        Hacemos lo razonable para que el canal funcione con continuidad y precisión, pero se ofrece
        “tal cual”: puede haber interrupciones, retrasos o errores. En la medida permitida por la
        ley, no respondemos por daños derivados de fallas de plataformas de terceros, de la falta de
        disponibilidad del canal o de decisiones tomadas solo con base en una respuesta automática
        sin confirmarla con nosotros. Esto no limita los derechos que la ley reconoce al consumidor.
      </p>

      <h2>9. Cambios</h2>
      <p>
        Podemos modificar estas condiciones. La versión vigente estará publicada en esta página con
        su fecha. Si sigues usando el canal después de un cambio, entendemos que lo aceptas.
      </p>

      <h2>10. Ley aplicable y jurisdicción</h2>
      <p>
        Estas condiciones se rigen por las leyes de la República del Ecuador. Cualquier controversia
        se someterá a los jueces competentes de Ecuador, sin perjuicio de los derechos que la ley te
        reconozca como consumidor.
      </p>

      <h2>11. Contacto</h2>
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
