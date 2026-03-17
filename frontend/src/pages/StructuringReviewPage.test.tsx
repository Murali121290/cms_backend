import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StructuringReviewPage } from "@/pages/StructuringReviewPage";
import { createApiError } from "@/test/fixtures";
import { renderRoute } from "@/test/testUtils";

const getStructuringReview = vi.fn();
const saveStructuringReview = vi.fn();

vi.mock("@/api/structuringReview", () => ({
  getStructuringReview: (...args: unknown[]) => getStructuringReview(...args),
  saveStructuringReview: (...args: unknown[]) => saveStructuringReview(...args),
}));

describe("StructuringReviewPage", () => {
  it("surfaces the missing processed-file backend error state", async () => {
    getStructuringReview.mockRejectedValueOnce(
      createApiError("Processed file not found.", {
        status: 404,
        code: "PROCESSED_FILE_MISSING",
      }),
    );

    renderRoute({
      path: "/ui/projects/:projectId/chapters/:chapterId/files/:fileId/structuring-review",
      initialEntry: "/ui/projects/10/chapters/20/files/100/structuring-review",
      element: <StructuringReviewPage />,
    });

    expect(await screen.findByText("Structuring review unavailable")).toBeInTheDocument();
    expect(screen.getByText("Processed file not found.")).toBeInTheDocument();
  });
});
