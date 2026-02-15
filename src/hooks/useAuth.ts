import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../api/supabase';
import { authApi } from '../api/auth';

export const useAuth = () => {
  const store = useAuthStore();

  useEffect(() => {
    // Check current session
    const initAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const profile = await authApi.getProfile();
          const subscription = await authApi.getSubscription();
          store.setUser(profile);
          store.setSubscription(subscription);
        } else {
          store.setUser(null);
          store.setSubscription(null);
        }
      } catch {
        store.setUser(null);
      } finally {
        store.setLoading(false);
      }
    };

    initAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          const profile = await authApi.getProfile();
          const sub = await authApi.getSubscription();
          store.setUser(profile);
          store.setSubscription(sub);
        } else if (event === 'SIGNED_OUT') {
          store.logout();
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  return store;
};
