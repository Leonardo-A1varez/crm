import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2.5 p-8 text-center">
      {icon ? <div className="text-ink-ghost">{icon}</div> : null}
      <h3 className="text-ink-secondary text-[13.5px] font-[650] tracking-[-0.01em]">{title}</h3>
      {description ? (
        <p className="text-ink-faint max-w-[340px] text-[11.5px] leading-relaxed">{description}</p>
      ) : null}
      {action ? <div className="mt-1.5">{action}</div> : null}
    </div>
  );
}
