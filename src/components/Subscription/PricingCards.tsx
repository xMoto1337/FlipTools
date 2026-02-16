import { useSubscription } from '../../hooks/useSubscription';
import { useAuthStore } from '../../stores/authStore';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { config } from '../../config';

export function PricingCards() {
  const { tier, isPaid } = useSubscription();
  const { user } = useAuthStore();
  const { requireAuth } = useRequireAuth();

  const paymentLinks: Record<string, string> = {
    pro: config.stripe.proPaymentLink,
    lifetime: config.stripe.lifetimePaymentLink,
  };

  const handleSubscribe = (selectedTier: 'pro' | 'lifetime') => {
    const link = paymentLinks[selectedTier];
    if (link) {
      const url = new URL(link);
      // Pass user ID so webhook can identify the user
      if (user?.id) {
        url.searchParams.set('client_reference_id', user.id);
      }
      // Pre-fill email for convenience
      if (user?.email) {
        url.searchParams.set('prefilled_email', user.email);
      }
      window.open(url.toString(), '_blank');
    }
  };

  const tiers = [
    {
      id: 'free' as const,
      name: 'Free',
      price: '$0',
      period: '/forever',
      description: 'Get started with basic features',
      features: [
        { text: '10 cross-listings/month', included: true },
        { text: '10 keyword searches/month', included: true },
        { text: 'Basic price stats', included: true },
        { text: '1 platform connection', included: true },
        { text: '30-day analytics history', included: true },
        { text: 'Market analysis & demand scoring', included: false },
        { text: 'Saved searches & watchlist', included: false },
        { text: 'Ad-free experience', included: false },
      ],
    },
    {
      id: 'pro' as const,
      name: 'Pro',
      price: '$9.99',
      period: '/month',
      description: 'Everything you need to scale',
      featured: true,
      features: [
        { text: 'Unlimited cross-listings', included: true },
        { text: 'Unlimited product research', included: true },
        { text: 'Market analysis & demand scoring', included: true },
        { text: 'Saved searches & watchlist', included: true },
        { text: 'Price trend charts', included: true },
        { text: 'All platform connections', included: true },
        { text: 'Full analytics history', included: true },
        { text: 'Ad-free experience', included: true },
      ],
    },
    {
      id: 'lifetime' as const,
      name: 'Lifetime',
      price: '$99',
      period: ' one-time',
      description: 'Pay once, use forever',
      features: [
        { text: 'Everything in Pro', included: true },
        { text: 'Lifetime updates', included: true },
        { text: 'Priority support', included: true },
        { text: 'Early access to new features', included: true },
        { text: 'All future platforms', included: true },
        { text: 'Never pay again', included: true },
        { text: 'Best value', included: true },
      ],
    },
  ];

  return (
    <div className="pricing-grid">
      {tiers.map((t) => (
        <div key={t.id} className={`pricing-card ${t.featured ? 'featured' : ''}`}>
          <div className="pricing-tier">{t.name}</div>
          <div className="pricing-price">
            {t.price}
            <span>{t.period}</span>
          </div>
          <div className="pricing-desc">{t.description}</div>

          <ul className="pricing-features">
            {t.features.map((f, i) => (
              <li key={i}>
                {f.included ? (
                  <svg className="check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                ) : (
                  <svg className="x" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                )}
                {f.text}
              </li>
            ))}
          </ul>

          {t.id === 'free' ? (
            <button className="btn btn-secondary" disabled={tier === 'free'}>
              {tier === 'free' ? 'Current Plan' : 'Downgrade'}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              disabled={isPaid && tier === t.id}
              onClick={requireAuth(() => handleSubscribe(t.id as 'pro' | 'lifetime'), 'Sign in to subscribe')}
            >
              {isPaid && tier === t.id ? 'Current Plan' : `Get ${t.name}`}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
