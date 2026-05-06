import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";

import { AuthLayout } from "@/features/session/AuthLayout";
import { getApiErrorMessage } from "@/api/client";
import { getSession } from "@/api/session";
import { useLogin } from "@/features/session/useLogin";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { uiPaths } from "@/utils/appPaths";

// ─── Form schema ──────────────────────────────────────────────────────────────

const schema = z.object({
  username: z.string().min(1, "Email is required"),
  password: z.string().min(1, "Password is required"),
});

type FormValues = z.infer<typeof schema>;

// ─── Input style helper ───────────────────────────────────────────────────────

function inputStyle(hasError: boolean, isFocused: boolean): React.CSSProperties {
  return {
    width: "100%",
    height: 44,
    backgroundColor: "#FFFFFF",
    border: `${isFocused ? "1.5px" : "1px"} solid ${
      hasError ? "#F87171" : isFocused ? "#C9821A" : "#DDD8D2"
    }`,
    borderRadius: 8,
    padding: "0 14px",
    fontSize: 14,
    color: "#1A1714",
    outline: "none",
    boxShadow: isFocused
      ? hasError
        ? "0 0 0 3px rgba(239,68,68,0.10)"
        : "0 0 0 3px rgba(201,130,26,0.10)"
      : "none",
    transition: "border 150ms ease, box-shadow 150ms ease",
    boxSizing: "border-box",
  };
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 10,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "#9C9590",
  marginBottom: 6,
};

// ─── Login Page ───────────────────────────────────────────────────────────────

