// ============================================================
// PresupuestoIA — Application Logic v2 (con Stripe)
// ============================================================

// ── CONFIG ──────────────────────────────────────────────────
// Estas variables se reemplazan con las tuyas reales
const SUPABASE_URL  = window.ENV_SUPABASE_URL  || 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_KEY  = window.ENV_SUPABASE_KEY  || 'YOUR_ANON_KEY';

// Apunta al proxy seguro en Vercel (nunca directamente a Anthropic desde el browser)
const AI_API_URL    = '/api/generate';
const CHECKOUT_URL  = '/api/stripe-checkout';
const PORTAL_URL    = '/api/stripe-portal';

// Límites por plan
const PLAN_LIMITS = { free: 3, pro: Infinity, empresa: Infinity };

// ── STATE ────────────────────────────────────────────────────
let supabaseClient = null;
let currentUser    = null;
let currentProfile = null;
let budgets        = [];
let currentBudget  = null;
let recognition    = null;
let isRecording    = false;
let isDemo         = false;

// ── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  try {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    checkSession();
  } catch(e) {
    console.warn('Supabase not configured — demo mode');
  }
  setupSpeechRecognition();
  loadProfileFromStorage();
  handleCheckoutReturn();   // Detecta vuelta de Stripe checkout
});

// Detecta si el usuario vuelve de Stripe con ?checkout=success
function handleCheckoutReturn() {
  const params = new URLSearchParams(window.location.search);
  const result = params.get('checkout');
  if (result === 'success') {
    // Limpia la URL
    window.history.replaceState({}, document.title, window.location.pathname);
    // Mostrar banner de éxito (visible después de que el app cargue)
    setTimeout(() => {
      document.getElementById('checkout-banner').style.display = 'block';
      // Refresca el perfil desde Supabase para obtener el nuevo plan
      if (supabaseClient && currentUser) loadProfile().then(updateSidebar);
    }, 800);
  }
  if (result === 'cancel') {
    window.history.replaceState({}, document.title, window.location.pathname);
    toast('Pago cancelado. Puedes intentarlo cuando quieras.', '');
  }
}

// ── SESSION ───────────────────────────────────────────────────
async function checkSession() {
  if (!supabaseClient) return;
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
      currentUser = session.user;
      await loadProfile();
      showApp();
    }
  } catch(e) { console.warn('Session check:', e); }
}

// ── AUTH ─────────────────────────────────────────────────────
function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t,i) =>
    t.classList.toggle('active', (i===0 && tab==='login') || (i===1 && tab==='register'))
  );
  document.getElementById('auth-login').classList.toggle('active', tab==='login');
  document.getElementById('auth-register').classList.toggle('active', tab==='register');
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;
  if (!email || !pass) return toast('Completa todos los campos', 'error');
  if (!supabaseClient) return doDemo();
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: pass });
    if (error) throw error;
    currentUser = data.user;
    await loadProfile();
    showApp();
    toast('¡Bienvenido!', 'success');
  } catch(e) { toast(e.message || 'Error al iniciar sesión', 'error'); }
}

async function doRegister() {
  const name  = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pass  = document.getElementById('reg-pass').value;
  const trade = document.getElementById('reg-trade').value;
  if (!name || !email || !pass || !trade) return toast('Completa todos los campos', 'error');
  if (pass.length < 6) return toast('Contraseña mínimo 6 caracteres', 'error');

  if (!supabaseClient) {
    currentUser = { id: 'demo', email };
    currentProfile = { full_name: name, trade, quota_used: 0, plan: 'free' };
    showApp();
    toast('¡Cuenta creada! (modo demo)', 'success');
    return;
  }
  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email, password: pass,
      options: { data: { full_name: name, trade } }
    });
    if (error) throw error;
    currentUser = data.user;
    currentProfile = { full_name: name, trade, quota_used: 0, plan: 'free' };
    await saveProfileToSupabase();
    showApp();
    toast('¡Cuenta creada! 🎉', 'success');
  } catch(e) { toast(e.message || 'Error al registrarse', 'error'); }
}

