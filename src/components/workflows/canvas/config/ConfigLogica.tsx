"use client";

import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import { SelectOpciones } from "@/components/shared/SelectOpciones";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { TextareaConVariables } from "./TextareaConVariables";
import { CAMPOS_CONDICION, OPERADORES } from "@/lib/workflows/condiciones";
import { editorDeConfig, type ConfigDeTipo } from "@/lib/workflows/config-nodos";
import type { CampoCondicion as CampoDelConstructor } from "@/lib/ui/condiciones";

interface ConfigLogicaProps {
  tipo: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  /**
   * Los campos que puede mirar "Según el valor", con su nombre y, los de
   * opciones, sus valores posibles (intents incluidos): los arma la pantalla,
   * igual que para la condición.
   */
  camposSwitch?: readonly CampoDelConstructor[];
  /** A qué pasos puede saltar "Ir a": los del flujo menos el disparador y él mismo. */
  pasos?: readonly { id: string; nombre: string }[];
  readonly?: boolean;
}

type CasoSwitch = ConfigDeTipo<"logica_switch">["casos"][number];

/** Un id para un caso nuevo. Es su puerto (`caso:<id>`): corto, único y sin posición. */
function idDeCasoNuevo(): string {
  return `caso_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
}

/**
 * Formularios de los bloques de lógica.
 *
 * Todos menos la condición escriben con el contrato de config
 * (`editorDeConfig`, `lib/workflows/config-nodos.ts`): el mismo schema que
 * revisa el validador y, en la espera, el que respeta el motor. Una clave que
 * el contrato no conoce no compila.
 *
 * La condición (`logica_condicion`) queda afuera: su config es el árbol Y/O
 * que define otro stream. Hasta que llegue, conserva su formulario y su
 * `handleChange` tal como estaban.
 */
export function ConfigLogica({
  tipo,
  config,
  onChange,
  camposSwitch = [],
  pasos = [],
  readonly,
}: ConfigLogicaProps) {
  // Sólo lo usa la condición, que está fuera del contrato de config.
  const handleChange = useCallback(
    (campo: string, valor: unknown) => {
      onChange({ ...config, [campo]: valor });
    },
    [config, onChange],
  );

  const labelClass = "text-ink-secondary mb-1 block text-[11px]";
  const selectClass = "border-line-control bg-surface-root text-ink-primary w-full text-[12px]";
  const inputClass = "border-line-control bg-surface-root text-ink-primary w-full text-[12px] h-8";

  const operadoresConEtiqueta: Record<string, string> = {
    es: "es igual a",
    no_es: "no es igual a",
    contiene: "contiene",
    es_verdadero: "es verdadero",
    es_falso: "es falso",
    mayor_que: "mayor que",
    menor_que: "menor que",
    existe: "existe",
    no_existe: "no existe",
  };

  const operadorRequiereValor = (op: string): boolean => {
    return !["es_verdadero", "es_falso", "existe", "no_existe"].includes(op);
  };

  switch (tipo) {
    case "logica_condicion":
      const operador = String(config.operador ?? "es");
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Campo</span>
            <SelectOpciones
              value={String(config.campo ?? "")}
              onValueChange={(v) => handleChange("campo", v)}
              disabled={readonly}
              className={selectClass}
              placeholder="Seleccionar campo"
              opciones={CAMPOS_CONDICION.map((c) => ({ value: c, label: c }))}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Operador</span>
            <SelectOpciones
              value={operador}
              onValueChange={(v) => handleChange("operador", v)}
              disabled={readonly}
              className={selectClass}
              opciones={[
                ...OPERADORES.map((o) => ({
                  value: o,
                  label: operadoresConEtiqueta[o] ?? o.replace("_", " "),
                })),
              ]}
            />
          </label>

          {operadorRequiereValor(operador) && (
            <label className="block">
              <span className={labelClass}>Valor</span>
              <Input
                className={inputClass}
                value={String(config.valor ?? "")}
                onChange={(e) => handleChange("valor", e.target.value)}
                placeholder="Valor a comparar"
                disabled={readonly}
              />
            </label>
          )}

          <div className="border-line-layout bg-surface-hover mt-2 rounded-md border p-2">
            <p className="text-ink-faint text-[10px]">
              Si la condicion es verdadera, sigue por la salida Verdadero.
              <br />
              Si es falsa, sigue por la salida Falso.
            </p>
          </div>
        </div>
      );

    case "logica_switch": {
      const c = editorDeConfig("logica_switch", config);
      const casos = Array.isArray(c.valores.casos) ? (c.valores.casos as CasoSwitch[]) : [];
      const campoId = String(c.valores.campo ?? "");
      const campo = camposSwitch.find((x) => x.id === campoId);
      const opciones = campo?.opciones;
      const cambiarCaso = (idx: number, valor: string) =>
        onChange(
          c.con(
            "casos",
            casos.map((k, i) => (i === idx ? { ...k, valor } : k)),
          ),
        );
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Campo que mira</span>
            <SelectOpciones
              value={campoId}
              onValueChange={(v) => onChange(c.con("campo", v))}
              disabled={readonly}
              className={selectClass}
              placeholder="Elegí un campo"
              opciones={camposSwitch.map((x) => ({
                value: x.id,
                label: x.etiqueta,
                grupo: x.grupo,
              }))}
            />
          </label>

          <fieldset className="flex flex-col gap-2">
            <legend className={labelClass}>Casos</legend>
            {casos.length === 0 ? (
              <p className="text-ink-faint text-[11px] text-pretty">
                Sin casos, todo sale por «Otro». Agregá uno por cada valor que lleve a otro camino.
              </p>
            ) : null}
            {casos.map((caso, idx) => {
              const valor = caso.valor.trim();
              const nombre =
                valor === ""
                  ? `caso ${idx + 1}`
                  : (opciones?.find((o) => o.valor === valor)?.etiqueta ?? valor);
              return (
                <div key={caso.id} className="flex items-center gap-2">
                  {opciones ? (
                    <SelectOpciones
                      value={caso.valor}
                      onValueChange={(v) => cambiarCaso(idx, v)}
                      disabled={readonly}
                      className={`${selectClass} flex-1`}
                      aria-label={`Valor del caso ${idx + 1}`}
                      placeholder="Elegí un valor"
                      opciones={opciones.map((o) => ({ value: o.valor, label: o.etiqueta }))}
                    />
                  ) : (
                    <Input
                      className={`${inputClass} flex-1`}
                      value={caso.valor}
                      onChange={(e) => cambiarCaso(idx, e.target.value)}
                      placeholder="Valor exacto"
                      aria-label={`Valor del caso ${idx + 1}`}
                      disabled={readonly}
                    />
                  )}
                  {!readonly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-ink-faint hover:text-danger h-8 w-8 shrink-0 p-0"
                      aria-label={`Quitar el caso «${nombre}»`}
                      onClick={() =>
                        onChange(
                          c.con(
                            "casos",
                            casos.filter((_, i) => i !== idx),
                          ),
                        )
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  )}
                </div>
              );
            })}
            {!readonly && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 self-start px-2 text-[11px]"
                onClick={() =>
                  onChange(c.con("casos", [...casos, { id: idDeCasoNuevo(), valor: "" }]))
                }
              >
                <Plus className="mr-1 h-3 w-3" aria-hidden />
                Agregar caso
              </Button>
            )}
          </fieldset>

          <p className="text-ink-faint text-[11px] text-pretty">
            Cada caso es una salida del bloque. Sigue por el primero cuyo valor es igual al
            {campo ? ` de «${campo.etiqueta}»` : " del campo"}; si ninguno coincide, sale por
            «Otro».
          </p>
        </div>
      );
    }

    case "logica_validacion": {
      const c = editorDeConfig("logica_validacion", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Campo a validar</span>
            <SelectOpciones
              value={String(c.valores.campo ?? "")}
              onValueChange={(v) => onChange(c.con("campo", v))}
              disabled={readonly}
              className={selectClass}
              placeholder="Seleccionar campo"
              opciones={CAMPOS_CONDICION.map((campo) => ({ value: campo, label: campo }))}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Tipo de validacion</span>
            <SelectOpciones
              value={String(c.valores.validacion)}
              onValueChange={(v) => onChange(c.con("validacion", v))}
              disabled={readonly}
              className={selectClass}
              opciones={[
                { value: "requerido", label: "Requerido" },
                { value: "email", label: "Es email valido" },
                { value: "telefono", label: "Es telefono valido" },
                { value: "numero", label: "Es numero" },
                { value: "regex", label: "Expresion regular" },
              ]}
            />
          </label>

          {c.valores.validacion === "regex" && (
            <label className="block">
              <span className={labelClass}>Expresion regular</span>
              <Input
                className={`${inputClass} font-mono`}
                value={String(c.valores.regex ?? "")}
                onChange={(e) => onChange(c.con("regex", e.target.value))}
                placeholder="^[A-Z]{2,4}$"
                disabled={readonly}
              />
            </label>
          )}

          <label className="block">
            <span className={labelClass}>Mensaje de error</span>
            <Input
              className={inputClass}
              value={String(c.valores.mensajeError ?? "")}
              onChange={(e) => onChange(c.con("mensajeError", e.target.value))}
              placeholder="El campo no es valido"
              disabled={readonly}
            />
          </label>
        </div>
      );
    }

    case "logica_esperar": {
      const c = editorDeConfig("logica_esperar", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Duracion</span>
            <div className="flex gap-2">
              <Input
                type="number"
                min={1}
                className={`${inputClass} w-20`}
                value={Number(c.valores.duracion)}
                onChange={(e) => onChange(c.con("duracion", Number(e.target.value)))}
                disabled={readonly}
              />
              <SelectOpciones
                value={String(c.valores.unidad)}
                onValueChange={(v) => onChange(c.con("unidad", v))}
                disabled={readonly}
                className={`${selectClass} flex-1`}
                opciones={[
                  { value: "segundos", label: "Segundos" },
                  { value: "minutos", label: "Minutos" },
                  { value: "horas", label: "Horas" },
                  { value: "dias", label: "Dias" },
                ]}
              />
            </div>
          </label>
        </div>
      );
    }

    case "logica_esperar_respuesta": {
      const c = editorDeConfig("logica_esperar_respuesta", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Timeout</span>
            <div className="flex gap-2">
              <Input
                type="number"
                min={1}
                className={`${inputClass} w-20`}
                value={Number(c.valores.timeout)}
                onChange={(e) => onChange(c.con("timeout", Number(e.target.value)))}
                disabled={readonly}
              />
              <SelectOpciones
                value={String(c.valores.unidadTimeout)}
                onValueChange={(v) => onChange(c.con("unidadTimeout", v))}
                disabled={readonly}
                className={`${selectClass} flex-1`}
                opciones={[
                  { value: "minutos", label: "Minutos" },
                  { value: "horas", label: "Horas" },
                  { value: "dias", label: "Dias" },
                ]}
              />
            </div>
          </label>

          <label className="block">
            <span className={labelClass}>Mensaje si no responde (opcional)</span>
            <TextareaConVariables
              value={String(c.valores.mensajeTimeout ?? "")}
              onChange={(v) => onChange(c.con("mensajeTimeout", v))}
              placeholder="Ej: Hola {{lead.nombre}}, notamos que no respondiste..."
              rows={3}
              className={`${inputClass} h-auto min-h-[80px] resize-y`}
            />
          </label>

          <div className="text-ink-faint text-[10px]">
            Si responde a tiempo, sigue por Respondio. Si no, sigue por Timeout.
          </div>
        </div>
      );
    }

    case "logica_esperar_evento": {
      const c = editorDeConfig("logica_esperar_evento", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Evento a esperar</span>
            <SelectOpciones
              value={String(c.valores.evento ?? "")}
              onValueChange={(v) => onChange(c.con("evento", v))}
              disabled={readonly}
              className={selectClass}
              placeholder="Seleccionar evento"
              opciones={[
                { value: "etiqueta_asignada", label: "Etiqueta asignada" },
                { value: "etapa_cambiada", label: "Etapa cambiada" },
                { value: "vendedor_asignado", label: "Vendedor asignado" },
                { value: "comprobante_subido", label: "Comprobante subido" },
              ]}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Timeout maximo</span>
            <div className="flex gap-2">
              <Input
                type="number"
                min={1}
                className={`${inputClass} w-20`}
                value={Number(c.valores.timeoutMax)}
                onChange={(e) => onChange(c.con("timeoutMax", Number(e.target.value)))}
                disabled={readonly}
              />
              <SelectOpciones
                value={String(c.valores.unidadTimeoutMax)}
                onValueChange={(v) => onChange(c.con("unidadTimeoutMax", v))}
                disabled={readonly}
                className={`${selectClass} flex-1`}
                opciones={[
                  { value: "horas", label: "Horas" },
                  { value: "dias", label: "Dias" },
                ]}
              />
            </div>
          </label>
        </div>
      );
    }

    case "logica_loop": {
      const c = editorDeConfig("logica_loop", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Campo a iterar (array)</span>
            <Input
              className={inputClass}
              value={String(c.valores.campo ?? "")}
              onChange={(e) => onChange(c.con("campo", e.target.value))}
              placeholder="Ej: contexto.productos"
              disabled={readonly}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Variable del item</span>
            <Input
              className={inputClass}
              value={String(c.valores.variableItem)}
              onChange={(e) => onChange(c.con("variableItem", e.target.value))}
              placeholder="item"
              disabled={readonly}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Maximo de iteraciones</span>
            <Input
              type="number"
              min={1}
              max={100}
              className={inputClass}
              value={Number(c.valores.maxIteraciones)}
              onChange={(e) => onChange(c.con("maxIteraciones", Number(e.target.value)))}
              disabled={readonly}
            />
          </label>
        </div>
      );
    }

    case "logica_goto": {
      const c = editorDeConfig("logica_goto", config);
      const destino = String(c.valores.nodoDestino ?? "");
      const existe = destino === "" || pasos.some((x) => x.id === destino);
      // Dos bloques del mismo tipo se llaman igual: el id los distingue.
      const repetidos = new Set(
        pasos
          .filter((x, i) => pasos.findIndex((y) => y.nombre === x.nombre) !== i)
          .map((x) => x.nombre),
      );
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Paso al que salta</span>
            <SelectOpciones
              value={existe ? destino : ""}
              onValueChange={(v) => onChange(c.con("nodoDestino", v))}
              disabled={readonly}
              className={selectClass}
              placeholder="Elegí un paso"
              opciones={pasos.map((x) => ({
                value: x.id,
                label: repetidos.has(x.nombre) ? `${x.nombre} (${x.id})` : x.nombre,
              }))}
            />
          </label>

          {!existe ? (
            <p role="alert" className="text-danger text-[11px] text-pretty">
              El paso al que saltaba ya no está en el flujo. Elegí otro.
            </p>
          ) : null}

          <p className="text-ink-faint text-[11px] text-pretty">
            La corrida sigue desde ese paso. Para volver a un tramo anterior tiene que haber una
            espera en el medio: sin ella el flujo giraría sin freno y no se puede guardar.
          </p>
        </div>
      );
    }

    case "logica_detener": {
      const c = editorDeConfig("logica_detener", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Resultado</span>
            <SelectOpciones
              value={String(c.valores.resultado)}
              onValueChange={(v) => onChange(c.con("resultado", v))}
              disabled={readonly}
              className={selectClass}
              opciones={[
                { value: "exito", label: "Exito" },
                { value: "error", label: "Error" },
                { value: "cancelado", label: "Cancelado" },
              ]}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Mensaje final (opcional)</span>
            <Input
              className={inputClass}
              value={String(c.valores.mensaje ?? "")}
              onChange={(e) => onChange(c.con("mensaje", e.target.value))}
              placeholder="Workflow completado"
              disabled={readonly}
            />
          </label>
        </div>
      );
    }

    case "logica_error": {
      const c = editorDeConfig("logica_error", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Accion en caso de error</span>
            <SelectOpciones
              value={String(c.valores.accion)}
              onValueChange={(v) => onChange(c.con("accion", v))}
              disabled={readonly}
              className={selectClass}
              opciones={[
                { value: "continuar", label: "Continuar" },
                { value: "reintentar", label: "Reintentar" },
                { value: "detener", label: "Detener workflow" },
                { value: "notificar", label: "Notificar y continuar" },
              ]}
            />
          </label>

          {c.valores.accion === "reintentar" && (
            <label className="block">
              <span className={labelClass}>Reintentos maximos</span>
              <Input
                type="number"
                min={1}
                max={5}
                className={inputClass}
                value={Number(c.valores.reintentos)}
                onChange={(e) => onChange(c.con("reintentos", Number(e.target.value)))}
                disabled={readonly}
              />
            </label>
          )}
        </div>
      );
    }

    default:
      return (
        <p className="text-ink-faint text-[11px]">
          Este nodo de logica no tiene configuracion adicional
        </p>
      );
  }
}
