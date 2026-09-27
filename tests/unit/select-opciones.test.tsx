import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SelectOpciones } from "@/components/shared/SelectOpciones";
import {
  ConfigCRM,
  ConfigDelegar,
  ConfigIA,
  ConfigIntegracion,
  ConfigInterno,
  ConfigLogica,
  ConfigMensajeria,
  ConfigTrigger,
} from "@/components/workflows/canvas/config";
import {
  NODO_TIPOS_CRM,
  NODO_TIPOS_IA,
  NODO_TIPOS_INTEGRACION,
  NODO_TIPOS_INTERNO,
  NODO_TIPOS_LOGICA,
  NODO_TIPOS_MENSAJERIA,
  NODO_TIPOS_TRIGGER,
} from "@/types/workflows";

/**
 * Un `<Select>` de Base UI pinta en el disparador el valor crudo (`inferir`,
 * `lead.canal`) si el `Root` no recibe `items`. Pasó en el inspector del
 * editor: "Canal de envío" decía `inferir` y la opción se llama "Inferir del
 * trigger". `SelectOpciones` arma `items` de las mismas opciones que dibuja.
 *
 * Tres redes:
 * 1. el componente, con el caso exacto que se vio;
 * 2. el barrido del inspector real: cada select de cada tipo de bloque, con su
 *    config por defecto, muestra una de SUS opciones o el placeholder;
 * 3. la guarda de importación: fuera del envoltorio nadie usa el Select crudo,
 *    así que un select nuevo no puede olvidarse de `items`.
 */

afterEach(cleanup);

/** El texto del valor, sin el ícono del chevron (que en jsdom también es texto). */
function textoDelDisparador(combobox: HTMLElement): string {
  const valor = combobox.querySelector('[data-slot="select-value"]');
  if (!valor) throw new Error("el disparador no tiene [data-slot=select-value]");
  return (valor.textContent ?? "").trim();
}

describe("SelectOpciones", () => {
  it("muestra la etiqueta del valor elegido, nunca el valor crudo", () => {
    render(
      <SelectOpciones
        aria-label="Canal de envío"
        value="inferir"
        onValueChange={() => {}}
        opciones={[
          { value: "inferir", label: "Inferir del trigger" },
          { value: "whatsapp", label: "WhatsApp" },
        ]}
      />,
    );
    const disparador = screen.getByRole("combobox", { name: "Canal de envío" });
    expect(textoDelDisparador(disparador)).toBe("Inferir del trigger");
    expect(textoDelDisparador(disparador)).not.toContain("inferir");
  });

  it("un valor que no está entre las opciones muestra el placeholder, no el valor", () => {
    render(
      <SelectOpciones
        aria-label="Etiqueta"
        value="3f2a0c1e-borrada"
        onValueChange={() => {}}
        placeholder="Seleccionar etiqueta"
        opciones={[{ value: "tag-vip", label: "VIP" }]}
      />,
    );
    const disparador = screen.getByRole("combobox", { name: "Etiqueta" });
    expect(textoDelDisparador(disparador)).toBe("Seleccionar etiqueta");
  });

  it("elegir una opción devuelve su valor", async () => {
    const elegidos: string[] = [];
    render(
      <SelectOpciones
        aria-label="Unidad"
        value="horas"
        onValueChange={(v) => elegidos.push(v)}
        opciones={[
          { value: "horas", label: "Horas" },
          { value: "dias", label: "Días" },
        ]}
      />,
    );
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Unidad" }));
    const dias = await screen.findByRole("option", { name: "Días" });
    fireEvent.keyDown(dias, { key: "Shift" });
    fireEvent.click(dias);
    expect(elegidos).toEqual(["dias"]);
  });

  it("agrupa con encabezado cuando las opciones declaran grupo", async () => {
    render(
      <SelectOpciones
        aria-label="Campo"
        value={null}
        onValueChange={() => {}}
        opciones={[
          { value: "lead.nombre", label: "Nombre", grupo: "Lead" },
          { value: "sesion.intent", label: "Intent detectado", grupo: "Sesión" },
        ]}
      />,
    );
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Campo" }));
    const grupos = await screen.findAllByRole("group");
    expect(
      grupos.map((g) =>
        within(g)
          .getAllByRole("option")
          .map((o) => o.textContent),
      ),
    ).toEqual([["Nombre"], ["Intent detectado"]]);
  });
});

