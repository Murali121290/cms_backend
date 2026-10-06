import React, { useMemo } from "react";
import { VersionHistoryPanel } from "@/features/structuringReview/components/VersionHistoryPanel";

interface OverviewDashboardTabProps {
  findings: any[];
  rawScanData: any;
  spellingVariants: any[];
  editorFileId: number | null;
  onOpenVersion: (versionId: number) => void;
}

export function OverviewDashboardTab({
  findings,
  rawScanData,
  spellingVariants,
  editorFileId,
  onOpenVersion,
}: OverviewDashboardTabProps) {
  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    findings.forEach((f) => {
      const cat = f.category || "General";
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return counts;
  }, [findings]);

  const spellingCount = categoryCounts["spelling"] || 0;
  const totalInconsistencies = rawScanData?.total_inconsistencies ?? 0;
  const languageMix = rawScanData?.mix_metric || "Standard";

  const totalFindings = findings.length || 1;

  const categoryList = Object.entries(categoryCounts).map(([cat, count]) => ({
    name: cat,
    count,
    percent: Math.round((count / totalFindings) * 100),
  }));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 overflow-y-auto">
      {/* 4 Metric Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs border-t-4 border-t-blue-500">
          <span className="text-[10px] uppercase font-extrabold text-slate-400 tracking-wider">
            Total Findings
          </span>
          <div className="text-3xl font-black text-slate-900 mt-1">{findings.length}</div>
          <p className="text-xs text-slate-500 mt-1">Consistency anomalies detected</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs border-t-4 border-t-amber-500">
          <span className="text-[10px] uppercase font-extrabold text-slate-400 tracking-wider">
            Spelling Variants
          </span>
          <div className="text-3xl font-black text-slate-900 mt-1">{spellingCount}</div>
          <p className="text-xs text-slate-500 mt-1">Variant spelling profiles</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs border-t-4 border-t-emerald-500">
          <span className="text-[10px] uppercase font-extrabold text-slate-400 tracking-wider">
            Inconsistencies
          </span>
          <div className="text-3xl font-black text-slate-900 mt-1">{totalInconsistencies}</div>
          <p className="text-xs text-slate-500 mt-1">Explicit standard mismatches</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs border-t-4 border-t-purple-500">
          <span className="text-[10px] uppercase font-extrabold text-slate-400 tracking-wider">
            Language Balance
          </span>
          <div className="text-2xl font-black text-slate-900 mt-2 truncate">{languageMix}</div>
          <p className="text-xs text-slate-500 mt-1">US vs UK variant balance</p>
        </div>
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left column: Category breakdown */}
        <div className="lg:col-span-6 space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-4">
              Category Distribution Breakdown
            </h3>
            {categoryList.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-xs">
                No findings detected in manuscript.
              </div>
            ) : (
              <div className="space-y-3.5">
                {categoryList.map((item) => (
                  <div key={item.name} className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="capitalize text-slate-700">{item.name}</span>
                      <span className="text-slate-500">
                        {item.count} items ({item.percent}%)
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all duration-300"
                        style={{ width: `${item.percent}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column: Spelling variants & Version history */}
        <div className="lg:col-span-6 space-y-6">
          {/* Spelling Variants Table */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-4">
              Spelling Variant Occurrences (UK vs US)
            </h3>
            {spellingVariants.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs">
                No contradictory UK/US spelling variants found.
              </div>
            ) : (
              <div className="border border-slate-100 rounded-lg overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-100 text-[10px] uppercase font-bold tracking-wider">
                    <tr>
                      <th className="py-2.5 px-3">UK Form</th>
                      <th className="py-2.5 px-3">US Form</th>
                      <th className="py-2.5 px-3 text-center">UK Count</th>
                      <th className="py-2.5 px-3 text-center">US Count</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {spellingVariants.map((varItem: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-2.5 px-3 font-semibold text-slate-800">
                          {varItem.uk || "-"}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-800">
                          {varItem.us || "-"}
                        </td>
                        <td className="py-2.5 px-3 text-center text-slate-600 font-bold">
                          {varItem.uk_count ?? 0}
                        </td>
                        <td className="py-2.5 px-3 text-center text-slate-600 font-bold">
                          {varItem.us_count ?? 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Version History Panel */}
          <VersionHistoryPanel
            fileId={editorFileId}
            currentFileId={editorFileId || 0}
            onOpenVersion={onOpenVersion}
          />
        </div>
      </div>
    </div>
  );
}
