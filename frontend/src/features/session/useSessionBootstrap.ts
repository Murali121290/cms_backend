import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { getApiErrorMessage } from "@/api/client";
import { getSession } from "@/api/session";
import { useSessionStore } from "@/stores/sessionStore";

export function useSessionBootstrap() {
  const setLoading = useSessionStore((state) => state.setLoading);
  const setAuthenticated = useSessionStore((state) => state.setAuthenticated);
  const setAnonymous = useSessionStore((state) => state.setAnonymous);
  const setError = useSessionStore((state) => state.setError);
  const handoffStarted = useSessionStore((state) => state.handoffStarted);

  const query = useQuery({
    queryKey: ["session"],
    queryFn: getSession,
    enabled: !handoffStarted,
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (handoffStarted) {
      return;
    }

    if (query.isPending) {
      setLoading();
      return;
    }

    if (query.isError) {
      setError(getApiErrorMessage(query.error, "Failed to load session."));
      return;
    }

    if (query.data?.authenticated) {
      setAuthenticated(query.data);
      return;
    }

    setAnonymous();
  }, [
    query.data,
    query.error,
    query.isError,
    query.isPending,
    handoffStarted,
    setAnonymous,
    setAuthenticated,
    setError,
    setLoading,
  ]);

  return query;
}
