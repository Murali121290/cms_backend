import { Info } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { TechnicalIssue } from "@/types/api";

interface TechnicalIssuesFormProps {
  issues: TechnicalIssue[];
  replacements: Record<string, string>;
  isPending: boolean;
  canApply: boolean;
  onReplacementChange: (issueKey: string, value: string) => void;
  onSubmit: () => void | Promise<void>;
}

function groupIssuesByCategory(issues: TechnicalIssue[]) {
  const groups = new Map<string, TechnicalIssue[]>();

  issues.forEach((issue) => {
    const key = issue.category?.trim() || "General";
    const existing = groups.get(key) ?? [];
    existing.push(issue);
    groups.set(key, existing);
  });

  return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right));
}

export function TechnicalIssuesForm({
  issues,
  replacements,
  isPending,
  canApply,
  onReplacementChange,
  onSubmit,
}: TechnicalIssuesFormProps) {
  const groupedIssues = groupIssuesByCategory(issues);

  return (
    <section className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-navy-900">Issues Found</h2>
          <Badge variant="default" size="sm">
            {issues.length}
          </Badge>
        </div>
      </div>

      {/* Issue groups */}
      <div className="space-y-3">
        {groupedIssues.map(([category, categoryIssues]) => (
          <div key={category}>
            <div className="mb-2">
              <Badge variant="info" size="sm">
                {category}
              </Badge>
            </div>
            <div className="space-y-3">
              {categoryIssues.map((issue) => {
                const currentValue = replacements[issue.key] ?? "";
                const hasOptions = issue.options.length > 0;

                return (
                  <div
                    className="bg-white rounded-lg shadow-card p-4 mb-3"
                    key={issue.key}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-navy-900">{issue.label}</span>
                        <Badge variant="default" size="sm">
                          {category}
                        </Badge>
                      </div>
                      <span className="text-sm text-navy-500 shrink-0">
                        {issue.count} occurrence{issue.count === 1 ? "" : "s"}
                      </span>
                    </div>

                    {issue.found.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {issue.found.map((item, idx) => (
                          <span
                            key={idx}
                            className="inline-block px-2 py-0.5 bg-surface-200 text-navy-600 text-xs rounded"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-3">
                      {hasOptions ? (
                        <div className="space-y-1.5">
                          <p className="text-xs font-medium text-navy-500 uppercase tracking-wide mb-2">
                            Select replacement
                          </p>
                          {issue.options.map((option) => (
                            <label
                              key={`${issue.key}-${option}`}
                              className="flex items-center gap-2 cursor-pointer"
                            >
                              <input
                                checked={currentValue === option}
                                disabled={isPending}
                                name={issue.key}
                                type="radio"
                                value={option}
                                className="accent-gold-600"
                                onChange={(e) => onReplacementChange(issue.key, e.target.value)}
                              />
                              <span className="text-sm text-navy-700">{option}</span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <div>
                          <label className="block text-xs font-medium text-navy-500 uppercase tracking-wide mb-1.5">
                            Replacement
                          </label>
                          <input
                            className="w-full border border-surface-400 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold-600 focus:border-transparent disabled:opacity-50"
                            disabled={isPending}
                            placeholder="Enter replacement"
                            type="text"
                            value={currentValue}
                            onChange={(e) => onReplacementChange(issue.key, e.target.value)}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Apply All button */}
      <div className="pt-2">
        <Button
          variant="primary"
          disabled={isPending || !canApply}
          isLoading={isPending}
          onClick={() => void onSubmit()}
        >
          Apply All
        </Button>
      </div>
    </section>
  );
}
