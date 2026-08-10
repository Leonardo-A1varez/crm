import Form from "next/form";
import { SearchIcon } from "@/components/icons";

/**
 * Barra de búsqueda de una pantalla de lista. Es un GET con `next/form`, no un
 * filtro en cliente: el término vive en la URL y la búsqueda sobrevive el
 * refresh y el compartir el link. Misma caja que el buscador de la SideNav.
 */
export function SearchField({
  action,
  defaultValue,
  placeholder,
  label,
}: {
  action: string;
  defaultValue?: string;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="border-line-layout bg-surface-panel shrink-0 border-b px-5 py-2.5">
      <Form action={action}>
        <div className="bg-surface-elevated border-line-card flex max-w-[360px] items-center gap-2 rounded-[9px] border px-2.5 py-[7px]">
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
    </div>
  );
}
