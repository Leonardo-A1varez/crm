"use client";

import { useId, useState } from "react";
import { type ColumnaLista } from "@/lib/catalogo/columnas-productos";
import {
  errorDeRango,
  numeroCanonico,
  numeroEditable,
  type ConStockUrl,
  type EstadoUrl,
} from "@/lib/ui/filtros-productos";
import { Segmentado } from "./Segmentado";
import { useFiltrosProductos } from "./FiltrosProductosProvider";
import { ListaFiltro } from "./ListaFiltro";
import { useListaFiltro } from "./use-lista-filtro";
import type { KeyboardEvent } from "react";

const INPUT =
  "text-ink-body border-line-input bg-surface-input placeholder:text-ink-faint focus-visible:ring-brand/60 aria-invalid:border-danger w-full rounded-[7px] border px-2.5 py-[6px] text-[12px] outline-none focus-visible:ring-2";

interface CuerpoProps {
  cerrar: () => void;
}

function QuitarFiltro({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-ink-secondary hover:bg-surface-hover focus-visible:ring-brand/60 -mx-1 flex min-h-[26px] items-center gap-2 rounded-[6px] px-1 text-left text-[12px] font-[550] outline-none focus-visible:ring-2"
    >
      <span aria-hidden className="w-[18px] text-center font-mono text-[14px] leading-none">
        ×
      </span>
      Quitar filtro
    </button>
  );
}

// ---------------------------------------------------------------------------
// Lista de valores (código, cód. fábrica, otros códigos, categoría, descripción, marca)
// ---------------------------------------------------------------------------

export function CuerpoLista({ columna }: { columna: ColumnaLista }) {
  const lista = useListaFiltro(columna);
  return (
    <div className="flex min-h-0 flex-col gap-2 p-2">
      <ListaFiltro lista={lista} columna={columna} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Precio y stock (rangos)
// ---------------------------------------------------------------------------

function CampoRango({
  min,
  max,
  onMin,
  onMax,
  onConfirmar,
  entero,
  error,
  idError,
  deshabilitado,
}: {
  min: string;
  max: string;
  onMin: (v: string) => void;
  onMax: (v: string) => void;
  /** Enter o salir del campo: es cuando el rango se aplica. */
  onConfirmar: () => void;
  entero: boolean;
  error: string | null;
  idError: string;
  deshabilitado?: boolean;
}) {
  const idMin = useId();
  const idMax = useId();
  const propios = {
    // Texto y no `number`: el campo numérico del navegador no deja escribir la coma
    // decimal ni el punto de miles, que es como se escribe un precio en español.
    type: "text",
    inputMode: entero ? ("numeric" as const) : ("decimal" as const),
    disabled: deshabilitado,
    "aria-invalid": error !== null,
    "aria-describedby": error !== null ? idError : undefined,
    autoComplete: "off",
    placeholder: "Sin límite",
    onBlur: onConfirmar,
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onConfirmar();
      }
    },
    className: `${INPUT} font-mono tabular-nums disabled:opacity-45`,
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={idMin} className="text-ink-faint text-[11px] font-[550]">
            Mínimo
          </label>
          <input id={idMin} value={min} onChange={(e) => onMin(e.target.value)} {...propios} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={idMax} className="text-ink-faint text-[11px] font-[550]">
            Máximo
          </label>
          <input id={idMax} value={max} onChange={(e) => onMax(e.target.value)} {...propios} />
        </div>
      </div>
      <p
        id={idError}
        role={error !== null ? "alert" : undefined}
        className="text-danger min-h-0 text-[11px] leading-snug"
      >
        {error}
      </p>
      <p className="text-ink-faint text-[11px] leading-snug">
        Se aplica al apretar Enter o al salir del campo.
      </p>
    </div>
  );
}

