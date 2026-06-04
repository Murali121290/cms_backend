import os
import sys

file_path = r"c:\Users\muraliba\PycharmProjects\cms_backend\frontend\src\pages\ReferenceValidationReviewPage.tsx"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

start_marker = "            {/* Sidebar Tabs */}"
end_marker = "          </div>\n        </div>\n      </div>\n    </main>"

if start_marker not in content or end_marker not in content:
    print("Markers not found!")
    sys.exit(1)

start_idx = content.find(start_marker)
end_idx = content.rfind(end_marker)

new_jsx = """            {/* Sidebar Tabs */}
            <div className="flex border-b border-navy-200 bg-surface-50">
              <button
                onClick={() => setActiveTab("citations")}
                className={`flex-1 py-3 text-center text-xs font-bold border-b-2 transition-all flex items-center justify-center gap-1.5 relative ${
                  activeTab === "citations"
                    ? "border-navy-800 text-navy-800 bg-white"
                    : "border-transparent text-navy-400 hover:text-navy-600 hover:bg-navy-50/50"
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                Citations & References
                {(logs.citation_pairs?.filter((p: any) => p.status !== "ok").length || 0) > 0 && (
                  <span className="absolute top-1 right-2 px-1.5 py-0.5 rounded-full text-[9px] bg-red-100 border border-red-200 text-red-700 font-bold shrink-0">
                    {logs.citation_pairs?.filter((p: any) => p.status !== "ok").length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab("structuring")}
                className={`flex-1 py-3 text-center text-xs font-bold border-b-2 transition-all flex items-center justify-center gap-1.5 relative ${
                  activeTab === "structuring"
                    ? "border-navy-800 text-navy-800 bg-white"
                    : "border-transparent text-navy-400 hover:text-navy-600 hover:bg-navy-50/50"
                }`}
              >
                <Hash className="w-3.5 h-3.5" />
                Structuring Review
                {(logs.reference_entries?.filter((e: any) => !e.is_cited).length || 0) > 0 && (
                  <span className="absolute top-1 right-2 px-1.5 py-0.5 rounded-full text-[9px] bg-amber-100 border border-amber-200 text-amber-700 font-bold shrink-0">
                    {logs.reference_entries?.filter((e: any) => !e.is_cited).length}
                  </span>
                )}
              </button>
              {logs.raw_log && (
                <button
                  onClick={() => setActiveTab("logs")}
                  className={`flex-grow-0 px-4 py-3 text-center text-xs font-bold border-b-2 transition-all flex items-center justify-center gap-1.5 ${
                    activeTab === "logs"
                      ? "border-navy-800 text-navy-800 bg-white"
                      : "border-transparent text-navy-400 hover:text-navy-600 hover:bg-navy-50/50"
                  }`}
                >
                  Logs
                </button>
              )}
            </div>

            {/* Sidebar Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0 bg-surface-50/20">
              
              {/* ─── TAB 1: CITATIONS & REFERENCES ─── */}
              {activeTab === "citations" && (
                <div className="space-y-4 page-enter">
                  
                  {/* Summary Bar */}
                  <div className="flex justify-between items-center bg-white p-3 border border-navy-100 rounded-lg shadow-sm flex-wrap gap-2">
                    <div className="flex gap-4 text-[11px] font-bold text-navy-800 flex-wrap">
                      <span>Total: {logs.total_refs || 0} refs</span>
                      <span className="text-navy-300">|</span>
                      <span>{logs.total_cites || 0} citations</span>
                      <span className="text-navy-300">|</span>
                      <span className="text-emerald-600">✅ {citationPairs.filter((p: any) => p.status === "ok").length} matched</span>
                      <span className="text-navy-300">|</span>
                      <span className="text-red-500">⚠️ {citationPairs.filter((p: any) => p.status !== "ok").length} issues</span>
                    </div>
                    {detectedStyle === "APA" && (
                      <Button
                        variant="secondary"
                        size="sm"
                        leftIcon={<RefreshCw className="w-3 h-3" />}
                        className="text-[10px] px-2 py-1 h-auto"
                        onClick={sortBibliographyAlphabetically}
                        title="Sorts references alphabetically and preserves track changes"
                      >
                        A-Z Sort
                      </Button>
                    )}
                  </div>

                  {/* Style Highlighting Manager (Collapsible) */}
                  <div className="bg-white border border-navy-100 rounded-lg shadow-sm overflow-hidden">
                    <button
                      onClick={() => setStyleManagerOpen(!styleManagerOpen)}
                      className="w-full px-3 py-2 text-left text-[11px] font-bold text-navy-800 bg-surface-50 hover:bg-navy-50/50 flex items-center justify-between"
                    >
                      <span className="flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                        Style Highlight Manager
                      </span>
                      <span className="text-[10px] text-navy-500 font-normal">
                        {styleManagerOpen ? "Hide" : "Show"}
                      </span>
                    </button>
                    
                    {styleManagerOpen && (
                      <div className="p-3 border-t border-navy-50">
                        <div className="flex items-center justify-between pb-3.5 border-b border-navy-50 mb-3 flex-wrap gap-2">
                          <div className="relative max-w-[200px] w-full">
                            <Search className="w-3.5 h-3.5 text-navy-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                            <input
                              type="text"
                              placeholder="Filter character styles..."
                              value={styleFilterQuery}
                              onChange={(e) => setStyleFilterQuery(e.target.value)}
                              className="w-full pl-8 pr-3 py-1 bg-surface-50 text-[11px] rounded border border-navy-200 focus:outline-none focus:border-navy-500"
                            />
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => toggleAllStylesVisibility(true)}
                              className="text-[10px] font-bold text-navy-600 hover:text-navy-800 hover:underline"
                            >
                              Show All
                            </button>
                            <span className="text-navy-300">|</span>
                            <button
                              onClick={() => toggleAllStylesVisibility(false)}
                              className="text-[10px] font-bold text-navy-600 hover:text-navy-800 hover:underline"
                            >
                              Hide All
                            </button>
                          </div>
                        </div>

                        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                          {filteredStyles.length === 0 ? (
                            <div className="text-center py-6 text-navy-400 text-xs">
                              No styles match search filter.
                            </div>
                          ) : (
                            filteredStyles.map((style) => {
                              const count = styleStats[style] || 0;
                              const isHidden = hiddenStyles.includes(style);
                              return (
                                <div
                                  key={style}
                                  className="flex items-center justify-between p-2 rounded hover:bg-surface-50 border border-navy-50/50 bg-white transition-colors"
                                >
                                  <label className="flex items-center gap-2 cursor-pointer flex-1 select-none">
                                    <button
                                      type="button"
                                      onClick={() => toggleStyleVisibility(style)}
                                      className="text-navy-500 hover:text-navy-700"
                                    >
                                      {isHidden ? (
                                        <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                                      ) : (
                                        <Eye className="w-3.5 h-3.5 text-navy-600" />
                                      )}
                                    </button>
                                    <span className={`font-mono text-[10px] ${isHidden ? "text-slate-400 line-through" : "text-slate-800"}`}>
                                      {style}
                                    </span>
                                  </label>
                                  
                                  <div className="flex items-center gap-3">
                                    <span className="text-[9px] font-bold text-slate-400">
                                      {count} run{count === 1 ? "" : "s"}
                                    </span>
                                    <span
                                      className="w-3 h-3 rounded-full border border-slate-300/40"
                                      style={{ backgroundColor: CHAR_STYLE_COLOURS[style] ?? "#e5e7eb" }}
                                    />
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Filter Pills */}
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: "all", label: "All" },
                      { id: "ok", label: "✅ Matched" },
                      { id: "missing", label: "🔴 Missing" },
                      { id: "unused", label: "🟡 Unused" }
                    ].map(f => (
                      <button
                        key={f.id}
                        onClick={() => setCitationFilter(f.id as any)}
                        className={`px-3 py-1 text-[11px] font-bold rounded-full border transition-colors ${
                          citationFilter === f.id
                            ? "bg-navy-800 text-white border-navy-800 shadow-sm"
                            : "bg-white text-navy-600 border-navy-200 hover:bg-navy-50"
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  {/* Cards List */}
                  <div className="space-y-3">
                    {filteredCitationPairs.length === 0 ? (
                      <div className="text-center py-10 bg-white rounded-lg border border-navy-100 p-6 text-navy-400 text-xs font-semibold">
                        No citations match the current filter.
                      </div>
                    ) : (
                      filteredCitationPairs.map((pair: any, idx: number) => {
                        const isExpanded = expandedCitationIdx === idx;
                        const isMissing = pair.status === "missing";
                        const isUnused = pair.status === "unused";
                        const isOk = pair.status === "ok";

                        return (
                          <div
                            key={idx}
                            className={`rounded-lg border bg-white shadow-sm overflow-hidden border-l-[3.5px] transition-all ${
                              isMissing ? "border-l-red-500 border-red-200" :
                              isUnused ? "border-l-amber-500 border-amber-200" :
                              "border-l-emerald-500 border-navy-200"
                            }`}
                          >
                            {/* Card Header (Collapsed view) */}
                            <button
                              onClick={() => {
                                setExpandedCitationIdx(isExpanded ? null : idx);
                                if (!isExpanded && pair.citation) {
                                  focusCitationInEditor(pair.citation);
                                } else if (!isExpanded && pair.ref_text) {
                                  focusCitationInEditor(pair.ref_text.slice(0, 30));
                                }
                              }}
                              className="w-full p-3 flex flex-col gap-2 hover:bg-slate-50/50 text-left transition-colors"
                            >
                              <div className="flex items-start justify-between gap-3 w-full">
                                <div className="flex items-start gap-2 flex-1 min-w-0">
                                  <span className="text-sm shrink-0 mt-0.5">
                                    {isMissing ? "🔴" : isUnused ? "🟡" : "🟢"}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[11px] font-extrabold text-navy-900 break-words leading-tight">
                                      {pair.citation ? (
                                        detectedStyle === "AMA" && !pair.citation.includes("[") ? `[${pair.citation}]` : pair.citation
                                      ) : (
                                        <span className="text-navy-400 italic">No in-text citation</span>
                                      )}
                                    </p>
                                    <p className="text-[10px] text-navy-500 mt-1 truncate">
                                      {isMissing ? "Missing reference entry" :
                                       isUnused ? "Unused reference entry" :
                                       pair.ref_text.slice(0, 60) + (pair.ref_text.length > 60 ? "..." : "")}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 text-[10px] font-bold text-navy-400 hover:text-navy-600 bg-surface-50 px-2 py-1 rounded shrink-0">
                                  Locate <CornerDownRight className="w-3 h-3" />
                                </div>
                              </div>
                            </button>

                            {/* Card Body (Expanded view) */}
                            {isExpanded && (
                              <div className="p-3 bg-surface-50/30 border-t border-navy-100/60 space-y-3">
                                {isMissing ? (
                                  <div className="text-[11px] text-navy-800 font-semibold p-2 bg-red-50 rounded border border-red-100">
                                    ⚠️ Citation found in text but no matching bibliography entry.
                                    {pair.citation && (
                                      <button
                                        onClick={() => addBibliographyPlaceholder(detectedStyle === "AMA" && !pair.citation.includes("[") ? `[${pair.citation}]` : pair.citation)}
                                        className="mt-2 text-[10px] font-bold text-emerald-600 hover:text-emerald-800 flex items-center gap-1 hover:underline"
                                      >
                                        <PlusIcon className="w-3 h-3" />
                                        Add Placeholder Reference
                                      </button>
                                    )}
                                  </div>
                                ) : isUnused ? (
                                  <div className="space-y-2">
                                    <div className="text-[11px] text-navy-800 font-semibold p-2 bg-amber-50 rounded border border-amber-100">
                                      ⚠️ This reference is in the bibliography, but it is never cited in the text.
                                    </div>
                                    <div className="p-2.5 bg-white rounded border border-navy-100 text-[11px] leading-relaxed text-navy-800">
                                      {pair.ref_text}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[9px] uppercase font-bold text-navy-400 tracking-wider">Reference Text</span>
                                      <button
                                        onClick={() => {
                                          navigator.clipboard.writeText(pair.ref_text);
                                          setCopiedIdx(idx);
                                          setTimeout(() => setCopiedIdx(null), 1500);
                                        }}
                                        className="text-[9px] font-bold text-navy-500 hover:text-navy-800"
                                      >
                                        {copiedIdx === idx ? "Copied!" : "Copy"}
                                      </button>
                                    </div>
                                    <div className="p-2.5 bg-white rounded border border-navy-100 text-[11px] leading-relaxed text-navy-800 selection:bg-blue-100">
                                      {pair.ref_text}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* ─── TAB 2: STRUCTURING REVIEW ─── */}
              {activeTab === "structuring" && (
                <div className="space-y-4 page-enter">
                  {/* Header Stat Bar & Search */}
                  <div className="bg-white p-3 border border-navy-100 rounded-lg shadow-sm space-y-3">
                    <div className="flex gap-4 text-[11px] font-bold text-navy-800 flex-wrap">
                      <span>{referenceEntries.length} references</span>
                      <span className="text-navy-300">|</span>
                      <span className="text-emerald-600">✅ {referenceEntries.filter((e: any) => e.is_cited).length} cited</span>
                      <span className="text-navy-300">|</span>
                      <span className="text-amber-600">🟡 {referenceEntries.filter((e: any) => !e.is_cited).length} uncited</span>
                    </div>
                    
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Search className="w-3.5 h-3.5 text-navy-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          placeholder="Search references..."
                          value={refFilter}
                          onChange={(e) => setRefFilter(e.target.value)}
                          className="w-full pl-8 pr-3 py-1.5 bg-surface-50 text-[11px] rounded border border-navy-200 focus:outline-none focus:border-navy-500"
                        />
                      </div>
                      <button
                        onClick={() => setShowUncitedOnly(!showUncitedOnly)}
                        className={`px-3 text-[10px] font-bold rounded border whitespace-nowrap transition-colors ${
                          showUncitedOnly 
                            ? "bg-amber-100 text-amber-800 border-amber-300"
                            : "bg-surface-50 text-navy-600 border-navy-200 hover:bg-navy-50"
                        }`}
                      >
                        Uncited Only
                      </button>
                    </div>
                  </div>

                  {/* Reference Index Cards */}
                  <div className="space-y-3">
                    {filteredEntries.length === 0 ? (
                      <div className="text-center py-10 bg-white rounded-lg border border-navy-100 p-6 text-navy-400 text-xs font-semibold">
                        No references match the filter.
                      </div>
                    ) : (
                      filteredEntries.map((entry: any, idx: number) => (
                        <div key={idx} className="bg-white rounded-lg border border-navy-100 shadow-sm p-3.5 space-y-3 hover:border-navy-300 transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-black text-navy-900 bg-surface-100 px-1.5 py-0.5 rounded">
                              {entry.number ? `#${entry.number}` : `Ref ${idx + 1}`}
                            </span>
                            <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded tracking-wide ${
                              entry.is_cited ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                            }`}>
                              {entry.is_cited ? "Cited" : "Not Cited"}
                            </span>
                          </div>
                          
                          <p className="text-[11px] text-navy-800 leading-relaxed font-medium line-clamp-3">
                            {entry.text}
                          </p>
                          
                          <div className="flex justify-end pt-1 border-t border-navy-50">
                            <button
                              onClick={() => focusCitationInEditor(entry.text.slice(0, 40))}
                              className="text-[10px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 bg-blue-50 px-2 py-1 rounded hover:bg-blue-100 transition-colors"
                            >
                              Jump to reference <CornerDownRight className="w-3 h-3 ml-0.5" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* ─── TAB 3: RAW LOGS ─── */}
              {activeTab === "logs" && logs.raw_log && (
                <div className="page-enter bg-slate-950 rounded-lg p-3 shadow-inner border border-slate-900 max-h-[600px] overflow-y-auto">
                  <pre className="text-[10px] text-emerald-400 font-mono whitespace-pre-wrap leading-relaxed select-text">
                    {logs.raw_log}
                  </pre>
                </div>
              )}

"""

new_content = content[:start_idx] + new_jsx + content[end_idx:]

with open(file_path, "w", encoding="utf-8") as f:
    f.write(new_content)
print("SUCCESS")
