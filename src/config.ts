export const config = {
  supabase: {
    url: import.meta.env.VITE_SUPABASE_URL || '',
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
  },
  stripe: {
    publishableKey: import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '',
    proPriceId: import.meta.env.VITE_STRIPE_PRO_PRICE_ID || '',
    lifetimePriceId: import.meta.env.VITE_STRIPE_LIFETIME_PRICE_ID || '',
    proPaymentLink: import.meta.env.VITE_STRIPE_PRO_PAYMENT_LINK || '',
    lifetimePaymentLink: import.meta.env.VITE_STRIPE_LIFETIME_PAYMENT_LINK || '',
  },
  adsense: {
    clientId: import.meta.env.VITE_ADSENSE_CLIENT_ID || '',
    slotId: import.meta.env.VITE_ADSENSE_SLOT_ID || '',
  },
  ebay: {
    clientId: import.meta.env.VITE_EBAY_CLIENT_ID || '',
    redirectUri: import.meta.env.VITE_EBAY_REDIRECT_URI || '',
  },
  googleVision: {
    apiKey: import.meta.env.VITE_GOOGLE_VISION_API_KEY || '',
  },
  version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.1.0',
};
