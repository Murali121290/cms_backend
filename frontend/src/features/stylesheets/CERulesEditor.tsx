import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Search,
  Sparkles,
  Filter,
  X,
  Play,
  Check,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ArrowRight,
  Eye,
  SlidersHorizontal,
} from "lucide-react";

import type { CERule, CERuleSettings, CESeverity } from "@/types/api";
import {
  CE_SEVERITIES,
  HOUSE_STYLE_PRESETS,
  deriveFromRows,
  resolveRule,
  updateSetting,
  type CELinkedRow,
  type HouseStylePreset,
} from "./ceRules";

interface CERulesEditorProps {
  rules: CERule[];
  selectedRows: CELinkedRow[];
  settings: CERuleSettings;
  onChange: (settings: CERuleSettings) => void;
  isFullPage?: boolean;
}

interface SamplePrompt {
  id: string;
  label: string;
  ruleId: number;
  text: string;
}

const SAMPLE_PROMPTS: SamplePrompt[] = [
  {
    id: "percentages",
    label: "Percentages (%)",
    ruleId: 6,
    text: "In 2024, 25% of subjects aged 10-15 years received 50mg daily vs 25% in the control cohort. The treatment improved efficacy by 12% overall, with a 5% margin of error across groups.",
  },
  {
    id: "temp_ranges",
    label: "Temperature & Ranges",
    ruleId: 5,
    text: "Samples were incubated at 25 C for 48 hours, followed by storage at 4 C. Patient cohort aged 10-15 years showed temperature fluctuations between 36.5 C and 38.2 C during the trial.",
  },
  {
    id: "latin_editorial",
    label: "Latin & Editorial",
    ruleId: 35,
    text: "Results for group A vs. group B were significant (e.g., p < 0.05). Authors noted in situ hybridization vs standard PCR yielded consistent findings i.e., identical gene expression.",
  },
  {
    id: "dates_numbers",
    label: "Dates & Numbers",
    ruleId: 17,
    text: "Data collection ended on 10/10/2026 at 4:00 PM. A total of 5 subjects were evaluated at -5 C with negative readings down to -10 C on 12/04/2025.",
  },
];

