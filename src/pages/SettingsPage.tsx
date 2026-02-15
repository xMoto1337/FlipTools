import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useSubscription } from '../hooks/useSubscription';
import { usePlatform } from '../hooks/usePlatform';
import { authApi } from '../api/auth';
import { stripeApi } from '../api/stripe';

function PlatformConnectionCard({ platformId }: { platformId: 'ebay' | 'depop' }) {
  const { adapter, isConnected, connect, disconnect } = usePlatform(platformId);

  return (
    <div className="platform-connection">
      <div className={`platform-icon ${platformId}`}>{adapter.name[0]}</div>
      <div className="platform-info">
        <div className="platform-name">{adapter.name}</div>
        <div className={`platform-status ${isConnected ? 'connected' : ''}`}>
          {isConnected ? 'Connected' : 'Not connected'}
        </div>
      </div>
      {isConnected ? (
        <button className="btn btn-sm btn-danger" onClick={disconnect}>Disconnect</button>
      ) : (
        <button className="btn btn-sm btn-primary" onClick={connect}>Connect</button>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { user, isAuthenticated } = useAuthStore();
  const { tier, isPaid } = useSubscription();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [saving, setSaving] = useState(false);

  if (!isAuthenticated) {
    return (
      <div>
        <div className="page-header"><h1>Settings</h1></div>
        <div className="empty-state">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          <h3>Sign in to access settings</h3>
          <p>Create an account to manage your profile, subscriptions, and platform connections</p>
          <button className="btn btn-primary" onClick={() => navigate('/auth')}>Sign In</button>
        </div>
      </div>
    );
  }

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      await authApi.updateProfile({ display_name: displayName });
    } catch (err) {
      console.error('Save profile error:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleManageSubscription = async () => {
    try {
      const url = await stripeApi.createPortalSession();
      window.location.href = url;
    } catch (err) {
      console.error('Portal error:', err);
    }
  };

  const handleSignOut = async () => {
    await authApi.signOut();
  };

  return (
    <div>
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      {/* Profile */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="settings-section">
          <div className="settings-section-title">Profile</div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="form-input" value={user?.email || ''} disabled />
            <div className="form-hint">Email cannot be changed</div>
          </div>
          <div className="form-group">
            <label className="form-label">Display Name</label>
            <input
              className="form-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your display name"
            />
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleSaveProfile} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Subscription */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="settings-section">
          <div className="settings-section-title">Subscription</div>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">Current Plan</div>
              <div className="settings-row-desc">
                {tier === 'free' ? 'Free plan with limited features' :
                 tier === 'pro' ? 'Pro plan - $9.99/month' :
                 'Lifetime plan - One-time purchase'}
              </div>
            </div>
            <span className={`status-badge ${tier === 'free' ? 'draft' : 'active'}`}>
              <span className="status-dot" />
              {tier.charAt(0).toUpperCase() + tier.slice(1)}
            </span>
          </div>
          {isPaid ? (
            <button className="btn btn-secondary btn-sm" onClick={handleManageSubscription}>
              Manage Subscription
            </button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => window.location.href = '/pricing'}>
              Upgrade to Pro
            </button>
          )}
        </div>
      </div>

      {/* Platform Connections */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="settings-section">
          <div className="settings-section-title">Platform Connections</div>
          <PlatformConnectionCard platformId="ebay" />
          <PlatformConnectionCard platformId="depop" />
        </div>
      </div>

      {/* Sign Out */}
      <div className="card">
        <div className="settings-section" style={{ marginBottom: 0 }}>
          <div className="settings-section-title">Account</div>
          <button className="btn btn-danger" onClick={handleSignOut}>
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
