# Service Desk Call Coaching

Holcim UK service desk call-quality audits. A reviewer uploads a call recording, Google Gemini scores it against the 8-criteria coaching rubric, and the reviewer adjusts the scores, agrees an action plan, then saves (Firestore), exports (CSV) or prints the report. Saved audits feed a team analytics dashboard.

Hosted on **Vercel** (front end and serverless functions), with **Firebase** for sign-in and the audit database, **Vercel Blob** for temporary recording storage and the **Gemini API** for analysis.

## How an audit runs

1. The reviewer signs in with Firebase email/password.
2. The browser asks `/api/upload` for a presigned upload URL, then uploads the recording straight to the **private** Blob store. This avoids Vercel's 4.5 MB function request limit, so calls of any length work (up to 200 MB).
3. The browser calls `/api/analyze`. The function reads the recording from Blob, hands it to the Gemini Files API, runs the audit prompt and returns the scores.
4. Both copies of the recording (Blob and Gemini) are deleted as soon as the audit finishes or fails. Only the report is kept, and only if the reviewer saves it.

The Gemini API key and the audit prompt never reach the browser. Every `/api` call requires a valid Firebase sign-in.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/App.jsx` | The React app (Vite + Tailwind): upload, report, saved audits, analytics, user management |
| `api/upload.js` | Issues presigned Blob upload URLs: put-only, scoped to `recordings/<uid>/<file>`, audio only, 200 MB, 15 minutes |
| `api/analyze.js` | Runs the Gemini audit (prompt and model live here) and deletes the recording |
| `api/users.js` | Admin check and admin-only user creation |
| `api/_lib/server.js` | Shared helpers: Firebase token verification, admin list, errors |
| `firestore.rules` | Firestore security rules (`firebase.json` points at them) |
| `public/` | `logo.svg` (header and login), `favicon.svg`, `favicon-32.png`, `apple-touch-icon.png` |

## Setup

### 1. Vercel Blob store

Vercel → project → **Storage** → **Create Database** → **Blob** → choose **Private** → connect it to the project for **Production** (and **Preview** if you want previews to work). This adds `BLOB_STORE_ID` and `BLOB_WEBHOOK_PUBLIC_KEY` automatically. The functions authenticate with the project's OIDC token, so no `BLOB_READ_WRITE_TOKEN` is needed.

### 2. Environment variables

Vercel → project → **Settings → Environment Variables**:

| Variable | Required | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes | Google AI Studio API key |
| `FIREBASE_SERVICE_ACCOUNT` | Yes | Full JSON of a Firebase service account key: Firebase console → **Project settings → Service accounts → Generate new private key**. Paste the whole file contents. |
| `ADMIN_EMAILS` | Yes | Comma-separated emails that can create users, e.g. `manager@holcim.com,lead@holcim.com`. Matching ignores case. |
| `GEMINI_MODEL` | No | Overrides the model, default `gemini-3.8-flash`. Use it if Google retires a model before the code is updated. |
| `VITE_MOCK_MODE` | No | `true` gives random scores without calling Gemini (demo only; mock results can't be saved). Never set it in Production. |

- **Which deployments get them:** a variable only applies to the environments ticked when it's added. If they are set for **Production** only, preview deployments can sign in but can't run audits or manage users. Tick **Preview** as well if you want to test pull requests end to end.
- **Redeploy after any change:** variables take effect on the next deployment (**Deployments → … → Redeploy**).
- **Never put secrets in `VITE_` variables:** anything prefixed `VITE_` is built into the public JavaScript.

### 3. Firebase

1. **Deploy the Firestore rules.** Signed-in users can read and create audits, `createdBy` must be the caller's own email, and saved audits can't be edited or deleted from the app. Paste `firestore.rules` into Firebase console → **Firestore → Rules** and publish, or run:
   ```bash
   npx firebase-tools deploy --only firestore:rules --project holcim-coaching
   ```
2. **Disable public sign-up:** Firebase console → **Authentication → Settings → User actions** → untick **Enable create (sign-up)**. Accounts are then created only by admins.
3. **First admin:** create your own account in Firebase console → **Authentication → Users → Add user**, and add that email to `ADMIN_EMAILS`. After that, admins add everyone else from the app.

## Managing users

Admins (emails in `ADMIN_EMAILS`) see a **people icon** in the header. It creates an account with a temporary password to pass on to the new user. The server enforces the admin check, not just the button. Email verification is not required.

## Development

```bash
npm install
```

Analysis and user management run in the `/api` functions, which plain `npm run dev` (Vite only) doesn't serve. Use the Vercel CLI to run the app and functions together:

```bash
npx vercel link
```

```bash
npx vercel env pull .env.local
```

```bash
npx vercel dev
```

`vercel env pull` fetches the **Development** environment's variables, including a short-lived `VERCEL_OIDC_TOKEN` that the Blob calls need, so add the variables above to the Development environment too. Pull again when the token expires (about 12 hours). `.env.local` is git-ignored.

Other commands:

```bash
npm run lint
```

```bash
npm run build
```

Opening a pull request builds a Vercel preview automatically; merging to `main` deploys production.

## Troubleshooting

The app shows the server's error message. Common ones:

| Message | Cause and fix |
| --- | --- |
| `Server misconfigured: X is not set` | Variable `X` is missing for this deployment's environment. Add it, then redeploy. |
| `Server misconfigured: BLOB_STORE_ID is not set` | Blob store not connected to this environment (setup step 1), or not redeployed since. |
| `Session expired. Please sign in again.` | The Firebase sign-in token was rejected. Sign out and in. If it keeps happening, check `FIREBASE_SERVICE_ACCOUNT` is the full JSON for project `holcim-coaching`. |
| `Gemini: analysis failed (404): This model … is no longer available` | Google retired the model. Set `GEMINI_MODEL` to the model the message names and redeploy, then update the default in `api/analyze.js`. |
| `Gemini: … (400/403)` with an API key message | `GEMINI_API_KEY` is wrong, revoked or over quota. Check it in Google AI Studio. |
| `Failed to save report` | Firestore rules rejected the write. Check the published rules match `firestore.rules`. |
| No people (Manage Users) icon | Your sign-in email isn't in `ADMIN_EMAILS` for this environment, or the deployment predates the change. |
| Old icon in the browser tab | Favicons are cached hard; use a hard refresh (Ctrl+Shift+R). |

Function logs are in Vercel → project → **Logs**. Gemini failures are logged with Gemini's full response.
