import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectsPage } from "@/pages/ProjectsPage";
import { renderWithQueryClient } from "@/test/testUtils";

const getProjects = vi.fn();

vi.mock("@/api/projects", async () => {
  const actual = await vi.importActual<typeof import("@/api/projects")>("@/api/projects");
  return {
    ...actual,
    getProjects: (...args: unknown[]) => getProjects(...args),
  };
});

describe("ProjectsPage", () => {
  it("renders the current error state when the projects contract fails", async () => {
    getProjects.mockRejectedValueOnce(new Error("projects failed"));

    renderWithQueryClient(<ProjectsPage />);

    expect(await screen.findByText("Projects unavailable")).toBeInTheDocument();
    expect(
      screen.getByText("The frontend shell could not load the projects list contract."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open SSR projects" })).toBeInTheDocument();
  });
});
