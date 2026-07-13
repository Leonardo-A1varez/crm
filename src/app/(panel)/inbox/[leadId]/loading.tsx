const BUBBLES = [
  { out: false, w: "w-52" },
  { out: true, w: "w-40" },
  { out: false, w: "w-64" },
  { out: true, w: "w-56" },
  { out: false, w: "w-44" },
];

export default function Loading() {
  return (
    <div className="flex h-screen flex-col">
      <div className="border-border flex items-center gap-3 border-b px-4 py-3">
        <div className="bg-muted h-5 w-5 animate-pulse rounded-full" />
        <div className="flex-1 space-y-2">
          <div className="bg-muted h-4 w-40 animate-pulse rounded" />
          <div className="bg-muted h-3 w-28 animate-pulse rounded" />
        </div>
      </div>
      <div className="flex flex-1 flex-col justify-end gap-2 overflow-hidden px-4 py-3">
        {BUBBLES.map((b, i) => (
          <div key={i} className={b.out ? "flex justify-end" : "flex justify-start"}>
            <div className={`bg-muted h-10 ${b.w} animate-pulse rounded-2xl`} />
          </div>
        ))}
      </div>
    </div>
  );
}
