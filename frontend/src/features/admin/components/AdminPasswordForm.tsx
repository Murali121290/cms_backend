import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff } from "lucide-react";
import { z } from "zod";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { cn } from "@/utils/cn";
import type { AdminUser } from "@/types/api";

const schema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type FormValues = z.infer<typeof schema>;

interface AdminPasswordFormProps {
  user: AdminUser;
  isPending: boolean;
  onSubmit: (password: string) => Promise<unknown>;
  onCancel: () => void;
}

const inputClass =
  "w-full border border-surface-400 rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold-600 focus:border-transparent disabled:opacity-50 disabled:bg-surface-100 pr-10";

/** Returns 0–4 strength score based on password heuristics */
function getStrength(password: string): number {
  if (password.length === 0) return 0;
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
  return Math.min(score, 4);
}

const strengthLabels = ["", "Weak", "Fair", "Good", "Strong"];
const strengthColors = [
  "",
  "bg-error-500",
  "bg-warning-500",
  "bg-info-500",
  "bg-success-500",
];

function PasswordStrengthBar({ password }: { password: string }) {
  const score = getStrength(password);
  if (password.length === 0) return null;

  return (
    <div className="mt-2 space-y-1">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((seg) => (
          <div
            key={seg}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-200",
              score >= seg ? strengthColors[score] : "bg-surface-300"
            )}
          />
        ))}
      </div>
      <p className={cn("text-xs font-medium", score <= 1 ? "text-error-600" : score === 2 ? "text-warning-600" : score === 3 ? "text-info-600" : "text-success-600")}>
        {strengthLabels[score]}
      </p>
    </div>
  );
}

export function AdminPasswordForm({
  user,
  isPending,
  onSubmit,
  onCancel,
}: AdminPasswordFormProps) {
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
    setError,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: "" },
  });

  const passwordValue = useWatch({ control, name: "password" });

  useEffect(() => {
    reset({ password: "" });
    setShowPassword(false);
  }, [user.id, reset]);

  async function onValid(values: FormValues) {
    try {
      await onSubmit(values.password);
      reset({ password: "" });
    } catch (err) {
      setError("root", {
        message: err instanceof Error ? err.message : "Failed to update password.",
      });
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(onValid)(e)} className="space-y-4">
      {errors.root ? (
        <div className="bg-error-100 border border-error-100 text-error-600 text-sm rounded-md px-3 py-2">
          {errors.root.message}
        </div>
      ) : null}

      <div>
        <label className="block text-sm font-medium text-navy-700 mb-1.5">New Password</label>
        <div className="relative">
          <input
            {...register("password")}
            className={inputClass}
            disabled={isPending}
            type={showPassword ? "text" : "password"}
            placeholder="Min. 8 characters"
            autoComplete="new-password"
          />
          <button
            type="button"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-navy-400 hover:text-navy-700 transition-colors"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? (
              <EyeOff className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Eye className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        </div>
        <PasswordStrengthBar password={passwordValue ?? ""} />
        {errors.password ? (
          <p className="text-xs text-error-600 mt-1">{errors.password.message}</p>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button variant="ghost" type="button" disabled={isPending} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          type="submit"
          isLoading={isPending}
          disabled={isPending || !passwordValue}
        >
          Update Password
        </Button>
      </div>
    </form>
  );
}
