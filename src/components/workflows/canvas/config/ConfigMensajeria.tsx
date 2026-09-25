"use client";

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
import {
  CANALES_DE_ENVIO,
  editorDeConfig,
  type CanalDeEnvio,
  type ConfigDeTipo,
} from "@/lib/workflows/config-nodos";
import { TextareaConVariables } from "./TextareaConVariables";
import { VariableSelector } from "./VariableSelector";

interface ConfigMensajeriaProps {
  tipo: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  readonly?: boolean;
}

type Boton = ConfigDeTipo<"msg_botones">["botones"][number];
type SeccionLista = ConfigDeTipo<"msg_lista">["secciones"][number];

/** Cómo se llama en pantalla cada canal que `msg_texto` puede exigir. */
const ETIQUETA_CANAL_DE_ENVIO: Readonly<Record<CanalDeEnvio, string>> = {
  inferir: "Inferir del trigger",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
};

/**
 * Formularios de los bloques de mensajería.
 *
 * Qué clave escribe cada campo, y con qué valor arranca uno que nadie tocó,
 * sale del contrato de config (`editorDeConfig`, `lib/workflows/config-nodos.ts`):
 * el mismo schema que revisa el validador y que lee la acción `enviar_mensaje`.
 * Una clave que el contrato no conoce no compila.
 */
