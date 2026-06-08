import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChapterDetailPage } from "@/pages/ChapterDetailPage";
import {
  createApiError,
  createChapterDetailResponse,
  createChapterFilesResponse,
  createFileRecord,
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
const getFileVersions = vi.fn();

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
    getFileVersions: (...args: unknown[]) => getFileVersions(...args),
  };
});

vi.mock("@/api/processing", () => ({
  startProcessingJob: (...args: unknown[]) => startProcessingJob(...args),
  getProcessingStatus: (...args: unknown[]) => getProcessingStatus(...args),
}));

describe("ChapterDetailPage", () => {
  it("keeps the active folder synchronized from the sidebar selection", async () => {
    const baseDetailResponse = createChapterDetailResponse();
    const detailResponse = createChapterDetailResponse({
      chapter: {
        ...baseDetailResponse.chapter,
        category_counts: {
          Art: 1,
          Manuscript: 1,
          InDesign: 0,
          Proof: 0,
          XML: 0,
          Miscellaneous: 0,
        },
      },
      active_tab: "Manuscript",
    });
    const filesResponse = createChapterFilesResponse({
      chapter: detailResponse.chapter,
      files: [
        createFileRecord(),
        createFileRecord({
          id: 101,
          filename: "art.png",
          file_type: "png",
          category: "Art",
        }),
      ],
    });

    getChapterDetail.mockResolvedValue(detailResponse);
    getChapterFiles.mockResolvedValue(filesResponse);
    getFileVersions.mockResolvedValue({ versions: [] });
    getProcessingStatus.mockRejectedValue(createApiError("Not found", { status: 404 }));

    renderRoute({
      path: "/projects/:projectId/chapters/:chapterId",
      initialEntry: "/projects/10/chapters/20",
      element: <ChapterDetailPage />,
    });

    expect(await screen.findByText("BOOK100 / Manuscript folder")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Art/i }));

    expect(screen.getByRole("button", { name: /Art/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("BOOK100 / Art folder")).toBeInTheDocument();

    const currentFolderCard = screen.getByText("Current folder").closest("article");
    expect(currentFolderCard).not.toBeNull();
    expect(within(currentFolderCard!).getByText("Art folder")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Art folder" })).toBeInTheDocument();
    expect(screen.getByText("art.png")).toBeInTheDocument();
    expect(screen.queryByText("chapter01.docx")).not.toBeInTheDocument();
  });

  it("removes backend and SSR fallback labels from the normal chapter detail UI", async () => {
    getChapterDetail.mockResolvedValue(createChapterDetailResponse());
    getChapterFiles.mockResolvedValue(createChapterFilesResponse());
    getFileVersions.mockResolvedValue({ versions: [] });
    getProcessingStatus.mockRejectedValue(createApiError("Not found", { status: 404 }));

    renderRoute({
      path: "/projects/:projectId/chapters/:chapterId",
      initialEntry: "/projects/10/chapters/20",
      element: <ChapterDetailPage />,
    });

    expect(await screen.findByText("Chapter 01 - Chapter One")).toBeInTheDocument();
    expect(screen.queryByText("Current backend tab")).not.toBeInTheDocument();
    expect(screen.queryByText("Open SSR chapter view")).not.toBeInTheDocument();
    expect(screen.queryByText(/compatibility status contract/i)).not.toBeInTheDocument();
  });

  it("surfaces checkout lock conflicts without losing the current file row", async () => {
    const detailResponse = createChapterDetailResponse();
    const filesResponse = createChapterFilesResponse();
    getChapterDetail.mockResolvedValue(detailResponse);
    getChapterFiles.mockResolvedValue(filesResponse);
    getFileVersions.mockResolvedValue({ versions: [] });
    getProcessingStatus.mockRejectedValue(createApiError("Not found", { status: 404 }));
    checkoutFile.mockRejectedValueOnce(
      createApiError("File is locked by another user.", {
        status: 409,
        code: "LOCKED_BY_OTHER",
      }),
    );

    renderRoute({
      path: "/projects/:projectId/chapters/:chapterId",
      initialEntry: "/projects/10/chapters/20",
      element: <ChapterDetailPage />,
    });

    expect(await screen.findByText("chapter01.docx")).toBeInTheDocument();

    // Open context menu via "More actions" button
    const moreBtn = screen.getByRole("button", { name: "More actions" });
    await userEvent.click(moreBtn);

    // Click "Check Out" in the context menu (portaled to body)
    const checkOutItem = await screen.findByRole("menuitem", { name: /Check Out/i });
    await userEvent.click(checkOutItem);

    // Error message should appear and file row should persist
    expect(await screen.findByText("File is locked by another user.")).toBeInTheDocument();
    expect(screen.getByText("chapter01.docx")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
  });

  it("renders skipped upload results for foreign-lock overwrite attempts", async () => {
    const detailResponse = createChapterDetailResponse();
    const filesResponse = createChapterFilesResponse();
    getChapterDetail.mockResolvedValue(detailResponse);
    getChapterFiles.mockResolvedValue(filesResponse);
    getFileVersions.mockResolvedValue({ versions: [] });
    getProcessingStatus.mockRejectedValue(createApiError("Not found", { status: 404 }));
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

    renderRoute({
      path: "/projects/:projectId/chapters/:chapterId",
      initialEntry: "/projects/10/chapters/20",
      element: <ChapterDetailPage />,
    });

    await userEvent.click(await screen.findByRole("button", { name: /Upload/ }));
    const uploadDialog = await screen.findByRole("dialog", { name: "Upload files" });

    const fileInput = uploadDialog.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    await userEvent.upload(
      fileInput!,
      new File(["replacement"], "locked.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );

    await userEvent.click(within(uploadDialog).getByRole("button", { name: "Upload" }));

    expect(await screen.findByText("Upload finished: 0 uploaded, 1 skipped.")).toBeInTheDocument();
    expect(screen.getByText("LOCKED_BY_OTHER")).toBeInTheDocument();
    expect(screen.getByText("File is locked by another user.")).toBeInTheDocument();

    await waitFor(() => {
      expect(getChapterFiles.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("keeps file actions wired after switching folders from the sidebar", async () => {
    const baseDetailResponse = createChapterDetailResponse();
    const detailResponse = createChapterDetailResponse({
      chapter: {
        ...baseDetailResponse.chapter,
        category_counts: {
          Art: 1,
          Manuscript: 1,
          InDesign: 0,
          Proof: 0,
          XML: 0,
          Miscellaneous: 0,
        },
      },
      active_tab: "Manuscript",
    });
    const filesResponse = createChapterFilesResponse({
      chapter: detailResponse.chapter,
      files: [
        createFileRecord(),
        createFileRecord({
          id: 101,
          filename: "art.png",
          file_type: "png",
          category: "Art",
          available_actions: ["download", "delete", "edit", "technical_edit", "checkout", "structuring_review"],
        }),
      ],
    });

    getChapterDetail.mockResolvedValue(detailResponse);
    getChapterFiles.mockResolvedValue(filesResponse);
    getFileVersions.mockResolvedValue({ versions: [] });
    getProcessingStatus.mockRejectedValue(createApiError("Not found", { status: 404 }));
    deleteFile.mockResolvedValue({
      status: "ok",
      deleted: {
        file_id: 101,
        filename: "art.png",
        category: "Art",
        project_id: 10,
        chapter_id: 20,
      },
      redirect_to: null,
    });

    renderRoute({
      path: "/projects/:projectId/chapters/:chapterId",
      initialEntry: "/projects/10/chapters/20",
      element: <ChapterDetailPage />,
    });

    await screen.findByText("chapter01.docx");
    await userEvent.click(screen.getByRole("button", { name: /Art/i }));

    const artRow = screen.getByText("art.png").closest("tr");
    expect(artRow).not.toBeNull();

    // Open context menu via "More actions" for the art file row
    const moreBtns = within(artRow!).getAllByRole("button", { name: "More actions" });
    await userEvent.click(moreBtns[0]);

    // Verify context menu has the expected links/actions (portaled to body)
    await screen.findByRole("menu");

    // Verify "Technical Edit" link is present and has correct href
    const techEditLink = screen.getByRole("menuitem", { name: /Technical Edit/i });
    expect(techEditLink).toHaveAttribute(
      "href",
      "/projects/10/chapters/20/files/101/technical-review",
    );

    // Verify "View Structuring Review" link is present and has correct href
    const structReviewLink = screen.getByRole("menuitem", { name: /View Structuring Review/i });
    expect(structReviewLink).toHaveAttribute(
      "href",
      "/projects/10/chapters/20/files/101/structuring-review",
    );

    // Click "Delete" in the context menu
    const deleteItem = screen.getByRole("menuitem", { name: /^Delete$/i });
    await userEvent.click(deleteItem);

    // Confirm delete in the confirmation dialog
    const confirmDialog = await screen.findByRole("dialog");
    const confirmButton = within(confirmDialog).getByRole("button", { name: /Delete/i });
    await userEvent.click(confirmButton);

    await waitFor(() => {
      expect(deleteFile).toHaveBeenCalledWith(101);
    });
  });

  it("keeps structuring start and review entry routes wired to the current contracts", async () => {
    const detailResponse = createChapterDetailResponse();
    const filesResponse = createChapterFilesResponse({
      files: [
        createFileRecord({
          available_actions: ["download", "delete", "edit", "technical_edit", "checkout", "structuring_review"],
        }),
      ],
    });
    getChapterDetail.mockResolvedValue(detailResponse);
    getChapterFiles.mockResolvedValue(filesResponse);
    getFileVersions.mockResolvedValue({ versions: [] });
    getProcessingStatus.mockRejectedValue(createApiError("Not found", { status: 404 }));
    startProcessingJob.mockResolvedValue({
      status: "processing",
      message: "Structuring started.",
    });

    renderRoute({
      path: "/projects/:projectId/chapters/:chapterId",
      initialEntry: "/projects/10/chapters/20",
      element: <ChapterDetailPage />,
    });

    // Wait for file to render
    expect(await screen.findByText("chapter01.docx")).toBeInTheDocument();

    // Open context menu via "More actions" to verify review links
    const moreBtn = screen.getByRole("button", { name: "More actions" });
    await userEvent.click(moreBtn);

    await screen.findByRole("menu");

    // Verify "Technical Edit" link in context menu (portaled to body)
    const techEditLink = screen.getByRole("menuitem", { name: /Technical Edit/i });
    expect(techEditLink).toHaveAttribute(
      "href",
      "/projects/10/chapters/20/files/100/technical-review",
    );

    // Verify "View Structuring Review" link in context menu
    const structReviewLink = screen.getByRole("menuitem", { name: /View Structuring Review/i });
    expect(structReviewLink).toHaveAttribute(
      "href",
      "/projects/10/chapters/20/files/100/structuring-review",
    );

    // Verify "Structuring" processing action exists in context menu
    const structuringItem = screen.getByRole("menuitem", { name: "Structuring" });
    expect(structuringItem).toBeInTheDocument();
  });
});
