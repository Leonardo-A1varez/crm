const BURBUJAS = [
  { saliente: false, ancho: "w-52" },
  { saliente: true, ancho: "w-40" },
  { saliente: false, ancho: "w-64" },
  { saliente: true, ancho: "w-56" },
  { saliente: false, ancho: "w-44" },
];

/**
 * Esqueleto con la forma real de la pantalla: conversación + Twin, cada uno en
 * su columna. Un esqueleto de una sola columna hace saltar el layout cuando
 * entra el contenido.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Cargando conversación" className="flex flex-1 overflow-hidden">
      <div className="bg-surface-chat flex min-w-[520px] flex-1 flex-col overflow-hidden">
        <div className="border-line-layout flex items-center gap-3 border-b px-5 py-[13px]">
          <div className="bg-surface-avatar h-9 w-9 animate-pulse rounded-[11px]" />
          <div className="flex-1 space-y-2">
            <div className="bg-surface-elevated h-3.5 w-40 animate-pulse rounded" />
            <div className="bg-surface-elevated h-2.5 w-56 animate-pulse rounded" />
          </div>
        </div>
        <div className="flex flex-1 flex-col justify-end gap-[9px] overflow-hidden px-[26px] py-5">
          {BURBUJAS.map((b, i) => (
            <div key={i} className={b.saliente ? "flex justify-end" : "flex justify-start"}>
              <div
                className={`bg-surface-bubble-in h-10 ${b.ancho} animate-pulse rounded-[15px]`}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="border-line-layout bg-surface-panel w-[322px] shrink-0 border-l p-[17px]">
        <div className="bg-surface-elevated h-3 w-24 animate-pulse rounded" />
        <div className="bg-surface-elevated mt-4 h-5 w-32 animate-pulse rounded" />
        <div className="bg-line-card mt-3 h-[3.5px] w-full animate-pulse rounded-full" />
      </div>
    </div>
  );
}
