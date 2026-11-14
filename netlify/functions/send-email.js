// Brevo transactional email — API key stays server-side (Netlify env variable).
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hits = new Map(); // simple per-instance rate limit

const SITE = (process.env.SITE_URL || process.env.URL || 'https://eruditeeasypay.netlify.app').replace(/\/$/, '');
const wrap = (title, body) => `<div style="background:#f4f7ff;padding:24px;font-family:Arial,sans-serif"><div style="max-width:480px;margin:auto;background:#fff;border-radius:16px;overflow:hidden"><div style="background:#ffffff;padding:18px 24px;border-bottom:3px solid #1d4ed8;text-align:center"><img src="${SITE}/logo-email.png" alt="Erudite Easy Pay" width="180" style="max-width:180px;height:auto;display:inline-block"></div><div style="padding:24px;color:#0b1b3f;line-height:1.6"><h2 style="margin:0 0 12px">${title}</h2>${body}</div><div style="padding:14px 24px;background:#eaf1ff;color:#64748b;font-size:12px">Erudite Easy Pay · Pay Smart. Live Better.<br>You received this email because of activity on your Erudite Easy Pay account.</div></div></div>`;
const toText = h => String(h).replace(/<(br|\/p|\/h2|\/tr)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();

const templates = {
  welcome: d => ({
    subject: 'Your Erudite Easy Pay account is ready',
    html: wrap(`Hi ${esc(d.name || 'there')},`, `<p>Your Erudite Easy Pay account has been created.</p><p>To get started, add money to your wallet from the app, then you can buy airtime, data, electricity, cable TV and exam pins whenever you need them.</p><p style="color:#64748b;font-size:13px">If you did not create this account, just reply to this email and we will look into it.</p>`)
  }),
  receipt: d => ({
    subject: `Your receipt for ₦${Number(d.amount || 0).toLocaleString('en-NG')} (${String(d.ref || '').slice(0, 20)})`,
    html: wrap('Your receipt', `<p>Thanks for using Erudite Easy Pay. Here are the details of your purchase.</p><table style="width:100%;font-size:14px;border-collapse:collapse"><tr><td style="padding:8px 0;color:#64748b">Service</td><td align="right"><b>${esc(d.service)}</b></td></tr><tr><td style="padding:8px 0;color:#64748b">Recipient</td><td align="right"><b>${esc(d.recipient)}</b></td></tr><tr><td style="padding:8px 0;color:#64748b">Amount</td><td align="right"><b>₦${Number(d.amount || 0).toLocaleString('en-NG')}</b></td></tr><tr><td style="padding:8px 0;color:#64748b">Reference</td><td align="right"><b>${esc(d.ref)}</b></td></tr><tr><td style="padding:8px 0;color:#64748b">Status</td><td align="right"><b style="color:#16a34a">Successful</b></td></tr></table><p style="color:#64748b;font-size:13px">Need help with this order? Reply to this email and quote the reference above.</p>`)
  })
};

const reply = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  const { BREVO_API_KEY, SENDER_EMAIL, SENDER_NAME, ALLOWED_ORIGIN } = process.env;
  if (!BREVO_API_KEY || !SENDER_EMAIL) return reply(500, { error: 'Email is not configured' });

  const origin = event.headers.origin || event.headers.Origin;
  if (ALLOWED_ORIGIN && origin && !ALLOWED_ORIGIN.split(',').map(s => s.trim()).includes(origin)) return reply(403, { error: 'Forbidden' });

  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || 'x';
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 600000);
  if (list.length >= 10) return reply(429, { error: 'Too many requests' });
  hits.set(ip, [...list, now]);

  let b;
  try { if ((event.body || '').length > 5000) throw 0; b = JSON.parse(event.body); } catch { return reply(400, { error: 'Bad request' }); }
  if (!templates[b.type] || !EMAIL.test(b.to || '')) return reply(400, { error: 'Invalid type or email' });

  const t = templates[b.type](b.data || {});
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: { name: SENDER_NAME || 'Erudite Easy Pay', email: SENDER_EMAIL }, replyTo: { email: process.env.REPLY_TO || SENDER_EMAIL }, to: [{ email: b.to }], subject: t.subject, htmlContent: t.html, textContent: toText(t.html), tags: ['transactional'] })
    });
    if (!r.ok) return reply(502, { error: 'Brevo rejected the request', status: r.status });
    return reply(200, { ok: true });
  } catch { return reply(502, { error: 'Could not reach Brevo' }); }
};
