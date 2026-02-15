import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const lifetimePriceId = process.env.VITE_STRIPE_LIFETIME_PRICE_ID || '';
const proPriceId = process.env.VITE_STRIPE_PRO_PRICE_ID || '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const signature = req.headers['stripe-signature'] as string;
  if (!signature) {
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }

  let event: Stripe.Event;

  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', (err as Error).message);
    return res.status(400).json({ error: `Webhook Error: ${(err as Error).message}` });
  }

  console.log('Received Stripe event:', event.type);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;

      // Support both Payment Links (client_reference_id) and Checkout Sessions (metadata)
      const userId = session.client_reference_id || session.metadata?.supabase_user_id;

      if (!userId) {
        console.error('No user ID found in checkout session');
        break;
      }

      // Determine tier from metadata or line items
      let tier = session.metadata?.tier as string | undefined;

      if (!tier) {
        try {
          const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
          const priceId = lineItems.data[0]?.price?.id;
          if (priceId === lifetimePriceId) {
            tier = 'lifetime';
          } else if (priceId === proPriceId) {
            tier = 'pro';
          }
        } catch {
          console.error('Failed to retrieve line items for session:', session.id);
        }
      }

      if (!tier || !['pro', 'lifetime'].includes(tier)) {
        console.error('Unknown tier or price, not upgrading user:', userId);
        break;
      }

      console.log(`Upgrading user ${userId} to ${tier}`);

      const updates: Record<string, unknown> = {
        tier,
        status: 'active',
        stripe_customer_id: (session.customer as string) || null,
        updated_at: new Date().toISOString(),
      };

      if (tier === 'pro' && session.subscription) {
        updates.stripe_subscription_id = session.subscription as string;
        try {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string);
          updates.current_period_start = new Date(sub.current_period_start * 1000).toISOString();
          updates.current_period_end = new Date(sub.current_period_end * 1000).toISOString();
        } catch {
          updates.current_period_start = new Date().toISOString();
          updates.current_period_end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        }
      }

      if (tier === 'lifetime') {
        updates.current_period_end = new Date('2099-12-31').toISOString();
      }

      const { error } = await supabase
        .from('subscriptions')
        .update(updates)
        .eq('user_id', userId);

      if (error) {
        console.error('Supabase update error:', error);
        return res.status(500).json({ error: 'Database error' });
      }

      console.log(`User ${userId} upgraded to ${tier} successfully`);
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      const { data: sub } = await supabase
        .from('subscriptions')
        .select('user_id')
        .eq('stripe_customer_id', customerId)
        .single();

      if (sub) {
        await supabase
          .from('subscriptions')
          .update({
            status: subscription.status === 'active' ? 'active' : 'past_due',
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', sub.user_id);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      const { data: sub } = await supabase
        .from('subscriptions')
        .select('user_id')
        .eq('stripe_customer_id', customerId)
        .single();

      if (sub) {
        await supabase
          .from('subscriptions')
          .update({
            tier: 'free',
            status: 'cancelled',
            stripe_subscription_id: null,
            current_period_start: null,
            current_period_end: null,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', sub.user_id);
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;

      const { data: sub } = await supabase
        .from('subscriptions')
        .select('user_id')
        .eq('stripe_customer_id', customerId)
        .single();

      if (sub) {
        await supabase
          .from('subscriptions')
          .update({
            status: 'past_due',
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', sub.user_id);
      }
      break;
    }
  }

  return res.status(200).json({ received: true });
}

// Vercel doesn't parse the body for us when we need the raw string for signature verification
function getRawBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
