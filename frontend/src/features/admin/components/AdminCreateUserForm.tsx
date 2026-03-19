import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button } from "@/components/ui/Button";
import type { AdminRole } from "@/types/api";

const schema = z.object({
  username: z.string().min(1, "Username is required").max(64),
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  roleId: z.number().positive("Select a role"),
});

type FormValues = z.infer<typeof schema>;

interface AdminCreateUserFormProps {
  roles: AdminRole[];
  isPending: boolean;
  onSubmit: (payload: {
    username: string;
    email: string;
    password: string;
    roleId: number;
  }) => Promise<unknown>;
  onCancel?: () => void;
}

const inputClass =
  "w-full border border-surface-400 rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold-600 focus:border-transparent disabled:opacity-50 disabled:bg-surface-100";

export function AdminCreateUserForm({
  roles,
  isPending,
  onSubmit,
  onCancel,
}: AdminCreateUserFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
    setError,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      username: "",
      email: "",
      password: "",
      roleId: roles[0]?.id ?? 0,
    },
  });

  // Update default roleId if roles load after mount
  useEffect(() => {
    if (roles[0]?.id) setValue("roleId", roles[0].id);
  }, [roles, setValue]);

  async function onValid(values: FormValues) {
    try {
      await onSubmit({
        username: values.username.trim(),
        email: values.email.trim(),
        password: values.password,
        roleId: values.roleId,
      });
      reset({ username: "", email: "", password: "", roleId: roles[0]?.id ?? 0 });
    } catch (err) {
      setError("root", {
        message: err instanceof Error ? err.message : "Failed to create user.",
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
        <label className="block text-sm font-medium text-navy-700 mb-1.5">Username</label>
        <input
          {...register("username")}
          className={inputClass}
          disabled={isPending}
          placeholder="e.g. john_doe"
          type="text"
          autoComplete="username"
        />
        {errors.username ? (
          <p className="text-xs text-error-600 mt-1">{errors.username.message}</p>
        ) : null}
      </div>

      <div>
        <label className="block text-sm font-medium text-navy-700 mb-1.5">Email</label>
        <input
          {...register("email")}
          className={inputClass}
          disabled={isPending}
          placeholder="e.g. john@example.com"
          type="email"
          autoComplete="email"
        />
        {errors.email ? (
          <p className="text-xs text-error-600 mt-1">{errors.email.message}</p>
        ) : null}
      </div>

      <div>
        <label className="block text-sm font-medium text-navy-700 mb-1.5">Password</label>
        <input
          {...register("password")}
          className={inputClass}
          disabled={isPending}
          placeholder="Min. 8 characters"
          type="password"
          autoComplete="new-password"
        />
        {errors.password ? (
          <p className="text-xs text-error-600 mt-1">{errors.password.message}</p>
        ) : null}
      </div>

      <div>
        <label className="block text-sm font-medium text-navy-700 mb-1.5">Role</label>
        <select
          {...register("roleId", { valueAsNumber: true })}
          className={inputClass}
          disabled={isPending || roles.length === 0}
        >
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
              {role.description ? ` — ${role.description}` : ""}
            </option>
          ))}
        </select>
        {errors.roleId ? (
          <p className="text-xs text-error-600 mt-1">{errors.roleId.message}</p>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        {onCancel ? (
          <Button variant="ghost" type="button" disabled={isPending} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button
          variant="primary"
          type="submit"
          isLoading={isPending}
          disabled={isPending || roles.length === 0}
        >
          Create User
        </Button>
      </div>
    </form>
  );
}