export function CERulesEditor({
  rules,
  selectedRows,
  settings,
  onChange,
  isFullPage = true,
}: CERulesEditorProps) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [showCustomOnly, setShowCustomOnly] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);

  // Active rule preview selection (defaults to Rule 6 - Percentage)
  const [activePreviewRuleId, setActivePreviewRuleId] = useState<number>(6);

  // Live sandbox tester state
  const [showSandbox, setShowSandbox] = useState(true);
  const [sandboxText, setSandboxText] = useState(
    "In 2024, 25% of subjects aged 10-15 years received 50mg at 25 C vs 25% in the control group e.g. group B on 10/10/2026."
  );
  const [feedbackToast, setFeedbackToast] = useState<string | null>(null);

  const { derived } = useMemo(() => deriveFromRows(selectedRows), [selectedRows]);

  // Group rules by domain
  const groups = useMemo(() => {
    const byGroup = new Map<string, CERule[]>();
    for (const rule of rules) {
      if (!byGroup.has(rule.group)) byGroup.set(rule.group, []);
      byGroup.get(rule.group)!.push(rule);
    }
    return Array.from(byGroup.entries());
  }, [rules]);

  // Distinct category names for tabs
  const categories = useMemo(() => {
    return Array.from(new Set(rules.map((r) => r.group)));
  }, [rules]);

  const toggleGroup = (group: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const showNotification = (msg: string) => {
    setFeedbackToast(msg);
    setTimeout(() => setFeedbackToast(null), 3000);
  };

  const handleApplyPreset = (preset: HouseStylePreset) => {
    const next = { ...settings };
    for (const [snoStr, pSetting] of Object.entries(preset.rules)) {
      const rule = rules.find((r) => r.sno === Number(snoStr));
      if (rule) {
        next[snoStr] = { ...(next[snoStr] || {}), ...pSetting };
      }
    }
    onChange(next);
    setSelectedPresetId(preset.id);
    showNotification(`Applied ${preset.name} preset across checklist rules`);
  };

  const promptCustomOption = (rule: CERule) => {
    const current = settings[String(rule.sno)]?.custom_template || "";
    const input = window.prompt(
      `Enter custom formatting pattern for R${rule.sno} ${rule.name}\n(e.g., "{n} percentage points" or "{a} to {b}"):`,
      current
    );
    if (input !== null && input.trim()) {
      const clean = input.trim();
      const updated = {
        ...settings,
        [String(rule.sno)]: {
          ...(settings[String(rule.sno)] || {}),
          option: clean,
          custom_template: clean,
        },
      };
      onChange(updated);
      showNotification(`Set custom template "${clean}" for R${rule.sno}`);
    }
  };

  // Filtered rules by search, category, and custom-only flag
  const filteredGroups = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return groups
      .map(([group, groupRules]) => {
        if (activeCategory !== "all" && group !== activeCategory) {
          return null;
        }
        const matchingRules = groupRules.filter((rule) => {
          const isModified = Boolean(settings[String(rule.sno)] || derived[rule.sno]);
          if (showCustomOnly && !isModified) return false;
          if (!q) return true;
          const textToSearch = `${rule.sno} ${rule.name} ${rule.description} ${rule.needs} ${rule.handling}`.toLowerCase();
          return textToSearch.includes(q);
        });
        if (matchingRules.length === 0) return null;
        return [group, matchingRules] as [string, CERule[]];
      })
      .filter((entry): entry is [string, CERule[]] => entry !== null);
  }, [groups, activeCategory, searchQuery, showCustomOnly, settings, derived]);

  // Total modified count across all rules
  const totalModified = useMemo(() => {
    return rules.filter((r) => settings[String(r.sno)] || derived[r.sno]).length;
  }, [rules, settings, derived]);

  // Compute live diff preview for the sandbox
  const renderedSandboxDiff = useMemo(() => {
    let text = sandboxText;

    // R6 Percentage
    const r6Cfg = resolveRule(rules.find((r) => r.sno === 6) || ({} as any), derived, settings);
    if (r6Cfg.enabled) {
      const opt = r6Cfg.option;
      text = text.replace(/\b(\d+(?:\.\d+)?)\s*%/g, (match, n) => {
        let rep = `${n}%`;
        if (opt === 1) rep = `${n}%`;
        else if (opt === 2) rep = `${n} %`;
        else if (opt === 3) rep = `${n} percent`;
        else if (opt === 4) rep = `${n} per cent`;
        else if (opt === 5) rep = `${n} percentage points`;
        else if (typeof opt === "string") rep = opt.replace("{n}", n);
        if (rep === match) return match;
        return `<del class="bg-red-100 text-red-800 line-through px-1 rounded">${match}</del><ins class="bg-emerald-100 text-emerald-800 font-semibold px-1 rounded no-underline">${rep}</ins>`;
      });
    }

    // R5 Temperature
    const r5Cfg = resolveRule(rules.find((r) => r.sno === 5) || ({} as any), derived, settings);
    if (r5Cfg.enabled) {
      const opt = r5Cfg.option;
      text = text.replace(/\b(\d+(?:\.\d+)?)\s*(?:°\s*C|C\b)/g, (match, n) => {
        let rep = `${n} °C`;
        if (opt === 1) rep = `${n} °C`;
        else if (opt === 2) rep = `${n}°C`;
        else if (opt === 3) rep = `${n} deg C`;
        else if (opt === 4) rep = `${n} degrees Celsius`;
        else if (opt === 5) rep = `${n} °C (${Math.round((Number(n) * 9) / 5 + 32)} °F)`;
        if (rep === match) return match;
        return `<del class="bg-red-100 text-red-800 line-through px-1 rounded">${match}</del><ins class="bg-emerald-100 text-emerald-800 font-semibold px-1 rounded no-underline">${rep}</ins>`;
      });
    }

    // R14 Number Ranges
    const r14Cfg = resolveRule(rules.find((r) => r.sno === 14) || ({} as any), derived, settings);
    if (r14Cfg.enabled) {
      const opt = r14Cfg.option;
      text = text.replace(/\b(\d+)\s*[-–]\s*(\d+)\b/g, (match, a, b) => {
        let rep = `${a}–${b}`;
        if (opt === 1) rep = `${a}–${b}`;
        else if (opt === 2) rep = `${a} to ${b}`;
        else if (opt === 3) rep = `from ${a} to ${b}`;
        else if (opt === 4) rep = `${a} – ${b}`;
        else if (opt === 5) rep = `${a}-${b}`;
        if (rep === match) return match;
        return `<del class="bg-red-100 text-red-800 line-through px-1 rounded">${match}</del><ins class="bg-emerald-100 text-emerald-800 font-semibold px-1 rounded no-underline">${rep}</ins>`;
      });
    }

    // R15 Minus Sign
    const r15Cfg = resolveRule(rules.find((r) => r.sno === 15) || ({} as any), derived, settings);
    if (r15Cfg.enabled) {
      const opt = r15Cfg.option;
      text = text.replace(/(?:\b|\s)-\s*(\d+)/g, (match, n) => {
        let rep = `−${n}`;
        if (opt === 1) rep = `−${n}`;
        else if (opt === 2) rep = `-${n}`;
        else if (opt === 3) rep = `minus ${n}`;
        if (rep === match) return match;
        return `<del class="bg-red-100 text-red-800 line-through px-1 rounded">${match}</del><ins class="bg-emerald-100 text-emerald-800 font-semibold px-1 rounded no-underline">${rep}</ins>`;
      });
    }

    // R35 Latin & Versus
    const r35Cfg = resolveRule(rules.find((r) => r.sno === 35) || ({} as any), derived, settings);
    if (r35Cfg.enabled) {
      const opt = r35Cfg.option;
      text = text.replace(/\b(?:vs\.?|versus)\b/gi, (match) => {
        let rep = match;
        if (opt === 1) rep = "vs.";
        else if (opt === 2) rep = "vs";
        else if (opt === 3) rep = "versus";
        else if (opt === 4) rep = "v.";
        if (rep === match) return match;
        return `<del class="bg-red-100 text-red-800 line-through px-1 rounded">${match}</del><ins class="bg-emerald-100 text-emerald-800 font-semibold px-1 rounded no-underline">${rep}</ins>`;
      });
      text = text.replace(/\be\.g\.?,?/gi, (match) => {
        let rep = match;
        if (opt === 1) rep = "e.g.,";
        else if (opt === 2) rep = "e.g.";
        else if (opt === 3) rep = "for example,";
        if (rep === match) return match;
        return `<del class="bg-red-100 text-red-800 line-through px-1 rounded">${match}</del><ins class="bg-emerald-100 text-emerald-800 font-semibold px-1 rounded no-underline">${rep}</ins>`;
      });
    }

    return text;
  }, [sandboxText, rules, derived, settings]);

  // Active rule for the Reviewer Workspace Preview Card
  const activeRule = useMemo(() => {
    return rules.find((r) => r.sno === activePreviewRuleId) || rules[0] || ({} as CERule);
  }, [rules, activePreviewRuleId]);

  const activeResolved = useMemo(() => {
    return resolveRule(activeRule, derived, settings);
  }, [activeRule, derived, settings]);

  // Simulated finding context and dynamic replacement values for the preview card
  const simulatedFinding = useMemo(() => {
    const sno = activeRule.sno;
    let contextBefore = "Manuscript finding in ";
    let target = activeRule.name || "Sample finding";
    let contextAfter = " under standard publication guidelines.";
    let location = "Chapter 2 · Para 8";
    let styleGuidance = activeRule.description || "Enforces stylesheet standard for editorial consistency.";
    let optionsList: { optVal: number | string; label: string; preview: string }[] = [];

    if (sno === 6) {
      contextBefore = "In 2024, ";
      target = "25%";
      contextAfter = " of subjects aged 10-15 years received 50mg daily vs 25% in the control cohort.";
      location = "Chapter 3 · Para 14";
      styleGuidance =
        "House style dictates consistent percentage representation across clinical trial chapters. Use symbol % with numbers in scientific context or spell out per publisher guidelines.";
      optionsList = [
        { optVal: 1, label: "Closed symbol", preview: "25%" },
        { optVal: 2, label: "Spaced symbol", preview: "25 %" },
        { optVal: 3, label: "US Spelled", preview: "25 percent" },
        { optVal: 4, label: "UK Spelled", preview: "25 per cent" },
        { optVal: 5, label: "Delta/Margin", preview: "25 percentage points" },
      ];
    } else if (sno === 5) {
      contextBefore = "Samples were incubated at ";
      target = "25 C";
      contextAfter = " for 48 hours, followed by storage at 4 C under controlled humidity.";
      location = "Chapter 2 · Methods · Para 8";
      styleGuidance =
        "Standard SI convention requires degree symbol attached to Celsius abbreviation with appropriate spacing.";
      optionsList = [
        { optVal: 1, label: "Spaced degree", preview: "25 °C" },
        { optVal: 2, label: "Closed degree", preview: "25°C" },
        { optVal: 3, label: "Spelled deg", preview: "25 deg C" },
        { optVal: 4, label: "Spelled out", preview: "25 degrees Celsius" },
        { optVal: 5, label: "Dual °C (°F)", preview: "25 °C (77 °F)" },
      ];
    } else if (sno === 14) {
      contextBefore = "Patient cohort aged ";
      target = "10-15";
      contextAfter = " years showed significant biomarker reduction across trial arms.";
      location = "Chapter 4 · Results · Para 3";
      styleGuidance =
        "Inclusive numeric ranges should use an en-dash (–) closed, or words 'from ... to ...' when preceded by 'from'.";
      optionsList = [
        { optVal: 1, label: "En-dash closed", preview: "10–15" },
        { optVal: 2, label: "Word 'to'", preview: "10 to 15" },
        { optVal: 3, label: "From-to phrase", preview: "from 10 to 15" },
        { optVal: 4, label: "En-dash spaced", preview: "10 – 15" },
        { optVal: 5, label: "Hyphen", preview: "10-15" },
      ];
    } else if (sno === 15) {
      contextBefore = "External sensor readings recorded ambient temperatures down to ";
      target = "-5 °C";
      contextAfter = " during the overnight testing cycle.";
      location = "Chapter 3 · Experiments · Para 19";
      styleGuidance =
        "Hyphens should not be used as mathematical minus operators. Replace with Unicode U+2212 (−).";
      optionsList = [
        { optVal: 1, label: "Unicode minus", preview: "−5 °C" },
        { optVal: 2, label: "ASCII hyphen", preview: "-5 °C" },
        { optVal: 3, label: "Spelled out", preview: "minus 5 °C" },
      ];
    } else if (sno === 17) {
      contextBefore = "The protocol was approved on ";
      target = "10/10/2026";
      contextAfter = " by the institutional review committee and ethics board.";
      location = "Chapter 1 · Ethics · Para 2";
      styleGuidance =
        "Avoid ambiguous numeric slashes. Adopt either standard British (10 October 2026) or American (October 10, 2026) format.";
      optionsList = [
        { optVal: 1, label: "British (DD Month YYYY)", preview: "10 October 2026" },
        { optVal: 2, label: "American (Month DD, YYYY)", preview: "October 10, 2026" },
        { optVal: 3, label: "ISO 8601", preview: "2026-10-10" },
        { optVal: 4, label: "Dot format", preview: "10.10.2026" },
      ];
    } else if (sno === 19) {
      contextBefore = "Secondary intravenous infusion commenced at ";
      target = "4:00 PM";
      contextAfter = " following the initial 2-hour observation period.";
      location = "Chapter 2 · Dosage · Para 6";
      styleGuidance =
        "Ensure uniform time typography: lowercase spaced 'p.m.' vs uppercase 'PM' vs 24-hour notation.";
      optionsList = [
        { optVal: 1, label: "Lowercase with periods", preview: "4:00 p.m." },
        { optVal: 2, label: "Uppercase sans periods", preview: "4:00 PM" },
        { optVal: 3, label: "24-hour time", preview: "16:00" },
        { optVal: 4, label: "Military notation", preview: "16:00 h" },
      ];
    } else if (sno === 35) {
      contextBefore = "Survival outcomes for group A ";
      target = "vs.";
      contextAfter = " group B demonstrated statistical variance (e.g., p < 0.05).";
      location = "Chapter 4 · Discussion · Para 12";
      styleGuidance =
        "Scientific papers typically abbreviate to 'vs.' with a period, while legal and UK styles may prefer 'v.' or 'versus'.";
      optionsList = [
        { optVal: 1, label: "Abbreviated with dot", preview: "vs." },
        { optVal: 2, label: "Abbreviated no dot", preview: "vs" },
        { optVal: 3, label: "Spelled out", preview: "versus" },
        { optVal: 4, label: "Legal italic", preview: "v." },
      ];
    } else {
      // General dynamic fallback for any other rule
      optionsList = (activeRule.options || []).map((text, i) => ({
        optVal: i + 1,
        label: text,
        preview: text.length > 20 ? `${text.slice(0, 18)}…` : text,
      }));
    }

    // Determine current replacement text
    let currentReplacement = target;
    const matchOpt = optionsList.find((o) => o.optVal === activeResolved.option);
    if (matchOpt) {
      currentReplacement = matchOpt.preview;
    } else if (activeResolved.custom_template) {
      currentReplacement = activeResolved.custom_template.replace("{n}", target);
    }

    return {
      contextBefore,
      target,
      contextAfter,
      location,
      styleGuidance,
      optionsList,
      currentReplacement,
    };
  }, [activeRule, activeResolved]);

  const setRuleField = (
    rule: CERule,
    field: "enabled" | "option" | "severity",
    value: boolean | number | string
  ) => {
    onChange(updateSetting(settings, rule, derived, field, value));
  };

  /* -------------------------------------------------------------------------- */
  /* Reusable Sub-Components                                                    */
  /* -------------------------------------------------------------------------- */

  // 1. Quick House Style Presets Bar
  const PresetsBar = (
    <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-2 shadow-xs">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-amber-600" />
          Quick House Style Presets
        </span>
        <span className="text-[11px] text-slate-500 font-medium">
          {totalModified} of {rules.length} custom rules configured
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {HOUSE_STYLE_PRESETS.map((p) => {
          const isActive = selectedPresetId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => handleApplyPreset(p)}
              title={p.description}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                isActive
                  ? "bg-slate-900 text-white border-slate-900 shadow-xs ring-2 ring-slate-400"
                  : "bg-white hover:bg-slate-100 text-slate-700 border-slate-300"
              }`}
            >
              {p.name}
            </button>
          );
        })}
      </div>
    </div>
  );

  // 2. Search & Filter Bar
  const SearchAndFilterBar = (
    <div className="space-y-2">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search 72 checklist rules (e.g. percent, dash, units, date, minus, latin)..."
          className="w-full pl-9 pr-8 py-2 rounded-md border border-slate-300 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-xs"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
        <button
          type="button"
          onClick={() => setActiveCategory("all")}
          className={`px-2.5 py-1 rounded border whitespace-nowrap font-medium transition-colors ${
            activeCategory === "all"
              ? "bg-slate-800 text-white border-slate-800 font-semibold"
              : "bg-white text-slate-600 hover:bg-slate-100 border-slate-200"
          }`}
        >
          All ({rules.length})
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setActiveCategory(cat)}
            className={`px-2.5 py-1 rounded border whitespace-nowrap font-medium transition-colors ${
              activeCategory === cat
                ? "bg-slate-800 text-white border-slate-800 font-semibold"
                : "bg-white text-slate-600 hover:bg-slate-100 border-slate-200"
            }`}
          >
            {cat}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowCustomOnly(!showCustomOnly)}
          className={`ml-auto px-2.5 py-1 rounded border whitespace-nowrap font-medium text-[11px] transition-colors ${
            showCustomOnly
              ? "bg-amber-100 text-amber-900 border-amber-300 font-semibold"
              : "bg-white text-slate-500 hover:bg-slate-100 border-slate-200"
          }`}
        >
          <Filter className="w-3 h-3 inline mr-1" />
          Modified Only ({totalModified})
        </button>
      </div>
    </div>
  );

  // 3. Technical Review Workspace Card Preview (Interactive Live Card)
  const ReviewerCardPreview = (
    <div className="border border-slate-300 rounded-lg overflow-hidden bg-white shadow-sm">
      <div className="px-3.5 py-2.5 bg-slate-900 text-white flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[11px] font-bold uppercase tracking-wider">
            Reviewer Workspace Live Card
          </span>
        </div>
        <span className="text-[10px] font-mono text-amber-300 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
          FindReplaceMasterCard
        </span>
      </div>

      <div className="p-4 space-y-3.5">
        {/* Finding Tag Bar */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono font-extrabold text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300">
              R{activeRule.sno}
            </span>
            <span className="text-xs font-bold text-slate-900 truncate">
              {activeRule.name}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                activeResolved.severity === "Critical"
                  ? "bg-red-100 text-red-800 border border-red-300"
                  : activeResolved.severity === "Major"
                  ? "bg-amber-100 text-amber-800 border border-amber-300"
                  : "bg-blue-100 text-blue-800 border border-blue-300"
              }`}
            >
              {activeResolved.severity}
            </span>
            <span className="text-[11px] text-slate-400 font-mono">
              {simulatedFinding.location}
            </span>
          </div>
        </div>

        {/* Context Snippet with Highlighted Finding */}
        <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-md text-xs font-serif leading-relaxed text-slate-800">
          <span className="text-slate-500">{simulatedFinding.contextBefore}</span>
          <mark className="bg-red-100 text-red-900 font-sans font-bold px-1.5 py-0.5 rounded border border-red-300 mx-0.5">
            {simulatedFinding.target}
          </mark>
          <span className="text-slate-500">{simulatedFinding.contextAfter}</span>
        </div>

        {/* Current Active Replacement Output Banner */}
        <div className="flex items-center justify-between p-2 rounded bg-emerald-50/70 border border-emerald-200 text-xs">
          <span className="text-[11px] font-semibold text-emerald-900">
            Current House Style Fix:
          </span>
          <span className="font-mono font-bold text-emerald-800 bg-white px-2 py-0.5 rounded border border-emerald-300 shadow-2xs">
            {simulatedFinding.currentReplacement}
          </span>
        </div>

        {/* Dynamic Options Grid */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Rule Options (Click to change house style):
            </span>
            <span className="text-[10px] text-slate-400">
              Option {activeResolved.option} active
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {simulatedFinding.optionsList.map((opt) => {
              const isSelected = activeResolved.option === opt.optVal;
              return (
                <button
                  key={String(opt.optVal)}
                  type="button"
                  onClick={() => {
                    setRuleField(activeRule, "option", opt.optVal);
                    showNotification(`R${activeRule.sno} option set to "${opt.preview}"`);
                  }}
                  className={`flex items-center justify-between p-2 rounded text-xs border text-left transition-all ${
                    isSelected
                      ? "bg-amber-50 text-amber-950 border-amber-400 font-semibold shadow-xs ring-1 ring-amber-400"
                      : "bg-white hover:bg-slate-50 text-slate-700 border-slate-200"
                  }`}
                >
                  <div className="min-w-0 pr-1">
                    <span className="text-[10px] font-mono opacity-60 mr-1">
                      {opt.optVal}.
                    </span>
                    <span className="truncate">{opt.label}</span>
                  </div>
                  <span className="font-mono text-[11px] font-bold text-slate-900 shrink-0 bg-slate-100 px-1.5 py-0.5 rounded">
                    {opt.preview}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Action Buttons Simulation */}
        <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
          <button
            type="button"
            onClick={() => showNotification("Simulated fix applied to chapter!")}
            className="flex-1 py-1.5 px-3 bg-primary text-white rounded text-xs font-semibold hover:bg-primary/90 transition-colors shadow-2xs"
          >
            Accept Fix (Alt+A)
          </button>
          <button
            type="button"
            onClick={() => showNotification("Simulated: Rule applied to all 14 findings in file!")}
            className="py-1.5 px-3 bg-slate-100 text-slate-700 rounded text-xs font-medium hover:bg-slate-200 transition-colors"
          >
            Replace All
          </button>
          <button
            type="button"
            onClick={() => showNotification("Simulated: Author query logged in AQ dossier!")}
            className="py-1.5 px-3 text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded text-xs font-medium transition-colors"
          >
            Query
          </button>
        </div>

        {/* Editorial Guideline Tip */}
        <div className="p-2.5 bg-amber-50/50 rounded-md border border-amber-200/80 text-[11px] text-amber-950 flex items-start gap-2">
          <HelpCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="leading-snug">{simulatedFinding.styleGuidance}</p>
        </div>
      </div>
    </div>
  );

  // 4. Try-it-Out Live Preview Diff Sandbox
  const LiveDiffSandbox = (
    <div className="border border-slate-300 rounded-lg overflow-hidden bg-white shadow-sm">
      <div className="w-full flex items-center justify-between px-3.5 py-2.5 bg-slate-50 border-b border-slate-200">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
          <Play className="w-3.5 h-3.5 text-emerald-600" />
          Try-it-Out Live Diff Sandbox
        </span>
        <span className="text-[10px] text-slate-500 font-medium">Real-Time Transformation</span>
      </div>

      <div className="p-3.5 space-y-3">
        {/* Sample text prompts */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">
            Samples:
          </span>
          {SAMPLE_PROMPTS.map((sample) => (
            <button
              key={sample.id}
              type="button"
              onClick={() => {
                setSandboxText(sample.text);
                setActivePreviewRuleId(sample.ruleId);
              }}
              className={`px-2 py-0.5 rounded text-[11px] border font-medium transition-colors ${
                activePreviewRuleId === sample.ruleId
                  ? "bg-slate-800 text-white border-slate-800"
                  : "bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200"
              }`}
            >
              {sample.label}
            </button>
          ))}
        </div>

        {/* Editable test text */}
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
            Input Manuscript Sentence:
          </label>
          <textarea
            rows={2}
            value={sandboxText}
            onChange={(e) => setSandboxText(e.target.value)}
            placeholder="Type or paste text to test how rules transform live..."
            className="w-full p-2.5 text-xs font-serif border border-slate-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>

        {/* Transformed Diff Box */}
        <div>
          <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block mb-1">
            Live Transformed Diff (<span className="text-emerald-700 font-semibold">ins</span> /{" "}
            <span className="text-red-700 line-through">del</span>):
          </span>
          <div className="p-3 bg-slate-900 text-slate-100 rounded text-xs font-serif leading-relaxed border border-slate-800 shadow-inner">
            <div dangerouslySetInnerHTML={{ __html: renderedSandboxDiff }} />
          </div>
        </div>
      </div>
    </div>
  );

  // 5. Accordion Grouped Rules List
  const RulesAccordionList = (
    <div className="border border-border rounded-lg overflow-hidden divide-y divide-border bg-white shadow-xs">
      {filteredGroups.length === 0 ? (
        <div className="p-8 text-center text-xs text-muted">
          No rules match your search criteria. Try clearing filters or search term.
        </div>
      ) : (
        filteredGroups.map(([group, groupRules]) => {
          const changed = groupRules.filter((r) => settings[String(r.sno)] || derived[r.sno]).length;
          const isOpen = openGroups.has(group) || searchQuery.trim().length > 0;
          return (
            <div key={group}>
              <button
                type="button"
                onClick={() => toggleGroup(group)}
                className="w-full flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-slate-50 transition-colors text-left"
              >
                <span className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                  {group}
                </span>
                <span className="flex items-center gap-2 text-[11px] text-muted">
                  {groupRules.length} rule{groupRules.length === 1 ? "" : "s"}
                  {changed > 0 && (
                    <span className="font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                      {changed} customized
                    </span>
                  )}
                  {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </span>
              </button>
              {isOpen && (
                <div className="px-4 pb-3 bg-white border-t border-border divide-y divide-border">
                  {groupRules.map((rule) => {
                    const resolved = resolveRule(rule, derived, settings);
                    const isSelectedInPreview = activePreviewRuleId === rule.sno;

                    return (
                      <div
                        key={rule.sno}
                        onClick={() => setActivePreviewRuleId(rule.sno)}
                        className={`py-3 space-y-2 cursor-pointer transition-all rounded px-2 -mx-2 ${
                          isSelectedInPreview
                            ? "bg-amber-50/40 ring-1 ring-amber-300 shadow-2xs"
                            : "hover:bg-slate-50/80"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                              <span className="font-mono font-bold text-[11px] bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded border border-slate-200">
                                R{rule.sno}
                              </span>
                              <span>{rule.name}</span>
                              {isSelectedInPreview && (
                                <span className="text-[10px] text-amber-800 font-bold bg-amber-100 px-1.5 py-0.2 rounded border border-amber-300 inline-flex items-center gap-1">
                                  <Eye className="w-3 h-3" /> Previewing
                                </span>
                              )}
                            </p>
                            <p className="text-[11px] text-muted mt-0.5">
                              {rule.handling} · needs {rule.needs}
                              {rule.detectable === "manual" && " · manual check"}
                            </p>
                          </div>
                          <div
                            className="flex items-center gap-2 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <select
                              aria-label={`Severity for rule ${rule.sno}`}
                              value={resolved.severity}
                              disabled={!resolved.enabled}
                              onChange={(e) =>
                                setRuleField(rule, "severity", e.target.value as CESeverity)
                              }
                              className="px-1.5 py-0.5 rounded border border-border text-[11px] bg-white disabled:opacity-50"
                            >
                              {CE_SEVERITIES.map((s) => (
                                <option key={s}>{s}</option>
                              ))}
                            </select>
                            <label className="flex items-center gap-1 text-[11px] text-muted cursor-pointer font-medium">
                              <input
                                type="checkbox"
                                checked={resolved.enabled}
                                onChange={(e) => setRuleField(rule, "enabled", e.target.checked)}
                                className="rounded border-border text-primary focus:ring-primary"
                              />
                              On
                            </label>
                          </div>
                        </div>

                        {/* Segmented Option Chips */}
                        <div className="space-y-1">
                          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                            Rule Options:
                          </span>
                          <div
                            className="flex flex-wrap gap-1.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {rule.options.map((text, i) => {
                              const optVal = i + 1;
                              const isSelected = resolved.option === optVal;
                              return (
                                <button
                                  key={i}
                                  type="button"
                                  disabled={!resolved.enabled}
                                  onClick={() => {
                                    setRuleField(rule, "option", optVal);
                                    setActivePreviewRuleId(rule.sno);
                                    showNotification(`R${rule.sno} option set to ${optVal}`);
                                  }}
                                  className={`px-2 py-1 rounded text-[11px] border text-left transition-all ${
                                    isSelected
                                      ? "bg-amber-100 text-amber-950 border-amber-400 font-semibold shadow-xs"
                                      : "bg-white hover:bg-slate-50 text-slate-700 border-slate-200"
                                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                                >
                                  <span className="font-mono opacity-60 mr-1">{optVal}.</span>
                                  {text}
                                </button>
                              );
                            })}
                            {resolved.custom_template && (
                              <button
                                type="button"
                                disabled={!resolved.enabled}
                                onClick={() => promptCustomOption(rule)}
                                className="px-2 py-1 rounded text-[11px] border border-amber-400 bg-amber-50 text-amber-900 font-semibold"
                              >
                                Custom: "{resolved.custom_template}"
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={!resolved.enabled}
                              onClick={() => promptCustomOption(rule)}
                              className="px-2 py-1 rounded text-[11px] border border-dashed border-blue-300 text-blue-600 hover:bg-blue-50 transition-colors"
                            >
                              + Custom
                            </button>
                          </div>
                        </div>

                        {resolved.fromIaRow && (
                          <p className="text-[11px] text-amber-700 font-medium">
                            From IA row: {resolved.fromIaRow}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );

  /* -------------------------------------------------------------------------- */
  /* Main Layout Render                                                         */
  /* -------------------------------------------------------------------------- */

  // 1. FULL PAGE PREVIEW MODE (Side-by-Side 2-Column Split Studio)
  if (isFullPage) {
    return (
      <div className="relative">
        {/* Floating feedback notification toast */}
        {feedbackToast && (
          <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white text-xs px-3.5 py-2 rounded-lg shadow-lg flex items-center gap-2 border border-slate-700 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{feedbackToast}</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column (60%): Presets, Filters, 72 Checklist Rules */}
          <div className="lg:col-span-7 space-y-4">
            {PresetsBar}
            {SearchAndFilterBar}
            {RulesAccordionList}
          </div>

          {/* Right Column (40%): Sticky Studio Live Preview Panel */}
          <div className="lg:col-span-5 space-y-4 sticky top-0">
            {ReviewerCardPreview}
            {LiveDiffSandbox}
          </div>
        </div>
      </div>
    );
  }

  // 2. DRAWER MODE (Compact Single-Column with Collapsible Sandbox)
  return (
    <div className="space-y-3">
      {PresetsBar}
      {SearchAndFilterBar}

      {/* Collapsible Sandbox for Drawer Mode */}
      <div className="border border-slate-200 rounded-md overflow-hidden bg-white">
        <button
          type="button"
          onClick={() => setShowSandbox(!showSandbox)}
          className="w-full flex items-center justify-between px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-left border-b border-slate-200"
        >
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
            <Play className="w-3 h-3 text-emerald-600" />
            Try-it-Out Live Preview Sandbox
          </span>
          <span className="text-[10px] text-slate-500">
            {showSandbox ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </span>
        </button>
        {showSandbox && (
          <div className="p-3 space-y-2 bg-slate-50/50">
            <textarea
              rows={2}
              value={sandboxText}
              onChange={(e) => setSandboxText(e.target.value)}
              placeholder="Type or paste sample text..."
              className="w-full p-2 text-xs font-serif border border-slate-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
            <div className="p-2 bg-slate-900 text-slate-100 rounded text-xs font-serif leading-relaxed">
              <span className="text-[10px] uppercase font-sans font-bold tracking-wider text-slate-400 block mb-1">
                Live Transformed Diff:
              </span>
              <div dangerouslySetInnerHTML={{ __html: renderedSandboxDiff }} />
            </div>
          </div>
        )}
      </div>

      {RulesAccordionList}
    </div>
  );
}
