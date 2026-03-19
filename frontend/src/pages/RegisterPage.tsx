import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
} from "lucide-react";

import { AuthLayout } from "@/features/session/AuthLayout";
import { getApiErrorMessage } from "@/api/client";
import { getSession } from "@/api/session";
import { useRegister } from "@/features/session/useRegister";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { uiPaths } from "@/utils/appPaths";

// ─── Form schema ──────────────────────────────────────────────────────────────

const schema = z
  .object({
    fullName: z.string().min(2, "Full name must be at least 2 characters"),
    email: z.string().email("Please enter a valid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type FormValues = z.infer<typeof schema>;

// ─── Input style helper ───────────────────────────────────────────────────────

function inputStyle(hasError: boolean): React.CSSProperties {
  return {
    width: "100%",
    height: 44,
    backgroundColor: "#FFFFFF",
    border: `1px solid ${hasError ? "#F87171" : "#DDD8D2"}`,
    borderRadius: 8,
    padding: "0 14px",
    fontSize: 14,
    color: "#1A1714",
    outline: "none",
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

function onFocus(e: React.FocusEvent<HTMLInputElement>, hasError: boolean) {
  e.currentTarget.style.border = `1.5px solid ${hasError ? "#F87171" : "#C9821A"}`;
  e.currentTarget.style.boxShadow = hasError
    ? "0 0 0 3px rgba(239,68,68,0.10)"
    : "0 0 0 3px rgba(201,130,26,0.10)";
}

function onBlur(e: React.FocusEvent<HTMLInputElement>, hasError: boolean) {
  e.currentTarget.style.border = `1px solid ${hasError ? "#F87171" : "#DDD8D2"}`;
  e.currentTarget.style.boxShadow = "none";
}

// ─── Password strength bar ────────────────────────────────────────────────────

function getStrength(password: string): {
  level: 0 | 1 | 2 | 3 | 4;
  label: string;
  color: string;
} {
  const len = password.length;
  if (len === 0) return { level: 0, label: "", color: "#E2DDD6" };
  if (len <= 3) return { level: 1, label: "Weak", color: "#EF4444" };
  if (len <= 6) return { level: 2, label: "Fair", color: "#F59E0B" };
  if (len <= 9) return { level: 3, label: "Good", color: "#EAB308" };
  return { level: 4, label: "Strong", color: "#16A34A" };
}

function PasswordStrengthBar({ password }: { password: string }) {
  const { level, label, color } = getStrength(password);
  if (!password) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 4 }} aria-hidden="true">
        {([1, 2, 3, 4] as const).map((seg) => (
          <div
            key={seg}
            style={{
              height: 4,
              flex: 1,
              borderRadius: 9999,
              backgroundColor: seg <= level ? color : "#E2DDD6",
              transition: "background-color 200ms",
            }}
          />
        ))}
      </div>
      {label && (
        <p style={{ fontSize: 11, marginTop: 4, color }}>{label}</p>
      )}
    </div>
  );
}

// ─── Success panel ────────────────────────────────────────────────────────────

function SuccessPanel() {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
        <CheckCircle2 size={48} style={{ color: "#16A34A" }} aria-hidden="true" />
      </div>
      <h2
        style={{
          fontFamily: "Georgia, serif",
          fontSize: 20,
          fontWeight: 600,
          color: "#1A1714",
          marginTop: 16,
          marginBottom: 8,
        }}
      >
        Account created!
      </h2>
      <p style={{ fontSize: 13, color: "#6B6560", margin: "0 0 24px 0" }}>
        Your account has been created successfully.
      </p>
      <Link
        to={uiPaths.login}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: 46,
          borderRadius: 8,
          backgroundColor: "#C9821A",
          color: "#fff",
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: "0.02em",
          textDecoration: "none",
          boxShadow: "0 2px 8px rgba(201,130,26,0.30)",
        }}
      >
        Sign in to get started
      </Link>
    </div>
  );
}

// ─── Register Page ────────────────────────────────────────────────────────────

