// User management. Only emails listed in the ADMIN_EMAILS env var may create accounts.
//   GET  -> {isAdmin}
//   POST {email, password} -> {uid, email}
import { createUser, handle, HttpError, isAdmin, json, verifyUser } from './_lib/server.js';

const getStatus = async (request) => {
  const user = await verifyUser(request);
  return json({ isAdmin: isAdmin(user) });
};

const create = async (request) => {
  const user = await verifyUser(request);
  if (!isAdmin(user)) throw new HttpError(403, 'Only administrators can create users.');

  let body;
  try { body = await request.json(); } catch { throw new HttpError(400, 'Invalid JSON body'); }
  const email = String(body.email || '').trim();
  const password = String(body.password || '');
  if (!email || password.length < 6) throw new HttpError(400, 'Enter an email and a password of at least 6 characters.');

  try {
    const created = await createUser(email, password);
    return json({ uid: created.uid, email: created.email });
  } catch (err) {
    if (err.code?.startsWith('auth/')) throw new HttpError(400, err.message);
    throw err;
  }
};

export default {
  fetch: handle(async (request) => {
    if (request.method === 'GET') return getStatus(request);
    if (request.method === 'POST') return create(request);
    throw new HttpError(405, 'Method not allowed');
  }),
};
