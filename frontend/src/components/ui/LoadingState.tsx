import type { ReactNode } from "react";

interface LoadingStateProps {
  title: string;
  message: string;
  compact?: boolean;
  actions?: ReactNode;
}

export function LoadingState({ title, message, compact = false, actions }: LoadingStateProps) {
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
