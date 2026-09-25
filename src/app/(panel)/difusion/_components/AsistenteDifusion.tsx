"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ConstructorAudiencia,
  ConstructorMensaje,
  PASOS_DIFUSION,
  PreVuelo,
  configInicial,
  disponibilidad,
  formatearEntero,
  lineasCostoMensaje,
  pendientesMensaje,
} from "@/components/difusion";
import { contarIncompletas, contarReglas } from "@/lib/ui/condiciones";
import { calcularAlcanceAction } from "../_actions/alcance.action";
import { crearBorradorAction, guardarBorradorAction } from "../_actions/borrador.actions";
import { programarAction } from "../_actions/envio.actions";
import { vistaAlcance } from "../_lib/alcance";
import type {
  AlcanceAudiencia,
  CatalogosAudiencia,
  CategoriaPlantilla,
  ConfigMensaje,
  Dato,
  Destinatario,
  EstadoAlcance,
  EstadoPreVuelo,
  GrupoAudiencia,
  LecturaPlantillas,
  ModoAudiencia,
  MotivoExclusion,
  Plantilla,
  SaludNumero,
} from "@/components/difusion";
import type { Alcance, DifusionVista } from "@/server/services/difusion/difusion.service";
import type { ResultadoAccion } from "../_actions/action-error";

type Paso = (typeof PASOS_DIFUSION)[number];

interface PedidoAlcance {
  audiencia: GrupoAudiencia;
  todaLaBase: boolean;
  modo: ModoAudiencia;
  incluirEnNegociacion: boolean;
  exentaTopeFrecuencia: boolean;
  plantillaCategoria: CategoriaPlantilla | null;
}

/**
 * El árbol con que arranca una audiencia nueva: una fila por completar. Ids
 * fijos a propósito: con `nuevoId()` el servidor y el cliente generarían ids
 * distintos al hidratar. Las filas que agregue la persona sí salen de
 * `nuevoId()`, ya en el cliente.
 */
const ARBOL_INICIAL: GrupoAudiencia = {
  id: "raiz",
  clase: "grupo",
  operador: "y",
  hijos: [
    { id: "fila-1", clase: "regla", campoId: null, comparador: null, valor: { tipo: "ninguno" } },
  ],
};

/** Lo que se guarda y se manda con "toda la base": sin condiciones, que es lo que exige la base. */
const ARBOL_VACIO: GrupoAudiencia = { id: "raiz", clase: "grupo", operador: "y", hijos: [] };

/**
 * Cuánto se espera antes de recalcular mientras se edita. Cada cálculo
 * resuelve la audiencia entera en la base y planifica: una tecla por pedido
 * sería un pedido por tecla. Sin fuente: decisión de esta pantalla.
 */
const ESPERA_MS = 600;
/** Filas que trae el cálculo mientras se arma: las del panel de la derecha. */
const MUESTRA_EN_VIVO = 12;
/** Filas por página en el pre-vuelo. */
const PAGINA_PREVUELO = 50;
/** La muestra que se propone. Sin fuente: se ajusta en pantalla, de 1 a n−1. */
const MUESTRA_SUGERIDA = 50;

const SIN_RESPUESTA = "El servidor no respondió. Reintentá.";

function idDeLaGuardada(inicial: DifusionVista | null, lista: readonly Plantilla[]): string | null {
  if (!inicial?.plantillaNombre) return null;
  return (
    lista.find(
      (p) => p.nombre === inicial.plantillaNombre && p.categoria === inicial.plantillaCategoria,
    )?.id ?? null
  );
}

