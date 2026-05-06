import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { useSessionStore } from "@/stores/sessionStore";

afterEach(() => {
  cleanup();
  useSessionStore.getState().clear();
});
