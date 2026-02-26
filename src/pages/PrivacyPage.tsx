export default function PrivacyPage() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px' }}>
      <h1 style={{ marginBottom: 8 }}>Privacy Policy</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: 32 }}>Last updated: February 2026</p>

      <div className="card" style={{ padding: 32, marginBottom: 24 }}>
        <h2 style={{ marginBottom: 12 }}>What We Collect</h2>
        <p>FlipTools collects the following information when you use our service:</p>
        <ul style={{ paddingLeft: 20, lineHeight: 2 }}>
          <li>Email address and display name (for account creation)</li>
          <li>OAuth tokens for connected platforms (eBay, Etsy) — stored encrypted</li>
          <li>Listing and inventory data you enter into the app</li>
          <li>Usage data such as search history (stored locally in your browser)</li>
        </ul>
      </div>

      <div className="card" style={{ padding: 32, marginBottom: 24 }}>
        <h2 style={{ marginBottom: 12 }}>How We Use Your Data</h2>
        <ul style={{ paddingLeft: 20, lineHeight: 2 }}>
          <li>To provide the FlipTools service (cross-listing, analytics, research)</li>
          <li>To sync your listings and sales across connected platforms</li>
          <li>To process payments via Stripe (we never store card details)</li>
          <li>We do not sell your data to third parties</li>
        </ul>
      </div>

      <div className="card" style={{ padding: 32, marginBottom: 24 }}>
        <h2 style={{ marginBottom: 12 }}>Platform Connections</h2>
        <p>
          When you connect an eBay or Etsy account, FlipTools stores OAuth access tokens
          to call those platforms on your behalf. These tokens are stored securely in our
          database (Supabase) and in your browser's local storage. You can disconnect any
          platform at any time in Settings, which will delete the stored tokens.
        </p>
      </div>

      <div className="card" style={{ padding: 32, marginBottom: 24 }}>
        <h2 style={{ marginBottom: 12 }}>Data Retention & Deletion</h2>
        <p>
          You may delete your account at any time by contacting us. All associated data
          will be removed within 30 days. Platform tokens are deleted immediately when
          you disconnect a platform.
        </p>
      </div>

      <div className="card" style={{ padding: 32 }}>
        <h2 style={{ marginBottom: 12 }}>Contact</h2>
        <p>
          For privacy-related questions, contact us at{' '}
          <a href="mailto:privacy@fliptools.net" style={{ color: 'var(--neon-cyan)' }}>
            privacy@fliptools.net
          </a>
          .
        </p>
      </div>
    </div>
  );
}
