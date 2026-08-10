"use client";

import { BorrarTagDialog } from "./BorrarTagDialog";
import { TagFormDialog } from "./TagFormDialog";
import type { TagFormValues } from "./TagFormDialog";
import type { ActionResult } from "@/types/inbox";
import type { BorrarTagResult, TagListItem } from "@/types/tags";

export function TagRowActions({
  tag,
  onEditar,
  onBorrar,
}: {
  tag: TagListItem;
  onEditar: (input: TagFormValues & { id: string }) => Promise<ActionResult>;
  onBorrar: (input: { id: string }) => Promise<BorrarTagResult>;
}) {
  return (
    <div className="flex items-center justify-end gap-1.5">
      <TagFormDialog
        title={`Editar «${tag.nombre}»`}
        description="El nombre nuevo tiene que seguir siendo único."
        triggerLabel="Editar"
        triggerVariant="outline"
        initial={tag}
        onSubmit={(values) => onEditar({ ...values, id: tag.id })}
      />
      <BorrarTagDialog tag={tag} onBorrar={() => onBorrar({ id: tag.id })} />
    </div>
  );
}
