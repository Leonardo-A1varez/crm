export function TwinField({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div>{value ?? "—"}</div>
    </div>
  );
}
