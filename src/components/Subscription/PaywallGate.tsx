import { useNavigate } from 'react-router-dom';
import { useSubscription } from '../../hooks/useSubscription';

interface PaywallGateProps {
  feature: string;
  children: React.ReactNode;
}

export function PaywallGate({ feature, children }: PaywallGateProps) {
  const { isPaid } = useSubscription();
  const navigate = useNavigate();

  if (isPaid) return <>{children}</>;

  return (
    <div className="paywall-overlay">
      <div className="paywall-content">{children}</div>
      <div className="paywall-prompt">
        <div className="paywall-box">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--neon-purple)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 12 }}>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
          <h3>Upgrade to Pro</h3>
          <p>"{feature}" requires a Pro or Lifetime subscription</p>
          <button className="btn btn-primary" onClick={() => navigate('/pricing')}>
            View Plans
          </button>
        </div>
      </div>
    </div>
  );
}
