// api/stripe-portal.js
// Redirige al usuario al portal de Stripe para gestionar su suscripción
// (cancelar, cambiar método de pago, ver facturas)

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'nodejs' };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { userId, returnUrl } = req.body;

    if (!userId) return res.status(400).json({ error: 'userId requerido' });

    // Buscar el stripe_customer_id del usuario
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    if (error || !profile?.stripe_customer_id) {
      return res.status(404).json({ error: 'No se encontró la suscripción del usuario' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: returnUrl || process.env.NEXT_PUBLIC_APP_URL,
    });

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('Portal error:', err);
    return res.status(500).json({ error: err.message });
  }
}
