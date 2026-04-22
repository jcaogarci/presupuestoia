# PresupuestoIA 📋

> Generador de presupuestos profesionales con IA para autónomos y oficios. En 2 minutos, no en 30.

![License](https://img.shields.io/badge/license-MIT-green)
![Stack](https://img.shields.io/badge/stack-HTML%20%2B%20Vercel%20%2B%20Supabase%20%2B%20Stripe-orange)

---

## ¿Qué es?

Aplicación SaaS completa para que fontaneros, electricistas, pintores, reformistas y cualquier autónomo de oficio generen presupuestos profesionales en 2 minutos usando inteligencia artificial.

**Flujo del usuario:**
1. Describe el trabajo por **voz**, texto libre o campos estructurados
2. La IA (Claude) genera el presupuesto con ítems, precios, IVA y condiciones
3. **Descarga el PDF** o envíalo directamente al cliente por email
4. Todo queda guardado en el **historial** con seguimiento de estado

---

## Stack técnico

| Capa | Tecnología | Coste |
|------|-----------|-------|
| Frontend | HTML/CSS/JS vanilla | Gratis |
| Hosting | Vercel | Gratis (hasta 100GB/mes) |
| Base de datos + Auth | Supabase | Gratis (hasta 500MB) |
| IA | Claude API (Anthropic) | ~€0.01 por presupuesto |
| Pagos | Stripe | 1.4% + 0.25€ por transacción |
| PDF | jsPDF (CDN) | Gratis |

**Coste fijo mensual para el operador: €0**

---

## Modelo de negocio

| Plan | Precio | Presupuestos | Funciones |
|------|--------|-------------|-----------|
| **Gratis** | €0/mes | 3/mes | Básico |
| **Pro** | €29/mes | Ilimitados | Todo incluido |
| **Empresa** | €79/mes | Ilimitados | + hasta 5 usuarios |

---

## Estructura del proyecto

```
presupuestoia/
├── public/
│   ├── index.html          # App completa (SPA)
│   └── js/
│       └── app.js          # Lógica frontend + Stripe + Supabase
├── api/
│   ├── generate.js         # Proxy Claude API (Edge Function)
│   ├── stripe-checkout.js  # Crea sesión de pago Stripe
│   ├── stripe-webhook.js   # Recibe eventos Stripe → actualiza plan
│   └── stripe-portal.js    # Portal de gestión de suscripción
├── schema.sql              # Esquema Supabase con RLS y triggers
├── vercel.json             # Configuración de rutas Vercel
├── package.json
├── .env.example            # Variables de entorno necesarias
└── .gitignore
```

---

## Instalación y despliegue

### 1. Clonar el repositorio

```bash
git clone https://github.com/tu-usuario/presupuestoia.git
cd presupuestoia
npm install
```

### 2. Configurar Supabase

1. Crear proyecto en [supabase.com](https://supabase.com)
2. Ir a **SQL Editor** y ejecutar `schema.sql`
3. Anotar: `Project URL` y `anon key` (Settings > API)
4. También copiar la `service_role key` (para el webhook)

### 3. Configurar Stripe

1. Crear cuenta en [stripe.com](https://stripe.com)
2. En **Products**, crear dos productos:
   - **PresupuestoIA Pro** — €29/mes (recurrente) → anotar el `Price ID`
   - **PresupuestoIA Empresa** — €79/mes (recurrente) → anotar el `Price ID`
3. En **Developers > Webhooks**, añadir endpoint:
   - URL: `https://tu-dominio.vercel.app/api/stripe-webhook`
   - Eventos: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
4. Anotar el `Webhook signing secret`

### 4. Variables de entorno

Copia `.env.example` como `.env` y rellena:

```env
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyxxx
SUPABASE_ANON_KEY=eyxxx
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_PRO=price_xxx
STRIPE_PRICE_EMPRESA=price_xxx
NEXT_PUBLIC_APP_URL=https://tu-dominio.vercel.app
```

### 5. Configurar credenciales en el frontend

Edita `public/js/app.js` líneas 7-8:

```javascript
const SUPABASE_URL = 'https://TU_PROYECTO.supabase.co';
const SUPABASE_KEY = 'TU_ANON_KEY';
```

> **Nota:** La `anon key` de Supabase es segura para exponer en el frontend — está protegida por RLS. La `service_role key` solo va en las variables de entorno del servidor.

### 6. Desplegar en Vercel

```bash
# Instala Vercel CLI si no lo tienes
npm i -g vercel

# Despliega
vercel

# En el dashboard de Vercel, añade las variables de entorno
# Settings > Environment Variables
```

O conecta el repositorio de GitHub directamente desde [vercel.com](https://vercel.com) para deploy automático en cada push.

---

## Desarrollo local

```bash
npm install
vercel dev   # Levanta el servidor con las API functions en local
# Abre http://localhost:3000
```

Para el webhook de Stripe en local, usa [Stripe CLI](https://stripe.com/docs/stripe-cli):

```bash
stripe listen --forward-to localhost:3000/api/stripe-webhook
```

---

## Personalización

### Cambiar nombre de la app
Busca `PresupuestoIA` en `index.html` y `app.js` y reemplaza.

### Añadir nuevos oficios
En `index.html`, busca el `<select id="reg-trade">` y añade `<option>` nuevas.

### Cambiar precios
Actualiza los precios en Stripe Dashboard y refleja los cambios visuales en `index.html` (sección `#page-plans`).

### Envío de email real
En `public/js/app.js`, la función `sendEmail()` actualmente simula el envío. Para email real, crea `api/send-email.js` usando [Resend](https://resend.com) o [SendGrid](https://sendgrid.com):

```javascript
// api/send-email.js
import { Resend } from 'resend';
const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  const { to, subject, html, pdfBase64 } = req.body;
  await resend.emails.send({
    from: 'presupuestos@tudominio.com',
    to, subject, html,
    attachments: [{ filename: 'presupuesto.pdf', content: pdfBase64 }]
  });
  res.json({ ok: true });
}
```

---

## Licencia

MIT — úsalo, modifícalo, véndelo.