function doDemo() {
  isDemo = true;
  currentUser = { id: 'demo-user', email: 'demo@ejemplo.com' };
  currentProfile = { full_name: 'Juan García', trade: 'Fontanero', quota_used: 0, plan: 'free',
    phone: '600 123 456', nif: '12345678A', city: 'Barcelona' };
  showApp();
  toast('Modo demo — 3 presupuestos de prueba', 'success');
}

async function doLogout() {
  if (supabaseClient && !isDemo) await supabaseClient.auth.signOut();
  currentUser = null; currentProfile = null; budgets = []; currentBudget = null; isDemo = false;
  document.getElementById('screen-app').classList.remove('active');
  document.getElementById('screen-landing').classList.add('active');
}

// ── APP INIT ─────────────────────────────────────────────────
function showApp() {
  document.getElementById('screen-landing').classList.remove('active');
  document.getElementById('screen-app').classList.add('active');
  updateSidebar();
  loadBudgetsFromStorage();
  renderHistory();
}

function updateSidebar() {
  const plan = currentProfile?.plan || 'free';
  const name = currentProfile?.full_name || currentUser?.email || 'Usuario';
  const initials = name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);

  document.getElementById('sb-avatar').textContent = initials;
  document.getElementById('sb-username').textContent = name.split(' ')[0];
  document.getElementById('sb-plan').textContent =
    plan === 'free' ? 'Plan Gratis' : plan === 'pro' ? '⚡ Plan Pro' : '🏢 Plan Empresa';
  document.getElementById('profile-avatar').textContent = initials;
  document.getElementById('profile-name-display').textContent = name;
  document.getElementById('profile-trade-display').textContent = currentProfile?.trade || '';

  // Quota badge
  const used  = currentProfile?.quota_used || 0;
  const limit = PLAN_LIMITS[plan];
  if (limit === Infinity) {
    document.getElementById('quota-badge').style.display = 'none';
  } else {
    document.getElementById('quota-badge').style.display = 'flex';
    document.getElementById('quota-text').textContent = `${Math.max(0,limit-used)}/${limit} gratis`;
  }

  // Plan buttons
  updatePlanButtons(plan);

  // Profile fields
  if (currentProfile) {
    const f = currentProfile;
    setVal('p-name',    f.full_name || '');
    setVal('p-trade',   f.trade || '');
    setVal('p-nif',     f.nif || '');
    setVal('p-phone',   f.phone || '');
    setVal('p-email',   f.email || currentUser?.email || '');
    setVal('p-address', f.address || '');
    setVal('p-city',    f.city || '');
    setVal('p-web',     f.web || '');
    setVal('p-note',    f.note || '');
  }
}

function updatePlanButtons(plan) {
  const freeBtn    = document.getElementById('plan-free-btn');
  const proBtn     = document.getElementById('plan-pro-btn');
  const empresaBtn = document.getElementById('plan-empresa-btn');
  const manageBlock = document.getElementById('manage-sub-block');

  if (!freeBtn || !proBtn || !empresaBtn) return;

  // Reset
  [freeBtn, proBtn, empresaBtn].forEach(b => { b.disabled = false; b.textContent = b.dataset.default || b.textContent; });

  if (plan === 'free') {
    freeBtn.disabled = true;
    freeBtn.textContent = '✓ Plan actual';
    proBtn.textContent = 'Activar Pro →';
    empresaBtn.textContent = 'Activar Empresa →';
    if (manageBlock) manageBlock.style.display = 'none';
  } else if (plan === 'pro') {
    proBtn.disabled = true;
    proBtn.textContent = '✓ Plan actual';
    freeBtn.textContent = 'Bajar a Gratis';
    empresaBtn.textContent = 'Subir a Empresa →';
    if (manageBlock) manageBlock.style.display = 'block';
  } else if (plan === 'empresa') {
    empresaBtn.disabled = true;
    empresaBtn.textContent = '✓ Plan actual';
    proBtn.textContent = 'Cambiar a Pro';
    if (manageBlock) manageBlock.style.display = 'block';
  }
}

function setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val; }

