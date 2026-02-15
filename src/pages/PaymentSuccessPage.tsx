import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { authApi } from '../api/auth';

export default function PaymentSuccessPage() {
  const navigate = useNavigate();
  const { isAuthenticated, setSubscription } = useAuthStore();
  const [status, setStatus] = useState<'verifying' | 'success' | 'pending'>('verifying');
  const [tier, setTier] = useState<string>('');

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/auth');
      return;
    }

    let attempts = 0;
    const maxAttempts = 10;

    const checkSubscription = async () => {
      try {
        const sub = await authApi.getSubscription();
        if (sub && sub.tier !== 'free') {
          setSubscription(sub);
          setTier(sub.tier);
          setStatus('success');
          return true;
        }
      } catch {
        // ignore
      }
      return false;
    };

    // Poll for subscription update (webhook may take a few seconds)
    const poll = async () => {
      const found = await checkSubscription();
      if (!found && attempts < maxAttempts) {
        attempts++;
        setTimeout(poll, 2000);
      } else if (!found) {
        setStatus('pending');
      }
    };

    poll();
  }, [isAuthenticated, navigate, setSubscription]);

  const handleRefresh = async () => {
    setStatus('verifying');
    try {
      const sub = await authApi.getSubscription();
      if (sub && sub.tier !== 'free') {
        setSubscription(sub);
        setTier(sub.tier);
        setStatus('success');
      } else {
        setStatus('pending');
      }
    } catch {
      setStatus('pending');
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Payment Status</h1>
      </div>

      <div className="card" style={{ maxWidth: 500, margin: '40px auto', textAlign: 'center', padding: 40 }}>
        {status === 'verifying' && (
          <>
            <div className="spinner" style={{ margin: '0 auto 20px', width: 40, height: 40 }} />
            <h2 style={{ marginBottom: 8 }}>Verifying your payment...</h2>
            <p style={{ color: 'var(--text-secondary)' }}>
              This may take a few seconds while we confirm with Stripe.
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--neon-green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <h2 style={{ color: 'var(--neon-green)', marginBottom: 8 }}>
              Payment Successful!
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
              You've been upgraded to <strong style={{ color: 'var(--neon-cyan)' }}>
                {tier === 'lifetime' ? 'Lifetime' : 'Pro'}
              </strong>. All premium features are now unlocked.
            </p>
            <button className="btn btn-primary" onClick={() => navigate('/')}>
              Go to Dashboard
            </button>
          </>
        )}

        {status === 'pending' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--neon-orange)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <h2 style={{ color: 'var(--neon-orange)', marginBottom: 8 }}>
              Payment Processing
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
              Your payment was received but your account hasn't been updated yet.
              This usually takes a few seconds. Click below to check again.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button className="btn btn-primary" onClick={handleRefresh}>
                Check Again
              </button>
              <button className="btn btn-secondary" onClick={() => navigate('/')}>
                Go to Dashboard
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
