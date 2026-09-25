"use client";

import { useState } from "react";
import { Add, Close } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FOCO, PRESION_TACTIL, TRANSICION_CONTROL } from "@/lib/ui/motion";
import {
  OPERADOR_FRASE,
  OPERADOR_LABEL,
  PROFUNDIDAD_MAX,
  comparadorSinValor,
  comparadoresDe,
  etiquetaComparador,
  grupoVacio,
  operadorOpuesto,
  reglaIncompleta,
  reglaVacia,
  valorPorDefecto,
  type CampoCondicion,
  type Comparador,
  type Grupo,
  type NodoCondicion,
  type OpcionCampo,
  type Operador,
  type Regla,
  type ValorCondicion,
} from "@/lib/ui/condiciones";
import { cn } from "@/lib/utils";

/**
 * Superficie de cada nivel de anidado.
 *
 * El fondo se aclara un escalón por nivel. Es la única señal de profundidad
 * además del borde y el margen, y alcanza justo para tres niveles: un cuarto
 * escalón ya no se distingue del tercero, que es parte de por qué
 * `PROFUNDIDAD_MAX` vale 3.
 */
const SUPERFICIE_NIVEL = ["bg-surface-card", "bg-surface-input", "bg-surface-hover"] as const;

export interface ConstructorCondicionesProps {
  grupo: Grupo;
  campos: readonly CampoCondicion[];
  onCambiar: (grupo: Grupo) => void;
  /** Quita este grupo entero. Ausente en la raíz, que no se puede borrar. */
  onQuitar?: () => void;
  /** Sube los hijos al grupo padre. Ausente si los operadores difieren o si es la raíz. */
  onDesagrupar?: () => void;
  profundidad?: number;
}

/**
 * Una caja de condiciones, con su operador y sus hijos.
 *
 * Es el constructor que comparten el nodo Condición de un workflow y el
 * constructor de audiencia de una difusión. Comparten esto y nada más: el
 * catálogo de campos, el vocabulario de los comparadores y qué se hace con el
 * resultado los pone cada pantalla, porque ahí sí son distintas —el workflow
 * evalúa un lead y bifurca, la difusión evalúa el padrón y devuelve un
 * conjunto—. La gramática de la pregunta, en cambio, es la misma, y tenerla dos
 * veces era enseñar dos idiomas para la misma operación mental.
 *
 * ## Los grupos son cajas, no texto
 *
 * `A Y (B O C)` escrito con paréntesis obliga a leer y a confiar en la
 * precedencia. Dibujado como una caja adentro de otra caja se **ve** y se
 * verifica de un vistazo. La caja es la feature.
 *
 * ## Los chips `Y` son un solo control, y la interfaz lo enseña
 *
 * Entre cada par de filas hay un chip con el operador del grupo. Son varios
 * dibujos del mismo control: tocar cualquiera los cambia todos, porque el
 * operador es del grupo. Para que eso no sea una sorpresa, pasar el mouse por
 * uno los **resalta a todos a la vez**. Se aprende en medio segundo y sin leer
 * ningún cartel, y es lo que hace obvio que `A Y B O C` no se puede escribir.
 */
