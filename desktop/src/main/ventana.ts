import { BaseWindow } from "electron";
import type { WebContentsView } from "electron";

const FRACCION_CRM = 0.5;

export function crearVentana(crm: WebContentsView, whatsapp: WebContentsView): BaseWindow {
  const ventana = new BaseWindow({
    width: 1600,
    height: 950,
    minWidth: 1100,
    minHeight: 600,
    title: "CRM",
    show: false,
  });
  ventana.contentView.addChildView(crm);
  ventana.contentView.addChildView(whatsapp);

  const acomodar = (): void => {
    const { width, height } = ventana.getContentBounds();
    const anchoCrm = Math.round(width * FRACCION_CRM);
    crm.setBounds({ x: 0, y: 0, width: anchoCrm, height });
    whatsapp.setBounds({ x: anchoCrm, y: 0, width: width - anchoCrm, height });
  };
  acomodar();
  ventana.on("resize", acomodar);

  // A diferencia de BrowserWindow, cerrar un BaseWindow no destruye los
  // webContents de sus vistas: sin esto quedan procesos vivos.
  ventana.on("closed", () => {
    crm.webContents.close();
    whatsapp.webContents.close();
  });
  ventana.show();
  return ventana;
}
