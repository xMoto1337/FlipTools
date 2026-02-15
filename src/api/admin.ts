import { supabase } from './supabase';
import type { UserProfile, Subscription } from './auth';

export interface AdminUser {
  profile: UserProfile;
  subscription: Subscription | null;
}

export const adminApi = {
  async getAllUsers(): Promise<AdminUser[]> {
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (profilesError) throw profilesError;

    const { data: subscriptions, error: subsError } = await supabase
      .from('subscriptions')
      .select('*');

    if (subsError) throw subsError;

    const subMap = new Map(
      (subscriptions || []).map((s: Subscription) => [s.user_id, s])
    );

    return (profiles || []).map((profile: UserProfile) => ({
      profile,
      subscription: subMap.get(profile.id) || null,
    }));
  },

  async updateSubscriptionTier(userId: string, tier: 'free' | 'pro' | 'lifetime') {
    const { data: existing } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (existing) {
      const { error } = await supabase
        .from('subscriptions')
        .update({
          tier,
          status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('subscriptions')
        .insert({
          user_id: userId,
          tier,
          status: 'active',
        });
      if (error) throw error;
    }
  },

  async getUserCount(): Promise<{ total: number; free: number; pro: number; lifetime: number }> {
    const { data: subs, error } = await supabase
      .from('subscriptions')
      .select('tier');

    if (error) throw error;

    const counts = { total: 0, free: 0, pro: 0, lifetime: 0 };
    (subs || []).forEach((s: { tier: string }) => {
      counts.total++;
      if (s.tier === 'free') counts.free++;
      else if (s.tier === 'pro') counts.pro++;
      else if (s.tier === 'lifetime') counts.lifetime++;
    });

    return counts;
  },
};
