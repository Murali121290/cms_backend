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
        mapped[u.user_name] = u;
      });
      set({ users: usersList, usersByUsername: mapped, loading: false });
    } catch (err: any) {
      set({ loading: false, error: err?.message || 'Failed to fetch users' });
    }
  },
  getUserDisplayNameByUsername: (username) => {
    if (!username) return 'Unknown User';
    const user = get().usersByUsername[username];
    if (user) {
      return getUserDisplayName(user);
    }
    return username;
  }
}));
