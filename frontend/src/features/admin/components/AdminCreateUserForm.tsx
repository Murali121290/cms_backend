import { useState } from "react";

import type { AdminRole } from "@/types/api";

interface AdminCreateUserFormProps {
  roles: AdminRole[];
  isPending: boolean;
  onSubmit: (payload: {
    username: string;
    email: string;
    password: string;
    roleId: number;
  }) => Promise<unknown>;
}

export function AdminCreateUserForm({
  roles,
  isPending,
  onSubmit,
}: AdminCreateUserFormProps) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState<number>(roles[0]?.id ?? 0);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!username.trim() || !email.trim() || !password || !roleId) {
      return;
    }

    await onSubmit({
      username: username.trim(),
      email: email.trim(),
      password,
      roleId,
    });

    setUsername("");
    setEmail("");
    setPassword("");
    setRoleId(roles[0]?.id ?? 0);
  }

  return (
    <section className="panel stack">
      <div className="section-title">
        <h2>Create user</h2>
        <span className="helper-text">Uses the current `/api/v2/admin/users` create contract.</span>
      </div>

      <form className="admin-form-grid" onSubmit={handleSubmit}>
        <label className="field">
          <span>Username</span>
          <input
            className="search-input"
            disabled={isPending}
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Email</span>
          <input
            className="search-input"
            disabled={isPending}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            className="search-input"
            disabled={isPending}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Role</span>
          <select
            className="select-input"
            disabled={isPending}
            value={roleId}
            onChange={(event) => setRoleId(Number.parseInt(event.target.value, 10))}
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </label>
        <div className="upload-actions">
          <button className="button" disabled={isPending || roles.length === 0} type="submit">
            {isPending ? "Creating..." : "Create user"}
          </button>
        </div>
      </form>
    </section>
  );
}