// ── PAGES ────────────────────────────────────────────────────
function showPage(page, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sb-item').forEach(b => b.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  if (btn) btn.classList.add('active');
  const titles = { generator:'Nuevo presupuesto', history:'Historial', profile:'Mi perfil', plans:'Planes' };
  document.getElementById('topbar-title').textContent = titles[page] || '';
  if (page === 'history') renderHistory();
  if (page === 'plans') updatePlanButtons(currentProfile?.plan || 'free');
}

// ── INPUT MODES ───────────────────────────────────────────────
function setMode(mode, btn) {
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('voice-area').classList.toggle('visible', mode==='voice');
  document.getElementById('text-area').classList.toggle('visible', mode==='text');
  document.getElementById('struct-area').classList.toggle('visible', mode==='struct');
  if (mode !== 'voice' && isRecording) stopRecording();
}

// ── SPEECH ───────────────────────────────────────────────────
function setupSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { document.getElementById('voice-hint').textContent = 'Voz no disponible — usa texto'; return; }
  recognition = new SR();
  recognition.lang = 'es-ES';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = (e) => {
    let t = '';
    for (let i=0; i<e.results.length; i++) t += e.results[i][0].transcript;
    const el = document.getElementById('voice-transcript');
    el.textContent = t; el.classList.add('visible');
  };
  recognition.onerror = (e) => { toast('Error micrófono: '+e.error, 'error'); stopRecording(); };
  recognition.onend = () => { if (isRecording) stopRecording(); };
}
function toggleRecording() { isRecording ? stopRecording() : startRecording(); }
function startRecording() {
  if (!recognition) return toast('Voz no soportada', 'error');
  recognition.start(); isRecording = true;
  document.getElementById('mic-btn').classList.add('recording');
  document.getElementById('mic-btn').textContent = '⏹';
  document.getElementById('voice-hint').textContent = 'Escuchando...';
}
function stopRecording() {
  if (recognition) recognition.stop();
  isRecording = false;
  document.getElementById('mic-btn').classList.remove('recording');
  document.getElementById('mic-btn').textContent = '🎤';
  document.getElementById('voice-hint').textContent = 'Pulsa para hablar de nuevo';
}

// ── GET INPUT ─────────────────────────────────────────────────
function getInputText() {
  if (document.getElementById('voice-area').classList.contains('visible'))
    return document.getElementById('voice-transcript').textContent.trim();
  if (document.getElementById('text-area').classList.contains('visible'))
    return document.getElementById('text-input').value.trim();
  const type    = document.getElementById('s-type').value;
  const hours   = document.getElementById('s-hours').value;
  const area    = document.getElementById('s-area').value;
  const urgency = document.getElementById('s-urgency').value;
  const desc    = document.getElementById('s-desc').value;
  return `Trabajo: ${type}. Horas: ${hours||'a estimar'}. ${area?'Sup: '+area+'m².':''} Urgencia: ${urgency}. ${desc}`;
}

