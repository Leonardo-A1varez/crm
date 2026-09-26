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
import { Plus, Trash2 } from "lucide-react";
import {
  CANALES_DE_ENVIO,
  CATEGORIAS_DE_MENSAJE,
  editorDeConfig,
  type CanalDeEnvio,
  type CategoriaDeMensaje,
} from "@/lib/workflows/config-nodos";
import { cn } from "@/lib/utils";
import {
  ConfigBotones,
  ConfigImagen,
  ConfigLista,
  ConfigUbicacion,
  type SubirImagenFn,
} from "./ConfigMensajeriaRica";
import { EditorConVariables } from "./EditorConVariables";

interface ConfigMensajeriaProps {
  tipo: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  readonly?: boolean;
  /** "Enviar imagen" por archivo: la Server Action que sube (sólo admin). */
  onSubirImagen?: SubirImagenFn;
}

/** Cómo se llama en pantalla cada canal que `msg_texto` puede exigir. */
const ETIQUETA_CANAL_DE_ENVIO: Readonly<Record<CanalDeEnvio, string>> = {
  inferir: "Inferir del trigger",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
};

/** Cómo se llama en pantalla cada categoría de «Enviar mensaje». */
const ETIQUETA_CATEGORIA: Readonly<Record<CategoriaDeMensaje, string>> = {
  servicio: "Servicio",
  marketing: "Marketing",
};

/**
 * Formularios de los bloques de mensajería.
 *
 * Qué clave escribe cada campo, y con qué valor arranca uno que nadie tocó,
 * sale del contrato de config (`editorDeConfig`, `lib/workflows/config-nodos.ts`):
 * el mismo schema que revisa el validador y que lee la acción `enviar_mensaje`.
 * Una clave que el contrato no conoce no compila.
 */
