import { FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { getApiErrorMessage } from "@/api/client";
import { getSession } from "@/api/session";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { getRegisterErrorMessage, useRegister } from "@/features/session/useRegister";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { uiPaths } from "@/utils/appPaths";

export function RegisterPage() {
  useDocumentTitle("CMS Register");
  const navigate = useNavigate();
  const registerMutation = useRegister();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: getSession,
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!registerMutation.isSuccess) {
      return;
    }

    navigate(uiPaths.login, { replace: true });
  }, [registerMutation.isSuccess, navigate]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    registerMutation.mutate({
      username,
      email,
      password,
      confirm_password: confirmPassword,
      redirect_to: uiPaths.login,
    });
  }

  if (sessionQuery.isPending) {
    return (
      <LoadingState
        title="Loading registration"
        message="Checking whether you already have an active CMS session."
      />
    );
  }

  if (sessionQuery.isError) {
    return (
      <ErrorState
        title="Registration unavailable"
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
        <h2>Create CMS account</h2>
        <p>The backend still owns validation, role bootstrap, and session issuance.</p>
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
            <span>Email</span>
            <input
              autoComplete="email"
              className="input"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label className="stack">
            <span>Password</span>
            <input
              autoComplete="new-password"
              className="input"
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <label className="stack">
            <span>Confirm password</span>
            <input
              autoComplete="new-password"
              className="input"
              name="confirm_password"
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              type="password"
              value={confirmPassword}
            />
          </label>
          {registerMutation.isError ? (
            <p className="status-banner status-banner--error" role="alert">
              {getRegisterErrorMessage(registerMutation.error)}
            </p>
          ) : null}
          <div className="feedback-actions">
            <button className="button" disabled={registerMutation.isPending} type="submit">
              {registerMutation.isPending ? "Creating account..." : "Create account"}
            </button>
            <Link className="button button--secondary" to={uiPaths.login}>
              Back to login
            </Link>
          </div>
        </form>
      </section>
    </main>
  );
}
