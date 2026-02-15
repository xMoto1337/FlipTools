import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

export function SignInModal() {
  const { showSignInPrompt, signInPromptMessage, dismissSignInPrompt } = useAuthStore();
  const navigate = useNavigate();

  if (!showSignInPrompt) return null;

  const handleSignIn = () => {
    dismissSignInPrompt();
    navigate('/auth');
  };

  return (
    <div className="modal-overlay" onClick={dismissSignInPrompt}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <div className="modal-title">Sign In Required</div>
          <button className="modal-close" onClick={dismissSignInPrompt}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="modal-body" style={{ textAlign: 'center', padding: '32px 24px' }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--neon-cyan)" strokeWidth="1.5" style={{ marginBottom: 16 }}>
            <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/>
            <polyline points="10 17 15 12 10 7"/>
            <line x1="15" y1="12" x2="3" y2="12"/>
          </svg>
          <p style={{ color: 'var(--text-secondary)', fontSize: 15, margin: '0 0 8px' }}>
            {signInPromptMessage}
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Create a free account to get started
          </p>
        </div>
        <div className="modal-footer" style={{ justifyContent: 'center' }}>
          <button className="btn btn-secondary" onClick={dismissSignInPrompt}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSignIn}>Sign In / Register</button>
        </div>
      </div>
    </div>
  );
}
