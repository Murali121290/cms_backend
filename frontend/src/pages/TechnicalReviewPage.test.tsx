import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TechnicalReviewPage } from "@/pages/TechnicalReviewPage";
import { createApiError, createTechnicalScanResponse } from "@/test/fixtures";
import { renderRoute } from "@/test/testUtils";

const getTechnicalReview = vi.fn();
const applyTechnicalReview = vi.fn();

vi.mock("@/api/technicalReview", () => ({
  getTechnicalReview: (...args: unknown[]) => getTechnicalReview(...args),
  applyTechnicalReview: (...args: unknown[]) => applyTechnicalReview(...args),
}));

describe("TechnicalReviewPage", () => {
  it("renders the current error state when the technical review contract fails", async () => {
    getTechnicalReview.mockRejectedValueOnce(
      createApiError("Technical scan unavailable.", {
        status: 500,
        code: "TECHNICAL_SCAN_FAILED",
      }),
    );

    renderRoute({
      path: "/ui/projects/:projectId/chapters/:chapterId/files/:fileId/technical-review",
      initialEntry: "/ui/projects/10/chapters/20/files/100/technical-review",
      element: <TechnicalReviewPage />,
    });

    expect(await screen.findByText("Technical review unavailable")).toBeInTheDocument();
    expect(screen.getByText("Technical scan unavailable.")).toBeInTheDocument();
  });

  it("renders premium dashboard elements successfully", async () => {
    getTechnicalReview.mockResolvedValueOnce(
      createTechnicalScanResponse({
        issues: [],
        findings: [
          {
            para_index: 0,
            match_start: 5,
            surface: "teh",
            replacement: "the",
            context: "This is teh test.",
            category: "spelling",
            rule_id: "rule-1",
            rule_label: "Spelling Correction"
          }
        ],
        spelling_summary: {
          variants: [
            { uk: "colour", us: "color", uk_count: 2, us_count: 1 }
          ]
        },
        stats: {
          word_count: 120,
          char_count: 700,
          missing_captions: 1,
          missing_citations: 0
        }
      }),
    );

    renderRoute({
      path: "/ui/projects/:projectId/chapters/:chapterId/files/:fileId/technical-review",
      initialEntry: "/ui/projects/10/chapters/20/files/100/technical-review",
      element: <TechnicalReviewPage />,
    });

    // Check heading
    expect(await screen.findByText("Advanced Manuscript consistency reviewer")).toBeInTheDocument();
    
    // Switch to Overview Dashboard tab
    const dashboardTab = screen.getByRole("button", { name: /overview dashboard/i });
    await userEvent.click(dashboardTab);

    // Check metric values
    expect(screen.getByText("120")).toBeInTheDocument(); // Word count
    expect(screen.getByText("700")).toBeInTheDocument(); // Char count
    expect(screen.getByText("colour")).toBeInTheDocument(); // Variant table
    expect(screen.getByText("color")).toBeInTheDocument(); // Variant table
  });
});
