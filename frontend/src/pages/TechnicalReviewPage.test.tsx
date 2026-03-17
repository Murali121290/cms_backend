import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TechnicalReviewPage } from "@/pages/TechnicalReviewPage";
import { createApiError } from "@/test/fixtures";
import { renderRoute } from "@/test/testUtils";

const getTechnicalReview = vi.fn();

vi.mock("@/api/technicalReview", () => ({
  getTechnicalReview: (...args: unknown[]) => getTechnicalReview(...args),
  applyTechnicalReview: vi.fn(),
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
});
