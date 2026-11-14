# Erudite Easy Pay

Mobile-first VTU platform UI (login, sign up, wallet, airtime, data, electricity, cable TV, exam pins). Blue and white theme with dark mode, installable as a PWA.

## Deploy to Netlify
1. Netlify → Add new site → Import from Git → choose this repo.
2. Build command: leave empty. Publish directory: `.`
3. Deploy.

## Next steps
Connect real auth (Firebase), your VTU provider API and Monnify for wallet funding. All data in this version is demo data.

## Brevo emails (welcome + payment receipts)
Add these in Netlify → Site configuration → Environment variables, then redeploy:
- `BREVO_API_KEY`: your Brevo API key (SMTP & API → API keys)
- `SENDER_EMAIL`: a sender verified in Brevo
- `SENDER_NAME`: optional
- `ALLOWED_ORIGIN`: optional, your site URL(s) to block other origins

The key never reaches the browser; the app calls `/api/email`, which runs `netlify/functions/send-email.js`.

## Admin panel
Open `/admin` on your site and sign in with `ADMIN_PASSWORD`. Dashboard, users, transactions, broadcast (in-app + email + push), message history and setup status. Data is stored in Netlify Blobs.

## Web push (VAPID)
The public key is hardcoded in `index.html` and `netlify/functions/api.mjs`. Add the matching private key as `VAPID_PRIVATE_KEY` in Netlify. Never commit the private key.

## Paystack (wallet funding)
Add `PAYSTACK_SECRET_KEY` in Netlify. In Paystack → Settings → API Keys & Webhooks, set the webhook URL to `https://YOUR-SITE/api/paystack/webhook`. Users pay via Paystack, the server verifies the payment and credits the wallet (also credited by webhook if the user closes the page).

## Pricing, wallet controls and history
- Admin → **Pricing**: edit data, TV and exam plans, airtime discount, and switch services on or off. The server charges from this config, not from what the app sends.
- Admin → **Users**: open a wallet (credit/debit with a note), suspend or activate, remove.
- Admin → **Transactions**: refund any purchase to the user's wallet (once only).
- App → **History**: synced from the server on any device; tap a row for a receipt you can download as an image.

## Transaction PIN
Users create a 4-digit PIN at sign-up (or on their first purchase if they signed up earlier) and enter it on a keypad to approve every purchase. PINs are stored hashed (scrypt), 5 wrong attempts lock the PIN for 15 minutes, and users can change it under Profile → Transaction PIN. Admin → Users → **Reset PIN** clears a forgotten PIN.

## Smart assistant
Chat button in the app (bottom-right). Powered by Claude through `/api/chat` using `ANTHROPIC_API_KEY` (optional `CHAT_MODEL`). It knows your live prices, service status and the user's balance, can't move money, and hands off to WhatsApp (`SUPPORT_WHATSAPP`) when it can't help. Without the key it falls back to a basic FAQ.

## Firebase Auth (email/password + Google)
The Firebase **web** config is hardcoded in `index.html` (it is public by design). Enable *Email/Password* and *Google* under Firebase → Authentication → Sign-in method, and add your site domain under Authentication → Settings → Authorized domains.
- **Forgot password**: `/api/auth/reset-password` generates the reset link with the Firebase Admin API and sends it through Brevo from your own domain (better inbox placement than Firebase's default sender). Falls back to Firebase's built-in email if the service account isn't set.
- **Forgot PIN**: user re-verifies with their password (or Google), then `/api/pin/reset` validates the Firebase ID token server-side (must be < 10 min old) and sets a new PIN.
- Netlify env var `FIREBASE_SERVICE_ACCOUNT`: paste the **entire service-account JSON**. Never commit this file or put it in client code.
- Optional env vars: `SITE_URL` (used for email logo/links), `REPLY_TO`.

## Email deliverability checklist
Code already sends a plain-text part, reply-to, and clean templates. The rest is DNS (do this in your domain registrar + Brevo → Senders, Domains):
1. Send from an address **on your own domain** (not gmail/yahoo) and authenticate the domain in Brevo.
2. Add Brevo's **DKIM** and **SPF** records, plus a **DMARC** record (`v=DMARC1; p=none; rua=mailto:you@yourdomain`).
3. Warm up gradually; avoid ALL-CAPS/“free”/“!!!” in broadcast subjects.

## Branding
`logo.jpg` (source), `og-image.jpg` (1200×630 link preview for WhatsApp etc.), `icon-192/512.png`, `apple-touch-icon.png`, `favicon.png`, `logo-email.png`. If your live URL differs from `https://eruditeeasypay.netlify.app`, search/replace it in `index.html` (OG tags, canonical).
