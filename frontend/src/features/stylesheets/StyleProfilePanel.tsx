import { useMemo, useState } from "react";
import {
  BookOpen,
  X,
  AlertTriangle,
  ShieldAlert,
  Search,
  Sparkles,
  Info,
  CheckCircle2,
  FileText,
  Tag,
} from "lucide-react";

import type { StyleProfile, UnresolvedSpec, WordReplacement } from "@/types/api";

export const SPRINGER_BOOK_TYPES: Record<string, string> = {
  standard: "Standard",
  pa: "PA / APRN / NP book",
  demos: "Demos Medical",
  qa: "Q&A / certification review",
};

export const SPRINGER_LIST_STYLES: Record<string, string> = {
  narrative: "Narrative-style lists",
  outline: "Outline-style lists",
};

type Tab =
  | "red_flags"
  | "avoid_words"
  | "replacements"
  | "orgs"
  | "words"
  | "acronyms"
  | "registered"
  | "structural"
  | "unresolved";

interface StyleProfilePanelProps {
  profile: StyleProfile;
  unresolved?: UnresolvedSpec[];
  onChange: (next: StyleProfile) => void;
  onBookTypeChange?: (bookType: string, listStyle: string) => void;
  isApplyingBookType?: boolean;
}

/**
 * Editorial Style Profile & Red Flags Hub:
 * Displays and allows managing publisher word lists, Rule 125 Red Flags,
 * Rule 96 Avoid/Sensitive terms, Rule 46 Product brands, and Structural guidelines.
 */
