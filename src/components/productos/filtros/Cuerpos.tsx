"use client";

import { useId, useState } from "react";
import { avisoDeLista, errorDeRango, valoresDeLista } from "@/lib/ui/filtros-productos";
import { TEXTO_MAX } from "@/lib/validation/productos-filtros.schema";
import { PanelFiltro, Segmentado } from "./FiltroColumna";
import { useFiltrosProductos } from "./FiltrosProductosProvider";
import { ListaFiltro } from "./ListaFiltro";
import { useListaFiltro } from "./use-lista-filtro";
import type { ConStockUrl, EstadoUrl, GrupoFiltro, ModoTextoUrl } from "@/lib/ui/filtros-productos";
import type { ReactNode } from "react";

const INPUT =
  "text-ink-body border-line-input bg-surface-input placeholder:text-ink-faint focus-visible:ring-brand/60 aria-invalid:border-danger w-full rounded-[7px] border px-2.5 py-[6px] text-[12px] outline-none focus-visible:ring-2";

const MODOS: readonly { valor: ModoTextoUrl; texto: string }[] = [
  { valor: "contiene", texto: "Contiene" },
  { valor: "empieza", texto: "Empieza con" },
];

/** Texto libre con el modo "contiene" / "empieza con". */
function CampoTexto({
  etiqueta,
  placeholder,
  texto,
  onTexto,
  modo,
  onModo,
  autoFocus,
}: {
  etiqueta: string;
  placeholder: string;
  texto: string;
  onTexto: (v: string) => void;
  modo: ModoTextoUrl;
  onModo: (m: ModoTextoUrl) => void;
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="sr-only">
        {etiqueta}
      </label>
      <input
        id={id}
        type="text"
        value={texto}
        maxLength={TEXTO_MAX}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onTexto(e.target.value)}
        className={INPUT}
      />
      <Segmentado
        leyenda={`Cómo coincide el texto de ${etiqueta}`}
        opciones={MODOS}
        valor={modo}
        onCambiar={onModo}
      />
    </div>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="flex min-h-0 flex-col gap-2">
      <h3 className="text-ink-faint text-[11px] font-[600]">{titulo}</h3>
      {children}
    </section>
  );
}

interface CuerpoProps {
  cerrar: () => void;
}

// ---------------------------------------------------------------------------
// Código
// ---------------------------------------------------------------------------

export function CuerpoCodigo({ cerrar }: CuerpoProps) {
  const { filtros, aplicar, limpiar } = useFiltrosProductos();
  const [texto, setTexto] = useState(filtros.codigo);
  const [modo, setModo] = useState(filtros.codigoModo);

  return (
    <PanelFiltro
      titulo="Filtrar por código"
      hayFiltro={filtros.codigo !== ""}
      aviso={null}
      onAplicar={() => {
        const t = texto.trim();
        aplicar(["codigo"], {
          codigo: t,
          codigoModo: t !== "" && modo === "empieza" ? modo : undefined,
        });
        cerrar();
      }}
      onLimpiar={() => {
        limpiar(["codigo"]);
        cerrar();
      }}
    >
      <CampoTexto
        etiqueta="Código"
        placeholder="Parte del código"
        texto={texto}
        onTexto={setTexto}
        modo={modo}
        onModo={setModo}
        autoFocus
      />
    </PanelFiltro>
  );
}

// ---------------------------------------------------------------------------
// Descripción (texto) + Marca (lista)
// ---------------------------------------------------------------------------

export function CuerpoDescripcion({ cerrar }: CuerpoProps) {
  const { filtros, aplicar, limpiar } = useFiltrosProductos();
  const [texto, setTexto] = useState(filtros.descripcion);
  const [modo, setModo] = useState(filtros.descripcionModo);
  const marcas = useListaFiltro("marca", filtros.marcas, filtros.sinMarcas, texto.trim() !== "");
  const valoresMarca = valoresDeLista(marcas.resolucion, "marcas", "sinMarcas");
  const grupos: GrupoFiltro[] = ["descripcion", "marca"];

  return (
    <PanelFiltro
      titulo="Filtrar por descripción y marca"
      hayFiltro={filtros.descripcion !== "" || filtros.marcas.length + filtros.sinMarcas.length > 0}
      aviso={avisoDeLista(marcas.resolucion, "marca")}
      onAplicar={() => {
        const t = texto.trim();
        aplicar(grupos, {
          descripcion: t,
          descripcionModo: t !== "" && modo === "empieza" ? modo : undefined,
          ...(valoresMarca ?? {}),
        });
        cerrar();
      }}
      onLimpiar={() => {
        limpiar(grupos);
        cerrar();
      }}
    >
      <Seccion titulo="Descripción">
        <CampoTexto
          etiqueta="Descripción"
          placeholder="Parte de la descripción"
          texto={texto}
          onTexto={setTexto}
          modo={modo}
          onModo={setModo}
          autoFocus
        />
      </Seccion>
      <div className="border-line-layout border-t" />
      <Seccion titulo="Marca">
        <ListaFiltro lista={marcas} nombre="Marca" plural="marcas" />
      </Seccion>
    </PanelFiltro>
  );
}

// ---------------------------------------------------------------------------
// Categoría (lista)
// ---------------------------------------------------------------------------

