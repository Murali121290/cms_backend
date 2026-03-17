import { FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { getApiErrorMessage } from "@/api/client";
import { getSession } from "@/api/session";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { useLogin } from "@/features/session/useLogin";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { uiPaths } from "@/utils/appPaths";

export function LoginPage() {
  useDocumentTitle("CMS Login");
  const navigate = useNavigate();
  const loginMutation = useLogin();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: getSession,
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!loginMutation.isSuccess) {
      return;
    }

    navigate(uiPaths.dashboard, { replace: true });
  }, [loginMutation.isSuccess, navigate]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loginMutation.mutate({
      username,
      password,
      redirect_to: uiPaths.dashboard,
    });
  }

  if (sessionQuery.isPending) {
    return (
      <LoadingState
        title="Loading login"
        message="Checking whether you already have an active CMS session."
      />
    );
  }

  if (sessionQuery.isError) {
    return (
      <ErrorState
        title="Login unavailable"
        message={getApiErrorMessage(
          sessionQuery.error,
          "The frontend could not verify the current CMS session.",
        )}
        actions={
          <button className="button" onClick={() => sessionQuery.refetch()} type="button">
            Retry
          </button>
        }
      />
    );
  }

  if (sessionQuery.data?.authenticated) {
    return <Navigate replace to={uiPaths.dashboard} />;
  }

  return (
    <main className="page">
      <section className="feedback">
        <h2>Login to CMS UI</h2>
        <p>Use your existing CMS credentials. The backend still owns session creation and cookie issuance.</p>
        <form className="stack" onSubmit={handleSubmit}>
          <label className="stack">
            <span>Username</span>
            <input
              autoComplete="username"
              className="input"
              name="username"
              onChange={(event) => setUsername(event.target.value)}
              required
              type="text"
              value={username}
            />
          </label>
          <label className="stack">
            <span>Password</span>
            <input
              autoComplete="current-password"
              className="input"
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {loginMutation.isError ? (
            <p className="status-banner status-banner--error" role="alert">
              {getApiErrorMessage(loginMutation.error, "Login failed.")}
            </p>
          ) : null}
          <div className="feedback-actions">
            <button className="button" disabled={loginMutation.isPending} type="submit">
              {loginMutation.isPending ? "Signing in..." : "Sign in"}
            </button>
            <Link className="button button--secondary" to={uiPaths.register}>
              Create account
            </Link>
          </div>
        </form>
      </section>
    </main>
  );
}
