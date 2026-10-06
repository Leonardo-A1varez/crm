"use client";

import { useState, useTransition } from "react";
import { SelectOpciones, type OpcionSelect } from "@/components/shared/SelectOpciones";
import { EMPRESAS_ERP } from "@/lib/catalogo/precios-erp";

export type AsignarEmpresaDeUsuario = (input: {
  usuarioId: string;
  empresaErp: string;
}) => Promise<{ ok: true } | { ok: false; error: string }>;

/** `<select>` no admite el valor vacío como opción: "sin empresa" viaja con este. */
const SIN_EMPRESA = "sin-empresa";

const OPCIONES: readonly OpcionSelect[] = [
  { value: SIN_EMPRESA, label: "Sin empresa" },
  ...EMPRESAS_ERP.map((e) => ({ value: String(e.codigo), label: e.nombre })),
];

function nombreDe(empresaErp: number | null): string {
  return EMPRESAS_ERP.find((e) => e.codigo === empresaErp)?.nombre ?? "Sin empresa";
}

/**
 * La empresa del ERP de un usuario: de ella depende qué columna de precio ve
 * resaltada en /productos. Un admin la cambia en el lugar; sin `asignar` es solo
 * lectura (la página no le pasa la acción a un vendedor, y la RLS de `usuarios`
 * igual rechazaría su escritura).
 */
export function EmpresaErpDelUsuario({
  usuarioId,
  nombre,
  empresaErp,
  asignar,
}: {
  usuarioId: string;
  nombre: string;
  empresaErp: number | null;
  asignar: AsignarEmpresaDeUsuario | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  if (asignar === null) {
    return (
      <span className="text-ink-faint w-[150px] shrink-0 truncate text-[11px]">
        {nombreDe(empresaErp)}
      </span>
    );
  }

  function cambiar(valor: string) {
    setError(null);
    iniciar(async () => {
      const r = await asignar?.({
        usuarioId,
        empresaErp: valor === SIN_EMPRESA ? "" : valor,
      });
      if (r && !r.ok) setError(r.error);
    });
  }

  return (
    <span className="flex w-[150px] shrink-0 flex-col gap-1">
      <SelectOpciones
        opciones={OPCIONES}
        value={empresaErp === null ? SIN_EMPRESA : String(empresaErp)}
        onValueChange={cambiar}
        disabled={pendiente}
        size="sm"
        aria-label={`Empresa del ERP de ${nombre}`}
      />
      {error !== null ? (
        <span role="alert" className="text-danger text-[10.5px] leading-snug">
          {error}
        </span>
      ) : null}
    </span>
  );
}
