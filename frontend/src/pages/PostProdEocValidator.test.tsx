import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PostProdEocValidator } from "@/pages/PostProdEocValidator";

const okResponse = {
  report: {
    generated_at: "2026-11-21T10:00:00",
    reference_prefix: "modplumb2028_eoc",
    totals: { files: 1, questions: 1, errors: 0, warnings: 0, info: 0 },
    rules: [],
    files: [{ file: "x_ch01.docx", chapter: 1, questions: 1, mc: 1, tf: 0, shuffle_lines: 1, images: 0, errors: 0, warnings: 0, info: 0, status: "pass" }],
    issues: [],
  },
  artifacts: { csv: "", xlsx_base64: "" },
};

function renderPage() {
  return render(
    <MemoryRouter>
      <PostProdEocValidator />
    </MemoryRouter>,
  );
}

function addFile() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(["x"], "x_ch01.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("PostProdEocValidator — prefix dropdown and clearing", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears files and prefix after a successful run and remembers the prefix", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(okResponse), { status: 200 }));
    renderPage();
    const prefix = screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.change(prefix, { target: { value: "modplumb2028_eoc" } });
    addFile();
    expect(screen.getByText("x_ch01.docx")).toBeTruthy();
    const run = screen.getByRole("button", { name: /run validation/i });
    fireEvent.mouseDown(run); // a real click presses the mouse first, closing the dropdown
    fireEvent.click(run);

    await waitFor(() => expect(prefix.value).toBe(""));
    expect(screen.queryByText("1 file(s) selected")).toBeNull();
    expect(JSON.parse(localStorage.getItem("eocValidator.recentPrefixes") || "[]")).toEqual(["modplumb2028_eoc"]);

    // Dropdown now offers the recent prefix; picking it fills the box
    fireEvent.click(screen.getByRole("button", { name: /show recent prefixes/i }));
    fireEvent.click(screen.getByRole("option", { name: /modplumb2028_eoc/ }));
    expect(prefix.value).toBe("modplumb2028_eoc");
  });

  it("keeps inputs when the run fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ detail: "boom" }), { status: 400 }));
    renderPage();
    const prefix = screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.change(prefix, { target: { value: "machfund2028_eoc" } });
    addFile();
    fireEvent.click(screen.getByRole("button", { name: /run validation/i }));
    await waitFor(() => expect(screen.getAllByText("boom").length).toBeGreaterThan(0));
    expect(prefix.value).toBe("machfund2028_eoc");
    expect(screen.getByText("x_ch01.docx")).toBeTruthy();
    expect(localStorage.getItem("eocValidator.recentPrefixes")).toBeNull();
  });

  it("lists recent prefixes newest first, filters while typing, and can remove one", () => {
    localStorage.setItem("eocValidator.recentPrefixes", JSON.stringify(["modplumb2028_eoc", "machfund2028_eoc", "iat2028_eoc"]));
    renderPage();
    const prefix = screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.focus(prefix);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["modplumb2028_eoc", "machfund2028_eoc", "iat2028_eoc"]);
    fireEvent.change(prefix, { target: { value: "mach" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["machfund2028_eoc"]);
    fireEvent.change(prefix, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /remove iat2028_eoc from recent/i }));
    expect(JSON.parse(localStorage.getItem("eocValidator.recentPrefixes") || "[]")).toEqual(["modplumb2028_eoc", "machfund2028_eoc"]);
  });
});
