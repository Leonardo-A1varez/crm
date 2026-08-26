const NAMESPACES_CONOCIDOS = ["lead", "sesion", "contexto", "vendedor", "config"] as const;
type Namespace = (typeof NAMESPACES_CONOCIDOS)[number];

export interface DatosInterpolacion {
  lead?: Record<string, unknown>;
  sesion?: Record<string, unknown>;
  contexto?: Record<string, unknown>;
  vendedor?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

export interface InterpolacionResult {
  texto: string;
  warnings: string[];
}

const VARIABLE_REGEX = /\{\{(\w+)\.(\w+)\}\}/g;

export function interpolarVariables(texto: string, datos: DatosInterpolacion): InterpolacionResult {
  const warnings: string[] = [];

  const resultado = texto.replace(VARIABLE_REGEX, (match, namespace: string, campo: string) => {
    if (!NAMESPACES_CONOCIDOS.includes(namespace as Namespace)) {
      warnings.push(`namespace ${namespace} desconocido`);
      return match;
    }

    const obj = datos[namespace as Namespace];
    if (!obj) {
      warnings.push(`${namespace}.${campo} no encontrado`);
      return "";
    }

    const valor = obj[campo];
    if (valor === undefined || valor === null) {
      warnings.push(`${namespace}.${campo} no encontrado`);
      return "";
    }

    return String(valor);
  });

  return { texto: resultado, warnings };
}
