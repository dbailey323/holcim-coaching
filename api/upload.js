// Issues presigned Vercel Blob upload URLs so the browser can upload recordings straight to the
// private Blob store, bypassing Vercel's 4.5 MB function request limit.
// Uses the store's OIDC credentials (BLOB_STORE_ID + BLOB_WEBHOOK_PUBLIC_KEY, added when the store is
// connected to the project). Signed-in users may only upload audio under recordings/<their uid>/.
import { issueSignedToken } from '@vercel/blob';
import { handleUploadPresigned } from '@vercel/blob/client';
import { handle, HttpError, json, requireEnv, verifyUser } from './_lib/server.js';

const MAX_RECORDING_BYTES = 200 * 1024 * 1024;
const UPLOAD_CONSTRAINTS = { allowedContentTypes: ['audio/*'], maximumSizeInBytes: MAX_RECORDING_BYTES };

export default {
  fetch: handle(async (request) => {
    if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    const user = await verifyUser(request);
    requireEnv('BLOB_STORE_ID');
    requireEnv('BLOB_WEBHOOK_PUBLIC_KEY');

    let body;
    try { body = await request.json(); } catch { throw new HttpError(400, 'Invalid JSON body'); }
    if (body?.type !== 'blob.generate-presigned-url') throw new HttpError(400, 'Unsupported upload event');

    try {
      return json(await handleUploadPresigned({
        body,
        request,
        // The browser picks a unique pathname; the token is scoped to exactly that path, put-only, 15 minutes.
        getSignedToken: async (pathname) => {
          if (!pathname.startsWith(`recordings/${user.uid}/`) || pathname.includes('..')) throw new HttpError(403, 'Invalid upload path');
          const token = await issueSignedToken({
            pathname,
            operations: ['put'],
            validUntil: Date.now() + 15 * 60 * 1000,
            ...UPLOAD_CONSTRAINTS,
          });
          return { token, urlOptions: UPLOAD_CONSTRAINTS };
        },
      }));
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(500, `Could not start upload: ${err.message}`);
    }
  }),
};