/**
 * El asistente de una difusión: Audiencia → Mensaje → Pre-vuelo, contra el
 * servidor de verdad.
 *
 *   - El alcance se pide a `calcularAlcanceAction` cada vez que cambia algo
 *     que lo mueve (árbol, toda la base, exenciones, categoría), con una
 *     espera corta y descartando respuestas viejas. Todas las cifras son del
 *     planificador: acá no se resta nada.
 *   - El primer "Continuar" crea el borrador y cambia la URL a
 *     `/difusion/<id>` sin navegar (`history.replaceState`, que Next integra a
 *     su router): el asistente sigue montado, y una recarga cae en el borrador
 *     en vez de crear otro. Los siguientes guardan sobre el mismo.
 *   - Programar escribe el plan y avisa al motor; después se va al envío.
 *
 * El id del borrador vive en una ref y no en estado: nada de lo que se dibuja
 * depende de él, y así el efecto del alcance no se vuelve a disparar al crearlo.
 */
export function AsistenteDifusion({
  inicial,
  catalogos,
  avisoCatalogos,
  plantillas,
  salud,
  zonaHoraria,
}: {
  /** El borrador guardado, o `null` si es una difusión nueva. */
  inicial: DifusionVista | null;
  catalogos: CatalogosAudiencia;
  avisoCatalogos: string | null;
  plantillas: Dato<LecturaPlantillas>;
  salud: SaludNumero;
  zonaHoraria: string;
}) {
  const router = useRouter();
  const lista = useMemo(
    () => (plantillas.estado === "ok" ? plantillas.valor.plantillas : []),
    [plantillas],
  );
  const idRef = useRef<string | null>(inicial?.id ?? null);

  const [paso, setPaso] = useState<Paso>("Audiencia");
  const [nombre, setNombre] = useState(inicial?.nombre ?? "");
  const [raiz, setRaiz] = useState<GrupoAudiencia>(() =>
    inicial && contarReglas(inicial.audiencia) > 0 ? inicial.audiencia : ARBOL_INICIAL,
  );
  const [todaLaBase, setTodaLaBase] = useState(inicial?.audienciaTodaLaBase ?? false);
  const [modo, setModo] = useState<ModoAudiencia>(inicial?.audienciaModo ?? "congelada");
  const [incluirEnNegociacion, setIncluirEnNegociacion] = useState(
    inicial?.incluirEnNegociacion ?? false,
  );
  const [exentaTopeFrecuencia, setExentaTopeFrecuencia] = useState(
    inicial?.exentaTopeFrecuencia ?? false,
  );
  const [plantillaId, setPlantillaId] = useState<string | null>(() =>
    idDeLaGuardada(inicial, lista),
  );
  const [configs, setConfigs] = useState<Readonly<Record<string, ConfigMensaje>>>({});
  const [canary, setCanary] = useState<{ activo: boolean; tamano: number | null }>({
    activo: true,
    tamano: null,
  });
  const [guardando, setGuardando] = useState(false);
  const [programando, setProgramando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  const [resultado, setResultado] = useState<{ clave: string; r: ResultadoAccion<Alcance> } | null>(
    null,
  );
  const [ultimo, setUltimo] = useState<AlcanceAudiencia | null>(null);
  const [extra, setExtra] = useState<{ clave: string; filas: Destinatario[] } | null>(null);
  const [cargandoMas, setCargandoMas] = useState(false);

  const plantilla = lista.find((p) => p.id === plantillaId) ?? null;
  const config = plantilla ? (configs[plantilla.id] ?? configInicial(plantilla)) : null;
  const reglas = contarReglas(raiz);
  const incompletas = contarIncompletas(raiz);
  const esPrevuelo = paso === "Pre-vuelo";

  const pedido: PedidoAlcance | null =
    todaLaBase || (reglas > 0 && incompletas === 0)
      ? {
          audiencia: todaLaBase ? ARBOL_VACIO : raiz,
          todaLaBase,
          modo,
          incluirEnNegociacion,
          exentaTopeFrecuencia,
          plantillaCategoria: plantilla?.categoria ?? null,
        }
      : null;
  const clave = pedido === null ? null : JSON.stringify({ pedido, esPrevuelo, intento });

  useEffect(() => {
    if (clave === null) return;
    let vigente = true;
    const { pedido: p, esPrevuelo: pre } = JSON.parse(clave) as {
      pedido: PedidoAlcance;
      esPrevuelo: boolean;
    };
    const timer = setTimeout(
      () => {
        calcularAlcanceAction({
          ...p,
          muestra: { desde: 0, limite: pre ? PAGINA_PREVUELO : MUESTRA_EN_VIVO },
          difusionId: idRef.current,
          conDiff: pre,
        })
          .then((r) => {
            if (!vigente) return;
            setResultado({ clave, r });
            if (r.ok) setUltimo(vistaAlcance(r.datos, zonaHoraria).audiencia);
          })
          .catch(() => {
            if (vigente) setResultado({ clave, r: { ok: false, error: SIN_RESPUESTA } });
          });
      },
      pre ? 0 : ESPERA_MS,
    );
    return () => {
      vigente = false;
      clearTimeout(timer);
    };
  }, [clave, zonaHoraria]);

  const vigente = resultado !== null && resultado.clave === clave ? resultado.r : null;
  const vista = useMemo(
    () => (vigente?.ok ? vistaAlcance(vigente.datos, zonaHoraria) : null),
    [vigente, zonaHoraria],
  );

  const estadoAlcance: EstadoAlcance =
    !todaLaBase && incompletas > 0
      ? { estado: "incompleta", faltan: incompletas }
      : pedido === null
        ? { estado: "sin-condiciones" }
        : vigente === null
          ? { estado: "calculando", previo: ultimo }
          : vista
            ? { estado: "listo", alcance: vista.audiencia, calculado: vista.calculado }
            : {
                estado: "error",
                mensaje: vigente.ok ? SIN_RESPUESTA : vigente.error,
                previo: ultimo,
              };
  const alcanceVisible =
    estadoAlcance.estado === "listo"
      ? estadoAlcance.alcance
      : estadoAlcance.estado === "calculando" || estadoAlcance.estado === "error"
        ? estadoAlcance.previo
        : null;

  const saludConPlantilla: SaludNumero =
    salud.plantillasPausadas.estado === "ok"
      ? {
          ...salud,
          plantillasPausadas: {
            estado: "ok",
            valor: salud.plantillasPausadas.valor.map((p) => ({
              ...p,
              laUsaEstaDifusion: p.nombre === plantilla?.nombre,
            })),
          },
        }
      : salud;

  const aplicadas: Partial<Record<MotivoExclusion, boolean>> = {
    en_negociacion: !incluirEnNegociacion,
    cap_frecuencia: !exentaTopeFrecuencia,
  };

  const pendienteAudiencia =
    nombre.trim() === ""
      ? "Falta el nombre de la difusión"
      : !todaLaBase && incompletas > 0
        ? incompletas === 1
          ? "Falta terminar una condición"
          : `Faltan terminar ${incompletas} condiciones`
        : pedido === null
          ? "Falta una condición, o elegir toda la base"
          : null;

  async function guardar(
    accion: () => Promise<ResultadoAccion<unknown>>,
    siguiente: () => void,
  ): Promise<void> {
    setGuardando(true);
    setError(null);
    try {
      const r = await accion();
      if (r.ok) siguiente();
      else setError(r.error);
    } catch {
      setError(`No se pudo guardar. ${SIN_RESPUESTA}`);
    } finally {
      setGuardando(false);
    }
  }

  function continuarAudiencia() {
    if (pendienteAudiencia !== null || guardando || pedido === null) return;
    const datos = {
      nombre: nombre.trim(),
      audiencia: pedido.audiencia,
      todaLaBase,
      modo,
      incluirEnNegociacion,
      exentaTopeFrecuencia,
    };
    void guardar(
      async () => {
        const id = idRef.current;
        if (id !== null) return guardarBorradorAction({ id, ...datos });
        const r = await crearBorradorAction(datos);
        if (r.ok) {
          idRef.current = r.datos.id;
          // Sin navegar: el asistente sigue montado y una recarga cae en el borrador.
          window.history.replaceState(null, "", `/difusion/${r.datos.id}`);
        }
        return r;
      },
      () => setPaso("Mensaje"),
    );
  }

  function continuarMensaje() {
    const id = idRef.current;
    if (!plantilla || guardando) return;
    if (pendientesMensaje(plantilla, config).length > 0) return;
    if (id === null) {
      setError("La audiencia todavía no se guardó: volvé al paso anterior y continuá desde ahí.");
      return;
    }
    void guardar(
      () =>
        guardarBorradorAction({
          id,
          plantilla: { nombre: plantilla.nombre, categoria: plantilla.categoria },
        }),
      () => setPaso("Pre-vuelo"),
    );
  }

  const destinatariosPrevuelo: Destinatario[] = vista
    ? [...vista.audiencia.muestra, ...(extra !== null && extra.clave === clave ? extra.filas : [])]
    : [];
  const nPrevuelo = vista?.audiencia.destinatarios ?? 0;
  const tamanoCanary = canary.tamano ?? Math.min(MUESTRA_SUGERIDA, Math.max(1, nPrevuelo - 1));

  async function cargarMas() {
    if (pedido === null || clave === null || vista === null || cargandoMas) return;
    const claveActual = clave;
    const desde = destinatariosPrevuelo.length;
    setCargandoMas(true);
    try {
      const r = await calcularAlcanceAction({
        ...pedido,
        muestra: { desde, limite: PAGINA_PREVUELO },
        difusionId: idRef.current,
        conDiff: true,
      });
      if (!r.ok) {
        toast.error(r.error);
      } else if (r.datos.destinatarios !== vista.audiencia.destinatarios) {
        // La base cambió entre una página y la otra: se recalcula todo en vez de
        // pegar dos listas que no son la misma.
        toast.warning("La audiencia cambió mientras la revisabas: se vuelve a calcular.");
        setIntento((i) => i + 1);
      } else {
        setExtra((prev) => ({
          clave: claveActual,
          filas: [
            ...(prev !== null && prev.clave === claveActual ? prev.filas : []),
            ...r.datos.muestra,
          ],
        }));
      }
    } catch {
      toast.error(`No se pudo cargar la página siguiente. ${SIN_RESPUESTA}`);
    } finally {
      setCargandoMas(false);
    }
  }

  async function programar() {
    const id = idRef.current;
    if (id === null || vista === null || programando) return;
    const conMuestra = canary.activo && nPrevuelo >= 2;
    setProgramando(true);
    setError(null);
    try {
      const r = await programarAction({ id, canaryTamano: conMuestra ? tamanoCanary : null });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast.success(
        r.datos.yaEstabaProgramada
          ? "La difusión ya estaba programada: no se reescribió nada."
          : `Programada: ${formatearEntero(r.datos.destinatarios)} destinatarios en ${
              r.datos.tandas === 1 ? "una tanda" : `${r.datos.tandas} tandas`
            }.`,
      );
      router.replace(`/difusion/${id}`);
      router.refresh();
    } catch {
      setError(
        "No se pudo programar: el servidor no respondió. Reintentar es seguro: si ya quedó programada, no se duplica.",
      );
    } finally {
      setProgramando(false);
    }
  }

  function avisarDespausado(nombrePlantilla: string) {
    toast(`${nombrePlantilla} se despausa desde el administrador de WhatsApp de Meta`, {
      description: "Este CRM sólo lee las plantillas: no las crea ni las despausa.",
    });
  }

  function alternarExclusion(motivo: MotivoExclusion, aplicada: boolean) {
    if (motivo === "en_negociacion") setIncluirEnNegociacion(!aplicada);
    else if (motivo === "cap_frecuencia") setExentaTopeFrecuencia(!aplicada);
  }

  const nombreVisible = nombre.trim() || "Difusión nueva";

  if (paso === "Audiencia") {
    return (
      <ConstructorAudiencia
        nombre={nombre}
        onCambiarNombre={setNombre}
        modo={modo}
        onCambiarModo={setModo}
        raiz={raiz}
        onCambiarCondiciones={setRaiz}
        todaLaBase={todaLaBase}
        onCambiarTodaLaBase={(v) => {
          setTodaLaBase(v);
          if (!v && contarReglas(raiz) === 0) setRaiz(ARBOL_INICIAL);
        }}
        catalogos={catalogos}
        aviso={avisoCatalogos}
        estado={estadoAlcance}
        aplicadas={aplicadas}
        onAlternarExclusion={alternarExclusion}
        onReintentar={() => setIntento((i) => i + 1)}
        pendiente={pendienteAudiencia}
        guardando={guardando}
        error={error}
        onVolver={() => router.push("/difusion")}
        onContinuar={continuarAudiencia}
      />
    );
  }

  if (paso === "Mensaje") {
    return (
      <ConstructorMensaje
        nombre={nombreVisible}
        lectura={plantillas}
        plantilla={plantilla}
        config={config}
        destinatarios={alcanceVisible?.muestra ?? []}
        // Los valores por lead para la vista previa no se leen todavía: sin el
        // texto de la plantilla no hay variables que completar.
        valoresPorLead={{}}
        etiquetas={catalogos.etiquetas ?? []}
        porVentanaAbierta={alcanceVisible?.porVentanaAbierta ?? null}
        porPlantilla={alcanceVisible?.porPlantilla ?? null}
        lineasCosto={
          plantilla && alcanceVisible
            ? lineasCostoMensaje(
                plantilla.categoria,
                alcanceVisible.porVentanaAbierta,
                alcanceVisible.porPlantilla,
                null,
              )
            : null
        }
        guardando={guardando}
        error={error}
        onElegirPlantilla={(id) => {
          setError(null);
          setPlantillaId(id);
        }}
        onCambiarConfig={(c) => setConfigs((prev) => ({ ...prev, [c.plantillaId]: c }))}
        onDespausar={avisarDespausado}
        onVolver={() => {
          setError(null);
          setPaso("Audiencia");
        }}
        onContinuar={continuarMensaje}
      />
    );
  }

  const estadoPrevuelo: EstadoPreVuelo =
    pedido === null
      ? {
          estado: "error",
          mensaje: "La audiencia quedó incompleta: volvé al paso Audiencia.",
        }
      : vigente === null
        ? { estado: "calculando" }
        : vista
          ? {
              estado: "listo",
              calculo: {
                alcance: vista.audiencia,
                cupo: vista.cupo,
                tandas: vista.tandas,
                diff: vista.diff,
                calculado: vista.calculado,
              },
            }
          : { estado: "error", mensaje: vigente.ok ? SIN_RESPUESTA : vigente.error };

  return (
    <PreVuelo
      nombre={nombreVisible}
      estado={estadoPrevuelo}
      destinatarios={destinatariosPrevuelo}
      onCargarMas={
        vista && destinatariosPrevuelo.length < vista.audiencia.destinatarios
          ? () => void cargarMas()
          : null
      }
      cargandoMas={cargandoMas}
      lineasCosto={
        plantilla && vista
          ? lineasCostoMensaje(
              plantilla.categoria,
              vista.audiencia.porVentanaAbierta,
              vista.audiencia.porPlantilla,
              null,
            )
          : []
      }
      salud={saludConPlantilla}
      plantilla={
        plantilla
          ? { nombre: plantilla.nombre, elegible: disponibilidad(plantilla).elegible }
          : null
      }
      canary={{ activo: canary.activo, tamano: tamanoCanary }}
      onCambiarCanary={(c) => setCanary(c)}
      programando={programando}
      error={error}
      onVolver={() => {
        setError(null);
        setPaso("Mensaje");
      }}
      onReintentar={() => setIntento((i) => i + 1)}
      onSalir={() => router.push("/difusion")}
      onProgramar={() => void programar()}
    />
  );
}