// ── GENERATE ──────────────────────────────────────────────────
async function generateBudget() {
  const inputText = getInputText();
  if (!inputText || inputText.length < 10) return toast('Describe el trabajo primero', 'error');

  // Quota check
  const plan  = currentProfile?.plan || 'free';
  const used  = currentProfile?.quota_used || 0;
  const limit = PLAN_LIMITS[plan];
  if (used >= limit) {
    toast('Has alcanzado el límite de tu plan. Actualiza para continuar.', 'error');
    showPage('plans', null); return;
  }

  // UI: show generating
  document.getElementById('preview-placeholder').style.display = 'none';
  document.getElementById('budget-preview').classList.remove('visible');
  document.getElementById('action-bar').style.display = 'none';
  document.getElementById('edit-btn').style.display = 'none';
  document.getElementById('generating-state').classList.add('visible');

  const steps = ['Analizando el trabajo...','Estimando materiales...','Calculando precios...','Redactando presupuesto...','Aplicando formato...'];
  let si = 0;
  const iv = setInterval(() => { if (si < steps.length) document.getElementById('gen-step').textContent = steps[si++]; }, 1100);

  const profile = getProfile();
  const clientName    = document.getElementById('c-name').value    || 'Cliente';
  const clientEmail   = document.getElementById('c-email').value;
  const clientPhone   = document.getElementById('c-phone').value;
  const clientAddress = document.getElementById('c-address').value;

  try {
    const response = await fetch(AI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: buildPrompt(inputText, profile, clientName, clientAddress) }]
      })
    });
    clearInterval(iv);
    if (!response.ok) throw new Error('API error '+response.status);
    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    currentBudget = parseAPIResponse(text, clientName, clientEmail, clientPhone, clientAddress);
  } catch(e) {
    clearInterval(iv);
    console.warn('AI fallback:', e.message);
    currentBudget = generateFallbackBudget(inputText, clientName, clientEmail, clientPhone, clientAddress);
    toast('IA no disponible — presupuesto estimado generado', '');
  }

  // Increment quota (local + Supabase)
  if (currentProfile) {
    currentProfile.quota_used = (currentProfile.quota_used || 0) + 1;
    if (supabaseClient && currentUser && !isDemo) {
      supabaseClient.from('profiles').update({ quota_used: currentProfile.quota_used }).eq('id', currentUser.id).then();
    }
    updateSidebar();
  }

  renderBudgetPreview(currentBudget, profile);
  document.getElementById('generating-state').classList.remove('visible');
  document.getElementById('budget-preview').classList.add('visible');
  document.getElementById('action-bar').style.display = 'flex';
  document.getElementById('edit-btn').style.display = 'inline-flex';
  toast('¡Presupuesto generado! 🎉', 'success');
}

function buildPrompt(inputText, profile, clientName, clientAddress) {
  return `Eres un experto en presupuestos para oficios y construcción en España. Genera un presupuesto profesional.

Trabajo descrito: "${inputText}"
Profesional: ${profile.name || 'Profesional'} — ${profile.trade || 'Oficio'}
Cliente: ${clientName}${clientAddress ? '\nDirección: '+clientAddress : ''}

Responde SOLO con JSON válido, sin texto adicional ni markdown:
{
  "titulo": "Título breve del trabajo",
  "items": [
    {"descripcion": "descripción", "cantidad": 1, "unidad": "ud", "precio_unitario": 100.00}
  ],
  "notas": "Condiciones, garantía, observaciones",
  "validez_dias": 30
}

Reglas: 3-8 ítems realistas, precios mercado español actual, separa materiales y mano de obra, unidades correctas (ud, m², ml, h).`;
}

function parseAPIResponse(text, clientName, clientEmail, clientPhone, clientAddress) {
  try {
    const json = JSON.parse(text.replace(/```json|```/g,'').trim());
    const subtotal = json.items.reduce((s,i) => s + i.cantidad * i.precio_unitario, 0);
    const iva = subtotal * 0.21;
    return { number: genNum(), date: today(), title: json.titulo, items: json.items,
      subtotal, iva, total: subtotal+iva, notes: json.notas, validez: json.validez_dias||30,
      client: { name:clientName, email:clientEmail, phone:clientPhone, address:clientAddress }, status:'pending' };
  } catch(e) { return generateFallbackBudget('', clientName, clientEmail, clientPhone, clientAddress); }
}

function generateFallbackBudget(desc, clientName, clientEmail, clientPhone, clientAddress) {
  const items = [
    { descripcion:'Mano de obra especializada', cantidad:4, unidad:'h', precio_unitario:45 },
    { descripcion:'Materiales y suministros',   cantidad:1, unidad:'ud', precio_unitario:120 },
    { descripcion:'Desplazamiento y gestión',   cantidad:1, unidad:'ud', precio_unitario:25 },
  ];
  const subtotal = items.reduce((s,i) => s + i.cantidad*i.precio_unitario, 0);
  const iva = subtotal * 0.21;
  return { number:genNum(), date:today(), title:desc.slice(0,60)||'Trabajo profesional', items,
    subtotal, iva, total:subtotal+iva,
    notes:'Presupuesto válido 30 días. Condiciones: 50% al aceptar, 50% al finalizar. Garantía 1 año.',
    validez:30, client:{name:clientName,email:clientEmail,phone:clientPhone,address:clientAddress}, status:'pending' };
}

