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
