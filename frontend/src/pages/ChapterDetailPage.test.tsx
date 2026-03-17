import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChapterDetailPage } from "@/pages/ChapterDetailPage";
import {
  createApiError,
  createChapterDetailResponse,
  createChapterFilesResponse,
} from "@/test/fixtures";
import { renderRoute } from "@/test/testUtils";

const getChapterDetail = vi.fn();
const getChapterFiles = vi.fn();
const checkoutFile = vi.fn();
const cancelCheckout = vi.fn();
const deleteFile = vi.fn();
const downloadFile = vi.fn();
const uploadChapterFiles = vi.fn();
const startProcessingJob = vi.fn();
const getProcessingStatus = vi.fn();

vi.mock("@/api/projects", async () => {
  const actual = await vi.importActual<typeof import("@/api/projects")>("@/api/projects");
  return {
    ...actual,
    getChapterDetail: (...args: unknown[]) => getChapterDetail(...args),
    getChapterFiles: (...args: unknown[]) => getChapterFiles(...args),
  };
});

vi.mock("@/api/files", async () => {
  const actual = await vi.importActual<typeof import("@/api/files")>("@/api/files");
  return {
    ...actual,
    checkoutFile: (...args: unknown[]) => checkoutFile(...args),
    cancelCheckout: (...args: unknown[]) => cancelCheckout(...args),
    deleteFile: (...args: unknown[]) => deleteFile(...args),
    downloadFile: (...args: unknown[]) => downloadFile(...args),
    uploadChapterFiles: (...args: unknown[]) => uploadChapterFiles(...args),
  };
});

vi.mock("@/api/processing", () => ({
  startProcessingJob: (...args: unknown[]) => startProcessingJob(...args),
  getProcessingStatus: (...args: unknown[]) => getProcessingStatus(...args),
}));

describe("ChapterDetailPage", () => {
  it("surfaces checkout lock conflicts without losing the current file row", async () => {
    const detailResponse = createChapterDetailResponse();
    const filesResponse = createChapterFilesResponse();
    getChapterDetail.mockResolvedValue(detailResponse);
    getChapterFiles.mockResolvedValue(filesResponse);
    checkoutFile.mockRejectedValueOnce(
      createApiError("File is locked by another user.", {
        status: 409,
        code: "LOCKED_BY_OTHER",
      }),
    );
    downloadFile.mockResolvedValue({
      blob: new Blob(["content"]),
      filename: "chapter01.docx",
    });

    const { container } = renderRoute({
      path: "/ui/projects/:projectId/chapters/:chapterId",
      initialEntry: "/ui/projects/10/chapters/20",
      element: <ChapterDetailPage />,
    });

    expect(await screen.findByText("chapter01.docx")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Checkout" }));

    expect(await screen.findByText("File is locked by another user.")).toBeInTheDocument();
    expect(screen.getByText("chapter01.docx")).toBeInTheDocument();
    expect(screen.getByText("Unlocked")).toBeInTheDocument();
  });

  it("renders skipped upload results for foreign-lock overwrite attempts", async () => {
    const detailResponse = createChapterDetailResponse();
    const filesResponse = createChapterFilesResponse();
    getChapterDetail.mockResolvedValue(detailResponse);
    getChapterFiles.mockResolvedValue(filesResponse);
    uploadChapterFiles.mockResolvedValue({
      status: "ok",
      uploaded: [],
      skipped: [
        {
          filename: "locked.docx",
          code: "LOCKED_BY_OTHER",
          message: "File is locked by another user.",
        },
      ],
      redirect_to: "/projects/10/chapter/20?tab=Manuscript&msg=Files+Uploaded+Successfully",
    });

    const { container } = renderRoute({
      path: "/ui/projects/:projectId/chapters/:chapterId",
      initialEntry: "/ui/projects/10/chapters/20",
      element: <ChapterDetailPage />,
    });

    expect(await screen.findByText("Upload files")).toBeInTheDocument();

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    await userEvent.upload(
      fileInput!,
      new File(["replacement"], "locked.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByText("Upload finished: 0 uploaded, 1 skipped.")).toBeInTheDocument();
    expect(screen.getByText("LOCKED_BY_OTHER")).toBeInTheDocument();
    expect(screen.getByText("File is locked by another user.")).toBeInTheDocument();

    await waitFor(() => {
      expect(getChapterFiles.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });
});
