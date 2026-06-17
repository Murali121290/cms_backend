import { fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { LoginPage } from "@/pages/LoginPage";
import { createApiError, createSession, createViewer } from "@/test/fixtures";
import { createTestQueryClient } from "@/test/testUtils";
import { uiPaths } from "@/utils/appPaths";

const getSession = vi.fn();
const loginSession = vi.fn();

vi.mock("@/api/session", () => ({
  getSession: (...args: unknown[]) => getSession(...args),
  loginSession: (...args: unknown[]) => loginSession(...args),
}));

function renderLoginRoute(initialEntry = uiPaths.login) {
  const queryClient = createTestQueryClient();
  const router = createMemoryRouter(
    [
      { path: uiPaths.login, element: <LoginPage /> },
      { path: uiPaths.dashboard, element: <div>Dashboard route</div> },
    ],
    {
      initialEntries: [initialEntry],
    },
  );

  return {
    queryClient,
    router,
    ...screen,
    renderResult: (
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    ),
  };
}

describe("LoginPage", () => {
  it("redirects to the dashboard when the current session is already authenticated", async () => {
    getSession.mockResolvedValueOnce(createSession());

    const queryClient = createTestQueryClient();
    const router = createMemoryRouter(
      [
        { path: uiPaths.login, element: <LoginPage /> },
        { path: uiPaths.dashboard, element: <div>Dashboard route</div> },
      ],
      { initialEntries: [uiPaths.login] },
    );

    const { render } = await import("@testing-library/react");
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Dashboard route")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(uiPaths.dashboard);
  });

  it("shows the current 401 error state when login fails", async () => {
    getSession.mockResolvedValueOnce(createSession({ authenticated: false, viewer: null, auth: { mode: null, expires_at: null } }));
    loginSession.mockRejectedValueOnce(createApiError("Invalid credentials", { status: 401, code: "INVALID_CREDENTIALS" }));

    const queryClient = createTestQueryClient();
    const router = createMemoryRouter([{ path: uiPaths.login, element: <LoginPage /> }], {
      initialEntries: [uiPaths.login],
    });

    const { render } = await import("@testing-library/react");
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    fireEvent.change(await screen.findByLabelText("Username"), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid credentials");
  });

  it("signs in with the current backend contract and redirects to the dashboard", async () => {
    getSession.mockResolvedValueOnce(
      createSession({ authenticated: false, viewer: null, auth: { mode: null, expires_at: null } }),
    );
    loginSession.mockResolvedValueOnce({
      status: "ok",
      session: {
        authenticated: true,
        auth_mode: "cookie",
        expires_at: "2026-03-17T00:00:00",
      },
      viewer: createViewer(),
      redirect_to: uiPaths.dashboard,
    });

    const queryClient = createTestQueryClient();
    const router = createMemoryRouter(
      [
        { path: uiPaths.login, element: <LoginPage /> },
        { path: uiPaths.dashboard, element: <div>Dashboard route</div> },
      ],
      { initialEntries: [uiPaths.login] },
    );

    const { render } = await import("@testing-library/react");
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    fireEvent.change(await screen.findByLabelText("Username"), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "Password123!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(loginSession).toHaveBeenCalledWith({
        username: "admin",
        password: "Password123!",
        redirect_to: uiPaths.dashboard,
      });
    });
    expect(await screen.findByText("Dashboard route")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(uiPaths.dashboard);
    expect(queryClient.getQueryData(["session"])).toMatchObject({
      authenticated: true,
      viewer: { username: "admin" },
      auth: { mode: "cookie" },
    });
  });
});
