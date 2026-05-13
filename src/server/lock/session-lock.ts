// Lock por key para serializar trabajo concurrente sobre la misma sesión.
// Garantiza single-flight para twin-extractor cuando 2 turn.completed eventos
// llegan simultáneos (last-write-wins se evita).
//
// Impls:
// - NoopSessionLock: passthrough. Tests in-memory single-thread no necesitan serialización.
// - InMemorySessionLock: chain de promesas por key. Single-process prod o tests paralelos.
// - PostgresSessionLock (Fase 7): pg_advisory_xact_lock(hashtext(key)).
export interface SessionLock {
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

export class NoopSessionLock implements SessionLock {
  async withLock<T>(_key: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

export class InMemorySessionLock implements SessionLock {
  private readonly chains = new Map<string, Promise<unknown>>();

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((r) => {
      release = r;
    });
    this.chains.set(key, current);

    // Espera turno (ignora errores previos para no romper cadena).
    await prev.catch(() => {});

    try {
      return await fn();
    } finally {
      release();
      // Cleanup solo si nadie más se encoló sobre nosotros.
      if (this.chains.get(key) === current) {
        this.chains.delete(key);
      }
    }
  }
}
