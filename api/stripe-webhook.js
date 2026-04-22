// api/stripe-webhook.js
// Recibe eventos de Stripe y actualiza el plan del usuario en Supabase
// IMPORTANTE: Esta ruta debe recibir el body RAW (sin parsear) para verificar la firma

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const config = {
  runtime: 'nodejs',
  api: { bodyParser: false },   // Raw body necesario para verificar firma Stripe
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY   // Service role: puede escribir sin RLS
);

// Helper: leer body raw como buffer
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  console.log(`Stripe event: ${event.type}`);

  // ── Mapa de planes según precio ──────────────────────────
  const planByPrice = {
    [process.env.STRIPE_PRICE_PRO]:     'pro',
    [process.env.STRIPE_PRICE_EMPRESA]: 'empresa',
  };

  try {
    switch (event.type) {

      // ✅ Suscripción nueva o reactivada
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const userId = sub.metadata?.userId;
        const priceId = sub.items?.data[0]?.price?.id;
        const plan = planByPrice[priceId] || 'free';
        const status = sub.status; // active, past_due, canceled...

        if (!userId) break;

        const newPlan = (status === 'active' || status === 'trialing') ? plan : 'free';

        await supabase
          .from('profiles')
          .update({
            plan: newPlan,
            stripe_customer_id:     sub.customer,
            stripe_subscription_id: sub.id,
            quota_used: newPlan !== 'free' ? 0 : undefined,  // Resetea quota al activar
          })
          .eq('id', userId);

        console.log(`Usuario ${userId} → plan ${newPlan} (${status})`);
        break;
      }

      // ❌ Suscripción cancelada o expirada
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const userId = sub.metadata?.userId;
        if (!userId) break;

        await supabase
          .from('profiles')
          .update({ plan: 'free', stripe_subscription_id: null })
          .eq('id', userId);

        console.log(`Usuario ${userId} → plan free (cancelado)`);
        break;
      }

      // 💳 Pago fallido → notificación (no bajamos plan hasta que Stripe lo cancele)
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        console.warn(`Pago fallido para customer ${customerId}`);
        // Aquí podrías enviar un email de aviso al usuario
        break;
      }

      // ✅ Checkout completado (alternativa a subscription events)
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.client_reference_id || session.metadata?.userId;
        const plan   = session.metadata?.plan;

        if (userId && plan) {
          await supabase
            .from('profiles')
            .update({
              plan,
              stripe_customer_id: session.customer,
              quota_used: 0,
            })
            .eq('id', userId);

          console.log(`Checkout completado: usuario ${userId} → plan ${plan}`);
        }
        break;
      }

      default:
        console.log(`Evento no manejado: ${event.type}`);
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).json({ error: 'Handler failed' });
  }
}
