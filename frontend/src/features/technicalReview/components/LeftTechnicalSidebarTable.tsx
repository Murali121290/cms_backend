import { OccurrencesChecklistSidebar } from "./OccurrencesChecklistSidebar";

interface LeftTechnicalSidebarTableProps {
  findings: any[];
  filteredFindings: any[];
  searchTerm: string;
  onSearchChange: (val: string) => void;
  categoryFilter: string;
  onCategoryFilterChange: (cat: string) => void;
  categoriesList: string[];
  stylesheetFilter: "all" | "in_stylesheet" | "other";
  onStylesheetFilterChange: (filter: "all" | "in_stylesheet" | "other") => void;
  hasActiveStylesheet: boolean;
  selectedOccurrenceIndex: number;
  onSelectOccurrenceIndex: (idx: number) => void;
  checkedIds: Record<string, boolean>;
  onToggleCheck: (key: string) => void;
  onToggleAll: () => void;
  isAllChecked: boolean;
  actionTypes: Record<string, "fix" | "highlight">;
  reviewedCount: number;
  onClearDraft?: () => void;
  onBatchFixCategory?: (category: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

// Thin wrapper around the real OccurrencesChecklistSidebar (filter tabs,
// search, Select All, Reviewed X/Y progress, rule cards with Batch apply/Fix)
// — that component is fully controlled, so NewTechnicalReviewPage.tsx ports
// the same filtering/selection state TechnicalReviewPage.tsx already owns and
// passes it straight through here for full feature parity.
export function LeftTechnicalSidebarTable(props: LeftTechnicalSidebarTableProps) {
  return <OccurrencesChecklistSidebar {...props} />;
}