export function ConfigMensajeria({ tipo, config, onChange, readonly }: ConfigMensajeriaProps) {
  const labelClass = "text-ink-secondary mb-1 block text-[11px]";
  const selectClass = "border-line-control bg-surface-root text-ink-primary w-full text-[12px]";
  const inputClass = "border-line-control bg-surface-root text-ink-primary w-full text-[12px] h-8";

  switch (tipo) {
    case "msg_texto": {
      const c = editorDeConfig("msg_texto", config);
      const mensaje = String(c.valores.mensaje ?? "");
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Canal de envio</span>
            <Select
              value={String(c.valores.canal)}
              onValueChange={(v) => onChange(c.con("canal", v))}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CANALES_DE_ENVIO.map((canal) => (
                  <SelectItem key={canal} value={canal}>
                    {ETIQUETA_CANAL_DE_ENVIO[canal]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="block">
            <span className={labelClass}>Mensaje</span>
            <TextareaConVariables
              value={mensaje}
              onChange={(v) => onChange(c.con("mensaje", v))}
              placeholder="Hola {{lead.nombre}}, gracias por escribir..."
              maxLength={4096}
              rows={4}
              className={`${inputClass} h-auto min-h-[100px] resize-y`}
            />
          </label>

          <VariableSelector
            onSelect={(variable) => onChange(c.con("mensaje", mensaje + variable))}
            compact
          />
        </div>
      );
    }

    case "msg_botones": {
      const c = editorDeConfig("msg_botones", config);
      const botones = Array.isArray(c.valores.botones) ? (c.valores.botones as Boton[]) : [];
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Mensaje</span>
            <TextareaConVariables
              value={String(c.valores.mensaje ?? "")}
              onChange={(v) => onChange(c.con("mensaje", v))}
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
                    onChange(
                      c.con("botones", [...botones, { texto: "", accion: "responder", valor: "" }]),
                    )
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
                        onChange(c.con("botones", newBotones));
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
                          onChange(
                            c.con(
                              "botones",
                              botones.filter((_, i) => i !== idx),
                            ),
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
                        onChange(c.con("botones", newBotones));
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
                        onChange(c.con("botones", newBotones));
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
      const c = editorDeConfig("msg_lista", config);
      const secciones = Array.isArray(c.valores.secciones)
        ? (c.valores.secciones as SeccionLista[])
        : [];
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Header (max 60 caracteres)</span>
            <Input
              className={inputClass}
              value={String(c.valores.header ?? "")}
              onChange={(e) => onChange(c.con("header", e.target.value))}
              placeholder="Nuestro catalogo"
              maxLength={60}
              disabled={readonly}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Cuerpo</span>
            <TextareaConVariables
              value={String(c.valores.body ?? "")}
              onChange={(v) => onChange(c.con("body", v))}
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
              value={String(c.valores.footer ?? "")}
              onChange={(e) => onChange(c.con("footer", e.target.value))}
              placeholder="Responde con el numero"
              maxLength={60}
              disabled={readonly}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Texto del boton</span>
            <Input
              className={inputClass}
              value={String(c.valores.botonTexto)}
              onChange={(e) => onChange(c.con("botonTexto", e.target.value))}
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
                    onChange(
                      c.con("secciones", [
                        ...secciones,
                        { titulo: "", items: [{ titulo: "", descripcion: "" }] },
                      ]),
                    )
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
                        onChange(c.con("secciones", newSecciones));
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
                          onChange(
                            c.con(
                              "secciones",
                              secciones.filter((_, i) => i !== sIdx),
                            ),
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
                            onChange(c.con("secciones", newSecciones));
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
                            onChange(c.con("secciones", newSecciones));
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
                              onChange(c.con("secciones", newSecciones));
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
                          onChange(c.con("secciones", newSecciones));
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
    case "msg_documento": {
      const isImagen = tipo === "msg_imagen";
      // Lo común a los dos (tipo de media y URL) va por el editor del tipo; lo
      // propio de cada uno, por el suyo: el caption no es clave de un documento.
      const c = editorDeConfig(tipo, config);
      const imagen = editorDeConfig("msg_imagen", config);
      const documento = editorDeConfig("msg_documento", config);
      return (
        <div className="flex flex-col gap-3">
          <div>
            <span className={labelClass}>Tipo de {isImagen ? "imagen" : "documento"}</span>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={() => onChange(c.con("tipoMedia", "url"))}
                disabled={readonly}
                className={`rounded px-3 py-1.5 text-[11px] ${
                  c.valores.tipoMedia !== "archivo"
                    ? "bg-accent-blue text-white"
                    : "bg-surface-hover text-ink-secondary"
                }`}
              >
                URL
              </button>
              <button
                type="button"
                onClick={() => onChange(c.con("tipoMedia", "archivo"))}
                disabled={readonly}
                className={`rounded px-3 py-1.5 text-[11px] ${
                  c.valores.tipoMedia === "archivo"
                    ? "bg-accent-blue text-white"
                    : "bg-surface-hover text-ink-secondary"
                }`}
              >
                Subir archivo
              </button>
            </div>
          </div>

          {c.valores.tipoMedia !== "archivo" ? (
            <label className="block">
              <span className={labelClass}>URL del {isImagen ? "imagen" : "documento"}</span>
              <Input
                className={inputClass}
                value={String(c.valores.url ?? "")}
                onChange={(e) => onChange(c.con("url", e.target.value))}
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
                value={String(imagen.valores.caption ?? "")}
                onChange={(v) => onChange(imagen.con("caption", v))}
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
                value={String(documento.valores.nombreArchivo ?? "")}
                onChange={(e) => onChange(documento.con("nombreArchivo", e.target.value))}
                placeholder="catalogo.pdf"
                disabled={readonly}
              />
            </label>
          )}
        </div>
      );
    }

    case "msg_ubicacion": {
      const c = editorDeConfig("msg_ubicacion", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Latitud</span>
            <Input
              type="number"
              step="any"
              className={inputClass}
              value={String(c.valores.lat ?? "")}
              onChange={(e) => onChange(c.con("lat", Number(e.target.value)))}
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
              value={String(c.valores.lon ?? "")}
              onChange={(e) => onChange(c.con("lon", Number(e.target.value)))}
              placeholder="-70.6693"
              disabled={readonly}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Nombre del lugar</span>
            <Input
              className={inputClass}
              value={String(c.valores.nombre ?? "")}
              onChange={(e) => onChange(c.con("nombre", e.target.value))}
              placeholder="Nuestra tienda"
              disabled={readonly}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Direccion</span>
            <Input
              className={inputClass}
              value={String(c.valores.direccion ?? "")}
              onChange={(e) => onChange(c.con("direccion", e.target.value))}
              placeholder="Av. Principal 123"
              disabled={readonly}
            />
          </label>
        </div>
      );
    }

    case "msg_plantilla": {
      const c = editorDeConfig("msg_plantilla", config);
      const parametros = Array.isArray(c.valores.parametros)
        ? (c.valores.parametros as string[])
        : [];
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Nombre de la plantilla</span>
            <Input
              className={inputClass}
              value={String(c.valores.templateName ?? "")}
              onChange={(e) => onChange(c.con("templateName", e.target.value))}
              placeholder="hello_world"
              disabled={readonly}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Idioma</span>
            <Select
              value={String(c.valores.idioma)}
              onValueChange={(v) => onChange(c.con("idioma", v))}
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

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className={labelClass}>Variables del cuerpo, en orden</span>
              {!readonly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => onChange(c.con("parametros", [...parametros, ""]))}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Agregar
                </Button>
              )}
            </div>
            <div className="space-y-2">
              {parametros.map((valor, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-ink-faint w-8 shrink-0 font-mono text-[10px]">
                    {`{{${idx + 1}}}`}
                  </span>
                  <Input
                    className={`${inputClass} flex-1`}
                    aria-label={`Valor de la variable ${idx + 1}`}
                    value={valor}
                    onChange={(e) => {
                      const siguientes = [...parametros];
                      siguientes[idx] = e.target.value;
                      onChange(c.con("parametros", siguientes));
                    }}
                    placeholder="{{lead.nombre}}"
                    disabled={readonly}
                  />
                  {!readonly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Quitar la variable ${idx + 1}`}
                      className="h-8 w-8 p-0 text-red-500"
                      onClick={() =>
                        onChange(
                          c.con(
                            "parametros",
                            parametros.filter((_, i) => i !== idx),
                          ),
                        )
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="text-ink-faint bg-surface-hover rounded-md p-2 text-[10px]">
            Las plantillas deben estar aprobadas en Meta Business Manager. Se mandan también fuera
            de la ventana de 24 h, y sólo por WhatsApp.
          </div>
        </div>
      );
    }

    case "msg_reaccion": {
      const c = editorDeConfig("msg_reaccion", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Emoji de reaccion</span>
            <Input
              className={inputClass}
              value={String(c.valores.emoji ?? "")}
              onChange={(e) => onChange(c.con("emoji", e.target.value))}
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
                onClick={() => onChange(c.con("emoji", emoji))}
                disabled={readonly}
                className={`rounded px-2 py-1 text-lg ${
                  c.valores.emoji === emoji
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
    }

    default:
      return (
        <p className="text-ink-faint text-[11px]">
          Este nodo de mensajeria no tiene configuracion adicional
        </p>
      );
  }
}
