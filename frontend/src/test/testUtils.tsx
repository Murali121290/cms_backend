import type { PropsWithChildren, ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

function QueryWrapper({ children, queryClient }: PropsWithChildren<{ queryClient: QueryClient }>) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export function renderWithQueryClient(element: ReactElement) {
  const queryClient = createTestQueryClient();
  return {
    queryClient,
    ...render(<QueryWrapper queryClient={queryClient}>{element}</QueryWrapper>),
  };
}

export function renderRoute({
  path,
  initialEntry,
  element,
}: {
  path: string;
  initialEntry: string;
  element: ReactElement;
}) {
  const queryClient = createTestQueryClient();
  const routes: RouteObject[] = [{ path, element }];
  const router = createMemoryRouter(routes, {
    initialEntries: [initialEntry],
  });

  return {
    queryClient,
    router,
    ...render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  };
}
