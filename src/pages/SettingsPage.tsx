import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useSubscription } from '../hooks/useSubscription';
import { usePlatform } from '../hooks/usePlatform';
import { usePlatformStore } from '../stores/platformStore';
import { authApi } from '../api/auth';
import { stripeApi } from '../api/stripe';
import { isTauri } from '../utils/isTauri';
import { config } from '../config';

// Snippet that runs on depop.com — searches localStorage/sessionStorage/cookies
// for a JWT (starts with eyJ), then redirects to our callback with the token.
const DEPOP_SNIPPET = `(function(){var t=null;[localStorage,sessionStorage].forEach(function(s){if(t)return;for(var k in s){var v=s.getItem(k);if(v&&v.startsWith('eyJ')&&v.length>50){t=v;break;}}});if(!t){var ck=document.cookie.split(';').map(function(c){return c.trim();}).find(function(c){return c.startsWith('eyJ')||c.includes('access_token')||c.includes('depop_token');});if(ck)t=ck.split('=').slice(1).join('=');}if(t){location.href='https://fliptools.net/depop/callback?token='+encodeURIComponent(t);}else{alert('Could not find token. Reload depop.com, browse around for a few seconds, then try again.');}})()`;

// ── Depop login modal ─────────────────────────────────────────────────────────
function DepopLoginModal({ onClose }: { onClose: () => void }) {
  const [token, setToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const setConnection = usePlatformStore((s) => s.setConnection);

  const saveToken = (accessToken: string) => {
    setConnection('depop', {
      platform: 'depop',
      accessToken,
      refreshToken: '',
      tokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      platformUsername: 'Depop Account',
      connectedAt: new Date().toISOString(),
    });
    onClose();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(DEPOP_SNIPPET).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleManualSave = () => {
    const t = token.trim().replace(/^Bearer\s+/i, '');
    if (!t) { setError('Paste your Bearer token first.'); return; }
    saveToken(t);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={onClose}>
      <div className="card" style={{ width: '100%', maxWidth: 480, padding: 32 }}
        onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 4 }}>Connect Depop</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24 }}>
          Depop doesn't offer third-party login. Use the quick connect below — it takes about 30 seconds.
        </p>

        {/* Step 1 */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'flex-start' }}>
          <div style={{
            width: 24, height: 24, borderRadius: '50%', background: 'var(--neon-cyan)',
            color: '#000', fontWeight: 700, fontSize: 12, display: 'flex',
            alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2,
          }}>1</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Open Depop and log in</div>
            <a
              href="https://www.depop.com/login/"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary btn-sm"
              style={{ display: 'inline-block', textDecoration: 'none' }}
            >
              Open depop.com →
            </a>
          </div>
        </div>

        {/* Step 2 */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'flex-start' }}>
          <div style={{
            width: 24, height: 24, borderRadius: '50%', background: 'var(--neon-cyan)',
            color: '#000', fontWeight: 700, fontSize: 12, display: 'flex',
            alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2,
          }}>2</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Copy this script</div>
            <div style={{
              background: 'var(--bg-tertiary)', borderRadius: 6, padding: '8px 12px',
              fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)',
              wordBreak: 'break-all', marginBottom: 8, maxHeight: 52, overflow: 'hidden',
              position: 'relative',
            }}>
              {DEPOP_SNIPPET.slice(0, 80)}…
            </div>
            <button className="btn btn-primary btn-sm" onClick={handleCopy}>
              {copied ? '✓ Copied!' : 'Copy Script'}
            </button>
          </div>
        </div>

        {/* Step 3 */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, alignItems: 'flex-start' }}>
          <div style={{
            width: 24, height: 24, borderRadius: '50%', background: 'var(--neon-cyan)',
            color: '#000', fontWeight: 700, fontSize: 12, display: 'flex',
            alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2,
          }}>3</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Run it on depop.com</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 }}>
              On the Depop tab, press <kbd style={{ background: 'var(--bg-tertiary)', padding: '1px 5px', borderRadius: 3, fontSize: 12 }}>F12</kbd> → <strong>Console</strong> tab → paste → <kbd style={{ background: 'var(--bg-tertiary)', padding: '1px 5px', borderRadius: 3, fontSize: 12 }}>Enter</kbd>.
              You'll be redirected back here automatically.
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>
              Chrome tip: if prompted, type <code style={{ background: 'var(--bg-tertiary)', padding: '1px 4px', borderRadius: 3 }}>allow pasting</code> first.
            </div>
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 20, marginBottom: 4 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
            Script didn't work? Paste your token manually instead (F12 → Network → any api request → Authorization header):
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="form-input"
              placeholder="Bearer eyJ..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              style={{ flex: 1, fontSize: 12 }}
            />
            <button className="btn btn-secondary" onClick={handleManualSave} disabled={!token.trim()}>
              Save
            </button>
          </div>
          {error && <p style={{ color: 'var(--neon-red)', fontSize: 12, marginTop: 6 }}>{error}</p>}
        </div>

        <button className="btn btn-secondary btn-sm" onClick={onClose} style={{ marginTop: 12 }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Platform connection card ──────────────────────────────────────────────────
function PlatformConnectionCard({ platformId, onDepopConnect }: {
  platformId: 'ebay' | 'depop' | 'etsy';
  onDepopConnect?: () => void;
}) {
  const { adapter, isConnected, connect, disconnect } = usePlatform(platformId);

  const handleConnect = () => {
    if (platformId === 'depop') {
      onDepopConnect?.();
    } else {
      connect();
    }
  };

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
        <button className="btn btn-sm btn-primary" onClick={handleConnect}>Connect</button>
      )}
    </div>
  );
}

// ── Settings page ─────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { user, isAuthenticated } = useAuthStore();
  const { tier, isPaid } = useSubscription();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [saving, setSaving] = useState(false);
  const [showDepopModal, setShowDepopModal] = useState(false);

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
      {showDepopModal && <DepopLoginModal onClose={() => setShowDepopModal(false)} />}

      <div className="page-header">
        <h1>Settings</h1>
      </div>

      {/* Desktop app download banner — web only */}
      {!isTauri() && (
        <div className="card" style={{
          marginBottom: 24,
          background: 'linear-gradient(135deg, rgba(0,212,255,0.06), rgba(0,212,255,0.02))',
          border: '1px solid rgba(0,212,255,0.2)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '4px 0' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Get the Desktop App</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                Faster sync, full platform support, and no browser restrictions. Windows installer.
              </div>
            </div>
            <a
              href={config.desktopDownloadUrl}
              className="btn btn-primary"
              style={{ whiteSpace: 'nowrap', textDecoration: 'none' }}
            >
              Download (.exe)
            </a>
          </div>
        </div>
      )}

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
          <PlatformConnectionCard platformId="etsy" />
          <PlatformConnectionCard platformId="depop" onDepopConnect={() => setShowDepopModal(true)} />
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
