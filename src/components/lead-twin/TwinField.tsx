export function TwinField({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <div className="text-ink-faint text-[10.5px]">{label}</div>
      <div className="text-ink-secondary mt-[3px] text-[12.5px]">{value ?? "—"}</div>
    </div>
  );
}