function genNum() {
  const year = new Date().getFullYear();
  const c = JSON.parse(localStorage.getItem('pria_counter')||'{"n":0}');
  c.n++; localStorage.setItem('pria_counter', JSON.stringify(c));
  return `PRES-${year}-${String(c.n).padStart(4,'0')}`;
}
function today() { return new Date().toLocaleDateString('es-ES'); }

// ── RENDER PREVIEW ────────────────────────────────────────────
function renderBudgetPreview(b, profile) {
  const rows = b.items.map(item => `<tr>
    <td>${item.descripcion}</td>
    <td style="text-align:center">${item.cantidad} ${item.unidad}</td>
    <td style="text-align:right">€${item.precio_unitario.toFixed(2)}</td>
    <td>€${(item.cantidad*item.precio_unitario).toFixed(2)}</td>
  </tr>`).join('');

  document.getElementById('budget-doc').innerHTML = `
    <div class="doc-header">
      <div class="doc-company">
        <div class="doc-company-name">${profile.name||'Tu Empresa'}</div>
        <div class="doc-company-info">
          ${profile.trade?profile.trade+'<br>':''}
          ${profile.nif?'NIF: '+profile.nif+'<br>':''}
          ${profile.phone?'Tel: '+profile.phone+'<br>':''}
          ${profile.city||''}
        </div>
      </div>
      <div class="doc-meta">
        <div class="doc-num">PRESUPUESTO<br>${b.number}</div>
        <div class="doc-date">Fecha: ${b.date}<br>Válido: ${b.validez} días</div>
      </div>
    </div>
    <div class="doc-client">
      <div class="doc-client-label">Cliente</div>
      <div class="doc-client-name">${b.client.name||'—'}</div>
      <div class="doc-client-info">${[b.client.phone?'Tel: '+b.client.phone:'', b.client.address].filter(Boolean).join(' · ')}</div>
    </div>
    <div class="doc-title">${b.title}</div>
    <table class="doc-table">
      <thead><tr>
        <th style="width:45%">Descripción</th>
        <th style="width:15%;text-align:center">Cant.</th>
        <th style="width:18%;text-align:right">P.Unit.</th>
        <th style="width:22%;text-align:right">Total</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="doc-totals">
      <div class="doc-total-row"><span>Subtotal</span><span>€${b.subtotal.toFixed(2)}</span></div>
      <div class="doc-total-row"><span>IVA 21%</span><span>€${b.iva.toFixed(2)}</span></div>
      <div class="doc-total-row"><span>TOTAL</span><span>€${b.total.toFixed(2)}</span></div>
    </div>
    <div class="doc-notes">${b.notes}<div class="doc-validity">Válido ${b.validez} días desde emisión.</div></div>`;
}

// ── STRIPE ────────────────────────────────────────────────────
async function startCheckout(plan) {
  if (isDemo) return toast('Regístrate para activar un plan de pago', 'error');
  if (!currentUser) return toast('Debes estar registrado', 'error');

  const btn = document.getElementById(`plan-${plan}-btn`);
  if (btn) { btn.disabled = true; btn.textContent = 'Redirigiendo...'; }

  try {
    const response = await fetch(CHECKOUT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan,
        userId: currentUser.id,
        userEmail: currentUser.email,
      })
    });

    if (!response.ok) throw new Error('Error al crear sesión de pago');
    const { url } = await response.json();
    if (!url) throw new Error('Sin URL de checkout');

    // Redirige a Stripe Checkout
    window.location.href = url;

  } catch(e) {
    console.error('Checkout error:', e);
    toast('Error al iniciar el pago: ' + e.message, 'error');
    if (btn) { btn.disabled = false; updatePlanButtons(currentProfile?.plan||'free'); }
  }
}

async function openCustomerPortal() {
  if (isDemo || !currentUser) return toast('Función solo disponible con cuenta real', 'error');
  toast('Abriendo portal de gestión...', '');
  try {
    const response = await fetch(PORTAL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id })
    });
    if (!response.ok) throw new Error('Error');
    const { url } = await response.json();
    window.location.href = url;
  } catch(e) {
    toast('Error al abrir el portal: ' + e.message, 'error');
  }
}

