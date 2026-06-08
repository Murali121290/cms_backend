import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { useSessionStore } from "@/stores/sessionStore";

if (typeof window !== "undefined") {
  // @ts-ignore
  window.document.elementFromPoint = () => null;
  // @ts-ignore
  Document.prototype.elementFromPoint = () => null;
  // @ts-ignore
  import.meta.env.VITE_DEV_PROXY_TARGET = "http://localhost:8000";
}

afterEach(() => {
  cleanup();
  useSessionStore.getState().clear();
});
