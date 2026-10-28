// Issues Vercel Blob client-upload tokens so the browser can upload recordings straight to the
// private Blob store, bypassing Vercel's 4.5 MB function request limit.
// Signed-in users may only upload audio under recordings/<their uid>/.
import { handleUpload } from '@vercel/blob/client';
import { handle, HttpError, json, verifyUser } from './_lib/server.js';

const MAX_RECORDING_BYTES = 200 * 1024 * 1024;

export default {
  fetch: handle(async (request) => {
    if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    const user = await verifyUser(request);

    let body;
    try { body = await request.json(); } catch { throw new HttpError(400, 'Invalid JSON body'); }
    if (body?.type !== 'blob.generate-client-token') throw new HttpError(400, 'Unsupported upload event');

    try {
      return json(await handleUpload({
        body,
        request,
        onBeforeGenerateToken: async (pathname) => {
          if (!pathname.startsWith(`recordings/${user.uid}/`)) throw new HttpError(403, 'Invalid upload path');
          return {
            allowedContentTypes: ['audio/*'],
            maximumSizeInBytes: MAX_RECORDING_BYTES,
            addRandomSuffix: true,
          };
        },
      }));
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, `Upload not allowed: ${err.message}`);
    }
  }),
};
