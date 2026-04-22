// api/stripe-checkout.js
// Crea una sesión de pago de Stripe y devuelve la URL de checkout

import Stripe from 'stripe';

export const config = { runtime: 'nodejs' };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PRICE_IDS = {
  pro:     process.env.STRIPE_PRICE_PRO,
  empresa: process.env.STRIPE_PRICE_EMPRESA,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { plan, userId, userEmail, successUrl, cancelUrl } = req.body;

    if (!plan || !PRICE_IDS[plan]) {
      return res.status(400).json({ error: 'Plan no válido' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price: PRICE_IDS[plan],
        quantity: 1,
      }],
      customer_email: userEmail || undefined,
      client_reference_id: userId,        // Lo usamos en el webhook para identificar al usuario
      success_url: successUrl || `${process.env.NEXT_PUBLIC_APP_URL}/?checkout=success&plan=${plan}`,
      cancel_url:  cancelUrl  || `${process.env.NEXT_PUBLIC_APP_URL}/?checkout=cancel`,
      metadata: {
        userId,
        plan,
      },
      subscription_data: {
        metadata: { userId, plan },
        trial_period_days: 0,
      },
      locale: 'es',
      allow_promotion_codes: true,
    });

    return res.status(200).json({ url: session.url, sessionId: session.id });

  } catch (err) {
    console.error('Stripe checkout error:', err);
    return res.status(500).json({ error: err.message });
  }
}
