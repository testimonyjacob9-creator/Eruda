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

const wrap = (title, body) => `<div style="background:#f4f7ff;padding:24px;font-family:Arial,sans-serif"><div style="max-width:480px;margin:auto;background:#fff;border-radius:16px;overflow:hidden"><div style="background:linear-gradient(135deg,#0a2380,#2f6bff);color:#fff;padding:22px 24px"><b style="letter-spacing:3px;font-size:16px">ERUDITE EASY PAY</b></div><div style="padding:24px;color:#0b1b3f;line-height:1.6"><h2 style="margin:0 0 12px">${esc(title)}</h2>${body}</div><div style="padding:14px 24px;background:#eaf1ff;color:#64748b;font-size:12px">Erudite Easy Pay · Airtime, data and bills, instantly.</div></div></div>`;

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
        body: JSON.stringify({ sender: { name: E.SENDER_NAME || 'Erudite Easy Pay', email: E.SENDER_EMAIL }, subject: title, htmlContent: html, messageVersions: chunk.map(email => ({ to: [{ email }] })) })
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

const PS = 'https://api.paystack.co';
const ps = (path, o = {}) => fetch(PS + path, { ...o, headers: { Authorization: 'Bearer ' + E.PAYSTACK_SECRET_KEY, 'Content-Type': 'application/json' } }).then(r => r.json());
// wallet = sum of ledger entries (one key per entry, so crediting twice is harmless)
const balanceOf = async uid => { const s = getStore('ledger'); const { blobs } = await s.list({ prefix: hash(uid) + '/' }); const v = await Promise.all(blobs.map(x => s.get(x.key, { type: 'json' }))); return v.reduce((t, x) => t + (x?.amount || 0), 0); };
async function credit(ref) {
  const rec = await getStore('pay').get(hash(ref), { type: 'json' });
  if (!rec) return { ok: false, error: 'Unknown reference' };
  if (rec.status === 'success') return { ok: true, amount: rec.amount };
  const d = (await ps('/transaction/verify/' + encodeURIComponent(ref)))?.data;
  if (d?.status !== 'success') return { ok: false, status: d?.status || 'pending' };
  if (d.currency !== 'NGN' || d.amount !== rec.amount * 100) return { ok: false, error: 'Amount mismatch' };
  await put('ledger', hash(rec.uid) + '/' + ref, { amount: rec.amount, type: 'fund', ts: Date.now() });
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
      await put('users', hash(id), { id, name: clip(b.name, 60), email: EMAIL.test(b.email || '') ? clip(b.email, 120).toLowerCase() : '', joined: old?.joined || Date.now(), seen: Date.now() });
      return J({ ok: true });
    }
    if (p === 'push-sub' && m === 'POST') {
      if (!b.sub?.endpoint) return J({ error: 'Invalid' }, 400);
      await put('subs', hash(b.sub.endpoint), { sub: b.sub, uid: clip(b.uid, 120), ts: Date.now() });
      return J({ ok: true });
    }
    if (p === 'track' && m === 'POST') {
      const a = Number(b.amount), uid = clip(b.uid, 120).toLowerCase(), ref = clip(b.ref, 30).replace(/[^A-Za-z0-9]/g, '');
      if (!a || a < 0 || a > 1e7 || uid.length < 5 || !ref) return J({ error: 'Invalid' }, 400);
      const bal = await balanceOf(uid);
      if (a > bal) return J({ error: 'Insufficient balance. Please fund your wallet.', balance: bal }, 402);
      await put('ledger', hash(uid) + '/' + ref, { amount: -a, type: 'purchase', ts: Date.now() });
      await put('txs', hash(ref), { uid, service: clip(b.service, 80), recipient: clip(b.recipient, 40), amount: a, ref, ts: Date.now() });
      return J({ ok: true, balance: bal - a });
    }
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
      return J({ users: users.length, withEmail: users.filter(x => x.email).length, subs: subs.length, txCount: txs.length, revenue: txs.reduce((s, x) => s + x.amount, 0), funded: paid.reduce((s, x) => s + x.amount, 0), fundCount: paid.length, series, recentTx: txs.sort((a, c) => c.ts - a.ts).slice(0, 6), recentBc: bcs.sort((a, c) => c.ts - a.ts).slice(0, 5), status: { brevo: !!(E.BREVO_API_KEY && E.SENDER_EMAIL), vapid: !!E.VAPID_PRIVATE_KEY, paystack: !!E.PAYSTACK_SECRET_KEY, admin: !!E.ADMIN_PASSWORD, sender: E.SENDER_EMAIL || '' }, vapidPublic: VAPID_PUBLIC });
    }
    if (route === 'users' && m === 'GET') return J({ items: (await all('users')).sort((a, c) => c.joined - a.joined) });
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
    return J({ error: 'Not found' }, 404);
  } catch (e) { return J({ error: 'Server error' }, 500); }
};

export const config = { path: ['/api/register', '/api/push-sub', '/api/track', '/api/inbox', '/api/wallet', '/api/paystack/*', '/api/admin/*'] };
