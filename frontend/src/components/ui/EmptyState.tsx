import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  message: string;
  actions?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ title, message, actions, compact = false }: EmptyStateProps) {
  return (
    <section className={compact ? "stack" : "page"}>
      <div className="feedback">
        <h2>{title}</h2>
        <p>{message}</p>
        {actions ? <div className="feedback-actions">{actions}</div> : null}
      </div>
    </section>
  );
}
