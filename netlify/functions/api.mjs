import { getStore } from '@netlify/blobs';
import webpush from 'web-push';
import crypto from 'node:crypto';

const E = process.env;
const VAPID_PUBLIC = 'BByPun49jVlrCt9DzD8AgpciOwwey-BS9ZgHFoyweUGpWvsLv6AP-gHeMu_EWnlJ0rHmxvH_fIiE5JcmnQE06lM';
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hash = s => crypto.createHash('sha1').update(String(s)).digest('hex');
const clip = (s, n) => String(s ?? '').slice(0, n);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const all = async n => { const s = getStore(n); const { blobs } = await s.list(); return (await Promise.all(blobs.map(b => s.get(b.key, { type: 'json' })))).filter(Boolean); };
const put = (n, k, v) => getStore(n).setJSON(k, v);

// admin auth: stateless HMAC token, 24h
const secret = () => (E.ADMIN_PASSWORD || '') + (E.ADMIN_SECRET || '');
const sign = x => crypto.createHmac('sha256', secret()).update(x).digest('hex');
const mint = () => { const x = String(Date.now() + 864e5); return x + '.' + sign(x); };
const authed = req => {
  if (!E.ADMIN_PASSWORD) return false;
  const [x, g] = (req.headers.get('authorization') || '').replace('Bearer ', '').split('.');
  if (!x || !g || +x < Date.now()) return false;
  const a = Buffer.from(sign(x)), b = Buffer.from(g);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const SITE = (E.SITE_URL || E.URL || 'https://eruditeeasypay.netlify.app').replace(/\/$/, '');
const wrap = (title, body) => `<div style="background:#f4f7ff;padding:24px;font-family:Arial,sans-serif"><div style="max-width:480px;margin:auto;background:#fff;border-radius:16px;overflow:hidden"><div style="background:#ffffff;padding:18px 24px;border-bottom:3px solid #1d4ed8;text-align:center"><img src="${SITE}/logo-email.png" alt="Erudite Easy Pay" width="180" style="max-width:180px;height:auto;display:inline-block"></div><div style="padding:24px;color:#0b1b3f;line-height:1.6"><h2 style="margin:0 0 12px">${title}</h2>${body}</div><div style="padding:14px 24px;background:#eaf1ff;color:#64748b;font-size:12px">Erudite Easy Pay · Pay Smart. Live Better.<br>You received this email because of activity on your Erudite Easy Pay account.</div></div></div>`;
const toText = h => String(h).replace(/<(br|\/p|\/h2|\/tr)[^>]*>/gi, '\n').replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '$2: $1').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();

// Brevo transactional send, built for inbox placement: plain-text alternative, reply-to, proper sender
async function sendMail({ to, subject, html, text }) {
  if (!E.BREVO_API_KEY || !E.SENDER_EMAIL) return false;
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': E.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: { name: E.SENDER_NAME || 'Erudite Easy Pay', email: E.SENDER_EMAIL }, replyTo: { email: E.REPLY_TO || E.SENDER_EMAIL, name: 'Erudite Easy Pay Support' }, to: [{ email: to }], subject, htmlContent: html, textContent: text || toText(html), tags: ['transactional'] })
    });
    return r.ok;
  } catch { return false; }
}