// ── PROFILE ───────────────────────────────────────────────────
function getProfile() {
  return {
    name:    document.getElementById('p-name').value    || currentProfile?.full_name || '',
    trade:   document.getElementById('p-trade').value   || currentProfile?.trade || '',
    nif:     document.getElementById('p-nif').value     || currentProfile?.nif || '',
    phone:   document.getElementById('p-phone').value   || currentProfile?.phone || '',
    email:   document.getElementById('p-email').value   || currentUser?.email || '',
    address: document.getElementById('p-address').value || currentProfile?.address || '',
    city:    document.getElementById('p-city').value    || currentProfile?.city || '',
    web:     document.getElementById('p-web').value     || currentProfile?.web || '',
    note:    document.getElementById('p-note').value    || currentProfile?.note || '',
    payment: document.getElementById('p-payment').value || '',
  };
}

function saveProfile() {
  const p = getProfile();
  localStorage.setItem('pria_profile', JSON.stringify(p));
  if (currentProfile) Object.assign(currentProfile, { ...p, full_name: p.name });
  saveProfileToSupabase();
  updateSidebar();
  toast('Perfil guardado ✓', 'success');
}

function loadProfileFromStorage() {
  const stored = localStorage.getItem('pria_profile');
  if (stored) { try { const p = JSON.parse(stored); if (!currentProfile) currentProfile = {}; Object.assign(currentProfile, p); } catch(e){} }
}

async function saveProfileToSupabase() {
  if (!supabaseClient || !currentUser || isDemo) return;
  const p = getProfile();
  try {
    await supabaseClient.from('profiles').upsert({ id: currentUser.id, full_name: p.name,
      trade: p.trade, nif: p.nif, phone: p.phone, email: p.email, address: p.address,
      city: p.city, web: p.web, note: p.note, payment: p.payment });
  } catch(e) { console.warn('Profile save:', e); }
}

async function loadProfile() {
  if (!supabaseClient || !currentUser) return;
  try {
    const { data } = await supabaseClient.from('profiles').select('*').eq('id', currentUser.id).single();
    if (data) currentProfile = data;
    else currentProfile = { full_name: currentUser.user_metadata?.full_name, trade: currentUser.user_metadata?.trade, quota_used: 0, plan: 'free' };
  } catch(e) { currentProfile = { quota_used: 0, plan: 'free' }; }
}

