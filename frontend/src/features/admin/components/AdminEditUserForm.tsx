import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button } from "@/components/ui/Button";
import type { AdminUser } from "@/types/api";

const schema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
});

type FormValues = z.infer<typeof schema>;

interface AdminEditUserFormProps {
  user: AdminUser;
  isPending: boolean;
  onSubmit: (email: string) => Promise<unknown>;
  onCancel: () => void;
}

const inputClass =
  "w-full border border-border rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold-600 focus:border-transparent disabled:opacity-50 disabled:bg-background";

export function AdminEditUserForm({
  user,
  isPending,
  onSubmit,
  onCancel,
}: AdminEditUserFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
    setError,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: user.email },
  });

  // Reset when user changes (drawer opened for different user)
  useEffect(() => {
    reset({ email: user.email });
  }, [user.id, user.email, reset]);

  async function onValid(values: FormValues) {
    try {
      await onSubmit(values.email.trim());
    } catch (err) {
      setError("root", {
        message: err instanceof Error ? err.message : "Failed to update user.",
      });
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(onValid)(e)} className="space-y-4">
      {errors.root ? (
        <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-md px-3 py-2">
          {errors.root.message}
        </div>
      ) : null}

      <div>
        <label className="block text-sm font-medium text-text mb-1.5" htmlFor="email">Email</label>
        <input
          {...register("email")}
          id="email"
          className={inputClass}
          disabled={isPending}
          type="email"
          autoComplete="email"
        />
        {errors.email ? (
          <p className="text-xs text-danger mt-1">{errors.email.message}</p>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button variant="ghost" type="button" disabled={isPending} onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" isLoading={isPending} disabled={isPending}>
          Save Changes
        </Button>
      </div>
    </form>
  );
}
