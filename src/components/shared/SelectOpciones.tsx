"use client";

import { useMemo, type ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Una opción de `<SelectOpciones>`. El `label` es lo que se lee en la lista Y
 * en el disparador: es el mismo dato, así que no puede divergir.
 */
export interface OpcionSelect<V extends string = string> {
  value: V;
  label: string;
  /** Encabezado de sección. Ver `agruparOpciones`. */
  grupo?: string;
  /** Va antes del texto, sólo en la lista (p. ej. el punto de color de una etiqueta). */
  adorno?: ReactNode;
  /** Va después del texto, sólo en la lista (p. ej. un id o un "sin dato"). */
  detalle?: ReactNode;
  disabled?: boolean;
}

export interface SelectOpcionesProps<V extends string = string> {
  opciones: readonly OpcionSelect<V>[];
  /** Un valor que no está en `opciones` se trata como "sin elegir". */
  value: V | string | null | undefined;
  onValueChange: (valor: V) => void;
  placeholder?: string;
  /** Texto de la fila deshabilitada que se muestra cuando no hay opciones. */
  sinOpciones?: string;
  disabled?: boolean;
  size?: "sm" | "default";
  /** Clases del disparador. */
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}

/** Valor de la fila "no hay opciones": nunca coincide con uno real porque está deshabilitada. */
const VALOR_SIN_OPCIONES = "__sin_opciones__";

/**
 * Select de una sola elección que deriva el texto visible de sus opciones.
 *
 * Por qué existe: el `Select` de Base UI pinta en el disparador el valor CRUDO
 * (`inferir`, `lead.canal`, un uuid) salvo que el `Root` reciba `items` con la
 * etiqueta de cada valor. Esa prop es fácil de olvidar y el olvido no rompe
 * nada visible en los tests ni en el tipado; pasó en el inspector con el canal
 * de envío. Acá `items` se arma de las mismas `opciones` que dibujan la lista,
 * así que no hay forma de pasar una sin la otra.
 *
 * Además, un valor que no está entre las opciones (una etiqueta borrada, un
 * `String(undefined)`) muestra el placeholder en lugar del valor crudo.
 *
 * `src/components/ui/select.tsx` no se toca (AGENTS.md §4): esto lo compone.
 * Fuera de este archivo nadie importa `@/components/ui/select`; lo vigila
 * `tests/components/select-opciones.test.tsx`.
 */
export function SelectOpciones<V extends string = string>({
  opciones,
  value,
  onValueChange,
  placeholder = "Elegí una opción",
  sinOpciones = "No hay opciones",
  disabled,
  size,
  className,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
}: SelectOpcionesProps<V>) {
  const items = useMemo(
    () => opciones.map((o) => ({ value: o.value, label: o.label })),
    [opciones],
  );
  const conocido = value != null && value !== "" && opciones.some((o) => o.value === value);
  const grupos = agruparOpciones(opciones);

  return (
    <Select
      items={items}
      value={conocido ? (value as V) : null}
      onValueChange={(v) => {
        if (typeof v === "string" && v !== VALOR_SIN_OPCIONES) onValueChange(v as V);
      }}
      disabled={disabled}
    >
      <SelectTrigger
        size={size}
        id={id}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        className={className}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {opciones.length === 0 ? (
          <SelectItem value={VALOR_SIN_OPCIONES} disabled>
            {sinOpciones}
          </SelectItem>
        ) : grupos === null ? (
          opciones.map((o) => <FilaOpcion key={o.value} opcion={o} />)
        ) : (
          grupos.map(([nombre, lista]) => (
            <SelectGroup key={nombre || "sin-grupo"}>
              {nombre ? <SelectLabel>{nombre}</SelectLabel> : null}
              {lista.map((o) => (
                <FilaOpcion key={o.value} opcion={o} />
              ))}
            </SelectGroup>
          ))
        )}
      </SelectContent>
    </Select>
  );
}

function FilaOpcion<V extends string>({ opcion }: { opcion: OpcionSelect<V> }) {
  return (
    <SelectItem value={opcion.value} disabled={opcion.disabled}>
      {opcion.adorno}
      {opcion.detalle == null ? (
        opcion.label
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate">{opcion.label}</span>
          {opcion.detalle}
        </>
      )}
    </SelectItem>
  );
}

/**
 * Agrupa por `grupo` respetando el orden de aparición. Devuelve `null` cuando
 * no hace falta agrupar: si ninguna opción declara grupo, un encabezado de una
 * sola sección es ruido.
 */
export function agruparOpciones<V extends string>(
  opciones: readonly OpcionSelect<V>[],
): [string, OpcionSelect<V>[]][] | null {
  const grupos = new Map<string, OpcionSelect<V>[]>();
  for (const o of opciones) {
    const clave = o.grupo ?? "";
    const lista = grupos.get(clave);
    if (lista) lista.push(o);
    else grupos.set(clave, [o]);
  }
  if (grupos.size === 1 && grupos.has("")) return null;
  return [...grupos];
}