export function ConfigMensajeria({
  tipo,
  config,
  onChange,
  readonly,
  onSubirImagen,
}: ConfigMensajeriaProps) {
  const labelClass = "text-ink-secondary mb-1 block text-[11px]";
  const selectClass = "border-line-control bg-surface-root text-ink-primary w-full text-[12px]";
  const inputClass = "border-line-control bg-surface-root text-ink-primary w-full text-[12px] h-8";

  switch (tipo) {
    case "msg_texto": {
      const c = editorDeConfig("msg_texto", config);
      const mensaje = String(c.valores.mensaje ?? "");
      const categoria = c.valores.categoria === "marketing" ? "marketing" : "servicio";
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

          <fieldset className="flex flex-col gap-1.5">
            <legend className={labelClass}>Categoría</legend>
            <div role="radiogroup" aria-label="Categoría del mensaje" className="flex gap-2">
              {CATEGORIAS_DE_MENSAJE.map((opcion) => {
                const elegida = categoria === opcion;
                return (
                  <button
                    key={opcion}
                    type="button"
                    role="radio"
                    aria-checked={elegida}
                    disabled={readonly}
                    onClick={() => onChange(c.con("categoria", opcion))}
                    className={cn(
                      "focus-visible:ring-brand/60 h-[30px] flex-1 rounded-[8px] border text-[11.5px] font-medium outline-none focus-visible:ring-2",
                      "transition-[color,background-color,border-color,transform] duration-150 ease-out active:scale-[0.97]",
                      elegida
                        ? "border-ink-primary bg-surface-hover text-ink-primary"
                        : "border-line-control text-ink-faint hover:text-ink-secondary",
                    )}
                  >
                    {ETIQUETA_CATEGORIA[opcion]}
                  </button>
                );
              })}
            </div>
            <p className="text-ink-faint text-[10.5px] leading-snug text-pretty">
              {categoria === "servicio"
                ? "Texto libre, sin costo. Sólo sale con la ventana de 24 h abierta: cerrada, el paso se salta."
                : "Sale con una plantilla aprobada, que Meta cobra como marketing. Si la ventana de 24 h está abierta y escribís un texto libre, sale el texto, sin costo."}
            </p>
          </fieldset>

          {categoria === "marketing" ? (
            <CamposPlantilla
              valores={c.valores}
              cambiar={(campo, v) => onChange(c.con(campo, v))}
              readonly={readonly}
              labelClass={labelClass}
              inputClass={inputClass}
              selectClass={selectClass}
            />
          ) : null}

          {/* Nota 01 del diseño: las variables se eligen de una lista y se ven
              como chips; nunca se escribe una llave a mano. */}
          <EditorConVariables
            etiqueta={
              categoria === "marketing"
                ? "Texto libre con la ventana abierta (opcional)"
                : "Mensaje"
            }
            value={mensaje}
            onChange={(v) => onChange(c.con("mensaje", v))}
            placeholder="Hola, gracias por escribir. Contame qué repuesto necesitás."
            maxLength={4096}
            readonly={readonly}
          />
          <p className="text-ink-ghost -mt-1 text-[10.5px] leading-snug">
            Las variables se insertan con «+ Variable». Nunca se escribe la llave a mano.
          </p>
        </div>
      );
    }

    case "msg_botones":
      return <ConfigBotones config={config} onChange={onChange} readonly={readonly} />;

    case "msg_lista":
      return <ConfigLista config={config} onChange={onChange} readonly={readonly} />;

    case "msg_imagen":
      return (
        <ConfigImagen
          config={config}
          onChange={onChange}
          onSubirImagen={onSubirImagen}
          readonly={readonly}
        />
      );

    case "msg_documento": {
      // El documento todavía no corre (`disponibilidad.ts`): el formulario
      // queda como estaba. La imagen tiene el suyo (`ConfigImagen`).
      const isImagen = false;
      const c = editorDeConfig("msg_documento", config);
      const documento = c;
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

    case "msg_ubicacion":
      return <ConfigUbicacion config={config} onChange={onChange} readonly={readonly} />;

    case "msg_plantilla": {
      const c = editorDeConfig("msg_plantilla", config);
      return (
        <div className="flex flex-col gap-3">
          <CamposPlantilla
            valores={c.valores}
            cambiar={(campo, v) => onChange(c.con(campo, v))}
            readonly={readonly}
            labelClass={labelClass}
            inputClass={inputClass}
            selectClass={selectClass}
          />
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

type CampoPlantilla = "templateName" | "idioma" | "parametros";

/**
 * La plantilla aprobada de Meta: nombre, idioma y variables del cuerpo. La
 * comparten «Enviar plantilla» y «Enviar mensaje» de marketing, que escriben
 * las mismas claves y las lee el mismo handler.
 */
function CamposPlantilla({
  valores,
  cambiar,
  readonly,
  labelClass,
  inputClass,
  selectClass,
}: {
  valores: { templateName?: unknown; idioma?: unknown; parametros?: unknown };
  cambiar: (campo: CampoPlantilla, valor: unknown) => void;
  readonly?: boolean;
  labelClass: string;
  inputClass: string;
  selectClass: string;
}) {
  const parametros = Array.isArray(valores.parametros) ? (valores.parametros as string[]) : [];
  return (
    <>
      <label className="block">
        <span className={labelClass}>Nombre de la plantilla</span>
        <Input
          className={inputClass}
          value={String(valores.templateName ?? "")}
          onChange={(e) => cambiar("templateName", e.target.value)}
          placeholder="hello_world"
          disabled={readonly}
        />
      </label>

      <label className="block">
        <span className={labelClass}>Idioma</span>
        <Select
          value={String(valores.idioma ?? "es")}
          onValueChange={(v) => cambiar("idioma", v)}
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
              onClick={() => cambiar("parametros", [...parametros, ""])}
            >
              <Plus className="mr-1 h-3 w-3" />
              Agregar
            </Button>
          )}
        </div>
        <div className="space-y-2">
          {parametros.map((valor, idx) => (
            <div key={idx} className="flex items-end gap-2">
              <EditorConVariables
                className="flex-1"
                etiqueta={`Valor de la variable ${idx + 1}`}
                value={valor}
                onChange={(v) => {
                  const siguientes = [...parametros];
                  siguientes[idx] = v;
                  cambiar("parametros", siguientes);
                }}
                placeholder="Texto fijo o una variable"
                unaLinea
                readonly={readonly}
              />
              {!readonly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Quitar la variable ${idx + 1}`}
                  className="h-8 w-8 p-0 text-red-500"
                  onClick={() =>
                    cambiar(
                      "parametros",
                      parametros.filter((_, i) => i !== idx),
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
    </>
  );
}
