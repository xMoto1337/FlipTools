import { useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';

/**
 * Returns a `requireAuth` wrapper. Pass it a callback and an optional message.
 * If the user is logged in, the callback runs. If not, the sign-in modal appears.
 */
export function useRequireAuth() {
  const { isAuthenticated, promptSignIn } = useAuthStore();

  const requireAuth = useCallback(
    <T extends unknown[]>(callback: (...args: T) => void, message?: string) => {
      return (...args: T) => {
        if (!isAuthenticated) {
          promptSignIn(message);
          return;
        }
        callback(...args);
      };
    },
    [isAuthenticated, promptSignIn]
  );

  return { requireAuth, isAuthenticated };
}
