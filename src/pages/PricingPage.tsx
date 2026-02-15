import { PricingCards } from '../components/Subscription/PricingCards';

export default function PricingPage() {
  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, marginBottom: 12 }}>Choose Your Plan</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 16, maxWidth: 500, margin: '0 auto' }}>
          Upgrade to unlock unlimited cross-listing, image search, bulk actions, and more
        </p>
      </div>
      <PricingCards />
    </div>
  );
}