export function CuerpoPrecio(_props: CuerpoProps) {
  const { filtros, aplicar, limpiar } = useFiltrosProductos();
  const [min, setMin] = useState(numeroEditable(filtros.precioMin));
  const [max, setMax] = useState(numeroEditable(filtros.precioMax));
  const idError = useId();
  const error = errorDeRango(min, max, { entero: false, nombre: "precio" });
  const hayFiltro = filtros.precioMin !== "" || filtros.precioMax !== "";

  function confirmar() {
    if (error !== null) return;
    const a = numeroCanonico(min) ?? "";
    const b = numeroCanonico(max) ?? "";
    if (a === filtros.precioMin && b === filtros.precioMax) return;
    aplicar(["precio"], { precioMin: a, precioMax: b });
  }

  return (
    <div className="flex flex-col gap-2 p-2">
      {hayFiltro ? (
        <QuitarFiltro
          onClick={() => {
            setMin("");
            setMax("");
            limpiar(["precio"]);
          }}
        />
      ) : null}
      <CampoRango
        min={min}
        max={max}
        onMin={setMin}
        onMax={setMax}
        onConfirmar={confirmar}
        entero={false}
        error={error}
        idError={idError}
      />
    </div>
  );
}

const CON_STOCK: readonly { valor: "todos" | "con" | "sin"; texto: string }[] = [
  { valor: "todos", texto: "Todos" },
  { valor: "con", texto: "Con stock" },
  { valor: "sin", texto: "Sin stock" },
];

type OpcionStock = "todos" | "con" | "sin";

function conStockAOpcion(v: ConStockUrl): OpcionStock {
  return v === "1" ? "con" : v === "0" ? "sin" : "todos";
}

export function CuerpoStock(_props: CuerpoProps) {
  const { filtros, aplicar, limpiar } = useFiltrosProductos();
  const [min, setMin] = useState(numeroEditable(filtros.stockMin));
  const [max, setMax] = useState(numeroEditable(filtros.stockMax));
  const [existencia, setExistencia] = useState(conStockAOpcion(filtros.conStock));
  const idError = useId();
  // "Sin stock" ya fija el stock en 0: un rango encima es contradictorio.
  const rangoAplica = existencia !== "sin";
  const error = rangoAplica ? errorDeRango(min, max, { entero: true, nombre: "stock" }) : null;
  const hayFiltro = filtros.stockMin !== "" || filtros.stockMax !== "" || filtros.conStock !== null;

  /** Escribe en la URL lo que dice el borrador; con un rango inválido no toca nada. */
  function escribir(opcion: OpcionStock) {
    const rango = opcion !== "sin";
    if (rango && errorDeRango(min, max, { entero: true, nombre: "stock" }) !== null) return;
    aplicar(["stock"], {
      stockMin: rango ? (numeroCanonico(min) ?? "") : undefined,
      stockMax: rango ? (numeroCanonico(max) ?? "") : undefined,
      conStock: opcion === "con" ? "1" : opcion === "sin" ? "0" : undefined,
    });
  }

  function confirmar() {
    if (error !== null) return;
    if (
      (numeroCanonico(min) ?? "") === filtros.stockMin &&
      (numeroCanonico(max) ?? "") === filtros.stockMax
    ) {
      return;
    }
    escribir(existencia);
  }

  return (
    <div className="flex flex-col gap-2 p-2">
      {hayFiltro ? (
        <QuitarFiltro
          onClick={() => {
            setMin("");
            setMax("");
            setExistencia("todos");
            limpiar(["stock"]);
          }}
        />
      ) : null}
      <Segmentado
        leyenda="Existencia"
        opciones={CON_STOCK}
        valor={existencia}
        onCambiar={(v) => {
          setExistencia(v);
          escribir(v);
        }}
      />
      <CampoRango
        min={min}
        max={max}
        onMin={setMin}
        onMax={setMax}
        onConfirmar={confirmar}
        entero
        error={error}
        idError={idError}
        deshabilitado={!rangoAplica}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

type OpcionEstado = "todos" | NonNullable<EstadoUrl>;

const ESTADOS: readonly { valor: OpcionEstado; texto: string }[] = [
  { valor: "todos", texto: "Todos" },
  { valor: "activo", texto: "Activo" },
  { valor: "inactivo", texto: "Inactivo" },
];

export function CuerpoEstado({ cerrar }: CuerpoProps) {
  const { filtros, aplicar } = useFiltrosProductos();
  const [estado, setEstado] = useState<OpcionEstado>(filtros.estado ?? "todos");

  return (
    <div className="flex flex-col gap-2 p-2">
      <Segmentado
        leyenda="Estado del producto"
        opciones={ESTADOS}
        valor={estado}
        onCambiar={(v) => {
          setEstado(v);
          aplicar(["estado"], { estado: v === "todos" ? undefined : v });
          cerrar();
        }}
      />
    </div>
  );
}
