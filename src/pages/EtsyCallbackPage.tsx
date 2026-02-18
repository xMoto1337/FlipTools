import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePlatformStore } from '../stores/platformStore';
import { supabase } from '../api/supabase';

export default function EtsyCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const setConnection = usePlatformStore((s) => s.setConnection);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    console.log('[etsy-callback] code:', code ? 'present' : 'missing', 'error:', error);

    if (error) {
      setStatus('error');
      setErrorMsg(error === 'access_denied' ? 'You declined the Etsy connection.' : error);
      return;
    }

    if (!code) {
      setStatus('error');
      setErrorMsg('No authorization code received from Etsy.');
      return;
    }

    (async () => {
      try {
        // Get PKCE verifier from sessionStorage (set during getAuthUrl)
        const codeVerifier = sessionStorage.getItem('etsy_code_verifier');
        if (!codeVerifier) {
          setStatus('error');
          setErrorMsg('Missing PKCE verifier. Please try connecting again.');
          return;
        }

        console.log('[etsy-callback] Exchanging code for tokens...');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const response = await fetch('/api/etsy-auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            grant_type: 'authorization_code',
            code_verifier: codeVerifier,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        console.log('[etsy-callback] Response status:', response.status);
        const data = await response.json();

        if (!response.ok) {
          console.error('[etsy-callback] Token exchange failed:', data);
          setStatus('error');
          setErrorMsg(data.error || 'Failed to connect Etsy account');
          return;
        }

        sessionStorage.removeItem('etsy_code_verifier');

        // Fetch user info to get shop_id
        let shopId = '';
        let shopName = 'Etsy Account';
        try {
          const meResp = await fetch('/api/etsy-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              endpoint: '/v3/application/users/me',
              token: data.access_token,
              method: 'GET',
            }),
          });
          if (meResp.ok) {
            const meData = await meResp.json();
            shopId = String(meData.shop_id || '');
            shopName = meData.shop_name || meData.login_name || 'Etsy Account';
            // Store shop_id for the adapter to use
            localStorage.setItem('fliptools_etsy_shop_id', shopId);
            console.log('[etsy-callback] Shop ID:', shopId, 'Name:', shopName);
          }
        } catch (err) {
          console.warn('[etsy-callback] Failed to fetch user info:', err);
        }

        console.log('[etsy-callback] Token exchange success, saving connection...');

        setConnection('etsy', {
          platform: 'etsy',
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          tokenExpiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
          platformUsername: shopName,
          connectedAt: new Date().toISOString(),
          platformUserId: shopId,
        });
        setStatus('success');

        // Also save shop_id to Supabase platform_connections
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user && shopId) {
            await supabase.from('platform_connections').upsert({
              user_id: user.id,
              platform: 'etsy',
              access_token: data.access_token,
              refresh_token: data.refresh_token,
              token_expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
              platform_user_id: shopId,
              platform_username: shopName,
              connected_at: new Date().toISOString(),
            }, { onConflict: 'user_id,platform' });
          }
        } catch {}

        if (window.opener) {
          setTimeout(() => window.close(), 1500);
        } else {
          setTimeout(() => navigate('/settings'), 2000);
        }
      } catch (err) {
        console.error('[etsy-callback] Error:', err);
        const msg = err instanceof DOMException && err.name === 'AbortError'
          ? 'Request timed out — please try again'
          : (err as Error).message || 'Failed to connect Etsy account';
        setStatus('error');
        setErrorMsg(msg);
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
            <h3>Connecting Etsy Account...</h3>
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
            <h3 style={{ color: 'var(--neon-green)' }}>Etsy Connected!</h3>
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
