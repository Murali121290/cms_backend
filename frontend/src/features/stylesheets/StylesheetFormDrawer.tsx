import { useState, useEffect } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import type { StylesheetSummary, IATemplateRow, StylesheetUpdateRequest, StylesheetCreateRequest } from "@/types/api";

interface StylesheetFormDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: number;
  editingStylesheet: StylesheetSummary | null;
  mutations: {
    create: { mutate: (payload: StylesheetCreateRequest) => void; isPending: boolean };
    update: { mutate: (params: { id: number; payload: StylesheetUpdateRequest }) => void; isPending: boolean };
  };
  iaTemplate: IATemplateRow[];
}

interface ElementGroup {
  element: string;
  rows: IATemplateRow[];
}

export function StylesheetFormDrawer({
  isOpen,
  onClose,
  projectId,
  editingStylesheet,
  mutations,
  iaTemplate,
}: StylesheetFormDrawerProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedRows, setSelectedRows] = useState<IATemplateRow[]>([]);
  const [expandedElements, setExpandedElements] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (editingStylesheet) {
      setName(editingStylesheet.name);
      setDescription(editingStylesheet.description || "");
      setSelectedRows(
        editingStylesheet.selected_ia_rows.map((row) => ({
          ...row,
          example: null,
        }))
      );
      setExpandedElements(
        new Set(editingStylesheet.selected_ia_rows.map((row) => row.element))
      );
    } else {
      setName("");
      setDescription("");
      setSelectedRows([]);
      setExpandedElements(new Set());
    }
  }, [editingStylesheet, isOpen]);

  const groupedRows = groupByElement(iaTemplate);

  const toggleElement = (element: string) => {
    const newExpanded = new Set(expandedElements);
    if (newExpanded.has(element)) {
      newExpanded.delete(element);
    } else {
      newExpanded.add(element);
    }
    setExpandedElements(newExpanded);
  };

  const toggleRowSelection = (row: IATemplateRow) => {
    setSelectedRows((prev) => {
      const exists = prev.some((r) => r.element === row.element && r.subtype === row.subtype && r.pattern === row.pattern);
      if (exists) {
        return prev.filter((r) => !(r.element === row.element && r.subtype === row.subtype && r.pattern === row.pattern));
      } else {
        return [...prev, row];
      }
    });
  };

  const isRowSelected = (row: IATemplateRow) => {
    return selectedRows.some((r) => r.element === row.element && r.subtype === row.subtype && r.pattern === row.pattern);
  };

  const handleSubmit = () => {
    if (!name.trim()) {
      return;
    }

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      selected_ia_rows: selectedRows,
    };

    if (editingStylesheet) {
      mutations.update.mutate({
        id: editingStylesheet.id,
        payload: {
          name: payload.name,
          description: payload.description,
          selected_ia_rows: payload.selected_ia_rows,
        },
      });
    } else {
      mutations.create.mutate(payload);
    }

    onClose();
  };

  const isPending = mutations.create.isPending || mutations.update.isPending;

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-md bg-white shadow-xl flex flex-col max-h-screen overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text">
            {editingStylesheet ? "Edit Stylesheet" : "New Stylesheet"}
          </h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-text p-1"
            type="button"
          >
            âœ•
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-xs font-semibold text-text mb-1.5 uppercase tracking-wide">
                Name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., American Standard Style"
                className="w-full px-3 py-2 rounded-md border border-border text-sm focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-transparent"
              />
            </div>

            <div>
              <label htmlFor="description" className="block text-xs font-semibold text-text mb-1.5 uppercase tracking-wide">
                Description
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional notes about this stylesheet"
                rows={2}
                className="w-full px-3 py-2 rounded-md border border-border text-sm focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-transparent resize-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-2 uppercase tracking-wide">
                Style Rules ({selectedRows.length} selected)
              </label>
              <div className="border border-border rounded-md bg-sidebar/3 overflow-hidden">
                {groupedRows.map((group) => (
                  <div key={group.element} className="border-b border-border last:border-b-0">
                    <button
                      type="button"
                      onClick={() => toggleElement(group.element)}
                      className="w-full flex items-center justify-between px-3 py-2 hover:bg-sidebar/5 transition-colors text-left"
                    >
                      <span className="text-xs font-semibold text-text">{group.element}</span>
                      {expandedElements.has(group.element) ? (
                        <ChevronUp className="w-4 h-4 text-muted" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-muted" />
                      )}
                    </button>
                    {expandedElements.has(group.element) && (
                      <div className="px-3 pb-2 bg-white space-y-1.5 border-t border-border">
                        {group.rows.map((row, i) => (
                          <label key={i} className="flex items-start gap-2 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isRowSelected(row)}
                              onChange={() => toggleRowSelection(row)}
                              className="mt-0.5 rounded border-border"
                            />
                            <span className="flex-1 font-mono text-text">{row.pattern}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border flex gap-3 bg-sidebar/3">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="flex-1 px-4 py-2 text-sm font-medium text-text bg-white border border-border rounded-md hover:bg-sidebar/3 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || !name.trim()}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary border border-primary rounded-md hover:bg-primary transition-colors disabled:opacity-50"
          >
            {isPending ? "Saving..." : editingStylesheet ? "Update" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function groupByElement(rows: IATemplateRow[]): ElementGroup[] {
  const grouped = new Map<string, IATemplateRow[]>();
  for (const row of rows) {
    if (!grouped.has(row.element)) {
      grouped.set(row.element, []);
    }
    grouped.get(row.element)!.push(row);
  }
  return Array.from(grouped.entries())
    .map(([element, items]) => ({ element, rows: items }))
    .sort((a, b) => a.element.localeCompare(b.element));
}
