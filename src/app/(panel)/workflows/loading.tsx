export default function Loading() {
  return (
    <div className="bg-surface-root flex h-full flex-col">
      <div className="border-line-layout bg-surface-panel h-[62px] shrink-0 border-b" />
      <div className="flex flex-col gap-2 p-5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="border-line-layout bg-surface-panel h-[58px] animate-pulse rounded-[11px] border"
          />
        ))}
      </div>
    </div>
  );
}