const TAGS = [{ id: "tag-vip", nombre: "VIP" }];
const INTENTS = [{ id: "intent-cotizar", nombre: "consulta_producto" }];
const VENDEDORES = [{ id: "ven-ana", nombre: "Ana" }];
const ETAPAS = [{ id: "nuevo", nombre: "Nuevo" }];
const noop = () => {};

function formularioDe(tipo: string): ReactElement | null {
  const comun = { tipo, config: {}, onChange: noop, readonly: false };
  if (tipo === "ia_delegar") return <ConfigDelegar config={{}} onChange={noop} intents={INTENTS} />;
  if ((NODO_TIPOS_TRIGGER as readonly string[]).includes(tipo))
    return <ConfigTrigger {...comun} tags={TAGS} etapas={ETAPAS} difusiones={[]} />;
  if ((NODO_TIPOS_MENSAJERIA as readonly string[]).includes(tipo))
    return <ConfigMensajeria {...comun} />;
  if ((NODO_TIPOS_CRM as readonly string[]).includes(tipo))
    return <ConfigCRM {...comun} tags={TAGS} etapas={ETAPAS} vendedores={VENDEDORES} />;
  if ((NODO_TIPOS_LOGICA as readonly string[]).includes(tipo))
    return <ConfigLogica {...comun} camposSwitch={[]} pasos={[{ id: "n2", nombre: "Detener" }]} />;
  if ((NODO_TIPOS_INTEGRACION as readonly string[]).includes(tipo))
    return <ConfigIntegracion {...comun} />;
  if ((NODO_TIPOS_IA as readonly string[]).includes(tipo))
    return <ConfigIA {...comun} intents={INTENTS} />;
  if ((NODO_TIPOS_INTERNO as readonly string[]).includes(tipo))
    return <ConfigInterno {...comun} vendedores={VENDEDORES} canales={[]} />;
  return null;
}

const TIPOS_DEL_INSPECTOR = [
  ...NODO_TIPOS_TRIGGER,
  ...NODO_TIPOS_MENSAJERIA,
  ...NODO_TIPOS_CRM,
  ...NODO_TIPOS_LOGICA,
  ...NODO_TIPOS_INTEGRACION,
  ...NODO_TIPOS_IA,
  ...NODO_TIPOS_INTERNO,
];

describe("inspector del editor: cada select muestra una de sus etiquetas", () => {
  it("el barrido encuentra selects (si da cero, el test no está mirando nada)", () => {
    let total = 0;
    for (const tipo of TIPOS_DEL_INSPECTOR) {
      const formulario = formularioDe(tipo);
      if (!formulario) continue;
      render(formulario);
      total += screen.queryAllByRole("combobox").length;
      cleanup();
    }
    expect(total).toBeGreaterThan(30);
  });

  it.each(TIPOS_DEL_INSPECTOR)("%s", async (tipo) => {
    const formulario = formularioDe(tipo);
    if (!formulario) return;
    render(formulario);
    const cantidad = screen.queryAllByRole("combobox").length;
    cleanup();
    // Un render limpio por select: abrir uno deja su popup montado.
    for (let i = 0; i < cantidad; i++) {
      render(formulario);
      const disparador = screen.getAllByRole("combobox")[i]!;
      const visible = textoDelDisparador(disparador);
      // Sin valor elegido muestra el placeholder, que no es un valor.
      if (!disparador.hasAttribute("data-placeholder")) {
        fireEvent.mouseDown(disparador);
        const etiquetas = (await screen.findAllByRole("option")).map((o) =>
          (o.textContent ?? "").trim(),
        );
        expect(etiquetas, `${tipo}: el disparador dice «${visible}»`).toContain(visible);
      }
      cleanup();
    }
  });
});

describe("guarda: nadie usa el Select crudo fuera del envoltorio", () => {
  it("sólo SelectOpciones importa @/components/ui/select", () => {
    const raiz = join(process.cwd(), "src");
    const permitidos = new Set([
      "components/shared/SelectOpciones.tsx",
      "components/ui/select.tsx",
    ]);
    const infractores: string[] = [];
    const recorrer = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const ruta = join(dir, e.name);
        if (e.isDirectory()) recorrer(ruta);
        else if (/\.tsx?$/.test(e.name)) {
          const rel = relative(raiz, ruta).split(sep).join("/");
          if (permitidos.has(rel)) continue;
          if (readFileSync(ruta, "utf8").includes('from "@/components/ui/select"')) {
            infractores.push(rel);
          }
        }
      }
    };
    recorrer(raiz);
    expect(infractores).toEqual([]);
  });
});
