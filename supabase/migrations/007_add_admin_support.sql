-- Add is_admin column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- Helper function for RLS admin checks
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$;

-- Admins can read all profiles
CREATE POLICY "Admins can read all profiles"
  ON profiles FOR SELECT
  USING (public.is_admin());

-- Admins can read all subscriptions
CREATE POLICY "Admins can read all subscriptions"
  ON subscriptions FOR SELECT
  USING (public.is_admin());

-- Admins can update any subscription
CREATE POLICY "Admins can update all subscriptions"
  ON subscriptions FOR UPDATE
  USING (public.is_admin());

-- Admins can insert subscriptions for any user
CREATE POLICY "Admins can insert subscriptions"
  ON subscriptions FOR INSERT
  WITH CHECK (public.is_admin());

-- Admins can delete subscriptions
CREATE POLICY "Admins can delete subscriptions"
  ON subscriptions FOR DELETE
  USING (public.is_admin());
