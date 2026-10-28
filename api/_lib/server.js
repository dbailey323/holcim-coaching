// Shared helpers for the Vercel serverless functions. Files in api/_lib are not exposed as routes.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const json = (body, status = 200) => Response.json(body, { status });

// Wraps a handler so thrown HttpErrors become JSON error responses.
export const handle = (fn) => async (request) => {
  try {
    return await fn(request);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: 'Internal server error' }, 500);
  }
};

export const requireEnv = (key) => {
  const value = process.env[key];
  if (!value) throw new HttpError(500, `Server misconfigured: ${key} is not set`);
  return value;
};

const adminAuth = () => {
  if (!getApps().length) {
    initializeApp({ credential: cert(JSON.parse(requireEnv('FIREBASE_SERVICE_ACCOUNT'))) });
  }
  return getAuth();
};

// Verifies the Firebase ID token sent as "Authorization: Bearer <token>".
export const verifyUser = async (request) => {
  const match = /^Bearer (.+)$/.exec(request.headers.get('authorization') || '');
  if (!match) throw new HttpError(401, 'Not signed in');
  try {
    return await adminAuth().verifyIdToken(match[1]);
  } catch {
    throw new HttpError(401, 'Session expired. Please sign in again.');
  }
};

export const isAdmin = (user) => {
  const admins = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return !!user.email && user.email_verified !== false && admins.includes(user.email.toLowerCase());
};

export const createUser = (email, password) => adminAuth().createUser({ email, password });

// AES-GCM so values handed to the browser (e.g. Gemini upload URLs) are opaque and tamper-proof.
const sealKey = () => createHash('sha256').update(`seal:${requireEnv('GEMINI_API_KEY')}`).digest();

export const seal = (text) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sealKey(), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
};

export const unseal = (token) => {
  try {
    const buf = Buffer.from(token, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', sealKey(), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    throw new HttpError(400, 'Invalid upload session');
  }
};
