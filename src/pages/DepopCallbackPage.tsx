import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlatformStore } from '../stores/platformStore';

export default function DepopCallbackPage() {
  const navigate = useNavigate();
  const setConnection = usePlatformStore((s) => s.setConnection);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('token');

    if (!raw) {
      setStatus('error');
      setErrorMsg('No token found in URL. Make sure you used the bookmarklet on depop.com.');
      return;
    }

    const token = decodeURIComponent(raw).replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      setStatus('error');
      setErrorMsg('Token was empty after decoding.');
      return;
    }

    setConnection('depop', {
      platform: 'depop',
      accessToken: token,
      refreshToken: '',
      tokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      platformUsername: 'Depop Account',
      connectedAt: new Date().toISOString(),
    });

    setStatus('success');

    const timer = setTimeout(() => navigate('/settings'), 2000);
    return () => clearTimeout(timer);
  }, [navigate, setConnection]);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: 'var(--bg-primary)', padding: 24,
    }}>
      <div className="card" style={{ maxWidth: 400, width: '100%', padding: 40, textAlign: 'center' }}>
        {status === 'loading' && (
          <>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />
            <p style={{ color: 'var(--text-secondary)' }}>Connecting Depop…</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✓</div>
            <h3 style={{ marginBottom: 8 }}>Depop Connected!</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              Redirecting to settings…
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 12, color: 'var(--neon-red)' }}>✕</div>
            <h3 style={{ marginBottom: 8 }}>Connection Failed</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>{errorMsg}</p>
            <button className="btn btn-primary" onClick={() => navigate('/settings')}>
              Back to Settings
            </button>
          </>
        )}
      </div>
    </div>
  );
}