export function ConstructorCondiciones({
  grupo,
  campos,
  onCambiar,
  onQuitar,
  onDesagrupar,
  profundidad = 0,
}: ConstructorCondicionesProps) {
  // El resaltado vive acá y no en un contexto global: alcanza a los hermanos
  // de ESTE grupo, que son unos pocos. Un estado global de hover repintaría
  // todo el árbol de condiciones en cada movimiento del mouse.
  const [resaltado, setResaltado] = useState(false);
  const esRaiz = profundidad === 0;
  const superficie = SUPERFICIE_NIVEL[Math.min(profundidad, SUPERFICIE_NIVEL.length - 1)];
  const puedeAnidar = profundidad < PROFUNDIDAD_MAX - 1;

  function cambiarHijo(id: string, nuevo: NodoCondicion) {
    onCambiar({ ...grupo, hijos: grupo.hijos.map((h) => (h.id === id ? nuevo : h)) });
  }

  function quitarHijo(id: string) {
    onCambiar({ ...grupo, hijos: grupo.hijos.filter((h) => h.id !== id) });
  }

  return (
    <div
      role="group"
      aria-label={`Grupo en el que ${OPERADOR_FRASE[grupo.operador]}`}
      className={cn(
        "border-line-card flex flex-col gap-2 rounded-lg border p-3",
        superficie,
        TRANSICION_CONTROL,
      )}
    >
      {!esRaiz ? (
        <div className="flex items-center gap-2">
          <span className="border-line-control bg-surface-panel text-ink-secondary rounded px-1.5 py-0.5 font-mono text-[9.5px] leading-tight font-semibold">
            grupo · {OPERADOR_FRASE[grupo.operador]}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {onDesagrupar ? (
              <button
                type="button"
                onClick={onDesagrupar}
                // Sólo aparece cuando el operador del grupo coincide con el del
                // padre. Si difieren, desagrupar cambiaría el significado de la
                // condición — y un botón que a veces cambia el resultado y a
                // veces no es peor que un botón ausente.
                className={cn(
                  "text-ink-ghost hover:text-ink-body h-6 rounded px-1.5 text-[10.5px]",
                  TRANSICION_CONTROL,
                  FOCO,
                )}
              >
                desagrupar
              </button>
            ) : null}
            {onQuitar ? (
              <button
                type="button"
                onClick={onQuitar}
                aria-label="Quitar este grupo y todas sus condiciones"
                className={cn(
                  "text-ink-ghost hover:text-danger grid size-6 place-items-center rounded",
                  TRANSICION_CONTROL,
                  FOCO,
                )}
              >
                <Close size={12} aria-hidden />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {grupo.hijos.map((hijo, i) => (
        <div key={hijo.id} className="flex flex-col gap-2">
          {i > 0 ? (
            <ChipOperador
              operador={grupo.operador}
              resaltado={resaltado}
              onResaltar={setResaltado}
              onCambiar={(operador) => onCambiar({ ...grupo, operador })}
            />
          ) : null}

          {hijo.clase === "regla" ? (
            <FilaCondicion
              regla={hijo}
              indice={i + 1}
              campos={campos}
              onCambiar={(r) => cambiarHijo(hijo.id, r)}
              onQuitar={grupo.hijos.length > 1 ? () => quitarHijo(hijo.id) : undefined}
            />
          ) : (
            <ConstructorCondiciones
              grupo={hijo}
              campos={campos}
              profundidad={profundidad + 1}
              onCambiar={(g) => cambiarHijo(hijo.id, g)}
              onQuitar={() => quitarHijo(hijo.id)}
              onDesagrupar={
                hijo.operador === grupo.operador
                  ? () =>
                      onCambiar({
                        ...grupo,
                        hijos: grupo.hijos.flatMap((h) => (h.id === hijo.id ? hijo.hijos : [h])),
                      })
                  : undefined
              }
            />
          )}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => onCambiar({ ...grupo, hijos: [...grupo.hijos, reglaVacia()] })}
          className={cn(TRANSICION_CONTROL, PRESION_TACTIL)}
        >
          <Add data-icon="inline-start" aria-hidden />
          Condición
        </Button>
        {puedeAnidar ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            // El grupo nuevo nace con el operador contrario al del padre: si no,
            // no agrega nada —un grupo `Y` dentro de un `Y` significa lo mismo
            // sin el grupo— y quien lo creó tendría que darse cuenta solo.
            onClick={() =>
              onCambiar({
                ...grupo,
                hijos: [...grupo.hijos, grupoVacio(operadorOpuesto(grupo.operador))],
              })
            }
            title={`Agrega una caja donde ${OPERADOR_FRASE[operadorOpuesto(grupo.operador)]}`}
            className={cn(TRANSICION_CONTROL, PRESION_TACTIL)}
          >
            <Add data-icon="inline-start" aria-hidden />
            Grupo
          </Button>
        ) : (
          <span className="text-ink-ghost text-[10.5px] text-pretty">
            Tres niveles es el máximo: más profundo no se puede verificar de un vistazo.
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * El chip `Y` / `O` entre dos filas.
 *
 * Al pasar el mouse por uno se resaltan todos los del grupo, porque son el
 * mismo control. Sin ese resalte, cambiar uno y ver que cambiaron los otros
 * se lee como un error de la aplicación en lugar de como la regla que es.
 *
 * Es un botón de verdad y no un adorno `aria-hidden`: quien navega con lector
 * de pantalla necesita saber cómo se combinan dos filas tanto como quien lo ve,
 * y en una lista de seis condiciones el rótulo del grupo ya quedó fuera de
 * pantalla cuando llegás a la cuarta.
 */
function ChipOperador({
  operador,
  resaltado,
  onResaltar,
  onCambiar,
}: {
  operador: Operador;
  resaltado: boolean;
  onResaltar: (v: boolean) => void;
  onCambiar: (o: Operador) => void;
}) {
  const otro = operadorOpuesto(operador);
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onCambiar(otro)}
        onMouseEnter={() => onResaltar(true)}
        onMouseLeave={() => onResaltar(false)}
        onFocus={() => onResaltar(true)}
        onBlur={() => onResaltar(false)}
        aria-label={`Combinar con ${OPERADOR_LABEL[operador]}. Cambiar a ${OPERADOR_LABEL[otro]} para todo el grupo.`}
        title={`Todas las condiciones de este grupo se combinan con ${OPERADOR_LABEL[operador]}. Tocá para cambiarlas a ${OPERADOR_LABEL[otro]}.`}
        className={cn(
          "grid min-h-6 min-w-8 place-items-center rounded px-2 font-mono text-[10px] leading-none font-bold",
          TRANSICION_CONTROL,
          PRESION_TACTIL,
          FOCO,
          resaltado
            ? "bg-brand text-brand-ink"
            : "bg-ink-primary text-surface-panel opacity-80 hover:opacity-100",
        )}
      >
        {OPERADOR_LABEL[operador]}
      </button>
      <div
        aria-hidden
        className={cn(
          "h-px flex-1",
          TRANSICION_CONTROL,
          resaltado ? "bg-brand/40" : "bg-line-card",
        )}
      />
    </div>
  );
}

/**
 * Una fila: campo → comparador → valor.
 *
 * Dos renglones y no uno. En un panel de 400 px, tres desplegables en línea
 * dan ~110 px cada uno y "Etiquetas del lead" no entra en ninguno. El valor
 * baja al segundo renglón, alineado con los otros dos, y así el más largo de
 * los tres —que casi siempre es el valor— tiene el ancho completo.
 *
 * Una fila sin terminar se marca **con una palabra, no sólo con un color**:
 * "sin terminar" al lado del número. El color por sí solo no llega a quien no
 * lo distingue, y es justo la información que decide si el contador de arriba
 * miente o no.
 */
function FilaCondicion({
  regla,
  indice,
  campos,
  onCambiar,
  onQuitar,
}: {
  regla: Regla;
  indice: number;
  campos: readonly CampoCondicion[];
  onCambiar: (r: Regla) => void;
  onQuitar?: () => void;
}) {
  const campo = campos.find((c) => c.id === regla.campoId) ?? null;
  const comparadores = campo ? comparadoresDe(campo) : [];
  const incompleta = reglaIncompleta(regla);

  function elegirCampo(id: string) {
    const nuevo = campos.find((c) => c.id === id);
    if (!nuevo) return;
    // Al cambiar de campo, el comparador anterior puede no existir para el tipo
    // nuevo. Se toma el primero válido en vez de dejar un estado imposible que
    // después hay que validar.
    const comparador = comparadoresDe(nuevo)[0] ?? null;
    onCambiar({
      ...regla,
      campoId: id,
      comparador,
      valor: comparador ? valorPorDefecto(nuevo.tipo, comparador) : { tipo: "ninguno" },
    });
  }

  function elegirComparador(c: Comparador) {
    if (!campo) return;
    onCambiar({ ...regla, comparador: c, valor: valorPorDefecto(campo.tipo, c) });
  }

  return (
    <div
      role="group"
      aria-label={`Condición ${indice}${incompleta ? ", sin terminar" : ""}`}
      className="flex flex-col gap-1.5"
    >
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          className={cn(
            "w-5 shrink-0 text-right font-mono text-[10px] tabular-nums",
            incompleta ? "text-caution" : "text-ink-ghost",
          )}
        >
          {indice}
        </span>

        <SelectorCampo campos={campos} valor={regla.campoId} onElegir={elegirCampo} />

        <Select
          value={regla.comparador ?? ""}
          onValueChange={(v) => elegirComparador(String(v) as Comparador)}
          disabled={!campo}
          // Base UI muestra el valor crudo (`no_es`) si no sabe su etiqueta.
          items={Object.fromEntries(
            comparadores.map((c) => [c, campo ? etiquetaComparador(campo, c) : c]),
          )}
        >
          <SelectTrigger
            size="sm"
            aria-label="Comparador"
            className="bg-surface-panel w-[124px] shrink-0"
          >
            <SelectValue placeholder="…" />
          </SelectTrigger>
          <SelectContent>
            {comparadores.map((c) => (
              <SelectItem key={c} value={c}>
                {campo ? etiquetaComparador(campo, c) : c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {onQuitar ? (
          <button
            type="button"
            onClick={onQuitar}
            aria-label={`Quitar la condición ${indice}`}
            className={cn(
              "text-ink-ghost hover:text-danger grid size-7 shrink-0 place-items-center rounded",
              TRANSICION_CONTROL,
              FOCO,
            )}
          >
            <Close size={13} aria-hidden />
          </button>
        ) : null}
      </div>

      {campo && regla.comparador && !comparadorSinValor(regla.comparador) ? (
        <div className="flex items-start gap-1.5 pl-6.5">
          <EditorValor
            campo={campo}
            valor={regla.valor}
            onCambiar={(valor) => onCambiar({ ...regla, valor })}
          />
          {onQuitar ? <span aria-hidden className="size-7 shrink-0" /> : null}
        </div>
      ) : null}

      {incompleta ? (
        <p className="text-caution pl-6.5 text-[10px] leading-none">
          {!campo
            ? "Falta elegir el campo"
            : !regla.comparador
              ? "Falta elegir la comparación"
              : "Falta el valor"}
        </p>
      ) : null}
    </div>
  );
}

/**
 * El selector de campo, agrupado por `grupo` cuando el catálogo lo trae.
 *
 * Un desplegable plano de 20 campos obliga a leerlos todos para encontrar uno;
 * separados en "Lead", "Sesión", "Vehículo" se busca en el bloque y no en la
 * lista. Si ningún campo declara grupo, sale plano: encabezados de una sola
 * sección son ruido.
 */
function SelectorCampo({
  campos,
  valor,
  onElegir,
}: {
  campos: readonly CampoCondicion[];
  valor: string | null;
  onElegir: (id: string) => void;
}) {
  const grupos = new Map<string, CampoCondicion[]>();
  for (const c of campos) {
    const clave = c.grupo ?? "";
    const actual = grupos.get(clave);
    if (actual) actual.push(c);
    else grupos.set(clave, [c]);
  }
  const agrupado = grupos.size > 1 || !grupos.has("");

  return (
    <Select
      value={valor ?? ""}
      onValueChange={(v) => onElegir(String(v))}
      // Sin esto el disparador muestra el id (`lead.etapa`) y no "Etapa".
      items={Object.fromEntries(campos.map((c) => [c.id, c.etiqueta]))}
    >
      <SelectTrigger size="sm" aria-label="Campo" className="bg-surface-panel min-w-0 flex-1">
        <SelectValue placeholder="Elegir campo…" />
      </SelectTrigger>
      <SelectContent>
        {agrupado
          ? [...grupos].map(([nombre, lista]) => (
              <SelectGroup key={nombre || "otros"}>
                {nombre ? <SelectLabel>{nombre}</SelectLabel> : null}
                {lista.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.etiqueta}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))
          : campos.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.etiqueta}
              </SelectItem>
            ))}
      </SelectContent>
    </Select>
  );
}

/**
 * El editor del valor, elegido por el tipo del campo.
 *
 * **Acá se cumple la regla más importante de la pantalla: ningún campo acepta
 * código.** Cuando el campo es cerrado —etapas, etiquetas, vendedores,
 * intents, canales— el valor sale de una lista y no hay dónde escribir. El
 * único `<Input>` de texto libre aparece cuando el campo es genuinamente
 * abierto, y compara literal: no interpola, no acepta `{{ }}`, no evalúa nada.
 *
 * No es una restricción de seguridad, es de producto: quien usa esto vende
 * repuestos. Un campo que acepta una expresión es un campo donde se puede
 * escribir una expresión mal, y no hay forma de que el sistema avise a tiempo.
 */
function EditorValor({
  campo,
  valor,
  onCambiar,
}: {
  campo: CampoCondicion;
  valor: ValorCondicion;
  onCambiar: (v: ValorCondicion) => void;
}) {
  if (valor.tipo === "opcion") {
    return (
      <Select
        value={valor.valor ?? ""}
        onValueChange={(v) => onCambiar({ tipo: "opcion", valor: String(v) })}
        items={Object.fromEntries((campo.opciones ?? []).map((o) => [o.valor, o.etiqueta]))}
      >
        <SelectTrigger
          size="sm"
          aria-label={campo.etiqueta}
          className="bg-surface-panel min-w-0 flex-1 font-mono"
        >
          <SelectValue placeholder="Elegir de la lista…" />
        </SelectTrigger>
        <SelectContent>
          {(campo.opciones ?? []).map((o) => (
            <SelectItem key={o.valor} value={o.valor}>
              {o.etiqueta}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (valor.tipo === "opciones") {
    return (
      <SelectorMultiple
        etiqueta={campo.etiqueta}
        opciones={campo.opciones ?? []}
        seleccionadas={valor.valores}
        onCambiar={(valores) => onCambiar({ tipo: "opciones", valores })}
      />
    );
  }

  if (valor.tipo === "numero") {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <Input
          type="number"
          inputMode="numeric"
          value={valor.valor ?? ""}
          onChange={(e) =>
            onCambiar({
              tipo: "numero",
              valor: e.target.value === "" ? null : Number(e.target.value),
            })
          }
          aria-label={campo.etiqueta}
          className="h-7 min-w-0 flex-1 font-mono text-[11.5px] tabular-nums"
        />
        {campo.unidad ? (
          <span className="text-ink-faint shrink-0 font-mono text-[11px]">{campo.unidad}</span>
        ) : null}
      </div>
    );
  }

  if (valor.tipo === "rango") {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <Input
          type="number"
          inputMode="numeric"
          value={valor.desde ?? ""}
          onChange={(e) =>
            onCambiar({ ...valor, desde: e.target.value === "" ? null : Number(e.target.value) })
          }
          aria-label={`${campo.etiqueta}, desde`}
          className="h-7 min-w-0 flex-1 font-mono text-[11.5px] tabular-nums"
        />
        <span className="text-ink-ghost shrink-0 text-[11px]">y</span>
        <Input
          type="number"
          inputMode="numeric"
          value={valor.hasta ?? ""}
          onChange={(e) =>
            onCambiar({ ...valor, hasta: e.target.value === "" ? null : Number(e.target.value) })
          }
          aria-label={`${campo.etiqueta}, hasta`}
          className="h-7 min-w-0 flex-1 font-mono text-[11.5px] tabular-nums"
        />
        {campo.unidad ? (
          <span className="text-ink-faint shrink-0 font-mono text-[11px]">{campo.unidad}</span>
        ) : null}
      </div>
    );
  }

  if (valor.tipo === "fecha") {
    return (
      <Input
        type="date"
        value={valor.valor ?? ""}
        onChange={(e) => onCambiar({ tipo: "fecha", valor: e.target.value || null })}
        aria-label={campo.etiqueta}
        className="h-7 min-w-0 flex-1 font-mono text-[11.5px] tabular-nums"
      />
    );
  }

  // Un rango de fechas son dos calendarios, no un texto con un guión en el
  // medio. Escribirlo a mano es la única forma de escribirlo mal.
  if (valor.tipo === "rangoFecha") {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <Input
          type="date"
          value={valor.desde ?? ""}
          onChange={(e) => onCambiar({ ...valor, desde: e.target.value || null })}
          aria-label={`${campo.etiqueta}, desde`}
          className="h-7 min-w-0 flex-1 font-mono text-[11.5px] tabular-nums"
        />
        <span className="text-ink-ghost shrink-0 text-[11px]">y</span>
        <Input
          type="date"
          value={valor.hasta ?? ""}
          onChange={(e) => onCambiar({ ...valor, hasta: e.target.value || null })}
          aria-label={`${campo.etiqueta}, hasta`}
          className="h-7 min-w-0 flex-1 font-mono text-[11.5px] tabular-nums"
        />
      </div>
    );
  }

  if (valor.tipo === "booleano") {
    return (
      <Select
        value={valor.valor ? "si" : "no"}
        onValueChange={(v) => onCambiar({ tipo: "booleano", valor: v === "si" })}
        items={{ si: "sí", no: "no" }}
      >
        <SelectTrigger
          size="sm"
          aria-label={campo.etiqueta}
          className="bg-surface-panel min-w-0 flex-1"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="si">sí</SelectItem>
          <SelectItem value="no">no</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  // El único texto libre de la pantalla, y sólo para campos abiertos.
  // Se compara literal: lo que se escribe es lo que se busca.
  return (
    <Input
      type="text"
      value={valor.tipo === "texto" ? valor.valor : ""}
      onChange={(e) => onCambiar({ tipo: "texto", valor: e.target.value })}
      placeholder="Escribí el texto a comparar"
      aria-label={campo.etiqueta}
      className="h-7 min-w-0 flex-1 text-[11.5px]"
    />
  );
}

/**
 * Selector de varias opciones, para los campos de tipo lista múltiple
 * (etiquetas, canales, vendedores).
 *
 * Las elegidas quedan como chips con su × y las que faltan se agregan desde un
 * desplegable. No hay campo de texto: agregar una etiqueta que no existe no es
 * un caso que valga la pena soportar acá — se crea en la administración de
 * etiquetas, donde se le pone color y descripción.
 */
function SelectorMultiple({
  etiqueta,
  opciones,
  seleccionadas,
  onCambiar,
}: {
  etiqueta: string;
  opciones: readonly OpcionCampo[];
  seleccionadas: string[];
  onCambiar: (v: string[]) => void;
}) {
  const disponibles = opciones.filter((o) => !seleccionadas.includes(o.valor));

  return (
    <div
      role="group"
      aria-label={etiqueta}
      className="border-line-input bg-surface-panel flex min-h-9 min-w-0 flex-1 flex-wrap items-center gap-1.5 rounded-md border p-1.5"
    >
      {seleccionadas.map((v) => {
        const o = opciones.find((x) => x.valor === v);
        return (
          <span
            key={v}
            className="bg-surface-input text-ink-body inline-flex items-center gap-1 rounded py-0.5 pl-1.5 font-mono text-[10.5px]"
          >
            {o?.color ? (
              <span
                aria-hidden
                style={{ backgroundColor: o.color }}
                className="size-1.5 rounded-full"
              />
            ) : null}
            {o?.etiqueta ?? v}
            <button
              type="button"
              onClick={() => onCambiar(seleccionadas.filter((s) => s !== v))}
              aria-label={`Quitar ${o?.etiqueta ?? v}`}
              className={cn(
                "text-ink-ghost hover:text-danger grid size-4 place-items-center rounded",
                TRANSICION_CONTROL,
                FOCO,
              )}
            >
              <Close size={10} aria-hidden />
            </button>
          </span>
        );
      })}

      {disponibles.length > 0 ? (
        <Select value="" onValueChange={(v) => onCambiar([...seleccionadas, String(v)])}>
          <SelectTrigger
            size="sm"
            aria-label={`Agregar a ${etiqueta}`}
            className="text-ink-ghost h-6 w-auto border-none bg-transparent px-1.5 text-[10.5px] shadow-none"
          >
            <SelectValue placeholder={seleccionadas.length === 0 ? "Elegir de la lista…" : "+"} />
          </SelectTrigger>
          <SelectContent>
            {disponibles.map((o) => (
              <SelectItem key={o.valor} value={o.valor}>
                {o.etiqueta}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : opciones.length === 0 ? (
        // El catálogo llegó vacío. Decirlo es mejor que un recuadro mudo que se
        // lee como "no hay nada que elegir acá" cuando en realidad no cargó.
        <span className="text-ink-ghost px-1 text-[10.5px]">Sin opciones cargadas</span>
      ) : null}
    </div>
  );
}
