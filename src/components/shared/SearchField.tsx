import Form from "next/form";
import { SearchIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * Buscador de una pantalla de lista. Es un GET con `next/form`, no un filtro
 * en cliente: el término vive en la URL y la búsqueda sobrevive al refresh y
 * al compartir el link. Misma caja que el buscador de la SideNav.
 *
 * Dibuja solo el control: dónde va —dentro del header o en una barra propia—
 * y cuánto mide lo decide quien lo usa, vía `className`.
 */
export function SearchField({
  action,
  defaultValue,
  placeholder,
  label,
  className,
  conservar,
}: {
  action: string;
  defaultValue?: string;
  placeholder: string;
  label: string;
  className?: string;
  /**
   * Params que el submit tiene que arrastrar. Un GET manda solo sus campos, así
   * que sin esto buscar apagaría los filtros que la pantalla tenga puestos.
   */
  conservar?: Record<string, string>;
}) {
  return (
    <Form action={action} className={cn("min-w-0", className)}>
      {Object.entries(conservar ?? {}).map(([clave, valor]) => (
        <input key={clave} type="hidden" name={clave} value={valor} />
      ))}
      <div className="bg-surface-elevated border-line-card flex items-center gap-2 rounded-[9px] border px-2.5 py-[7px]">
        <SearchIcon className="text-ink-ghost shrink-0" size={15} />
        <input
          type="search"
          name="q"
          defaultValue={defaultValue ?? ""}
          placeholder={placeholder}
          aria-label={label}
          className="text-ink-body placeholder:text-ink-faint min-w-0 flex-1 bg-transparent text-[12px] outline-none"
        />
      </div>
    </Form>
  );
}
