import { create } from "zustand";

import type { SessionGetResponse, Viewer } from "@/types/api";

export type SessionStatus = "idle" | "loading" | "authenticated" | "anonymous" | "error";

interface SessionStore {
  status: SessionStatus;
  viewer: Viewer | null;
  authMode: "cookie" | "bearer" | null;
  expiresAt: string | null;
  errorMessage: string | null;
  handoffStarted: boolean;
  setLoading: () => void;
  setAuthenticated: (payload: SessionGetResponse) => void;
  setAnonymous: () => void;
  setError: (message: string) => void;
  startHandoff: () => void;
  clear: () => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  status: "idle",
  viewer: null,
  authMode: null,
  expiresAt: null,
  errorMessage: null,
  handoffStarted: false,
  setLoading: () =>
    set((state) => ({
      ...state,
      status: "loading",
      errorMessage: null,
    })),
  setAuthenticated: (payload) =>
    set({
      status: "authenticated",
      viewer: payload.viewer,
      authMode: payload.auth.mode,
      expiresAt: payload.auth.expires_at,
      errorMessage: null,
      handoffStarted: false,
    }),
  setAnonymous: () =>
    set({
      status: "anonymous",
      viewer: null,
      authMode: null,
      expiresAt: null,
      errorMessage: null,
      handoffStarted: false,
    }),
  setError: (message) =>
    set({
      status: "error",
      viewer: null,
      authMode: null,
      expiresAt: null,
      errorMessage: message,
      handoffStarted: false,
    }),
  startHandoff: () =>
    set((state) => ({
      ...state,
      handoffStarted: true,
    })),
  clear: () =>
    set({
      status: "idle",
      viewer: null,
      authMode: null,
      expiresAt: null,
      errorMessage: null,
      handoffStarted: false,
    }),
}));
