"use client";

import { useEffect, useId, useState } from "react";
import { ImagePlus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectOpciones } from "@/components/shared/SelectOpciones";
import { editorDeConfig, type ConfigDeTipo } from "@/lib/workflows/config-nodos";
import { nuevoIdDeOpcion } from "@/lib/workflows/opciones-interactivas";
import { EditorConVariables } from "./EditorConVariables";

/**
 * Formularios de botones, lista, imagen y ubicación: los mensajes de servicio
 * de WhatsApp que un flujo sabe mandar (tanda 4a).
 *
 * Los topes que muestran (3 botones de 20 caracteres, 10 opciones de lista…)
 * son los de Meta y los mismos que exige el contrato (`config-nodos.ts`): el
 * formulario los anticipa, el validador los hace cumplir.
 */

export type SubirImagenFn = (
  form: FormData,
) => Promise<{ ok: true; ruta: string } | { ok: false; error: string }>;

type Boton = ConfigDeTipo<"msg_botones">["botones"][number];
type Seccion = ConfigDeTipo<"msg_lista">["secciones"][number];

const LABEL = "text-ink-secondary mb-1 block text-[11px]";
const INPUT = "border-line-control bg-surface-root text-ink-primary h-8 w-full text-[12px]";
const SELECT = "border-line-control bg-surface-root text-ink-primary w-full text-[12px]";
const AYUDA = "text-ink-ghost text-[10.5px] leading-snug";
const TARJETA = "border-line-control bg-surface-root rounded-md border p-2";

/** Contador de caracteres de un campo con tope, en mono como el resto de los números. */
function Contador({ largo, max }: { largo: number; max: number }) {
  return (
    <span
      className={`font-mono text-[10px] tabular-nums ${largo > max ? "text-danger" : "text-ink-ghost"}`}
    >
      {largo}/{max}
    </span>
  );
}

/** Aviso fijo de los cuatro bloques: son mensajes de servicio. */
function AvisoVentana({ esperaRespuesta }: { esperaRespuesta: boolean }) {
  return (
    <p className="text-ink-faint bg-surface-hover rounded-md p-2 text-[10.5px] leading-snug">
      Sólo por WhatsApp y con la ventana de 24 h abierta: si el lead no escribió en las últimas 24
      h, el flujo lo saltea con «sin ventana».
      {esperaRespuesta
        ? " El flujo espera la respuesta y sigue por la línea de la opción elegida."
        : null}
    </p>
  );
}

/** "Esperar la respuesta" de botones y lista: obligatorio, como en "Esperar respuesta". */
function TiempoMaximo({
  timeout,
  unidad,
  onTimeout,
  onUnidad,
  readonly,
}: {
  timeout: unknown;
  unidad: unknown;
  onTimeout: (v: number | undefined) => void;
  onUnidad: (v: string) => void;
  readonly?: boolean;
}) {
  const ayudaId = useId();
  return (
    <div>
      <span className={LABEL}>Esperar la respuesta hasta</span>
      <div className="flex gap-2">
        <Input
          type="number"
          min={1}
          step={1}
          aria-label="Esperar la respuesta hasta"
          aria-describedby={ayudaId}
          className={`${INPUT} w-24`}
          value={typeof timeout === "number" ? String(timeout) : ""}
          onChange={(e) => onTimeout(e.target.value === "" ? undefined : Number(e.target.value))}
          disabled={readonly}
        />
        <SelectOpciones
          value={String(unidad)}
          onValueChange={(v) => {
            if (v !== null) onUnidad(v);
          }}
          disabled={readonly}
          className={`${SELECT} w-[120px]`}
          aria-label="Unidad del tiempo máximo"
          opciones={[
            { value: "minutos", label: "minutos" },
            { value: "horas", label: "horas" },
            { value: "dias", label: "días" },
          ]}
        />
      </div>
      <p id={ayudaId} className={`${AYUDA} mt-1`}>
        Si no elige antes, el flujo sigue por «Sin respuesta».
      </p>
    </div>
  );
}