// ── PDF ───────────────────────────────────────────────────────
function downloadPDF() {
  if (!currentBudget) return;
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    const profile = getProfile();
    const b = currentBudget;
    const W = 210, M = 18;
    let y = 20;

    doc.setFillColor(26,23,20); doc.rect(0,0,W,36,'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.setTextColor(255,255,255);
    doc.text(profile.name||'Tu Empresa', M, 16);
    doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(180,170,160);
    doc.text([profile.trade, profile.nif?'NIF: '+profile.nif:'', profile.phone?'Tel: '+profile.phone:''].filter(Boolean).join(' · '), M, 24);
    doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(232,128,10);
    doc.text('PRESUPUESTO '+b.number, W-M, 14, {align:'right'});
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(180,170,160);
    doc.text('Fecha: '+b.date, W-M, 20, {align:'right'});
    doc.text('Válido: '+b.validez+' días', W-M, 26, {align:'right'});
    y = 46;

    doc.setFillColor(247,245,240); doc.roundedRect(M,y,W-M*2,22,2,2,'F');
    doc.setFontSize(7); doc.setFont('helvetica','bold'); doc.setTextColor(158,152,145); doc.text('CLIENTE',M+6,y+7);
    doc.setFontSize(11); doc.setTextColor(26,23,20); doc.text(b.client.name||'Cliente',M+6,y+14);
    if (b.client.address) { doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(107,101,96); doc.text(b.client.address,M+6,y+20); }
    y += 30;

    doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.setTextColor(26,23,20); doc.text(b.title,M,y); y+=10;
    doc.setFillColor(26,23,20); doc.rect(M,y,W-M*2,8,'F');
    doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255);
    doc.text('Descripción',M+3,y+5.5); doc.text('Cant.',M+95,y+5.5); doc.text('P.Unit.',M+120,y+5.5); doc.text('Total',W-M-3,y+5.5,{align:'right'});
    y += 10;

    b.items.forEach((item,idx) => {
      if (idx%2===0) { doc.setFillColor(247,245,240); doc.rect(M,y-2,W-M*2,9,'F'); }
      doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(26,23,20);
      doc.text((item.descripcion.length>48?item.descripcion.slice(0,48)+'...':item.descripcion),M+3,y+4);
      doc.text(item.cantidad+' '+item.unidad,M+95,y+4);
      doc.text('€'+item.precio_unitario.toFixed(2),M+120,y+4);
      doc.text('€'+(item.cantidad*item.precio_unitario).toFixed(2),W-M-3,y+4,{align:'right'});
      y += 9;
    });
    y += 4;

    const tX = W-M-80;
    [['Subtotal','€'+b.subtotal.toFixed(2)],['IVA 21%','€'+b.iva.toFixed(2)]].forEach(([l,v]) => {
      doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(107,101,96);
      doc.text(l,tX,y); doc.text(v,W-M,y,{align:'right'}); y+=7;
    });
    doc.setFontSize(12); doc.setFont('helvetica','bold'); doc.setTextColor(232,128,10);
    doc.text('TOTAL',tX,y+2); doc.text('€'+b.total.toFixed(2),W-M,y+2,{align:'right'});
    y += 14;

    if (b.notes) {
      doc.setDrawColor(226,221,214); doc.line(M,y,W-M,y); y+=6;
      doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(107,101,96);
      doc.text(doc.splitTextToSize(b.notes,W-M*2),M,y);
    }

    doc.save(`Presupuesto_${b.number}.pdf`);
    toast('PDF descargado ✓', 'success');
  } catch(e) { console.error(e); toast('Error al generar PDF', 'error'); }
}

// ── EMAIL MODAL ───────────────────────────────────────────────
function openEmailModal() {
  document.getElementById('modal-email').value = document.getElementById('c-email').value;
  const p = getProfile();
  document.getElementById('modal-msg').value =
    `Estimado/a ${currentBudget?.client?.name||'cliente'},\n\nAdjunto el presupuesto ${currentBudget?.number||''} solicitado.\n\nQuedamos a su disposición.\n\nSaludos,\n${p.name||''}`;
  document.getElementById('email-modal').classList.add('open');
}
function closeModal() { document.getElementById('email-modal').classList.remove('open'); }

function sendEmail() {
  const email = document.getElementById('modal-email').value;
  if (!email) return toast('Introduce el email del cliente', 'error');
  closeModal();
  // En producción: POST a /api/send-email con el PDF adjunto
  setTimeout(() => {
    if (currentBudget) { currentBudget.status = 'sent'; saveBudget(true); }
    toast(`Presupuesto enviado a ${email} ✓`, 'success');
  }, 600);
  toast('Enviando...', '');
}

// ── HISTORY ───────────────────────────────────────────────────
function saveBudget(silent=false) {
  if (!currentBudget) return;
  const idx = budgets.findIndex(b => b.number === currentBudget.number);
  if (idx>=0) budgets[idx]=currentBudget; else budgets.unshift(currentBudget);
  localStorage.setItem('pria_budgets', JSON.stringify(budgets));
  if (supabaseClient && currentUser && !isDemo) saveBudgetToSupabase(currentBudget);
  if (!silent) toast('Guardado ✓', 'success');
}

async function saveBudgetToSupabase(b) {
  try {
    await supabaseClient.from('budgets').upsert({
      number: b.number, user_id: currentUser.id, date: b.date, title: b.title,
      items: b.items, subtotal: b.subtotal, iva: b.iva, total: b.total,
      notes: b.notes, validez: b.validez, status: b.status,
      client_name: b.client?.name, client_email: b.client?.email,
      client_phone: b.client?.phone, client_address: b.client?.address,
    });
  } catch(e) { console.warn('Budget save:', e); }
}

