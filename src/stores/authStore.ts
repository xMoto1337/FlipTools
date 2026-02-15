import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UserProfile, Subscription } from '../api/auth';

interface AuthState {
  user: UserProfile | null;
  subscription: Subscription | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  showSignInPrompt: boolean;
  signInPromptMessage: string;

  setUser: (user: UserProfile | null) => void;
  setSubscription: (subscription: Subscription | null) => void;
  setLoading: (loading: boolean) => void;
  logout: () => void;
  promptSignIn: (message?: string) => void;
  dismissSignInPrompt: () => void;

  // Computed helpers
  isFree: () => boolean;
  isPro: () => boolean;
  isLifetime: () => boolean;
  isPaid: () => boolean;
  isAdmin: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      subscription: null,
      isLoading: true,
      isAuthenticated: false,
      showSignInPrompt: false,
      signInPromptMessage: '',

      setUser: (user) => set({ user, isAuthenticated: !!user }),
      setSubscription: (subscription) => set({ subscription }),
      setLoading: (isLoading) => set({ isLoading }),
      logout: () => set({ user: null, subscription: null, isAuthenticated: false }),
      promptSignIn: (message) => set({ showSignInPrompt: true, signInPromptMessage: message || 'Sign in to continue' }),
      dismissSignInPrompt: () => set({ showSignInPrompt: false, signInPromptMessage: '' }),

      isFree: () => {
        const sub = get().subscription;
        return !sub || sub.tier === 'free';
      },
      isPro: () => {
        const sub = get().subscription;
        return sub?.tier === 'pro' && sub?.status === 'active';
      },
      isLifetime: () => {
        const sub = get().subscription;
        return sub?.tier === 'lifetime' && sub?.status === 'active';
      },
      isPaid: () => {
        const sub = get().subscription;
        return !!sub && sub.tier !== 'free' && sub.status === 'active';
      },
      isAdmin: () => {
        const user = get().user;
        return user?.is_admin === true;
      },
    }),
    {
      name: 'fliptools-auth',
      partialize: (state) => ({
        user: state.user,
        subscription: state.subscription,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
