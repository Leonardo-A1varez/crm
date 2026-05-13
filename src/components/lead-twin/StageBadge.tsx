export function StageBadge({ stage }: { stage: string }) {
  return <span className="bg-muted inline-block rounded px-2 py-0.5 text-xs">{stage}</span>;
}
