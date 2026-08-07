import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { User } from "@/types";

interface AuthState {
  user: User | null;
  token: string | null;
  role: User["role"] | null;
  login: (user: User, token: string) => void;
  logout: () => void;
  setUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      role: null,
      login: (user, token) => set({ user, token, role: user.role }),
      logout: () => set({ user: null, token: null, role: null }),
      setUser: (user) => set({ user, role: user.role }),
    }),
    {
      name: "eventtixx-auth",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
