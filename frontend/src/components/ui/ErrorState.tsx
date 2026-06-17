import type { ReactNode } from "react";

interface ErrorStateProps {
  title: string;
  message: string;
  actions?: ReactNode;
  compact?: boolean;
}

export function ErrorState({ title, message, actions, compact = false }: ErrorStateProps) {
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