export function RegisterPage() {
  useDocumentTitle("Create Account — S4Carlisle CMS");
  const registerMutation = useRegister();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const passwordValue = watch("password", "");

  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: getSession,
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const onSubmit = (values: FormValues) => {
    registerMutation.mutate({
      username: values.fullName,
      email: values.email,
      password: values.password,
      confirm_password: values.confirmPassword,
      redirect_to: uiPaths.login,
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

  // ── Already authenticated ─────────────────────────────────────────────────
  if (sessionQuery.data?.authenticated) {
    return <Navigate replace to={uiPaths.dashboard} />;
  }

  // ── Success state ─────────────────────────────────────────────────────────
  if (registerMutation.isSuccess) {
    return (
      <AuthLayout>
        <SuccessPanel />
      </AuthLayout>
    );
  }

  // ── Registration form ─────────────────────────────────────────────────────
  return (
    <AuthLayout>
      <div style={{ maxWidth: 380, width: "100%" }}>
        {/* Mobile-only logo */}
        <div className="auth-mobile-logo">
          <img
            src="/logo.png"
            alt="S4Carlisle Publishing Services"
            style={{ height: 36, width: "auto", marginBottom: 32 }}
            draggable={false}
          />
        </div>

        {/* Heading */}
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
          Create your account
        </h2>
        <p style={{ fontSize: 13, color: "#8A8480", margin: "0 0 32px 0" }}>
          Request access to S4Carlisle CMS
        </p>

        {/* API error banner */}
        {registerMutation.isError && (
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
              {getApiErrorMessage(registerMutation.error, "Registration failed. Please try again.")}
            </p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* Full Name */}
            <div>
              <label htmlFor="reg-fullname" style={labelStyle}>Full Name</label>
              {(() => {
                const reg = register("fullName");
                return (
                  <input
                    id="reg-fullname"
                    type="text"
                    autoComplete="name"
                    placeholder="e.g. John Smith"
                    style={inputStyle(!!errors.fullName)}
                    onFocus={(e) => onFocus(e, !!errors.fullName)}
                    {...reg}
                    onBlur={(e) => { void reg.onBlur(e); onBlur(e, !!errors.fullName); }}
                  />
                );
              })()}
              {errors.fullName && (
                <p style={{ fontSize: 12, color: "#DC2626", marginTop: 4 }} role="alert">
                  {errors.fullName.message}
                </p>
              )}
            </div>

            {/* Email */}
            <div>
              <label htmlFor="reg-email" style={labelStyle}>Email Address</label>
              {(() => {
                const reg = register("email");
                return (
                  <input
                    id="reg-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@s4carlisle.com"
                    style={inputStyle(!!errors.email)}
                    onFocus={(e) => onFocus(e, !!errors.email)}
                    {...reg}
                    onBlur={(e) => { void reg.onBlur(e); onBlur(e, !!errors.email); }}
                  />
                );
              })()}
              {errors.email && (
                <p style={{ fontSize: 12, color: "#DC2626", marginTop: 4 }} role="alert">
                  {errors.email.message}
                </p>
              )}
            </div>

            {/* Password */}
            <div>
              <label htmlFor="reg-password" style={labelStyle}>Password</label>
              <div style={{ position: "relative" }}>
                {(() => {
                  const reg = register("password");
                  return (
                    <input
                      id="reg-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Min. 8 characters"
                      style={{ ...inputStyle(!!errors.password), paddingRight: 44 }}
                      onFocus={(e) => onFocus(e, !!errors.password)}
                      {...reg}
                      onBlur={(e) => { void reg.onBlur(e); onBlur(e, !!errors.password); }}
                    />
                  );
                })()}
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  tabIndex={-1}
                  onClick={() => setShowPassword((v) => !v)}
                  style={{
                    position: "absolute", top: 0, right: 0, bottom: 0, width: 44,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "none", border: "none", cursor: "pointer", color: "#9C9590",
                  }}
                >
                  {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              </div>
              <PasswordStrengthBar password={passwordValue} />
              {errors.password && (
                <p style={{ fontSize: 12, color: "#DC2626", marginTop: 4 }} role="alert">
                  {errors.password.message}
                </p>
              )}
            </div>

            {/* Confirm Password */}
            <div>
              <label htmlFor="reg-confirm-password" style={labelStyle}>Confirm Password</label>
              <div style={{ position: "relative" }}>
                {(() => {
                  const reg = register("confirmPassword");
                  return (
                    <input
                      id="reg-confirm-password"
                      type={showConfirmPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Re-enter your password"
                      style={{ ...inputStyle(!!errors.confirmPassword), paddingRight: 44 }}
                      onFocus={(e) => onFocus(e, !!errors.confirmPassword)}
                      {...reg}
                      onBlur={(e) => { void reg.onBlur(e); onBlur(e, !!errors.confirmPassword); }}
                    />
                  );
                })()}
                <button
                  type="button"
                  aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                  tabIndex={-1}
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  style={{
                    position: "absolute", top: 0, right: 0, bottom: 0, width: 44,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "none", border: "none", cursor: "pointer", color: "#9C9590",
                  }}
                >
                  {showConfirmPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              </div>
              {errors.confirmPassword && (
                <p style={{ fontSize: 12, color: "#DC2626", marginTop: 4 }} role="alert">
                  {errors.confirmPassword.message}
                </p>
              )}
            </div>

          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={registerMutation.isPending}
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
              cursor: registerMutation.isPending ? "not-allowed" : "pointer",
              opacity: registerMutation.isPending ? 0.7 : 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              marginTop: 24,
              boxShadow: registerMutation.isPending ? "none" : "0 2px 8px rgba(201,130,26,0.30)",
              transition: "background-color 150ms ease, box-shadow 150ms ease, transform 150ms ease",
            }}
            onMouseEnter={(e) => {
              if (registerMutation.isPending) return;
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
            {registerMutation.isPending ? (
              <>
                <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" aria-hidden="true" />
                Creating account...
              </>
            ) : (
              "Create Account"
            )}
          </button>
        </form>

        {/* Sign in link */}
        <p style={{ textAlign: "center", fontSize: 13, color: "#8A8480", marginTop: 24 }}>
          Already have an account?{" "}
          <Link
            to={uiPaths.login}
            style={{ color: "#C9821A", fontWeight: 500, textDecoration: "none" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none"; }}
          >
            Sign in
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