/* ---------- Firebase (web config is public; the service-account key lives ONLY in the FIREBASE_SERVICE_ACCOUNT env var) ---------- */
const FB_KEY = 'AIzaSyB4_pSASNgkJb-s08K7IhXR-7Plt8-hC9k', FB_PROJECT = 'easy-pay-c6471';
const b64u = x => Buffer.from(x).toString('base64url');
let adminTok = { t: '', exp: 0 };
async function adminToken() {
  if (adminTok.exp > Date.now() + 60000) return adminTok.t;
  let sa; try { sa = JSON.parse(E.FIREBASE_SERVICE_ACCOUNT || ''); } catch { return null; }
  if (!sa.private_key || !sa.client_email) return null;
  const now = Math.floor(Date.now() / 1000), h = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const c = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(h + '.' + c).sign(sa.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + h + '.' + c + '.' + sig });
  const d = await r.json().catch(() => ({}));
  if (!d.access_token) return null;
  adminTok = { t: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
  return adminTok.t;
}
// Verify a Firebase ID token with Google, return { email, authTime } or null
async function verifyIdToken(idToken) {
  if (typeof idToken !== 'string' || idToken.length > 4000) return null;
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FB_KEY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) });
  const d = await r.json().catch(() => ({})), u = d.users && d.users[0];
  if (!u || !u.email) return null;
  let authTime = 0; try { authTime = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString()).auth_time * 1000; } catch {}
  return { email: u.email.toLowerCase(), authTime };
}
async function resetLink(email) {
  const t = await adminToken(); if (!t) return null;
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${FB_PROJECT}/accounts:sendOobCode`, { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ requestType: 'PASSWORD_RESET', email, returnOobLink: true, continueUrl: SITE + '/', canHandleCodeInApp: false }) });
  const d = await r.json().catch(() => ({}));
  return d.oobLink || null;
}

async function sendEmails(list, title, message) {
  if (!E.BREVO_API_KEY || !E.SENDER_EMAIL) return { sent: 0, failed: list.length, error: 'Brevo not configured' };
  const html = wrap(title, `<p>${esc(message).replace(/\n/g, '<br>')}</p>`);
  let sent = 0, failed = 0;
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    try {
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': E.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ sender: { name: E.SENDER_NAME || 'Erudite Easy Pay', email: E.SENDER_EMAIL }, replyTo: { email: E.REPLY_TO || E.SENDER_EMAIL }, subject: title, htmlContent: html, textContent: toText(html), messageVersions: chunk.map(email => ({ to: [{ email }] })) })
      });
      r.ok ? (sent += chunk.length) : (failed += chunk.length);
    } catch { failed += chunk.length; }
  }
  return { sent, failed };
}

async function sendPush(subs, title, message) {
  if (!E.VAPID_PRIVATE_KEY) return { sent: 0, failed: subs.length, error: 'VAPID_PRIVATE_KEY not set' };
  webpush.setVapidDetails('mailto:' + (E.SENDER_EMAIL || 'admin@example.com'), VAPID_PUBLIC, E.VAPID_PRIVATE_KEY);
  const payload = JSON.stringify({ title, body: clip(message, 200), url: '/' });
  let sent = 0, failed = 0;
  await Promise.all(subs.map(async s => {
    try { await webpush.sendNotification(s.sub, payload); sent++; }
    catch (e) { failed++; if (e.statusCode === 404 || e.statusCode === 410) await getStore('subs').delete(hash(s.sub.endpoint)).catch(() => {}); }
  }));
  return { sent, failed };
}

// transaction PIN: scrypt-hashed, 5 wrong tries = 15 min lock
const WEAK = new Set(['1234', '4321', '0123', '1122', '2580', '1212', '0852']);
const validPin = p => /^\d{4}$/.test(p || '') && !/^(\d)\1{3}$/.test(p) && !WEAK.has(p);
const pinHash = (pin, salt) => crypto.scryptSync(pin, salt, 32).toString('hex');
async function checkPin(uid, usr, pin) {
  if (!usr?.pin) return { status: 403, error: 'Create your transaction PIN first.', code: 'nopin' };
  if (usr.pinLock && usr.pinLock > Date.now()) return { status: 429, error: `Too many wrong attempts. Try again in ${Math.ceil((usr.pinLock - Date.now()) / 60000)} min.` };
  const ok = /^\d{4}$/.test(pin || '') && crypto.timingSafeEqual(Buffer.from(pinHash(pin, usr.pin.s), 'hex'), Buffer.from(usr.pin.h, 'hex'));
  if (ok) { if (usr.pinFails) await put('users', hash(uid), { ...usr, pinFails: 0, pinLock: 0 }); return null; }
  const fails = (usr.pinFails || 0) + 1;
  await put('users', hash(uid), { ...usr, pinFails: fails >= 5 ? 0 : fails, pinLock: fails >= 5 ? Date.now() + 15 * 60000 : 0 });
  return { status: 401, error: fails >= 5 ? 'Too many wrong attempts. PIN locked for 15 minutes.' : `Wrong PIN. ${5 - fails} attempt(s) left.` };
}
const chatHits = new Map();
const faq = (q, P, w, wa) => {
  q = q.toLowerCase(); const N = n => '₦' + Number(n).toLocaleString('en-NG');
  if (/balance|wallet/.test(q) && w) return { reply: `Your wallet balance is ${N(w.balance)}.` };
  if (/data|plan|price/.test(q)) return { reply: 'Current data plans:\n' + P.plans.data.map(x => `${x.label}: ${N(x.price)}`).join('\n') };
  if (/fund|deposit|add money/.test(q)) return { reply: 'Tap Fund wallet on the home screen, enter an amount and pay with Paystack (card, transfer or USSD). Your wallet is credited right after payment.' };
  return { reply: 'I’m not sure about that one. Please contact our support team and include your transaction reference.', human: true, whatsapp: wa };
};
const PS = 'https://api.paystack.co';
const ps = (path, o = {}) => fetch(PS + path, { ...o, headers: { Authorization: 'Bearer ' + E.PAYSTACK_SECRET_KEY, 'Content-Type': 'application/json' } }).then(r => r.json());
// wallet = sum of ledger entries (one key per entry, so crediting twice is harmless)
const DEFAULT_PRICING = { airtimeDiscount: 2, off: {}, plans: {
  data: [['500MB · 7 days', 150], ['1GB · 30 days', 280], ['2GB · 30 days', 560], ['5GB · 30 days', 1350], ['10GB · 30 days', 2600]].map(([label, price]) => ({ label, price })),
  tv: [['Basic', 2100], ['Compact', 9000], ['Premium', 29500]].map(([label, price]) => ({ label, price })),
  exam: [['Result checker', 3500], ['Registration pin', 4700]].map(([label, price]) => ({ label, price })) } };
const getPricing = async () => ({ ...DEFAULT_PRICING, ...((await getStore('config').get('pricing', { type: 'json' })) || {}) });
const history = async uid => { const s = getStore('ledger'); const { blobs } = await s.list({ prefix: hash(uid) + '/' }); const v = (await Promise.all(blobs.map(x => s.get(x.key, { type: 'json' })))).filter(Boolean).sort((a, c) => c.ts - a.ts); return { balance: v.reduce((t, x) => t + (x.amount || 0), 0), items: v.slice(0, 100) }; };
const balanceOf = async uid => (await history(uid)).balance;
async function credit(ref) {
  const rec = await getStore('pay').get(hash(ref), { type: 'json' });
  if (!rec) return { ok: false, error: 'Unknown reference' };
  if (rec.status === 'success') return { ok: true, amount: rec.amount };
  const d = (await ps('/transaction/verify/' + encodeURIComponent(ref)))?.data;
  if (d?.status !== 'success') return { ok: false, status: d?.status || 'pending' };
  if (d.currency !== 'NGN' || d.amount !== rec.amount * 100) return { ok: false, error: 'Amount mismatch' };
  await put('ledger', hash(rec.uid) + '/' + ref, { amount: rec.amount, type: 'fund', title: 'Wallet funding', sub: 'Paystack', ref, ts: Date.now() });
  await put('pay', hash(ref), { ...rec, status: 'success', paidAt: Date.now() });
  return { ok: true, amount: rec.amount };
}

export default async req => {
  const u = new URL(req.url), p = u.pathname.replace(/^\/api\//, ''), m = req.method;
  let b = {}, raw = '';
  if (m === 'POST') { try { const t = await req.text(); raw = t; if (t.length > 20000) return J({ error: 'Too large' }, 413); b = t ? JSON.parse(t) : {}; } catch { return J({ error: 'Bad JSON' }, 400); } }
  try {
    /* ---------- public (app) ---------- */
    if (p === 'register' && m === 'POST') {
      const id = clip(b.id, 120).toLowerCase(); if (id.length < 5) return J({ error: 'Invalid' }, 400);
      const old = await getStore('users').get(hash(id), { type: 'json' });
      await put('users', hash(id), { ...old, id, name: clip(b.name, 60), email: EMAIL.test(b.email || '') ? clip(b.email, 120).toLowerCase() : '', joined: old?.joined || Date.now(), seen: Date.now(), suspended: !!old?.suspended });
      return J({ ok: true });
    }
    if (p === 'auth/reset-password' && m === 'POST') {
      // Always answers ok (no account enumeration). Sends through Brevo from your authenticated domain so it lands in the inbox.
      const em = clip(b.email, 120).toLowerCase(); if (!EMAIL.test(em)) return J({ error: 'Invalid email' }, 400);
      const link = await resetLink(em).catch(() => null);
      if (!link) return J({ ok: false, fallback: true });
      await sendMail({ to: em, subject: 'Reset your Erudite Easy Pay password', html: wrap('Reset your password', `<p>We received a request to reset the password for your account. Tap the button below to choose a new one.</p><p style="margin:22px 0"><a href="${esc(link)}" style="background:#1d4ed8;color:#fff;text-decoration:none;padding:13px 22px;border-radius:12px;font-weight:bold;display:inline-block">Reset password</a></p><p style="color:#64748b;font-size:13px">If you didn’t ask for this, you can safely ignore this email — your password won’t change.</p>`) });
      return J({ ok: true });
    }
    if (p === 'pin/reset' && m === 'POST') {
      const v = await verifyIdToken(b.idToken);
      if (!v) return J({ error: 'Please log in again.' }, 401);
      if (Date.now() - v.authTime > 10 * 60 * 1000) return J({ error: 'Please verify your identity again.' }, 401);
      const usr = await getStore('users').get(hash(v.email), { type: 'json' });
      if (!usr) return J({ error: 'Account not found' }, 404);
      if (!validPin(b.pin)) return J({ error: 'Choose a 4-digit PIN that is not 1234 or repeated digits.' }, 400);
      const salt = crypto.randomBytes(8).toString('hex');
      await put('users', hash(v.email), { ...usr, pin: { s: salt, h: pinHash(b.pin, salt) }, pinFails: 0, pinLock: 0 });
      return J({ ok: true });
    }
    if (p === 'push-sub' && m === 'POST') {
      if (!b.sub?.endpoint) return J({ error: 'Invalid' }, 400);
      await put('subs', hash(b.sub.endpoint), { sub: b.sub, uid: clip(b.uid, 120), ts: Date.now() });
      return J({ ok: true });
    }
    if (p === 'track' && m === 'POST') {
      const uid = clip(b.uid, 120).toLowerCase(), ref = clip(b.ref, 30).replace(/[^A-Za-z0-9]/g, ''), svc = clip(b.svc, 20);
      if (uid.length < 5 || !ref) return J({ error: 'Invalid' }, 400);
      const usr = await getStore('users').get(hash(uid), { type: 'json' });
      if (usr?.suspended) return J({ error: 'Your account is suspended. Please contact support.' }, 403);
      const bad = await checkPin(uid, usr, b.pin); if (bad) return J({ error: bad.error, code: bad.code }, bad.status);
      const P = await getPricing();
      if (P.off?.[svc]) return J({ error: 'This service is temporarily unavailable.' }, 503);
      let charge, label = clip(b.label, 80);
      if (P.plans[svc]) { const pl = P.plans[svc].find(x => x.label === label); if (!pl) return J({ error: 'That plan is no longer available. Please reselect.' }, 400); charge = pl.price; }
      else {
        const face = Number(b.amount);
        if (!['airtime', 'power'].includes(svc) || !(face >= 100 && face <= 1e6)) return J({ error: 'Invalid' }, 400);
        charge = svc === 'airtime' ? Math.round(face * (1 - (P.airtimeDiscount || 0) / 100)) : face;
      }
      const bal = await balanceOf(uid);
      if (charge > bal) return J({ error: 'Insufficient balance. Please fund your wallet.', balance: bal }, 402);
      const title = clip(b.title, 80) || label, recipient = clip(b.recipient, 40);
      await put('ledger', hash(uid) + '/' + ref, { amount: -charge, type: 'purchase', svc, title, sub: recipient, ref, ts: Date.now() });
      await put('txs', hash(ref), { uid, service: title, recipient, amount: charge, ref, ts: Date.now() });
      return J({ ok: true, balance: bal - charge, charge, title });
    }
    if (p === 'chat' && m === 'POST') {
      const uid = clip(b.uid, 120).toLowerCase(), key = req.headers.get('x-nf-client-connection-ip') || uid, now = Date.now();
      const hits = (chatHits.get(key) || []).filter(t => now - t < 600000); if (hits.length >= 20) return J({ reply: 'You are sending messages too fast. Please wait a few minutes.' }, 429);
      chatHits.set(key, [...hits, now]);
      const ms = (Array.isArray(b.messages) ? b.messages : []).slice(-10).filter(x => ['user', 'assistant'].includes(x?.role) && typeof x.content === 'string').map(x => ({ role: x.role, content: clip(x.content, 500) }));
      while (ms.length && ms[0].role !== 'user') ms.shift();
      if (!ms.length || ms[ms.length - 1].role !== 'user') return J({ error: 'Invalid' }, 400);
      const P = await getPricing(), w = uid.length >= 5 ? await history(uid) : null, wa = E.SUPPORT_WHATSAPP || '';
      if (!E.ANTHROPIC_API_KEY) return J(faq(ms[ms.length - 1].content, P, w, wa));
      const money = n => '₦' + Number(n).toLocaleString('en-NG');
      const system = `You are Erudite, the friendly support assistant for Erudite Easy Pay, a Nigerian VTU platform (airtime, data, electricity, cable TV, exam pins). Reply in short, clear sentences (max 5), in simple English, using ₦ for money. Use ONLY the facts below; if you do not know, say so and add the marker [[HUMAN]] at the end so the user is offered human support.
Rules: you cannot buy anything, change balances, confirm or reverse payments, or reset PINs or passwords. Never ask for a PIN, password or card number; if the user shares one, tell them to keep it private. For failed, pending or missing transactions or payments, tell the user to note the reference and add [[HUMAN]]. Funding is done with Paystack from the home screen (Fund wallet). Purchases need the user's 4-digit transaction PIN, which can be changed in Profile. Forgotten PIN: contact support ([[HUMAN]]).
Facts: airtime discount ${P.airtimeDiscount || 0}% off. Data plans: ${P.plans.data.map(x => `${x.label} ${money(x.price)}`).join('; ')}. Cable TV: ${P.plans.tv.map(x => `${x.label} ${money(x.price)}`).join('; ')}. Exam pins: ${P.plans.exam.map(x => `${x.label} ${money(x.price)}`).join('; ')}. Services currently switched off: ${Object.keys(P.off || {}).filter(k => P.off[k]).join(', ') || 'none'}.${w ? ` This user's wallet balance: ${money(w.balance)}. Their latest activity: ${w.items.slice(0, 5).map(x => `${x.title} ${x.amount > 0 ? '+' : '-'}${money(Math.abs(x.amount))}`).join('; ') || 'none'}.` : ''}`;
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': E.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: E.CHAT_MODEL || 'claude-haiku-5-5', max_tokens: 400, system, messages: ms }) });
        const d = await r.json(), t = d?.content?.find(x => x.type === 'text')?.text;
        if (!r.ok || !t) return J(faq(ms[ms.length - 1].content, P, w, wa));
        return J({ reply: t.replace('[[HUMAN]]', '').trim(), human: t.includes('[[HUMAN]]'), whatsapp: wa });
      } catch { return J(faq(ms[ms.length - 1].content, P, w, wa)); }
    }
    if (p === 'pin/status' && m === 'GET') { const usr = await getStore('users').get(hash(clip(u.searchParams.get('uid'), 120).toLowerCase()), { type: 'json' }); return J({ has: !!usr?.pin }); }
    if (p === 'pin/set' && m === 'POST') {
      const uid = clip(b.uid, 120).toLowerCase(), usr = await getStore('users').get(hash(uid), { type: 'json' });
      if (!usr) return J({ error: 'Account not found' }, 404);
      if (!validPin(b.pin)) return J({ error: 'Choose a 4-digit PIN that is not 1234 or repeated digits.' }, 400);
      if (usr.pin) { const bad = await checkPin(uid, usr, b.old); if (bad) return J({ error: bad.error }, bad.status); }
      const fresh = (await getStore('users').get(hash(uid), { type: 'json' })) || usr, salt = crypto.randomBytes(8).toString('hex');
      await put('users', hash(uid), { ...fresh, pin: { s: salt, h: pinHash(b.pin, salt) }, pinFails: 0, pinLock: 0 });
      return J({ ok: true });
    }
    if (p === 'history' && m === 'GET') {
      const uid = clip(u.searchParams.get('uid'), 120).toLowerCase(); if (uid.length < 5) return J({ error: 'Invalid' }, 400);
      return J(await history(uid));
    }
    if (p === 'pricing' && m === 'GET') return J(await getPricing());
    if (p === 'wallet' && m === 'GET') {
      const uid = clip(u.searchParams.get('uid'), 120).toLowerCase(); if (uid.length < 5) return J({ error: 'Invalid' }, 400);
      return J({ balance: await balanceOf(uid) });
    }
    if (p === 'paystack/init' && m === 'POST') {
      if (!E.PAYSTACK_SECRET_KEY) return J({ error: 'Payments are not configured yet' }, 500);
      const uid = clip(b.uid, 120).toLowerCase(), amount = Math.floor(Number(b.amount));
      if (uid.length < 5 || !(amount >= 100 && amount <= 500000)) return J({ error: 'Enter an amount between ₦100 and ₦500,000' }, 400);
      const email = EMAIL.test(b.email || '') ? b.email : uid.replace(/[^a-z0-9]/g, '') + '@erudite.app';
      const ref = 'EEP' + crypto.randomBytes(8).toString('hex').toUpperCase();
      const r = await ps('/transaction/initialize', { method: 'POST', body: JSON.stringify({ email, amount: amount * 100, reference: ref, currency: 'NGN', callback_url: u.origin + '/', metadata: { uid } }) });
      if (!r?.status) return J({ error: r?.message || 'Could not start payment' }, 502);
      await put('pay', hash(ref), { ref, uid, amount, status: 'pending', ts: Date.now() });
      return J({ url: r.data.authorization_url, reference: ref });
    }
    if (p === 'paystack/verify' && m === 'GET') {
      if (!E.PAYSTACK_SECRET_KEY) return J({ ok: false, error: 'Payments are not configured' }, 500);
      return J(await credit(clip(u.searchParams.get('reference'), 60)));
    }
    if (p === 'paystack/webhook' && m === 'POST') {
      const sig = crypto.createHmac('sha512', E.PAYSTACK_SECRET_KEY || '').update(raw).digest('hex');
      if (!E.PAYSTACK_SECRET_KEY || sig !== req.headers.get('x-paystack-signature')) return J({ error: 'Invalid signature' }, 401);
      if (b.event === 'charge.success' && b.data?.reference) await credit(b.data.reference);
      return J({ ok: true });
    }
    if (p === 'inbox' && m === 'GET') {
      const items = (await all('bcs')).filter(x => x.channels?.app).sort((a, c) => c.ts - a.ts).slice(0, 20).map(({ id, ts, title, message }) => ({ id, ts, title, message }));
      return J({ items });
    }

    /* ---------- admin ---------- */
    if (!p.startsWith('admin/')) return J({ error: 'Not found' }, 404);
    if (p === 'admin/login' && m === 'POST') {
      if (!E.ADMIN_PASSWORD) return J({ error: 'ADMIN_PASSWORD is not set in Netlify' }, 500);
      const a = Buffer.from(hash(b.password || '')), c = Buffer.from(hash(E.ADMIN_PASSWORD));
      if (crypto.timingSafeEqual(a, c)) return J({ token: mint() });
      await new Promise(r => setTimeout(r, 800));
      return J({ error: 'Wrong password' }, 401);
    }
    if (!authed(req)) return J({ error: 'Unauthorized' }, 401);
    const route = p.slice(6);

    if (route === 'stats') {
      const [users, subs, txs, bcs, pays] = await Promise.all([all('users'), all('subs'), all('txs'), all('bcs'), all('pay')]);
      const paid = pays.filter(x => x.status === 'success');
      const series = [...Array(7)].map((_, i) => { const d = new Date(Date.now() - (6 - i) * 864e5).toISOString().slice(0, 10); const t = txs.filter(x => new Date(x.ts).toISOString().slice(0, 10) === d); return { d, sales: t.reduce((s, x) => s + x.amount, 0), count: t.length }; });
      return J({ users: users.length, withEmail: users.filter(x => x.email).length, subs: subs.length, txCount: txs.length, revenue: txs.reduce((s, x) => s + x.amount, 0), funded: paid.reduce((s, x) => s + x.amount, 0), fundCount: paid.length, series, recentTx: txs.sort((a, c) => c.ts - a.ts).slice(0, 6), recentBc: bcs.sort((a, c) => c.ts - a.ts).slice(0, 5), status: { brevo: !!(E.BREVO_API_KEY && E.SENDER_EMAIL), vapid: !!E.VAPID_PRIVATE_KEY, paystack: !!E.PAYSTACK_SECRET_KEY, chat: !!E.ANTHROPIC_API_KEY, admin: !!E.ADMIN_PASSWORD, sender: E.SENDER_EMAIL || '' }, vapidPublic: VAPID_PUBLIC });
    }
    if (route === 'users' && m === 'GET') return J({ items: (await all('users')).sort((a, c) => c.joined - a.joined).map(({ pin, pinFails, pinLock, ...x }) => ({ ...x, hasPin: !!pin })) });
    if (route === 'users' && m === 'DELETE') { const id = clip(u.searchParams.get('id'), 120); await getStore('users').delete(hash(id)); return J({ ok: true }); }
    if (route === 'txs') return J({ items: (await all('txs')).sort((a, c) => c.ts - a.ts).slice(0, 500) });
    if (route === 'broadcasts' && m === 'GET') return J({ items: (await all('bcs')).sort((a, c) => c.ts - a.ts) });
    if (route === 'broadcast' && m === 'POST') {
      const title = clip(b.title, 80).trim(), message = clip(b.message, 2000).trim(), ch = b.channels || {};
      if (!title || !message) return J({ error: 'Title and message are required' }, 400);
      if (!ch.app && !ch.email && !ch.push) return J({ error: 'Pick at least one channel' }, 400);
      const sent = {};
      if (ch.app) sent.app = { sent: 1 };
      if (ch.email) { const emails = [...new Set((await all('users')).map(x => x.email).filter(Boolean))]; sent.email = await sendEmails(emails, title, message); }
      if (ch.push) sent.push = await sendPush(await all('subs'), title, message);
      const rec = { id: crypto.randomUUID(), ts: Date.now(), title, message, channels: { app: !!ch.app, email: !!ch.email, push: !!ch.push }, sent };
      await put('bcs', rec.id, rec);
      return J({ ok: true, record: rec });
    }
    if (route === 'broadcasts' && m === 'DELETE') { await getStore('bcs').delete(clip(u.searchParams.get('id'), 60)); return J({ ok: true }); }
    if (route === 'pricing' && m === 'GET') return J(await getPricing());
    if (route === 'pricing' && m === 'POST') {
      const cl = a => (Array.isArray(a) ? a : []).slice(0, 60).map(x => ({ label: clip(x.label, 60).trim(), price: Math.round(Number(x.price)) })).filter(x => x.label && x.price > 0 && x.price <= 1e6);
      const cfg = { airtimeDiscount: Math.min(30, Math.max(0, Number(b.airtimeDiscount) || 0)), off: Object.fromEntries(['airtime', 'data', 'power', 'tv', 'exam'].map(k => [k, !!b.off?.[k]])), plans: { data: cl(b.plans?.data), tv: cl(b.plans?.tv), exam: cl(b.plans?.exam) } };
      await put('config', 'pricing', cfg); return J({ ok: true });
    }
    if (route === 'wallet' && m === 'GET') return J(await history(clip(u.searchParams.get('uid'), 120).toLowerCase()));
    if (route === 'wallet' && m === 'POST') {
      const uid = clip(b.uid, 120).toLowerCase(), amt = Math.round(Number(b.amount));
      if (uid.length < 5 || !amt || Math.abs(amt) > 1e7) return J({ error: 'Invalid amount' }, 400);
      const cur = await balanceOf(uid); if (cur + amt < 0) return J({ error: 'That would make the balance negative' }, 400);
      await put('ledger', hash(uid) + '/ADJ' + crypto.randomBytes(5).toString('hex'), { amount: amt, type: 'adjust', title: amt > 0 ? 'Wallet credit' : 'Wallet debit', sub: clip(b.note, 80) || 'Admin adjustment', ts: Date.now() });
      return J({ ok: true, balance: cur + amt });
    }
    if (route === 'users/suspend' && m === 'POST') {
      const id = clip(b.id, 120), usr = await getStore('users').get(hash(id), { type: 'json' }); if (!usr) return J({ error: 'User not found' }, 404);
      await put('users', hash(id), { ...usr, suspended: !!b.on }); return J({ ok: true });
    }
    if (route === 'users/resetpin' && m === 'POST') {
      const id = clip(b.id, 120), usr = await getStore('users').get(hash(id), { type: 'json' }); if (!usr) return J({ error: 'User not found' }, 404);
      const { pin, pinFails, pinLock, ...rest } = usr; await put('users', hash(id), rest); return J({ ok: true });
    }
    if (route === 'refund' && m === 'POST') {
      const ref = clip(b.ref, 30).replace(/[^A-Za-z0-9]/g, ''), t = await getStore('txs').get(hash(ref), { type: 'json' });
      if (!t) return J({ error: 'Transaction not found' }, 404); if (t.refunded) return J({ error: 'Already refunded' }, 400);
      await put('ledger', hash(t.uid) + '/R' + ref, { amount: t.amount, type: 'refund', title: 'Refund', sub: t.service, ref, ts: Date.now() });
      await put('txs', hash(ref), { ...t, refunded: true }); return J({ ok: true });
    }
    return J({ error: 'Not found' }, 404);
  } catch (e) { return J({ error: 'Server error' }, 500); }
};

export const config = { path: ['/api/register', '/api/push-sub', '/api/track', '/api/inbox', '/api/wallet', '/api/history', '/api/pin/*', '/api/auth/*', '/api/chat', '/api/pricing', '/api/paystack/*', '/api/admin/*'] };
