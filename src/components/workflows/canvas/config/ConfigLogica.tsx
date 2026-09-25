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
import { Plus, Trash2 } from "lucide-react";
import { TextareaConVariables } from "./TextareaConVariables";
import { CAMPOS_CONDICION, OPERADORES } from "@/lib/workflows/condiciones";
import { editorDeConfig, type ConfigDeTipo } from "@/lib/workflows/config-nodos";

interface ConfigLogicaProps {
  tipo: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  readonly?: boolean;
}

type CasoSwitch = ConfigDeTipo<"logica_switch">["casos"][number];

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
export function ConfigLogica({ tipo, config, onChange, readonly }: ConfigLogicaProps) {
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
            <Select
              value={String(config.campo ?? "")}
              onValueChange={(v) => handleChange("campo", v)}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue placeholder="Seleccionar campo" />
              </SelectTrigger>
              <SelectContent>
                {CAMPOS_CONDICION.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="block">
            <span className={labelClass}>Operador</span>
            <Select
              value={operador}
              onValueChange={(v) => handleChange("operador", v)}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPERADORES.map((o) => (
                  <SelectItem key={o} value={o}>
                    {operadoresConEtiqueta[o] ?? o.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Campo a evaluar</span>
            <Select
              value={String(c.valores.campo ?? "")}
              onValueChange={(v) => onChange(c.con("campo", v))}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue placeholder="Seleccionar campo" />
              </SelectTrigger>
              <SelectContent>
                {CAMPOS_CONDICION.map((campo) => (
                  <SelectItem key={campo} value={campo}>
                    {campo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className={labelClass}>Casos</span>
              {!readonly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() =>
                    onChange(c.con("casos", [...casos, { valor: "", id: `caso_${Date.now()}` }]))
                  }
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Agregar caso
                </Button>
              )}
            </div>

            <div className="space-y-2">
              {casos.map((caso, idx) => (
                <div key={caso.id} className="flex items-center gap-2">
                  <span className="text-ink-faint w-6 text-right text-[10px]">{idx + 1}.</span>
                  <Input
                    className={`${inputClass} flex-1`}
                    value={caso.valor}
                    onChange={(e) => {
                      const newCasos = [...casos];
                      newCasos[idx] = { ...caso, valor: e.target.value };
                      onChange(c.con("casos", newCasos));
                    }}
                    placeholder={`Valor caso ${idx + 1}`}
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
                            "casos",
                            casos.filter((_, i) => i !== idx),
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

            <div className="text-ink-faint mt-2 text-[10px]">
              Cada caso genera una salida separada. Si ninguno coincide, sigue por Default.
            </div>
          </div>
        </div>
      );
    }

    case "logica_validacion": {
      const c = editorDeConfig("logica_validacion", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Campo a validar</span>
            <Select
              value={String(c.valores.campo ?? "")}
              onValueChange={(v) => onChange(c.con("campo", v))}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue placeholder="Seleccionar campo" />
              </SelectTrigger>
              <SelectContent>
                {CAMPOS_CONDICION.map((campo) => (
                  <SelectItem key={campo} value={campo}>
                    {campo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="block">
            <span className={labelClass}>Tipo de validacion</span>
            <Select
              value={String(c.valores.validacion)}
              onValueChange={(v) => onChange(c.con("validacion", v))}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="requerido">Requerido</SelectItem>
                <SelectItem value="email">Es email valido</SelectItem>
                <SelectItem value="telefono">Es telefono valido</SelectItem>
                <SelectItem value="numero">Es numero</SelectItem>
                <SelectItem value="regex">Expresion regular</SelectItem>
              </SelectContent>
            </Select>
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
              <Select
                value={String(c.valores.unidad)}
                onValueChange={(v) => onChange(c.con("unidad", v))}
                disabled={readonly}
              >
                <SelectTrigger className={`${selectClass} flex-1`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="segundos">Segundos</SelectItem>
                  <SelectItem value="minutos">Minutos</SelectItem>
                  <SelectItem value="horas">Horas</SelectItem>
                  <SelectItem value="dias">Dias</SelectItem>
                </SelectContent>
              </Select>
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
              <Select
                value={String(c.valores.unidadTimeout)}
                onValueChange={(v) => onChange(c.con("unidadTimeout", v))}
                disabled={readonly}
              >
                <SelectTrigger className={`${selectClass} flex-1`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minutos">Minutos</SelectItem>
                  <SelectItem value="horas">Horas</SelectItem>
                  <SelectItem value="dias">Dias</SelectItem>
                </SelectContent>
              </Select>
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
            <Select
              value={String(c.valores.evento ?? "")}
              onValueChange={(v) => onChange(c.con("evento", v))}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue placeholder="Seleccionar evento" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="etiqueta_asignada">Etiqueta asignada</SelectItem>
                <SelectItem value="etapa_cambiada">Etapa cambiada</SelectItem>
                <SelectItem value="vendedor_asignado">Vendedor asignado</SelectItem>
                <SelectItem value="comprobante_subido">Comprobante subido</SelectItem>
              </SelectContent>
            </Select>
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
              <Select
                value={String(c.valores.unidadTimeoutMax)}
                onValueChange={(v) => onChange(c.con("unidadTimeoutMax", v))}
                disabled={readonly}
              >
                <SelectTrigger className={`${selectClass} flex-1`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="horas">Horas</SelectItem>
                  <SelectItem value="dias">Dias</SelectItem>
                </SelectContent>
              </Select>
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
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Ir al nodo</span>
            <Input
              className={inputClass}
              value={String(c.valores.nodoDestino ?? "")}
              onChange={(e) => onChange(c.con("nodoDestino", e.target.value))}
              placeholder="ID del nodo destino"
              disabled={readonly}
            />
          </label>

          <div className="text-ink-faint text-[10px]">
            Conecta visualmente este nodo al destino en el canvas para seleccionarlo.
          </div>
        </div>
      );
    }

    case "logica_detener": {
      const c = editorDeConfig("logica_detener", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Resultado</span>
            <Select
              value={String(c.valores.resultado)}
              onValueChange={(v) => onChange(c.con("resultado", v))}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="exito">Exito</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="cancelado">Cancelado</SelectItem>
              </SelectContent>
            </Select>
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
            <Select
              value={String(c.valores.accion)}
              onValueChange={(v) => onChange(c.con("accion", v))}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="continuar">Continuar</SelectItem>
                <SelectItem value="reintentar">Reintentar</SelectItem>
                <SelectItem value="detener">Detener workflow</SelectItem>
                <SelectItem value="notificar">Notificar y continuar</SelectItem>
              </SelectContent>
            </Select>
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