export function CuerpoCategoria({ cerrar }: CuerpoProps) {
  const { filtros, aplicar, limpiar } = useFiltrosProductos();
  const categorias = useListaFiltro("categoria", filtros.categorias, filtros.sinCategorias);
  const valores = valoresDeLista(categorias.resolucion, "categorias", "sinCategorias");

  return (
    <PanelFiltro
      titulo="Filtrar por categoría"
      hayFiltro={filtros.categorias.length + filtros.sinCategorias.length > 0}
      aviso={avisoDeLista(categorias.resolucion, "categoría")}
      onAplicar={() => {
        aplicar(["categoria"], valores ?? {});
        cerrar();
      }}
      onLimpiar={() => {
        limpiar(["categoria"]);
        cerrar();
      }}
    >
      <ListaFiltro lista={categorias} nombre="Categoría" plural="categorías" />
    </PanelFiltro>
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
  entero,
  error,
  idError,
  deshabilitado,
}: {
  min: string;
  max: string;
  onMin: (v: string) => void;
  onMax: (v: string) => void;
  entero: boolean;
  error: string | null;
  idError: string;
  deshabilitado?: boolean;
}) {
  const idMin = useId();
  const idMax = useId();
  const propios = {
    type: "number",
    min: 0,
    step: entero ? 1 : "any",
    inputMode: entero ? ("numeric" as const) : ("decimal" as const),
    disabled: deshabilitado,
    "aria-invalid": error !== null,
    "aria-describedby": error !== null ? idError : undefined,
    placeholder: "Sin límite",
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
    </div>
  );
}

export function CuerpoPrecio({ cerrar }: CuerpoProps) {
  const { filtros, aplicar, limpiar } = useFiltrosProductos();
  const [min, setMin] = useState(filtros.precioMin);
  const [max, setMax] = useState(filtros.precioMax);
  const idError = useId();
  const error = errorDeRango(min, max, { entero: false, nombre: "precio" });

  return (
    <PanelFiltro
      titulo="Filtrar por precio"
      hayFiltro={filtros.precioMin !== "" || filtros.precioMax !== ""}
      aviso={error}
      avisoEnCampo={idError}
      onAplicar={() => {
        aplicar(["precio"], { precioMin: min.trim(), precioMax: max.trim() });
        cerrar();
      }}
      onLimpiar={() => {
        limpiar(["precio"]);
        cerrar();
      }}
    >
      <CampoRango
        min={min}
        max={max}
        onMin={setMin}
        onMax={setMax}
        entero={false}
        error={error}
        idError={idError}
      />
    </PanelFiltro>
  );
}

const CON_STOCK: readonly { valor: "todos" | "con" | "sin"; texto: string }[] = [
  { valor: "todos", texto: "Todos" },
  { valor: "con", texto: "Con stock" },
  { valor: "sin", texto: "Sin stock" },
];

function conStockAOpcion(v: ConStockUrl): "todos" | "con" | "sin" {
  return v === "1" ? "con" : v === "0" ? "sin" : "todos";
}

export function CuerpoStock({ cerrar }: CuerpoProps) {
  const { filtros, aplicar, limpiar } = useFiltrosProductos();
  const [min, setMin] = useState(filtros.stockMin);
  const [max, setMax] = useState(filtros.stockMax);
  const [existencia, setExistencia] = useState(conStockAOpcion(filtros.conStock));
  const idError = useId();
  // "Sin stock" ya fija el stock en 0: un rango encima es contradictorio.
  const rangoAplica = existencia !== "sin";
  const error = rangoAplica ? errorDeRango(min, max, { entero: true, nombre: "stock" }) : null;

  return (
    <PanelFiltro
      titulo="Filtrar por stock"
      hayFiltro={filtros.stockMin !== "" || filtros.stockMax !== "" || filtros.conStock !== null}
      aviso={error}
      avisoEnCampo={idError}
      onAplicar={() => {
        aplicar(["stock"], {
          stockMin: rangoAplica ? min.trim() : undefined,
          stockMax: rangoAplica ? max.trim() : undefined,
          conStock: existencia === "con" ? "1" : existencia === "sin" ? "0" : undefined,
        });
        cerrar();
      }}
      onLimpiar={() => {
        limpiar(["stock"]);
        cerrar();
      }}
    >
      <Segmentado
        leyenda="Existencia"
        opciones={CON_STOCK}
        valor={existencia}
        onCambiar={setExistencia}
      />
      <CampoRango
        min={min}
        max={max}
        onMin={setMin}
        onMax={setMax}
        entero
        error={error}
        idError={idError}
        deshabilitado={!rangoAplica}
      />
    </PanelFiltro>
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
  const { filtros, aplicar, limpiar } = useFiltrosProductos();
  const [estado, setEstado] = useState<OpcionEstado>(filtros.estado ?? "todos");

  return (
    <PanelFiltro
      titulo="Filtrar por estado"
      hayFiltro={filtros.estado !== null}
      aviso={null}
      onAplicar={() => {
        aplicar(["estado"], { estado: estado === "todos" ? undefined : estado });
        cerrar();
      }}
      onLimpiar={() => {
        limpiar(["estado"]);
        cerrar();
      }}
    >
      <Segmentado
        leyenda="Estado del producto"
        opciones={ESTADOS}
        valor={estado}
        onCambiar={setEstado}
      />
    </PanelFiltro>
  );
}
