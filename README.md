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
