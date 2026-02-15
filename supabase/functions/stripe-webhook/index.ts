import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
});

const endpointSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const lifetimePriceId = Deno.env.get('STRIPE_LIFETIME_PRICE_ID') || '';
const proPriceId = Deno.env.get('STRIPE_PRO_PRICE_ID') || '';

serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return new Response('Missing signature', { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

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

      // Determine tier from metadata or from the line items/price
      let tier = session.metadata?.tier as string | undefined;

      if (!tier) {
        // For Payment Links, determine tier from the price ID
        try {
          const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
          const priceId = lineItems.data[0]?.price?.id;
          if (priceId === lifetimePriceId) {
            tier = 'lifetime';
          } else if (priceId === proPriceId) {
            tier = 'pro';
          }
          // If price doesn't match either, tier stays undefined → no upgrade
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
        return new Response('Database error', { status: 500 });
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

        console.log(`Subscription cancelled for user ${sub.user_id}`);
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

        console.log(`Payment failed for user ${sub.user_id}`);
      }
      break;
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
