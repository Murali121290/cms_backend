import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router-dom";

import { SessionGate } from "@/features/session/SessionGate";
import { useSessionStore } from "@/stores/sessionStore";
import { renderRoute } from "@/test/testUtils";

const mockUseSessionBootstrap = vi.fn();

vi.mock("@/features/session/useSessionBootstrap", () => ({
  useSessionBootstrap: () => mockUseSessionBootstrap(),
}));

describe("SessionGate", () => {
  afterEach(() => {
    mockUseSessionBootstrap.mockReset();
  });

  it("redirects anonymous users to the frontend login route", async () => {
    useSessionStore.getState().clear();
    mockUseSessionBootstrap.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        authenticated: false,
      },
    });

    renderRoute({
      path: "/ui/*",
      initialEntry: "/ui/dashboard",
      element: (
        <Routes>
          <Route
            path="dashboard"
            element={
              <SessionGate>
                <div>Protected shell</div>
              </SessionGate>
            }
          />
          <Route path="login" element={<div>Frontend login route</div>} />
        </Routes>
      ),
    });

    expect(await screen.findByText("Frontend login route")).toBeInTheDocument();
  });
});
