import { BaseWindow } from "electron";
import type { WebContentsView } from "electron";

/**
 * El CRM ocupa toda la ventana. La vista de WhatsApp (si existe) se agrega y
 * posiciona aparte, desde `CoordinadorWhatsapp` — acá no se sabe de ella.
 */
export function crearVentana(crm: WebContentsView): BaseWindow {
  const ventana = new BaseWindow({
    width: 1600,
    height: 950,
    minWidth: 1100,
    minHeight: 600,
    title: "CRM",
    show: false,
  });
  ventana.contentView.addChildView(crm);

  const acomodarCrm = (): void => {
    const { width, height } = ventana.getContentBounds();
    crm.setBounds({ x: 0, y: 0, width, height });
  };
  acomodarCrm();
  ventana.on("resize", acomodarCrm);

  ventana.show();
  return ventana;
}
