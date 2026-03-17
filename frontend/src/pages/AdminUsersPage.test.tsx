import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AdminUsersPage } from "@/pages/AdminUsersPage";
import { createAdminRole, createAdminUser } from "@/test/fixtures";
import { renderRoute } from "@/test/testUtils";

const mockUseAdminUsersQuery = vi.fn();
const mockUseAdminMutations = vi.fn();

vi.mock("@/features/admin/useAdminUsersQuery", () => ({
  useAdminUsersQuery: () => mockUseAdminUsersQuery(),
}));

vi.mock("@/features/admin/useAdminMutations", () => ({
  useAdminMutations: () => mockUseAdminMutations(),
}));

describe("AdminUsersPage", () => {
  it("surfaces the current admin mutation error banner without changing backend behavior", async () => {
    mockUseAdminUsersQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        users: [createAdminUser()],
        roles: [createAdminRole()],
        pagination: {
          offset: 0,
          limit: 100,
          total: 1,
        },
      },
    });
    mockUseAdminMutations.mockReturnValue({
      status: {
        tone: "error",
        message: "User already exists.",
      },
      isPending: () => false,
      createUser: vi.fn(),
      updateRole: vi.fn(),
      toggleStatus: vi.fn(),
      editUser: vi.fn(),
      updatePassword: vi.fn(),
      deleteUser: vi.fn(),
    });

    renderRoute({
      path: "/ui/admin/users",
      initialEntry: "/ui/admin/users",
      element: <AdminUsersPage />,
    });

    expect(await screen.findByText("Admin users")).toBeInTheDocument();
    expect(screen.getByText("User already exists.")).toBeInTheDocument();
  });
});
