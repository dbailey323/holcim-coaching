# Service Desk Call Coaching

Holcim UK service desk call-quality audits. A reviewer uploads a call recording, Google Gemini scores it against the 8-criteria coaching rubric, and the reviewer adjusts, saves (Firestore), exports (CSV) or prints the report.

- `src/App.jsx` – the React app (Vite + Tailwind)
- `api/analyze.js` – serverless function that uploads the recording to Gemini and runs the audit
- `api/users.js` – serverless function for admin-only user creation
- `firestore.rules` – Firestore security rules

The Gemini API key and the audit prompt live only on the server. Every API call requires a valid Firebase sign-in.

## Configuration

Set these in **Vercel → Project → Settings → Environment Variables** (server-side, no `VITE_` prefix):

| Variable | Description |
| --- | --- |
| `GEMINI_API_KEY` | Google AI Studio API key |
| `FIREBASE_SERVICE_ACCOUNT` | Full JSON of a Firebase service account key (Firebase console → Project settings → Service accounts → Generate new private key) |
| `ADMIN_EMAILS` | Comma-separated emails allowed to create users, e.g. `manager@holcim.com` |
| `GEMINI_MODEL` | Optional, defaults to `gemini-2.5-flash` |

Remove the old `VITE_GEMINI_API_KEY` variable: anything prefixed `VITE_` is published in the browser bundle. After removing it, rotate the key in Google AI Studio, because the old one has been public.

Optional: `VITE_MOCK_MODE=true` produces random scores without calling Gemini (demo only; mock results can't be saved).

## One-time Firebase setup

1. **Disable public sign-up:** Firebase console → Authentication → Settings → User actions → untick *Enable create (sign-up)*. Users are then created only by admins through the app.
2. **Deploy the Firestore rules:**
   ```bash
   npx firebase-tools deploy --only firestore:rules --project holcim-coaching
   ```

## Development

```bash
npm install
npx vercel dev   # runs the app and the /api functions together
```

`npm run dev` runs only the front end; analysis and user management need the `/api` functions, so use `vercel dev` with the variables above in `.env.local`.