export function ConfigBotones({
  config,
  onChange,
  readonly,
}: {
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
  readonly?: boolean;
}) {
  const c = editorDeConfig("msg_botones", config);
  const botones = Array.isArray(c.valores.botones) ? (c.valores.botones as Boton[]) : [];
  const cambiarBoton = (idx: number, texto: string) =>
    onChange(
      c.con(
        "botones",
        botones.map((b, i) => (i === idx ? { ...b, texto } : b)),
      ),
    );

  return (
    <div className="flex flex-col gap-3">
      <EditorConVariables
        etiqueta="Mensaje"
        value={String(c.valores.mensaje ?? "")}
        onChange={(v) => onChange(c.con("mensaje", v))}
        placeholder="¿Te reservo el repuesto?"
        maxLength={1024}
        readonly={readonly}
      />

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className={LABEL}>Botones · hasta 3</span>
          {!readonly && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              disabled={botones.length >= 3}
              onClick={() =>
                onChange(
                  c.con("botones", [
                    ...botones,
                    { id: nuevoIdDeOpcion(botones.map((b) => b.id)), texto: "" },
                  ]),
                )
              }
            >
              <Plus className="mr-1 h-3 w-3" aria-hidden />
              Agregar botón
            </Button>
          )}
        </div>
        {botones.length === 0 ? (
          <p className={AYUDA}>Cada botón es una salida del bloque. Agregá al menos uno.</p>
        ) : (
          <ul className="space-y-2">
            {botones.map((boton, idx) => (
              <li key={boton.id} className="flex items-center gap-2">
                <Input
                  className={`${INPUT} flex-1`}
                  aria-label={`Texto del botón ${idx + 1}`}
                  value={boton.texto}
                  onChange={(e) => cambiarBoton(idx, e.target.value)}
                  placeholder={idx === 0 ? "Sí, reservalo" : "Texto del botón"}
                  maxLength={20}
                  disabled={readonly}
                />
                <Contador largo={boton.texto.length} max={20} />
                {!readonly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Quitar el botón ${idx + 1}`}
                    className="text-danger h-8 w-8 p-0"
                    onClick={() =>
                      onChange(
                        c.con(
                          "botones",
                          botones.filter((_, i) => i !== idx),
                        ),
                      )
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <TiempoMaximo
        timeout={c.valores.timeout}
        unidad={c.valores.unidadTimeout}
        onTimeout={(v) => onChange(c.con("timeout", v))}
        onUnidad={(v) => onChange(c.con("unidadTimeout", v))}
        readonly={readonly}
      />
      <AvisoVentana esperaRespuesta />
    </div>
  );
}

export function ConfigLista({
  config,
  onChange,
  readonly,
}: {
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
  readonly?: boolean;
}) {
  const c = editorDeConfig("msg_lista", config);
  const secciones = Array.isArray(c.valores.secciones) ? (c.valores.secciones as Seccion[]) : [];
  const ids = secciones.flatMap((s) => s.items.map((i) => i.id));
  const total = ids.length;
  const cambiarSecciones = (siguientes: Seccion[]) => onChange(c.con("secciones", siguientes));
  const nuevaOpcion = () => ({ id: nuevoIdDeOpcion(ids), titulo: "", descripcion: "" });
  // Las opciones se numeran de corrido entre secciones, como las ve el lead.
  const primeraDeSeccion = secciones.map((_, i) =>
    secciones.slice(0, i).reduce((n, s) => n + s.items.length, 0),
  );

  return (
    <div className="flex flex-col gap-3">
      <label className="block">
        <span className={LABEL}>Título (opcional)</span>
        <Input
          className={INPUT}
          value={String(c.valores.header ?? "")}
          onChange={(e) => onChange(c.con("header", e.target.value))}
          placeholder="Repuestos disponibles"
          maxLength={60}
          disabled={readonly}
        />
      </label>

      <EditorConVariables
        etiqueta="Mensaje"
        value={String(c.valores.body ?? "")}
        onChange={(v) => onChange(c.con("body", v))}
        placeholder="Elegí qué necesitás y te paso precio."
        maxLength={4096}
        readonly={readonly}
      />

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className={LABEL}>Botón que abre la lista</span>
          <Input
            className={INPUT}
            value={String(c.valores.botonTexto ?? "")}
            onChange={(e) => onChange(c.con("botonTexto", e.target.value))}
            maxLength={20}
            disabled={readonly}
          />
        </label>
        <label className="block">
          <span className={LABEL}>Pie (opcional)</span>
          <Input
            className={INPUT}
            value={String(c.valores.footer ?? "")}
            onChange={(e) => onChange(c.con("footer", e.target.value))}
            maxLength={60}
            disabled={readonly}
          />
        </label>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className={LABEL}>
            Opciones · <span className="font-mono tabular-nums">{total}</span> de 10
          </span>
          {!readonly && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              disabled={total >= 10 || secciones.length >= 10}
              onClick={() =>
                cambiarSecciones([...secciones, { titulo: "", items: [nuevaOpcion()] }])
              }
            >
              <Plus className="mr-1 h-3 w-3" aria-hidden />
              Agregar sección
            </Button>
          )}
        </div>
        <div className="space-y-3">
          {secciones.map((seccion, sIdx) => (
            <fieldset key={sIdx} className={TARJETA}>
              <legend className="sr-only">Sección {sIdx + 1}</legend>
              <div className="mb-2 flex items-center gap-2">
                <Input
                  className={`${INPUT} flex-1`}
                  aria-label={`Título de la sección ${sIdx + 1}`}
                  value={seccion.titulo}
                  onChange={(e) =>
                    cambiarSecciones(
                      secciones.map((s, i) => (i === sIdx ? { ...s, titulo: e.target.value } : s)),
                    )
                  }
                  placeholder="Título de la sección (opcional)"
                  maxLength={24}
                  disabled={readonly}
                />
                {!readonly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Quitar la sección ${sIdx + 1}`}
                    className="text-danger h-8 w-8 p-0"
                    onClick={() => cambiarSecciones(secciones.filter((_, i) => i !== sIdx))}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                )}
              </div>
              <ul className="space-y-1.5 pl-3">
                {seccion.items.map((item, iIdx) => {
                  const n = (primeraDeSeccion[sIdx] ?? 0) + iIdx + 1;
                  const cambiarItem = (campo: "titulo" | "descripcion", valor: string) =>
                    cambiarSecciones(
                      secciones.map((s, i) =>
                        i === sIdx
                          ? {
                              ...s,
                              items: s.items.map((it, j) =>
                                j === iIdx ? { ...it, [campo]: valor } : it,
                              ),
                            }
                          : s,
                      ),
                    );
                  return (
                    <li key={item.id} className="flex gap-1">
                      <Input
                        className={`${INPUT} flex-1`}
                        aria-label={`Título de la opción ${n}`}
                        value={item.titulo}
                        onChange={(e) => cambiarItem("titulo", e.target.value)}
                        placeholder="Título"
                        maxLength={24}
                        disabled={readonly}
                      />
                      <Input
                        className={`${INPUT} flex-1`}
                        aria-label={`Descripción de la opción ${n}`}
                        value={item.descripcion}
                        onChange={(e) => cambiarItem("descripcion", e.target.value)}
                        placeholder="Descripción (opcional)"
                        maxLength={72}
                        disabled={readonly}
                      />
                      {!readonly && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Quitar la opción ${n}`}
                          className="text-danger h-8 w-8 p-0"
                          onClick={() =>
                            cambiarSecciones(
                              secciones.map((s, i) =>
                                i === sIdx
                                  ? { ...s, items: s.items.filter((_, j) => j !== iIdx) }
                                  : s,
                              ),
                            )
                          }
                        >
                          <Trash2 className="h-3 w-3" aria-hidden />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {!readonly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-1 h-6 px-2 text-[10px]"
                  disabled={total >= 10}
                  onClick={() =>
                    cambiarSecciones(
                      secciones.map((s, i) =>
                        i === sIdx ? { ...s, items: [...s.items, nuevaOpcion()] } : s,
                      ),
                    )
                  }
                >
                  <Plus className="mr-1 h-3 w-3" aria-hidden />
                  Agregar opción
                </Button>
              )}
            </fieldset>
          ))}
        </div>
      </div>

      <TiempoMaximo
        timeout={c.valores.timeout}
        unidad={c.valores.unidadTimeout}
        onTimeout={(v) => onChange(c.con("timeout", v))}
        onUnidad={(v) => onChange(c.con("unidadTimeout", v))}
        readonly={readonly}
      />
      <AvisoVentana esperaRespuesta />
    </div>
  );
}

export function ConfigImagen({
  config,
  onChange,
  onSubirImagen,
  readonly,
}: {
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
  onSubirImagen?: SubirImagenFn;
  readonly?: boolean;
}) {
  const c = editorDeConfig("msg_imagen", config);
  const porArchivo = c.valores.tipoMedia === "archivo";
  const archivo = typeof c.valores.archivo === "string" ? c.valores.archivo : null;
  const [estado, setEstado] = useState<
    { tipo: "quieto" } | { tipo: "subiendo" } | { tipo: "error"; mensaje: string }
  >({ tipo: "quieto" });
  // La vista previa sale del archivo local (blob:): la URL de Storage es
  // privada y la CSP no la deja cargar en el panel.
  const [vista, setVista] = useState<string | null>(null);
  useEffect(() => () => (vista ? URL.revokeObjectURL(vista) : undefined), [vista]);
  const inputId = useId();
  const estadoId = useId();

  async function subir(f: File) {
    if (!onSubirImagen) return;
    setEstado({ tipo: "subiendo" });
    const form = new FormData();
    form.append("archivo", f);
    const r = await onSubirImagen(form);
    if (!r.ok) {
      setEstado({ tipo: "error", mensaje: r.error });
      return;
    }
    setEstado({ tipo: "quieto" });
    setVista(typeof URL.createObjectURL === "function" ? URL.createObjectURL(f) : null);
    onChange(c.con("archivo", r.ruta));
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="De dónde sale la imagen" className="flex gap-2">
        {(
          [
            ["url", "URL pública"],
            ["archivo", "Subir archivo"],
          ] as const
        ).map(([valor, texto]) => {
          const activo = (valor === "archivo") === porArchivo;
          return (
            <button
              key={valor}
              type="button"
              role="radio"
              aria-checked={activo}
              onClick={() => onChange(c.con("tipoMedia", valor))}
              disabled={readonly}
              className={`focus-visible:ring-ring rounded px-3 py-1.5 text-[11px] focus-visible:ring-2 focus-visible:outline-none ${
                activo ? "bg-accent-blue text-white" : "bg-surface-hover text-ink-secondary"
              }`}
            >
              {texto}
            </button>
          );
        })}
      </div>

      {porArchivo ? (
        <div>
          <label htmlFor={inputId} className={LABEL}>
            Elegir imagen (JPG o PNG, hasta 5 MB)
          </label>
          <label
            htmlFor={inputId}
            className="border-line-control bg-surface-root text-ink-faint hover:bg-surface-hover focus-within:ring-ring flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed p-2 text-[11px] focus-within:ring-2"
          >
            {vista ? (
              // eslint-disable-next-line @next/next/no-img-element -- blob: local, sin optimización posible
              <img
                src={vista}
                alt="Vista previa de la imagen subida"
                className="max-h-32 rounded"
              />
            ) : (
              <ImagePlus className="h-5 w-5" aria-hidden />
            )}
            <span>
              {estado.tipo === "subiendo"
                ? "Subiendo…"
                : archivo
                  ? "Imagen subida. Elegí otra para reemplazarla."
                  : "Elegí una imagen"}
            </span>
          </label>
          <input
            id={inputId}
            type="file"
            accept="image/jpeg,image/png"
            className="sr-only"
            aria-describedby={estadoId}
            disabled={readonly || !onSubirImagen || estado.tipo === "subiendo"}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void subir(f);
              e.target.value = "";
            }}
          />
          <p id={estadoId} role="status" className={`${AYUDA} mt-1`}>
            {estado.tipo === "error" ? (
              <span className="text-danger">{estado.mensaje}</span>
            ) : archivo ? (
              <span className="font-mono">{archivo}</span>
            ) : null}
          </p>
        </div>
      ) : (
        <label className="block">
          <span className={LABEL}>URL de la imagen</span>
          <Input
            className={INPUT}
            type="url"
            inputMode="url"
            value={String(c.valores.url ?? "")}
            onChange={(e) => onChange(c.con("url", e.target.value))}
            placeholder="https://tu-tienda.com/pieza.jpg"
            disabled={readonly}
          />
          <span className={`${AYUDA} mt-1 block`}>
            Tiene que ser https y pública: Meta la descarga al mandar.
          </span>
        </label>
      )}

      <EditorConVariables
        etiqueta="Pie de la imagen (opcional)"
        value={String(c.valores.caption ?? "")}
        onChange={(v) => onChange(c.con("caption", v))}
        placeholder="Este es el filtro para tu {{lead.nombre}}"
        maxLength={1024}
        readonly={readonly}
      />
      <AvisoVentana esperaRespuesta={false} />
    </div>
  );
}

export function ConfigUbicacion({
  config,
  onChange,
  readonly,
}: {
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
  readonly?: boolean;
}) {
  const c = editorDeConfig("msg_ubicacion", config);
  // Vacío borra el valor: `Number("")` es 0, un punto real en el golfo de Guinea.
  const numero = (v: string) => (v.trim() === "" ? undefined : Number(v));
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className={LABEL}>Latitud</span>
          <Input
            type="number"
            step="any"
            min={-90}
            max={90}
            className={INPUT}
            value={typeof c.valores.lat === "number" ? String(c.valores.lat) : ""}
            onChange={(e) => onChange(c.con("lat", numero(e.target.value)))}
            placeholder="-2.1709"
            disabled={readonly}
          />
        </label>
        <label className="block">
          <span className={LABEL}>Longitud</span>
          <Input
            type="number"
            step="any"
            min={-180}
            max={180}
            className={INPUT}
            value={typeof c.valores.lon === "number" ? String(c.valores.lon) : ""}
            onChange={(e) => onChange(c.con("lon", numero(e.target.value)))}
            placeholder="-79.9224"
            disabled={readonly}
          />
        </label>
      </div>
      <label className="block">
        <span className={LABEL}>Nombre del lugar (opcional)</span>
        <Input
          className={INPUT}
          value={String(c.valores.nombre ?? "")}
          onChange={(e) => onChange(c.con("nombre", e.target.value))}
          placeholder="Repuestos del Centro"
          disabled={readonly}
        />
      </label>
      <label className="block">
        <span className={LABEL}>Dirección (opcional)</span>
        <Input
          className={INPUT}
          value={String(c.valores.direccion ?? "")}
          onChange={(e) => onChange(c.con("direccion", e.target.value))}
          placeholder="Av. 9 de Octubre 100"
          disabled={readonly}
        />
      </label>
      <AvisoVentana esperaRespuesta={false} />
    </div>
  );
}