function loadBudgetsFromStorage() {
  try { const s = localStorage.getItem('pria_budgets'); if (s) budgets = JSON.parse(s); } catch(e){ budgets=[]; }
}

function renderHistory() {
  const search  = (document.getElementById('search-input')?.value||'').toLowerCase();
  const statusF = document.getElementById('status-filter')?.value||'';
  const filtered = budgets.filter(b =>
    (!search || b.client?.name?.toLowerCase().includes(search) || b.title?.toLowerCase().includes(search)) &&
    (!statusF || b.status===statusF)
  );

  const total    = budgets.length;
  const accepted = budgets.filter(b=>b.status==='accepted').length;
  const amount   = budgets.reduce((s,b)=>s+(b.total||0),0);
  document.getElementById('stat-total').textContent    = total;
  document.getElementById('stat-accepted').textContent = accepted;
  document.getElementById('stat-amount').textContent   = '€'+Math.round(amount).toLocaleString('es-ES');
  document.getElementById('stat-rate').textContent     = total ? Math.round(accepted/total*100)+'%' : '—';

  const list = document.getElementById('budget-list');
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><div class="big">📂</div>
      <h3>${!total?'Sin presupuestos todavía':'Sin resultados'}</h3>
      <p>${!total?'Genera tu primer presupuesto':'Prueba con otro filtro'}</p></div>`;
    return;
  }
  const labels = {pending:'Pendiente',sent:'Enviado',accepted:'Aceptado',rejected:'Rechazado'};
  list.innerHTML = filtered.map(b=>`
    <div class="budget-row">
      <div class="br-num">${b.number}</div>
      <div class="br-info">
        <div class="br-client">${b.client?.name||'—'}</div>
        <div class="br-work">${b.title||''}</div>
      </div>
      <div class="br-date">${b.date}</div>
      <span class="status-badge status-${b.status||'pending'}">${labels[b.status||'pending']}</span>
      <div class="br-amount">€${b.total?.toFixed(0)||'—'}</div>
      <div class="br-actions">
        <select class="btn btn-secondary btn-sm" style="padding:6px 8px;font-size:11px" onchange="changeStatus('${b.number}',this.value)">
          <option value="pending"  ${b.status==='pending' ?'selected':''}>Pendiente</option>
          <option value="sent"     ${b.status==='sent'    ?'selected':''}>Enviado</option>
          <option value="accepted" ${b.status==='accepted'?'selected':''}>Aceptado</option>
          <option value="rejected" ${b.status==='rejected'?'selected':''}>Rechazado</option>
        </select>
        <button class="btn btn-secondary btn-sm" onclick="reloadBudget('${b.number}')">Ver</button>
      </div>
    </div>`).join('');
}

function filterBudgets() { renderHistory(); }

function changeStatus(num, status) {
  const b = budgets.find(b=>b.number===num);
  if (b) { b.status=status; localStorage.setItem('pria_budgets',JSON.stringify(budgets)); if(supabaseClient&&currentUser&&!isDemo)supabaseClient.from('budgets').update({status}).eq('number',num).then(); renderHistory(); }
}

function reloadBudget(num) {
  const b = budgets.find(b=>b.number===num);
  if (!b) return;
  currentBudget = b;
  showPage('generator', document.querySelectorAll('.sb-item')[0]);
  document.querySelectorAll('.sb-item')[0].classList.add('active');
  setVal('c-name',b.client?.name||''); setVal('c-email',b.client?.email||'');
  setVal('c-phone',b.client?.phone||''); setVal('c-address',b.client?.address||'');
  document.getElementById('preview-placeholder').style.display='none';
  document.getElementById('generating-state').classList.remove('visible');
  renderBudgetPreview(b, getProfile());
  document.getElementById('budget-preview').classList.add('visible');
  document.getElementById('action-bar').style.display='flex';
  document.getElementById('edit-btn').style.display='inline-flex';
}

function editBudget() { toast('Edición manual — próximamente', ''); }

// ── TOAST ─────────────────────────────────────────────────────
function toast(msg, type='') {
  const c = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast-item ${type}`; el.textContent = msg;
  c.appendChild(el); setTimeout(()=>el.remove(), 3500);
}
