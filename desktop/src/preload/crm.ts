import { contextBridge, ipcRenderer } from "electron";

// Única superficie expuesta al CRM. No se pasa ipcRenderer entero: el renderer
// solo puede pedir abrir un chat, y el main valida remitente y argumentos.
contextBridge.exposeInMainWorld("crmEscritorio", {
  abrirChat: (telefono: unknown, texto: unknown): Promise<unknown> =>
    ipcRenderer.invoke("crm:abrir-chat", telefono, texto),
});
