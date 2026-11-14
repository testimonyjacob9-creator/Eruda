// Brevo transactional email — API key stays server-side (Netlify env variable).
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hits = new Map(); // simple per-instance rate limit

const wrap = (title, body) => `<div style="background:#f4f7ff;padding:24px;font-family:Arial,sans-serif"><div style="max-width:480px;margin:auto;background:#fff;border-radius:16px;overflow:hidden"><div style="background:linear-gradient(135deg,#0a2380,#2f6bff);color:#fff;padding:22px 24px"><b style="letter-spacing:3px;font-size:16px">ERUDITE EASY PAY</b></div><div style="padding:24px;color:#0b1b3f;line-height:1.6"><h2 style="margin:0 0 12px">${title}</h2>${body}</div><div style="padding:14px 24px;background:#eaf1ff;color:#64748b;font-size:12px">Erudite Easy Pay · Airtime, data and bills, instantly.</div></div></div>`;

const templates = {
  welcome: d => ({
    subject: 'Welcome to Erudite Easy Pay',
    html: wrap(`Welcome, ${esc(d.name || 'there')}!`, `<p>Your account is ready. Fund your wallet and start buying airtime, data, electricity, cable TV and exam pins in seconds.</p><p style="color:#64748b;font-size:13px">If you didn’t create this account, you can ignore this email.</p>`)
  }),
  receipt: d => ({
    subject: `Payment successful · ₦${Number(d.amount || 0).toLocaleString('en-NG')}`,
    html: wrap('Payment successful', `<table style="width:100%;font-size:14px;border-collapse:collapse"><tr><td style="padding:8px 0;color:#64748b">Service</td><td align="right"><b>${esc(d.service)}</b></td></tr><tr><td style="padding:8px 0;color:#64748b">Recipient</td><td align="right"><b>${esc(d.recipient)}</b></td></tr><tr><td style="padding:8px 0;color:#64748b">Amount</td><td align="right"><b>₦${Number(d.amount || 0).toLocaleString('en-NG')}</b></td></tr><tr><td style="padding:8px 0;color:#64748b">Reference</td><td align="right"><b>${esc(d.ref)}</b></td></tr><tr><td style="padding:8px 0;color:#64748b">Status</td><td align="right"><b style="color:#16a34a">Successful</b></td></tr></table>`)
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
      body: JSON.stringify({ sender: { name: SENDER_NAME || 'Erudite Easy Pay', email: SENDER_EMAIL }, to: [{ email: b.to }], subject: t.subject, htmlContent: t.html })
    });
    if (!r.ok) return reply(502, { error: 'Brevo rejected the request', status: r.status });
    return reply(200, { ok: true });
  } catch { return reply(502, { error: 'Could not reach Brevo' }); }
};
