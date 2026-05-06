import { fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { deleteSession } from "@/api/session";
import { useLogout } from "@/features/session/useLogout";
import { useSessionStore } from "@/stores/sessionStore";
import { createSession } from "@/test/fixtures";
import { createTestQueryClient } from "@/test/testUtils";
import { uiPaths } from "@/utils/appPaths";

vi.mock("@/api/session", () => ({
  deleteSession: vi.fn(),
}));

function LogoutHarness() {
  const logoutMutation = useLogout();

  return (
    <button type="button" onClick={() => logoutMutation.mutate()}>
      Logout
    </button>
  );
}

describe("useLogout", () => {
  it("clears frontend session state and redirects to /ui/login after backend logout", async () => {
    vi.mocked(deleteSession).mockResolvedValueOnce({
      status: "ok",
      redirect_to: "/login",
    });

    useSessionStore.getState().setAuthenticated(createSession());

    const queryClient = createTestQueryClient();
    queryClient.setQueryData(["session"], createSession());

    const router = createMemoryRouter(
      [
        { path: uiPaths.dashboard, element: <LogoutHarness /> },
        { path: uiPaths.login, element: <div>Frontend login route</div> },
      ],
      {
        initialEntries: [uiPaths.dashboard],
      },
    );

    const { render } = await import("@testing-library/react");
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Logout" }));

    expect(await screen.findByText("Frontend login route")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(uiPaths.login);
    expect(useSessionStore.getState().status).toBe("idle");
    await waitFor(() => {
      expect(queryClient.getQueryData(["session"])).toBeUndefined();
    });
  });
});