export function StyleProfilePanel({
  profile,
  unresolved = [],
  onChange,
  onBookTypeChange,
  isApplyingBookType = false,
}: StyleProfilePanelProps) {
  const [searchTerm, setSearchTerm] = useState("");

  const redFlags = useMemo(() => {
    const rf = (profile.red_flags as Array<any>) ?? [];
    return rf;
  }, [profile.red_flags]);

  const avoidWords = useMemo(() => {
    const raw = (profile.avoid_words as Record<string, string>) ?? {};
    return Object.entries(raw).map(([find, replace]) => ({ find, replace }));
  }, [profile.avoid_words]);

  const productTerms = useMemo(() => {
    const raw = (profile.product_terms as Record<string, string>) ?? {};
    return Object.entries(raw).map(([find, replace]) => ({ find, replace }));
  }, [profile.product_terms]);

  const replacements = profile.word_replacements ?? [];
  const orgs = profile.org_names ?? [];
  const words = profile.word_list ?? [];
  const acronyms = profile.acronyms_no_spellout ?? [];
  const registered = profile.registered_terms ?? [];
  const structural = (profile.structural_guidelines as Record<string, any>) ?? {};
  const isSpringer = profile.publisher === "springer";

  // Default to red_flags if available, otherwise replacements
  const [tab, setTab] = useState<Tab>(redFlags.length > 0 ? "red_flags" : "replacements");

  const tabs = useMemo(
    () =>
      [
        { id: "red_flags" as Tab, label: "Rule 125 Red Flags", count: redFlags.length, icon: ShieldAlert, color: "text-rose-600 bg-rose-50 border-rose-200" },
        { id: "avoid_words" as Tab, label: "Person-First & Avoid", count: avoidWords.length + productTerms.length, icon: AlertTriangle, color: "text-amber-700 bg-amber-50 border-amber-200" },
        { id: "replacements" as Tab, label: "Word Replacements", count: replacements.length, icon: BookOpen, color: "text-blue-700 bg-blue-50 border-blue-200" },
        { id: "words" as Tab, label: "Word List", count: words.length, icon: Tag, color: "text-slate-700 bg-slate-50 border-slate-200" },
        { id: "orgs" as Tab, label: "Organizations", count: orgs.length, icon: FileText, color: "text-slate-700 bg-slate-50 border-slate-200" },
        { id: "acronyms" as Tab, label: "Never Spell Out", count: acronyms.length, icon: Sparkles, color: "text-slate-700 bg-slate-50 border-slate-200" },
        { id: "registered" as Tab, label: "® First Mention", count: registered.length, icon: Info, color: "text-slate-700 bg-slate-50 border-slate-200" },
        { id: "structural" as Tab, label: "Structural Guidelines", count: Object.keys(structural).length, icon: FileText, color: "text-purple-700 bg-purple-50 border-purple-200" },
        { id: "unresolved" as Tab, label: "Unresolved Specs", count: unresolved.length, icon: Info, color: "text-slate-700 bg-slate-50 border-slate-200" },
      ].filter((t) => t.count > 0 || t.id === "red_flags" || t.id === "replacements"),
    [redFlags.length, avoidWords.length, productTerms.length, replacements.length, words.length, orgs.length, acronyms.length, registered.length, structural, unresolved.length],
  );

  const removePair = (key: "word_replacements" | "org_names", index: number) => {
    const list = [...((profile[key] as WordReplacement[] | undefined) ?? [])];
    list.splice(index, 1);
    onChange({ ...profile, [key]: list });
  };

  const removeItem = (key: "acronyms_no_spellout" | "registered_terms" | "word_list", value: string) => {
    onChange({ ...profile, [key]: ((profile[key] as string[] | undefined) ?? []).filter((v) => v !== value) });
  };

  const filteredWords = useMemo(() => {
    if (!searchTerm) return words;
    const q = searchTerm.toLowerCase();
    return words.filter((w) => w.toLowerCase().includes(q));
  }, [words, searchTerm]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-4 text-xs">
      {/* Top Banner & Preset Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-amber-500/10 text-amber-700 border border-amber-200">
            <BookOpen className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              Style Profile &amp; Red Flags Hub
              {isSpringer && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                  Springer July 2026 Active
                </span>
              )}
            </h3>
            <p className="text-slate-500 text-[11px]">
              Rules, sensitive language dictionaries, and house style lists checked automatically across chapters.
            </p>
          </div>
        </div>

        {isSpringer && onBookTypeChange && (
          <div className="flex items-center gap-3 bg-slate-50 p-1.5 rounded-lg border border-slate-200">
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
              Book Type:
              <select
                value={profile.book_type ?? "standard"}
                disabled={isApplyingBookType}
                onChange={(e) => onBookTypeChange(e.target.value, profile.list_style ?? "narrative")}
                className="border border-slate-300 rounded px-2 py-1 text-xs bg-white font-normal"
              >
                {Object.entries(SPRINGER_BOOK_TYPES).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
              List Style:
              <select
                value={profile.list_style ?? "narrative"}
                disabled={isApplyingBookType}
                onChange={(e) => onBookTypeChange(profile.book_type ?? "standard", e.target.value)}
                className="border border-slate-300 rounded px-2 py-1 text-xs bg-white font-normal"
              >
                {Object.entries(SPRINGER_LIST_STYLES).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      {/* Hub Tabs */}
      <div className="flex flex-wrap gap-2" role="tablist">
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${isActive
                  ? "bg-slate-900 border-slate-900 text-white shadow-xs"
                  : `${t.color} hover:opacity-90`
                }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{t.label}</span>
              <span
                className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold ${isActive ? "bg-white/20 text-white" : "bg-white text-slate-700 border border-slate-200"
                  }`}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tab 1: Rule 125 Editorial Red Flags */}
      {tab === "red_flags" && (
        <div className="space-y-3">
          <div className="bg-rose-50/70 border border-rose-200 rounded-lg p-3 text-rose-900 flex items-start gap-2.5">
            <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="text-[11px]">
              <strong className="font-bold">Rule 125 Editorial Red Flags:</strong> Critical items that require
              publisher permissions, cultural sensitivity review, or author clarification. These generate
              mandatory Author Queries (AQ) rather than automatic silent fixes.
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-lg shadow-2xs">
            <table className="w-full text-[11px]">
              <thead className="bg-slate-50 sticky top-0 border-b border-slate-200">
                <tr className="text-left text-slate-500 font-bold uppercase tracking-wider">
                  <th className="px-3 py-2 w-48">Trigger Pattern / Term</th>
                  <th className="px-3 py-2">Editorial Rationale &amp; House Rule</th>
                  <th className="px-3 py-2 w-40">Required Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {redFlags.map((rf, i) => (
                  <tr key={i} className="hover:bg-rose-50/30 transition-colors">
                    <td className="px-3 py-2 font-mono font-bold text-rose-700 bg-rose-50/40">
                      {rf.pattern || rf.term || `Red Flag #${i + 1}`}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      <p className="font-medium">{rf.message || rf.rationale || "Sensitivity / permissions query"}</p>
                      {rf.category && (
                        <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded text-[10px] font-semibold bg-slate-100 text-slate-600">
                          {rf.category}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                        {rf.action || "Query Author / Check"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Person-First & Avoid Terms (Rule 96 & 46) */}
      {tab === "avoid_words" && (
        <div className="space-y-3">
          <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-3 text-amber-900 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-[11px]">
              <strong className="font-bold">Rule 96 Person-First Language &amp; Avoided Terms:</strong> Non-stigmatizing
              terms and publisher-mandated replacements (e.g. <em>older adults</em> over <em>the elderly</em>;
              generic terms like <em>tablet</em> over brand names like <em>iPad</em>).
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto">
            {avoidWords.concat(productTerms).map((item, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-xs"
              >
                <div>
                  <span className="font-mono text-red-600 line-through decoration-red-400 font-semibold">
                    {item.find}
                  </span>
                  <span className="mx-2 text-slate-400">→</span>
                  <span className="font-mono font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                    {item.replace}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 font-medium uppercase">
                  {i < avoidWords.length ? "Rule 96" : "Rule 46"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 3: Word Replacements */}
      {tab === "replacements" && (
        <div className="space-y-2">
          {replacements.length === 0 ? (
            <p className="text-slate-500 text-[11px] py-4 text-center">
              No word-list replacements configured. Load the Springer Preset or import a Word style sheet.
            </p>
          ) : (
            <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-lg">
              <table className="w-full text-[11px]">
                <thead className="bg-slate-50 sticky top-0 border-b border-slate-200">
                  <tr className="text-left text-slate-500 uppercase tracking-wide">
                    <th className="px-3 py-1.5">Find (Variant)</th>
                    <th className="px-3 py-1.5">Replace With</th>
                    <th className="px-3 py-1.5">Guidance Note</th>
                    <th className="px-3 py-1.5 w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {replacements.map((p, i) => (
                    <tr key={`${p.find}-${i}`} className="hover:bg-slate-50">
                      <td className="px-3 py-1.5 font-mono text-red-700 line-through decoration-red-300">{p.find}</td>
                      <td className="px-3 py-1.5 font-mono font-bold text-emerald-800">{p.replace}</td>
                      <td className="px-3 py-1.5 text-slate-500 truncate max-w-[280px]" title={p.note}>
                        {p.note}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => removePair("word_replacements", i)}
                          title="Remove pair"
                          className="text-slate-400 hover:text-red-600 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Word List */}
      {tab === "words" && (
        <div className="space-y-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search publisher word list..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-64 overflow-y-auto p-1 border border-slate-100 rounded-lg">
            {filteredWords.map((v) => (
              <span
                key={v}
                className="inline-flex items-center gap-1 bg-slate-100 text-slate-800 px-2 py-0.5 rounded text-[11px] font-mono hover:bg-slate-200"
              >
                {v}
                <button
                  type="button"
                  onClick={() => removeItem("word_list", v)}
                  className="text-slate-400 hover:text-red-600"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Tab 5: Organizations */}
      {tab === "orgs" && (
        <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-lg">
          <table className="w-full text-[11px]">
            <thead className="bg-slate-50 sticky top-0 border-b border-slate-200">
              <tr className="text-left text-slate-500 uppercase tracking-wide">
                <th className="px-3 py-1.5">Find</th>
                <th className="px-3 py-1.5">Official Name</th>
                <th className="px-3 py-1.5">Note</th>
                <th className="px-3 py-1.5 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orgs.map((p, i) => (
                <tr key={`${p.find}-${i}`} className="hover:bg-slate-50">
                  <td className="px-3 py-1.5 font-mono text-red-700 line-through">{p.find}</td>
                  <td className="px-3 py-1.5 font-mono font-bold text-emerald-800">{p.replace}</td>
                  <td className="px-3 py-1.5 text-slate-500">{p.note}</td>
                  <td className="px-3 py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => removePair("org_names", i)}
                      className="text-slate-400 hover:text-red-600 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 6: Acronyms Never Spell Out */}
      {tab === "acronyms" && (
        <div className="flex flex-wrap gap-1.5 max-h-64 overflow-y-auto p-2 border border-slate-100 rounded-lg">
          {acronyms.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 bg-sky-50 text-sky-800 border border-sky-200 px-2 py-0.5 rounded text-[11px] font-mono font-semibold"
            >
              {v}
              <button
                type="button"
                onClick={() => removeItem("acronyms_no_spellout", v)}
                className="text-sky-400 hover:text-red-600"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Tab 7: Registered Terms */}
      {tab === "registered" && (
        <div className="flex flex-wrap gap-1.5 max-h-64 overflow-y-auto p-2 border border-slate-100 rounded-lg">
          {registered.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 bg-amber-50 text-amber-900 border border-amber-200 px-2 py-0.5 rounded text-[11px] font-mono font-semibold"
            >
              {v}®
              <button
                type="button"
                onClick={() => removeItem("registered_terms", v)}
                className="text-amber-400 hover:text-red-600"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Tab 8: Structural Guidelines */}
      {tab === "structural" && (
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {Object.entries(structural).map(([key, val]) => (
            <div key={key} className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <h4 className="font-bold text-slate-800 uppercase tracking-wider text-[11px] mb-1">
                {key.replace(/_/g, " ")}
              </h4>
              <pre className="text-[10px] text-slate-600 font-mono whitespace-pre-wrap bg-white p-2 rounded border border-slate-100">
                {typeof val === "string" ? val : JSON.stringify(val, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}

      {/* Tab 9: Unresolved Specs */}
      {tab === "unresolved" && (
        <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
          {unresolved.map((u, i) => (
            <div key={i} className="px-3 py-2 hover:bg-slate-50">
              <span className="font-semibold text-slate-800">{u.label}</span>
              <span className="text-slate-400 text-[10px]"> · {u.section}</span>
              <p className="text-[11px] text-slate-600 truncate mt-0.5" title={u.value}>
                {u.value}
              </p>
            </div>
          ))}
          <p className="px-3 py-2 text-[10px] text-slate-400 italic bg-slate-50">
            These layout specifications (running heads, trim sizes, permissions) are cataloged for reference.
          </p>
        </div>
      )}
    </div>
  );
}
