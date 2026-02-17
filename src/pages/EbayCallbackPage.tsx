import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePlatformStore } from '../stores/platformStore';
import { analyticsApi } from '../api/analytics';

export default function EbayCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const setConnection = usePlatformStore((s) => s.setConnection);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (error) {
      setStatus('error');
      setErrorMsg(error === 'access_denied' ? 'You declined the eBay connection.' : error);
      return;
    }

    if (!code) {
      setStatus('error');
      setErrorMsg('No authorization code received from eBay.');
      return;
    }

    (async () => {
      try {
        const response = await fetch('/api/ebay-auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, grant_type: 'authorization_code' }),
        });

        const data = await response.json();

        if (!response.ok) {
          setStatus('error');
          setErrorMsg(data.error || 'Failed to connect eBay account');
          return;
        }

        // Purge old sales so they get re-synced with correct values (non-blocking)
        try { await analyticsApi.purgePlatformSales('ebay'); } catch {}

        setConnection('ebay', {
          platform: 'ebay',
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          tokenExpiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
          platformUsername: 'eBay Account',
          connectedAt: new Date().toISOString(),
        });
        setStatus('success');
        if (window.opener) {
          setTimeout(() => window.close(), 1500);
        } else {
          setTimeout(() => navigate('/settings'), 2000);
        }
      } catch (err) {
        setStatus('error');
        setErrorMsg((err as Error).message || 'Failed to connect eBay account');
      }
    })();
  }, [searchParams, navigate, setConnection]);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <div className="card" style={{ maxWidth: 480, textAlign: 'center', padding: 40 }}>
        {status === 'loading' && (
          <>
            <div className="loading-spinner" style={{ marginBottom: 16 }}>
              <div className="spinner" />
            </div>
            <h3>Connecting eBay Account...</h3>
            <p style={{ color: 'var(--text-muted)' }}>Exchanging authorization code for access tokens</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--neon-green)" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <h3 style={{ color: 'var(--neon-green)' }}>eBay Connected!</h3>
            <p style={{ color: 'var(--text-muted)' }}>Redirecting to settings...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--neon-red)" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <h3 style={{ color: 'var(--neon-red)' }}>Connection Failed</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>{errorMsg}</p>
            <button className="btn btn-primary" onClick={() => navigate('/settings')}>
              Back to Settings
            </button>
          </>
        )}
      </div>
    </div>
  );
}