export function LoginPage() {
  useDocumentTitle("Sign In — S4Carlisle CMS");
  const navigate = useNavigate();
  const loginMutation = useLogin();
  const [showPassword, setShowPassword] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: getSession,
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  // Navigate on successful login
  useEffect(() => {
    if (loginMutation.isSuccess) {
      navigate(uiPaths.dashboard, { replace: true });
    }
  }, [loginMutation.isSuccess, navigate]);

  // On failed login: clear password and focus it
  useEffect(() => {
    if (loginMutation.isError) {
      setValue("password", "");
      passwordInputRef.current?.focus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loginMutation.isError, loginMutation.failureCount]);

  const passwordRegistration = register("password");

  const onSubmit = (values: FormValues) => {
    loginMutation.mutate({
      username: values.username,
      password: values.password,
      redirect_to: uiPaths.dashboard,
    });
  };

  // ── Session pending ───────────────────────────────────────────────────────
  if (sessionQuery.isPending) {
    return (
      <AuthLayout>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#6B6560" }}>
          <Loader2
            style={{ width: 16, height: 16, color: "#C9821A", animation: "auth-spin 1s linear infinite" }}
            aria-hidden="true"
          />
          Checking session…
        </div>
      </AuthLayout>
    );
  }

  // ── Session error ─────────────────────────────────────────────────────────
  if (sessionQuery.isError) {
    return (
      <AuthLayout>
        <div style={{ maxWidth: 380, width: "100%" }}>
          <div
            style={{
              marginBottom: 16,
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              borderRadius: 6,
              border: "1px solid #FECACA",
              borderLeft: "3px solid #EF4444",
              backgroundColor: "#FEF2F2",
              padding: "10px 12px",
            }}
          >
            <AlertCircle style={{ width: 14, height: 14, color: "#EF4444", flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
            <p style={{ fontSize: 13, color: "#B91C1C", margin: 0 }}>
              {getApiErrorMessage(sessionQuery.error, "Could not verify the current session.")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void sessionQuery.refetch()}
            style={{
              width: "100%",
              height: 44,
              borderRadius: 8,
              backgroundColor: "#C9821A",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      </AuthLayout>
    );
  }

  // ── Already authenticated ─────────────────────────────────────────────────
  if (sessionQuery.data?.authenticated) {
    return <Navigate replace to={uiPaths.dashboard} />;
  }

  // ── Main login form ───────────────────────────────────────────────────────
  return (
    <AuthLayout>
      <div style={{ maxWidth: 380, width: "100%" }}>

        {/* Mobile-only logo */}
        <div className="auth-mobile-logo" style={{ marginBottom: 32 }}>
          <div
            style={{
              display: "inline-block",
              backgroundColor: "#1C1917",
              borderRadius: 8,
              padding: "10px 18px",
            }}
          >
            <img
              src="/logo.png"
              alt="S4Carlisle Publishing Services"
              style={{ height: 36, width: "auto", display: "block" }}
              draggable={false}
            />
          </div>
        </div>

        {/* Welcome heading */}
        <h2
          style={{
            fontFamily: "Georgia, serif",
            fontSize: 26,
            fontWeight: 600,
            color: "#1A1714",
            margin: "0 0 6px 0",
            letterSpacing: "-0.02em",
            lineHeight: 1.2,
          }}
        >
          Welcome back
        </h2>
        <p style={{ fontSize: 13, color: "#8A8480", margin: "0 0 32px 0" }}>
          Sign in to your account
        </p>

        {/* Login error banner */}
        {loginMutation.isError && (
          <div
            style={{
              marginBottom: 20,
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              borderRadius: 6,
              border: "1px solid #FECACA",
              borderLeft: "3px solid #EF4444",
              backgroundColor: "#FEF2F2",
              padding: "10px 12px",
            }}
            role="alert"
          >
            <AlertCircle style={{ width: 14, height: 14, color: "#EF4444", flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
            <p style={{ fontSize: 13, color: "#B91C1C", margin: 0 }}>
              Invalid email or password. Please try again.
            </p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate>

          {/* Email */}
          <div style={{ marginBottom: 20 }}>
            <label htmlFor="login-username" style={labelStyle}>
              Email Address
            </label>
            {(() => {
              const reg = register("username");
              return (
                <input
                  id="login-username"
                  type="text"
                  autoComplete="username"
                  placeholder="you@s4carlisle.com"
                  style={inputStyle(!!errors.username, emailFocused)}
                  onFocus={() => setEmailFocused(true)}
                  {...reg}
                  onBlur={(e) => { void reg.onBlur(e); setEmailFocused(false); }}
                />
              );
            })()}
            {errors.username && (
              <p style={{ fontSize: 12, color: "#DC2626", marginTop: 4 }} role="alert">
                {errors.username.message}
              </p>
            )}
          </div>

          {/* Password */}
          <div style={{ marginBottom: 4 }}>
            <label htmlFor="login-password" style={labelStyle}>
              Password
            </label>
            <div style={{ position: "relative" }}>
              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••"
                style={{ ...inputStyle(!!errors.password, passwordFocused), paddingRight: 44 }}
                onFocus={() => setPasswordFocused(true)}
                {...passwordRegistration}
                onBlur={(e) => { void passwordRegistration.onBlur(e); setPasswordFocused(false); }}
                ref={(el) => {
                  passwordRegistration.ref(el);
                  passwordInputRef.current = el;
                }}
              />
              <button
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                tabIndex={-1}
                onClick={() => setShowPassword((v) => !v)}
                style={{
                  position: "absolute",
                  top: 0,
                  right: 0,
                  bottom: 0,
                  width: 44,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#9C9590",
                }}
              >
                {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
              </button>
            </div>
            {errors.password && (
              <p style={{ fontSize: 12, color: "#DC2626", marginTop: 4 }} role="alert">
                {errors.password.message}
              </p>
            )}
          </div>

          {/* Remember me + Forgot password */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, marginBottom: 24 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}>
              <input
                type="checkbox"
                id="remember-me"
                style={{ width: 16, height: 16, accentColor: "#C9821A" }}
              />
              <span style={{ fontSize: 13, color: "#6B6560" }}>Remember me</span>
            </label>
            <button
              type="button"
              style={{
                fontSize: 13,
                color: "#C9821A",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
              }}
            >
              Forgot password?
            </button>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loginMutation.isPending}
            style={{
              width: "100%",
              height: 46,
              backgroundColor: "#C9821A",
              color: "#fff",
              borderRadius: 8,
              border: "none",
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: "0.02em",
              cursor: loginMutation.isPending ? "not-allowed" : "pointer",
              opacity: loginMutation.isPending ? 0.7 : 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              boxShadow: loginMutation.isPending ? "none" : "0 2px 8px rgba(201,130,26,0.30)",
              transition: "background-color 150ms ease, box-shadow 150ms ease, transform 150ms ease",
            }}
            onMouseEnter={(e) => {
              if (loginMutation.isPending) return;
              const el = e.currentTarget;
              el.style.backgroundColor = "#B5731A";
              el.style.boxShadow = "0 4px 16px rgba(201,130,26,0.40)";
              el.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget;
              el.style.backgroundColor = "#C9821A";
              el.style.boxShadow = "0 2px 8px rgba(201,130,26,0.30)";
              el.style.transform = "translateY(0)";
            }}
            onMouseDown={(e) => {
              const el = e.currentTarget;
              el.style.backgroundColor = "#A3661A";
              el.style.transform = "translateY(0)";
              el.style.boxShadow = "0 1px 4px rgba(201,130,26,0.25)";
            }}
            onMouseUp={(e) => {
              const el = e.currentTarget;
              el.style.transform = "translateY(-1px)";
              el.style.boxShadow = "0 4px 16px rgba(201,130,26,0.40)";
            }}
          >
            {loginMutation.isPending ? (
              <>
                <Loader2
                  style={{ width: 16, height: 16, animation: "auth-spin 1s linear infinite" }}
                  aria-hidden="true"
                />
                Signing in...
              </>
            ) : (
              "Sign In"
            )}
          </button>
        </form>

        {/* OR divider */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0" }}>
          <div style={{ flex: 1, height: 1, backgroundColor: "#E8E3DC" }} />
          <span style={{ fontSize: 11, color: "#C4BFB9", letterSpacing: "0.15em", textTransform: "uppercase" }}>
            or
          </span>
          <div style={{ flex: 1, height: 1, backgroundColor: "#E8E3DC" }} />
        </div>

        {/* Register link */}
        <p style={{ textAlign: "center", fontSize: 13, color: "#8A8480", margin: 0 }}>
          Don&apos;t have an account?{" "}
          <Link
            to={uiPaths.register}
            style={{ color: "#C9821A", fontWeight: 500, textDecoration: "none" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none"; }}
          >
            Request access
          </Link>
        </p>

        {/* Footer */}
        <p style={{ textAlign: "center", fontSize: 11, color: "#C4BFB9", marginTop: 32, letterSpacing: "0.04em" }}>
          S4Carlisle — Production Suite
        </p>
      </div>
    </AuthLayout>
  );
}
