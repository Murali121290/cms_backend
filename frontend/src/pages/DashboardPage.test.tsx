import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DashboardPage } from "@/pages/DashboardPage";
import { createDashboardResponse } from "@/test/fixtures";
import { renderWithQueryClient } from "@/test/testUtils";

const getDashboard = vi.fn();

vi.mock("@/api/dashboard", () => ({
  getDashboard: (...args: unknown[]) => getDashboard(...args),
}));

describe("DashboardPage", () => {
  it("points the SSR project creation action at the backend origin in the empty state", async () => {
    getDashboard.mockResolvedValueOnce(
      createDashboardResponse({
        projects: [],
      }),
    );

    renderWithQueryClient(<DashboardPage />);

    const link = await screen.findByRole("link", { name: "Open SSR project creation" });
    expect(link).toHaveAttribute("href", "http://localhost:8000/projects/create");
  });

  it("renders the current error state when the dashboard contract fails", async () => {
    getDashboard.mockRejectedValueOnce(new Error("dashboard failed"));

    renderWithQueryClient(<DashboardPage />);

    expect(await screen.findByText("Dashboard unavailable")).toBeInTheDocument();
    expect(
      screen.getByText("The frontend shell could not load the dashboard contract."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open SSR dashboard" })).toBeInTheDocument();
  });
});
