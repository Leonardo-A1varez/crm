"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sell } from "@/components/icons";
import { ColorPicker } from "@/components/tags/ColorPicker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { plegar } from "@/lib/ui/busqueda-hilo";
import type { TagFormValues } from "@/components/tags/TagFormDialog";
import type { ActionResult } from "@/types/inbox";
import type { BorrarTagResult, TagListItem } from "@/types/tags";

/**
 * Administrar etiquetas sin salir de Leads.
 *
 * Antes esto era la pantalla `/tags`, que se comía una de las siete entradas de
 * la barra lateral para crear, editar y borrar. Nadie entra al CRM a "hacer
 * etiquetas": se administran mientras se las usa, y donde se las usa es
 * filtrando leads. Por eso el botón vive al lado del buscador.
 *
 * La edición es en línea y no en un diálogo aparte: anidar un `Dialog` adentro
 * de otro pelea por el foco con Radix, y además obligaría a cerrar y reabrir
 * para tocar dos etiquetas seguidas, que es exactamente lo que se viene a hacer.
 */
export function EtiquetasDialog({
  etiquetas,
  isAdmin,
  onCrear,
  onEditar,
  onBorrar,
}: {
  etiquetas: TagListItem[];
  isAdmin: boolean;
  onCrear: (values: TagFormValues) => Promise<ActionResult>;
  onEditar: (input: TagFormValues & { id: string }) => Promise<ActionResult>;
  onBorrar: (input: { id: string }) => Promise<BorrarTagResult>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [consulta, setConsulta] = useState("");
  const [creando, setCreando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);

  // Mismo plegado que el resto de las búsquedas del panel: quien escribe
  // "vip" tiene que encontrar "VIP", y quien escribe "mecanico" un "Mecánico".
  const visibles = useMemo(() => {
    const q = plegar(consulta.trim());
    if (q === "") return etiquetas;
    return etiquetas.filter((t) => plegar(t.nombre).includes(q));
  }, [etiquetas, consulta]);

  function cerrarFormularios(): void {
    setCreando(false);
    setEditandoId(null);
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => {
        setAbierto(v);
        if (!v) {
          cerrarFormularios();
          setConsulta("");
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" className="gap-1.5" />}>
        <Sell size={14} strokeWidth={1.8} />
        Etiquetas
      </DialogTrigger>
      <DialogContent className="flex max-h-[min(680px,85vh)] flex-col gap-0 p-0 sm:max-w-[620px]">
        <DialogHeader className="border-line-soft border-b px-5 pt-5 pb-4">
          <DialogTitle>Etiquetas</DialogTitle>
          <DialogDescription>
            {etiquetas.length === 1 ? "1 etiqueta" : `${etiquetas.length} etiquetas`}
            {isAdmin
              ? " · se cuelgan a un lead desde la conversación"
              : " · las administra un administrador"}
          </DialogDescription>
        </DialogHeader>

        <div className="border-line-soft flex items-center gap-2 border-b px-5 py-3">
          <Input
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            placeholder="Buscar etiqueta…"
            aria-label="Buscar etiqueta"
            className="h-8 flex-1"
          />
          {isAdmin ? (
            <Button
              size="sm"
              variant={creando ? "secondary" : "default"}
              onClick={() => {
                setEditandoId(null);
                setCreando((v) => !v);
              }}
            >
              {creando ? "Cancelar" : "Nueva"}
            </Button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {creando ? (
            <FormularioEtiqueta
              onGuardar={onCrear}
              onListo={() => setCreando(false)}
              textoBoton="Crear"
            />
          ) : null}

          {visibles.length === 0 ? (
            <p className="text-ink-faint px-5 py-8 text-center text-[12.5px]">
              {etiquetas.length === 0
                ? "Todavía no hay etiquetas."
                : `Ninguna etiqueta coincide con «${consulta.trim()}».`}
            </p>
          ) : (
            <ul>
              {visibles.map((t) =>
                editandoId === t.id ? (
                  <li key={t.id}>
                    <FormularioEtiqueta
                      inicial={t}
                      onGuardar={(values) => onEditar({ ...values, id: t.id })}
                      onListo={() => setEditandoId(null)}
                      textoBoton="Guardar"
                    />
                  </li>
                ) : (
                  <Fila
                    key={t.id}
                    etiqueta={t}
                    isAdmin={isAdmin}
                    onEditar={() => {
                      setCreando(false);
                      setEditandoId(t.id);
                    }}
                    onBorrar={onBorrar}
                    onIrALeads={() => setAbierto(false)}
                  />
                ),
              )}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Fila({
  etiqueta,
  isAdmin,
  onEditar,
  onBorrar,
  onIrALeads,
}: {
  etiqueta: TagListItem;
  isAdmin: boolean;
  onEditar: () => void;
  onBorrar: (input: { id: string }) => Promise<BorrarTagResult>;
  onIrALeads: () => void;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [pendiente, iniciar] = useTransition();

  function borrar(): void {
    iniciar(async () => {
      const r = await onBorrar({ id: etiqueta.id });
      if (!r.ok) {
        toast.error(r.error);
        setConfirmando(false);
        return;
      }
      toast.success(
        r.leadsAfectados === 0
          ? `Se borró «${r.nombre}».`
          : `Se borró «${r.nombre}» y se sacó de ${r.leadsAfectados} lead${r.leadsAfectados === 1 ? "" : "s"}.`,
      );
      router.refresh();
    });
  }

  return (
    <li className="border-line-soft hover:bg-surface-raised flex items-center gap-3 border-b px-5 py-2.5 last:border-b-0">
      <span
        aria-hidden
        className="size-3 shrink-0 rounded-full border"
        style={{ backgroundColor: etiqueta.color, borderColor: etiqueta.color }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-ink-primary truncate text-[12.5px] font-[620]">{etiqueta.nombre}</p>
        {etiqueta.descripcion === null || etiqueta.descripcion === "" ? null : (
          <p className="text-ink-faint truncate text-[11px]">{etiqueta.descripcion}</p>
        )}
      </div>

      {/* La pregunta que uno se hace mirando el contador es "¿quiénes son?", y
          hasta acá no tenía respuesta. Cierra el modal y deja Leads filtrado
          con el `etiqueta` que el filtro ya entendía. */}
      {etiqueta.leadsUsando === 0 ? (
        <span className="text-ink-ghost shrink-0 text-[11px]">sin uso</span>
      ) : (
        <button
          type="button"
          onClick={() => {
            onIrALeads();
            router.push(`/leads?etiqueta=${etiqueta.id}`);
          }}
          className="text-ink-dim hover:text-ink-primary shrink-0 text-[11px] underline-offset-2 hover:underline"
        >
          {etiqueta.leadsUsando} lead{etiqueta.leadsUsando === 1 ? "" : "s"}
        </button>
      )}

      {isAdmin ? (
        confirmando ? (
          <span className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant="destructive" onClick={borrar} disabled={pendiente}>
              {pendiente ? "Borrando…" : "Borrar"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmando(false)}
              disabled={pendiente}
            >
              No
            </Button>
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="ghost" onClick={onEditar}>
              Editar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmando(true)}>
              Borrar
            </Button>
          </span>
        )
      ) : null}
    </li>
  );
}

/** Alta y edición comparten formulario: los campos y las reglas son los mismos. */
function FormularioEtiqueta({
  inicial,
  onGuardar,
  onListo,
  textoBoton,
}: {
  inicial?: TagListItem;
  onGuardar: (values: TagFormValues) => Promise<ActionResult>;
  onListo: () => void;
  textoBoton: string;
}) {
  const router = useRouter();
  const [nombre, setNombre] = useState(inicial?.nombre ?? "");
  const [color, setColor] = useState(inicial?.color ?? "#888888");
  const [descripcion, setDescripcion] = useState(inicial?.descripcion ?? "");
  const [pendiente, iniciar] = useTransition();

  function guardar(): void {
    iniciar(async () => {
      const r = await onGuardar({
        nombre: nombre.trim(),
        color,
        descripcion: descripcion.trim() === "" ? null : descripcion.trim(),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(inicial ? "Etiqueta actualizada." : "Etiqueta creada.");
      onListo();
      router.refresh();
    });
  }

  return (
    <div className="border-line-soft bg-surface-raised space-y-2.5 border-b px-5 py-3.5">
      <div className="flex items-center gap-2">
        <Input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre"
          aria-label="Nombre de la etiqueta"
          autoFocus
          className="h-8 flex-1"
        />
        <Button size="sm" onClick={guardar} disabled={pendiente || nombre.trim() === ""}>
          {pendiente ? "Guardando…" : textoBoton}
        </Button>
        <Button size="sm" variant="ghost" onClick={onListo} disabled={pendiente}>
          Cancelar
        </Button>
      </div>
      <Input
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
        placeholder="Descripción (opcional)"
        aria-label="Descripción de la etiqueta"
        className="h-8"
      />
      <ColorPicker
        name="color"
        defaultValue={color}
        onValueChange={setColor}
        disabled={pendiente}
      />
    </div>
  );
}
