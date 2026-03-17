import type { TechnicalIssue } from "@/types/api";

interface TechnicalIssuesFormProps {
  issues: TechnicalIssue[];
  replacements: Record<string, string>;
  isPending: boolean;
  canApply: boolean;
  onReplacementChange: (issueKey: string, value: string) => void;
  onSubmit: () => void | Promise<void>;
}

export function TechnicalIssuesForm({
  issues,
  replacements,
  isPending,
  canApply,
  onReplacementChange,
  onSubmit,
}: TechnicalIssuesFormProps) {
  return (
    <section className="panel stack">
      <div className="section-title">
        <h2>Technical review issues</h2>
        <span className="helper-text">Uses the normalized `issues` list from the current /api/v2 contract.</span>
      </div>

      <div className="issue-list">
        {issues.map((issue) => {
          const currentValue = replacements[issue.key] ?? "";
          const hasOptions = issue.options.length > 0;

          return (
            <article className="issue-card" key={issue.key}>
              <div className="issue-header">
                <div>
                  <h3>{issue.label}</h3>
                  <p className="helper-text">
                    {issue.category || "uncategorized"} · {issue.count} match{issue.count === 1 ? "" : "es"}
                  </p>
                </div>
              </div>

              {issue.found.length > 0 ? (
                <div className="issue-found">
                  <strong>Found:</strong> {issue.found.join(", ")}
                </div>
              ) : null}

              <label className="field">
                <span>Replacement</span>
                {hasOptions ? (
                  <select
                    className="select-input"
                    disabled={isPending}
                    value={currentValue}
                    onChange={(event) => onReplacementChange(issue.key, event.target.value)}
                  >
                    {issue.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="search-input"
                    disabled={isPending}
                    placeholder="Enter replacement"
                    type="text"
                    value={currentValue}
                    onChange={(event) => onReplacementChange(issue.key, event.target.value)}
                  />
                )}
              </label>
            </article>
          );
        })}
      </div>

      <div className="upload-actions">
        <button
          className="button"
          disabled={isPending || !canApply}
          type="button"
          onClick={() => void onSubmit()}
        >
          {isPending ? "Applying..." : "Apply technical review"}
        </button>
      </div>
    </section>
  );
}
