"use client";

import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { TextareaConVariables } from "./TextareaConVariables";
import { VariableSelector } from "./VariableSelector";

interface ConfigMensajeriaProps {
  tipo: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  readonly?: boolean;
}

interface Boton {
  texto: string;
  accion: "responder" | "url" | "llamar";
  valor: string;
}

interface SeccionLista {
  titulo: string;
  items: Array<{ titulo: string; descripcion: string }>;
}

export function ConfigMensajeria({ tipo, config, onChange, readonly }: ConfigMensajeriaProps) {
  const handleChange = useCallback(
    (campo: string, valor: unknown) => {
      onChange({ ...config, [campo]: valor });
    },
    [config, onChange],
  );

  const labelClass = "text-ink-secondary mb-1 block text-[11px]";
  const selectClass = "border-line-control bg-surface-root text-ink-primary w-full text-[12px]";
  const inputClass = "border-line-control bg-surface-root text-ink-primary w-full text-[12px] h-8";

  const insertVariable = useCallback(
    (variable: string) => {
      const currentMensaje = String(config.mensaje ?? "");
      handleChange("mensaje", currentMensaje + variable);
    },
    [config.mensaje, handleChange],
  );

  switch (tipo) {
    case "msg_texto":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Canal de envio</span>
            <Select
              value={String(config.canal ?? "inferir")}
              onValueChange={(v) => handleChange("canal", v)}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inferir">Inferir del trigger</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="instagram">Instagram</SelectItem>
                <SelectItem value="messenger">Messenger</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <label className="block">
            <span className={labelClass}>Mensaje</span>
            <TextareaConVariables
              value={String(config.mensaje ?? "")}
              onChange={(v) => handleChange("mensaje", v)}
              placeholder="Hola {{lead.nombre}}, gracias por escribir..."
              maxLength={4096}
              rows={4}
              className={`${inputClass} h-auto min-h-[100px] resize-y`}
            />
          </label>

          <VariableSelector onSelect={insertVariable} compact />
        </div>
      );

    case "msg_botones": {
      const botones = (config.botones as Boton[]) ?? [];
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Mensaje</span>
            <TextareaConVariables
              value={String(config.mensaje ?? "")}
              onChange={(v) => handleChange("mensaje", v)}
              placeholder="Selecciona una opcion..."
              maxLength={1024}
              rows={3}
              className={`${inputClass} h-auto min-h-[80px] resize-y`}
            />
          </label>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className={labelClass}>Botones (max 3)</span>
              {botones.length < 3 && !readonly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() =>
                    handleChange("botones", [
                      ...botones,
                      { texto: "", accion: "responder", valor: "" },
                    ])
                  }
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Agregar
                </Button>
              )}
            </div>

            <div className="space-y-2">
              {botones.map((boton, idx) => (
                <div
                  key={idx}
                  className="border-line-control bg-surface-root rounded-md border p-2"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <GripVertical className="text-ink-faint h-3.5 w-3.5" />
                    <Input
                      className={`${inputClass} flex-1`}
                      value={boton.texto}
                      onChange={(e) => {
                        const newBotones = [...botones];
                        newBotones[idx] = { ...boton, texto: e.target.value };
                        handleChange("botones", newBotones);
                      }}
                      placeholder="Texto del boton"
                      maxLength={20}
                      disabled={readonly}
                    />
                    {!readonly && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-red-500"
                        onClick={() =>
                          handleChange(
                            "botones",
                            botones.filter((_, i) => i !== idx),
                          )
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Select
                      value={boton.accion}
                      onValueChange={(v) => {
                        const newBotones = [...botones];
                        newBotones[idx] = {
                          ...boton,
                          accion: v as Boton["accion"],
                        };
                        handleChange("botones", newBotones);
                      }}
                      disabled={readonly}
                    >
                      <SelectTrigger className={`${selectClass} w-[120px]`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="responder">Responder</SelectItem>
                        <SelectItem value="url">URL</SelectItem>
                        <SelectItem value="llamar">Llamar</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      className={`${inputClass} flex-1`}
                      value={boton.valor}
                      onChange={(e) => {
                        const newBotones = [...botones];
                        newBotones[idx] = { ...boton, valor: e.target.value };
                        handleChange("botones", newBotones);
                      }}
                      placeholder={
                        boton.accion === "url"
                          ? "https://..."
                          : boton.accion === "llamar"
                            ? "+521234567890"
                            : "Texto de respuesta"
                      }
                      disabled={readonly}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    case "msg_lista": {
      const secciones = (config.secciones as SeccionLista[]) ?? [];
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Header (max 60 caracteres)</span>
            <Input
              className={inputClass}
              value={String(config.header ?? "")}
              onChange={(e) => handleChange("header", e.target.value)}
              placeholder="Nuestro catalogo"
              maxLength={60}
              disabled={readonly}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Cuerpo</span>
            <TextareaConVariables
              value={String(config.body ?? "")}
              onChange={(v) => handleChange("body", v)}
              placeholder="Selecciona una categoria..."
              maxLength={1024}
              rows={3}
              className={`${inputClass} h-auto min-h-[80px] resize-y`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Footer (max 60 caracteres)</span>
            <Input
              className={inputClass}
              value={String(config.footer ?? "")}
              onChange={(e) => handleChange("footer", e.target.value)}
              placeholder="Responde con el numero"
              maxLength={60}
              disabled={readonly}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Texto del boton</span>
            <Input
              className={inputClass}
              value={String(config.botonTexto ?? "Ver opciones")}
              onChange={(e) => handleChange("botonTexto", e.target.value)}
              placeholder="Ver opciones"
              maxLength={20}
              disabled={readonly}
            />
          </label>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className={labelClass}>Secciones</span>
              {!readonly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() =>
                    handleChange("secciones", [
                      ...secciones,
                      { titulo: "", items: [{ titulo: "", descripcion: "" }] },
                    ])
                  }
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Agregar seccion
                </Button>
              )}
            </div>

            <div className="space-y-3">
              {secciones.map((seccion, sIdx) => (
                <div
                  key={sIdx}
                  className="border-line-control bg-surface-root rounded-md border p-2"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <Input
                      className={`${inputClass} flex-1`}
                      value={seccion.titulo}
                      onChange={(e) => {
                        const newSecciones = [...secciones];
                        newSecciones[sIdx] = {
                          ...seccion,
                          titulo: e.target.value,
                        };
                        handleChange("secciones", newSecciones);
                      }}
                      placeholder="Titulo de la seccion"
                      disabled={readonly}
                    />
                    {!readonly && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-red-500"
                        onClick={() =>
                          handleChange(
                            "secciones",
                            secciones.filter((_, i) => i !== sIdx),
                          )
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>

                  <div className="space-y-1 pl-4">
                    {seccion.items.map((item, iIdx) => (
                      <div key={iIdx} className="flex gap-1">
                        <Input
                          className={`${inputClass} flex-1`}
                          value={item.titulo}
                          onChange={(e) => {
                            const newSecciones = [...secciones];
                            const newItems = [...seccion.items];
                            newItems[iIdx] = {
                              ...item,
                              titulo: e.target.value,
                            };
                            newSecciones[sIdx] = { ...seccion, items: newItems };
                            handleChange("secciones", newSecciones);
                          }}
                          placeholder="Titulo"
                          disabled={readonly}
                        />
                        <Input
                          className={`${inputClass} flex-1`}
                          value={item.descripcion}
                          onChange={(e) => {
                            const newSecciones = [...secciones];
                            const newItems = [...seccion.items];
                            newItems[iIdx] = {
                              ...item,
                              descripcion: e.target.value,
                            };
                            newSecciones[sIdx] = { ...seccion, items: newItems };
                            handleChange("secciones", newSecciones);
                          }}
                          placeholder="Descripcion"
                          disabled={readonly}
                        />
                        {!readonly && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-red-500"
                            onClick={() => {
                              const newSecciones = [...secciones];
                              newSecciones[sIdx] = {
                                ...seccion,
                                items: seccion.items.filter((_, i) => i !== iIdx),
                              };
                              handleChange("secciones", newSecciones);
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    ))}
                    {!readonly && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => {
                          const newSecciones = [...secciones];
                          newSecciones[sIdx] = {
                            ...seccion,
                            items: [...seccion.items, { titulo: "", descripcion: "" }],
                          };
                          handleChange("secciones", newSecciones);
                        }}
                      >
                        <Plus className="mr-1 h-3 w-3" />
                        Item
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    case "msg_imagen":
    case "msg_documento":
      const isImagen = tipo === "msg_imagen";
      return (
        <div className="flex flex-col gap-3">
          <div>
            <span className={labelClass}>Tipo de {isImagen ? "imagen" : "documento"}</span>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={() => handleChange("tipoMedia", "url")}
                disabled={readonly}
                className={`rounded px-3 py-1.5 text-[11px] ${
                  config.tipoMedia !== "archivo"
                    ? "bg-accent-blue text-white"
                    : "bg-surface-hover text-ink-secondary"
                }`}
              >
                URL
              </button>
              <button
                type="button"
                onClick={() => handleChange("tipoMedia", "archivo")}
                disabled={readonly}
                className={`rounded px-3 py-1.5 text-[11px] ${
                  config.tipoMedia === "archivo"
                    ? "bg-accent-blue text-white"
                    : "bg-surface-hover text-ink-secondary"
                }`}
              >
                Subir archivo
              </button>
            </div>
          </div>

          {config.tipoMedia !== "archivo" ? (
            <label className="block">
              <span className={labelClass}>URL del {isImagen ? "imagen" : "documento"}</span>
              <Input
                className={inputClass}
                value={String(config.url ?? "")}
                onChange={(e) => handleChange("url", e.target.value)}
                placeholder={
                  isImagen ? "https://ejemplo.com/imagen.jpg" : "https://ejemplo.com/documento.pdf"
                }
                disabled={readonly}
              />
            </label>
          ) : (
            <label className="block">
              <span className={labelClass}>Archivo</span>
              <div className="border-line-control bg-surface-root text-ink-faint flex h-20 items-center justify-center rounded-md border border-dashed text-[11px]">
                Arrastra un archivo o haz clic
              </div>
            </label>
          )}

          {isImagen && (
            <label className="block">
              <span className={labelClass}>Caption</span>
              <TextareaConVariables
                value={String(config.caption ?? "")}
                onChange={(v) => handleChange("caption", v)}
                placeholder="Texto debajo de la imagen"
                maxLength={1024}
                rows={2}
                className={`${inputClass} h-auto min-h-[60px] resize-y`}
              />
            </label>
          )}

          {!isImagen && (
            <label className="block">
              <span className={labelClass}>Nombre del archivo</span>
              <Input
                className={inputClass}
                value={String(config.nombreArchivo ?? "")}
                onChange={(e) => handleChange("nombreArchivo", e.target.value)}
                placeholder="catalogo.pdf"
                disabled={readonly}
              />
            </label>
          )}
        </div>
      );

    case "msg_ubicacion":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Latitud</span>
            <Input
              type="number"
              step="any"
              className={inputClass}
              value={String(config.lat ?? "")}
              onChange={(e) => handleChange("lat", Number(e.target.value))}
              placeholder="-33.4489"
              disabled={readonly}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Longitud</span>
            <Input
              type="number"
              step="any"
              className={inputClass}
              value={String(config.lon ?? "")}
              onChange={(e) => handleChange("lon", Number(e.target.value))}
              placeholder="-70.6693"
              disabled={readonly}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Nombre del lugar</span>
            <Input
              className={inputClass}
              value={String(config.nombre ?? "")}
              onChange={(e) => handleChange("nombre", e.target.value)}
              placeholder="Nuestra tienda"
              disabled={readonly}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Direccion</span>
            <Input
              className={inputClass}
              value={String(config.direccion ?? "")}
              onChange={(e) => handleChange("direccion", e.target.value)}
              placeholder="Av. Principal 123"
              disabled={readonly}
            />
          </label>
        </div>
      );

    case "msg_plantilla":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Nombre de la plantilla</span>
            <Input
              className={inputClass}
              value={String(config.templateName ?? "")}
              onChange={(e) => handleChange("templateName", e.target.value)}
              placeholder="hello_world"
              disabled={readonly}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Idioma</span>
            <Select
              value={String(config.idioma ?? "es")}
              onValueChange={(v) => handleChange("idioma", v)}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="es">Espanol</SelectItem>
                <SelectItem value="es_MX">Espanol (Mexico)</SelectItem>
                <SelectItem value="es_AR">Espanol (Argentina)</SelectItem>
                <SelectItem value="pt_BR">Portugues (Brasil)</SelectItem>
                <SelectItem value="en">Ingles</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <div className="text-ink-faint bg-surface-hover rounded-md p-2 text-[10px]">
            Las plantillas deben estar aprobadas en Meta Business Manager
          </div>
        </div>
      );

    case "msg_reaccion":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Emoji de reaccion</span>
            <Input
              className={inputClass}
              value={String(config.emoji ?? "")}
              onChange={(e) => handleChange("emoji", e.target.value)}
              placeholder="Ej: ok"
              maxLength={2}
              disabled={readonly}
            />
          </label>

          <div className="flex flex-wrap gap-1">
            {["ok", "corazon", "aplausos", "fuego", "pulgar", "carita"].map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => handleChange("emoji", emoji)}
                disabled={readonly}
                className={`rounded px-2 py-1 text-lg ${
                  config.emoji === emoji
                    ? "bg-accent-blue/20 ring-accent-blue ring-1"
                    : "bg-surface-hover"
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      );

    default:
      return (
        <p className="text-ink-faint text-[11px]">
          Este nodo de mensajeria no tiene configuracion adicional
        </p>
      );
  }
}
