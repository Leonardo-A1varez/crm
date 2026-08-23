export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends DomainError {
  readonly code = "NOT_FOUND";

  constructor(
    message: string,
    public readonly resource: string,
    public readonly id: string,
    cause?: unknown,
  ) {
    super(message, cause);
  }
}

export class ConflictError extends DomainError {
  readonly code = "CONFLICT";

  constructor(
    message: string,
    public readonly conflictType?: string,
    cause?: unknown,
  ) {
    super(message, cause);
  }
}

export class ValidationError extends DomainError {
  readonly code = "VALIDATION";

  constructor(
    message: string,
    public readonly issues?: unknown,
    cause?: unknown,
  ) {
    super(message, cause);
  }
}

export class PermissionDeniedError extends DomainError {
  readonly code = "PERMISSION_DENIED";

  constructor(message: string, cause?: unknown) {
    super(message, cause);
  }
}

// State-conflict que NO es race tolerable (e.g., close con resultado distinto al ya
// cerrado, double-pause con estado inconsistente). Distinto de ConflictError que
// representa race (retryable). IllegalStateError = bug del caller → NonRetriable.
export class IllegalStateError extends DomainError {
  readonly code = "ILLEGAL_STATE";

  constructor(
    message: string,
    public readonly stateType?: string,
    cause?: unknown,
  ) {
    super(message, cause);
  }
}

// Kill switch generico de presupuesto: NonRetriable, reintentar repite el
// problema hasta un override admin o un reset de ventana. Pensado para el cap
// diario de gasto LLM (`docs/cost-budget.md`, `CostTracker.exceedsCap`) y
// usado primero por el tope de salientes automaticos por lead de la capa 3 de
// workflows (Task 9, `docs/cost-budget.md` documentaba ya un `throw new
// BudgetExceededError(mensaje)` de un solo argumento). Antes tenia una firma
// fija `(day, capUsd, spentUsd)` que generaba el mensaje en dolares -- sin un
// solo `new BudgetExceededError(...)` en todo el repo (grep verificado) -- lo
// que la dejaba inutilizable para un tope que no es plata. Se generaliza al
// mismo patron `(message, categoria?, cause?)` que ya usan `ConflictError` y
// `ValidationError` antes de que aparezca un segundo uso real que dependa de
// la firma vieja.
export class BudgetExceededError extends DomainError {
  readonly code = "BUDGET_EXCEEDED";

  constructor(
    message: string,
    public readonly budgetType?: string,
    cause?: unknown,
  ) {
    super(message, cause);
  }
}

/** Fallo transitorio de una dependencia externa o de infraestructura. */
export class InfraError extends DomainError {
  readonly code = "INFRA";

  constructor(
    message: string,
    public readonly dependency?: string,
    cause?: unknown,
  ) {
    super(message, cause);
  }
}

/** Una dependencia pidió bajar el ritmo; es reintentable, no un conflicto de dominio. */
export class RateLimitError extends DomainError {
  readonly code = "RATE_LIMIT";

  constructor(
    message: string,
    public readonly dependency?: string,
    public readonly retryAfterSeconds?: number,
    cause?: unknown,
  ) {
    super(message, cause);
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}

export function isNonRetriable(e: unknown): boolean {
  return (
    e instanceof NotFoundError ||
    e instanceof ValidationError ||
    e instanceof PermissionDeniedError ||
    e instanceof IllegalStateError ||
    e instanceof BudgetExceededError
  );
}
