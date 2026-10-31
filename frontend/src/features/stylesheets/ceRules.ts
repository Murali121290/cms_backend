import type { CERule, CERuleSetting, CERuleSettings, CESeverity, IARow } from "@/types/api";

export const CE_SEVERITIES: CESeverity[] = ["Critical", "Major", "Minor", "Informational"];

/** An IA row that carries the checklist rule and option it implies. */
export interface CELinkedRow extends IARow {
  ce_rule_no?: number | null;
  ce_option?: number | null;
}

export interface DerivedOption {
  option: number | string;
  from: string;
}

/**
 * Options implied by ticked IA rows (mirrors ce_rules.derive_from_ia_rows on the
 * backend): the first ticked row wins, and a rule with two different options
 * ticked is reported as a conflict.
 */
export function deriveFromRows(rows: CELinkedRow[]): {
  derived: Record<number, DerivedOption>;
  conflicts: number[];
} {
  const derived: Record<number, DerivedOption> = {};
  const conflicts: number[] = [];
  for (const row of rows) {
    if (!row.ce_rule_no || !row.ce_option) continue;
    const existing = derived[row.ce_rule_no];
    if (existing) {
      if (existing.option !== row.ce_option && !conflicts.includes(row.ce_rule_no)) {
        conflicts.push(row.ce_rule_no);
      }
      continue;
    }
    derived[row.ce_rule_no] = {
      option: row.ce_option,
      from: `${row.element}: ${row.pattern}`,
    };
  }
  return { derived, conflicts };
}

export interface ResolvedRule {
  enabled: boolean;
  option: number | string;
  severity: CESeverity;
  fromIaRow: string | null;
  custom_template?: string;
}

/** Catalog default, then IA-row option, then the stylesheet's explicit setting. */
export function resolveRule(
  rule: CERule,
  derived: Record<number, DerivedOption>,
  settings: CERuleSettings,
): ResolvedRule {
  const explicit = settings[String(rule.sno)] ?? {};
  const fromRow = derived[rule.sno];
  return {
    enabled: explicit.enabled ?? true,
    option: explicit.option ?? fromRow?.option ?? 1,
    severity: explicit.severity ?? rule.severity,
    fromIaRow: explicit.option === undefined && fromRow ? fromRow.from : null,
    custom_template: explicit.custom_template,
  };
}

/** Store only what differs from the inherited value, so the stylesheet stays small. */
export function updateSetting(
  settings: CERuleSettings,
  rule: CERule,
  derived: Record<number, DerivedOption>,
  field: keyof CERuleSetting,
  value: boolean | number | string,
): CERuleSettings {
  const inherited: Record<string, unknown> = {
    enabled: true,
    option: derived[rule.sno]?.option ?? 1,
    severity: rule.severity,
  };
  const key = String(rule.sno);
  const next: CERuleSetting = { ...(settings[key] ?? {}) };
  if (inherited[field] === value) {
    delete (next as Record<string, unknown>)[field];
  } else {
    (next as Record<string, unknown>)[field] = value;
  }
  const out = { ...settings };
  if (Object.keys(next).length === 0) delete out[key];
  else out[key] = next;
  return out;
}

export interface HouseStylePreset {
  id: string;
  name: string;
  badge: string;
  description: string;
  rules: Record<number, { option?: number | string; severity?: CESeverity; enabled?: boolean }>;
}

export const HOUSE_STYLE_PRESETS: HouseStylePreset[] = [
  {
    id: "chicago",
    name: "Chicago (CMOS)",
    badge: "Chicago Manual of Style (US)",
    description: "Words 0–99, US dates, closed range en dashes, 'percent' in prose, dotted a.m./p.m.",
    rules: {
      6: { option: 3 }, // 25 percent
      5: { option: 1 }, // 25 °C
      14: { option: 1 }, // 10–15 closed en-dash
      13: { option: 2 }, // 0–99 spelled
      17: { option: 2 }, // October 10, 2026
      19: { option: 1 }, // 3:30 p.m.
      35: { option: 1 }, // e.g., & vs.
    },
  },
  {
    id: "ama",
    name: "AMA 11th Edition",
    badge: "AMA 11th Edition (Medical)",
    description: "Numerals for all quantities, metric SI units, closed 25%, closed 25°C, undotted pm",
    rules: {
      6: { option: 1 }, // 25% closed
      5: { option: 2 }, // 25°C closed
      14: { option: 2 }, // 10 to 15
      13: { option: 3 }, // Numerals for all
      17: { option: 2 }, // October 10, 2026
      19: { option: 3 }, // 3:30 PM / 3:30 pm
      35: { option: 1 }, // e.g.,
    },
  },
  {
    id: "oxford",
    name: "Oxford / Cambridge (UK)",
    badge: "Oxford University Press (UK)",
    description: "Two-word 'per cent', UK dates (10 October 2026), spaced en dashes, undotted 'vs'",
    rules: {
      6: { option: 4 }, // 25 per cent
      5: { option: 1 }, // 25 °C
      14: { option: 4 }, // 10 – 15 spaced
      13: { option: 1 }, // 0–9 spelled
      17: { option: 1 }, // 10 October 2026
      19: { option: 2 }, // 3:30 pm
      35: { option: 2 }, // e.g. & vs
    },
  },
  {
    id: "apa",
    name: "APA 7th Edition",
    badge: "APA 7th Edition",
    description: "Closed %, words 0–9, numerals 10+, US dates, dotted a.m./p.m., e.g., with comma",
    rules: {
      6: { option: 1 }, // 25%
      5: { option: 1 }, // 25 °C
      14: { option: 1 }, // 10–15
      13: { option: 1 }, // 0–9 spelled
      17: { option: 2 }, // October 10, 2026
      19: { option: 1 }, // 3:30 p.m.
      35: { option: 1 }, // e.g.,
    },
  },
  {
    id: "nature",
    name: "Nature / Springer",
    badge: "Nature Publishing Group",
    description: "Closed %, spaced °C, closed en-dashes, numerals throughout, UK dates, 24-hour time",
    rules: {
      6: { option: 1 }, // 25%
      5: { option: 1 }, // 25 °C
      14: { option: 1 }, // 10–15
      13: { option: 3 }, // numerals throughout
      17: { option: 1 }, // 10 October 2026
      19: { option: 4 }, // 15:30 24h
      35: { option: 1 }, // e.g.,
    },
  },
];
