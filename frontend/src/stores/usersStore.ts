import { create } from 'zustand';
import { usersApi, type User } from '@/api/users';
import { getUserDisplayName } from '@/utils/userUtils';

interface UsersStore {
  users: User[];
  usersByUsername: Record<string, User>;
  loading: boolean;
  error: string | null;
  fetchUsers: () => Promise<void>;
  getUserDisplayNameByUsername: (username: string | null | undefined) => string;
}

export const useUsersStore = create<UsersStore>((set, get) => ({
  users: [],
  usersByUsername: {},
  loading: false,
  error: null,
  fetchUsers: async () => {
    // Only fetch once
    if (get().users.length > 0 || get().loading) return;
    
    set({ loading: true, error: null });
    try {
      const usersList = await usersApi.list();
      const mapped: Record<string, User> = {};
      usersList.forEach(u => {
        if (u.user_name) mapped[u.user_name] = u;
        if ((u as any).username) mapped[(u as any).username] = u;
        if (u.id != null) mapped[String(u.id)] = u;
      });
      set({ users: usersList, usersByUsername: mapped, loading: false });
    } catch (err: any) {
      set({ loading: false, error: err?.message || 'Failed to fetch users' });
    }
  },
  getUserDisplayNameByUsername: (username) => {
    if (!username) return 'Unknown User';
    if (get().users.length === 0 && !get().loading) {
      get().fetchUsers();
    }
    const key = String(username).trim();
    const user = get().usersByUsername[key] || get().usersByUsername[key.toLowerCase()];
    if (user) {
      return getUserDisplayName(user);
    }
    return username;
  }
}));
