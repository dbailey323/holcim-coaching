// Audits a call recording with Gemini, keeping the API key and prompt on the server.
// The browser first uploads the recording to the private Vercel Blob store (see api/upload.js), then
// POSTs {pathname} here. This function hands the whole file to the Gemini Files API in one request,
// runs the audit, and deletes both copies of the recording.
import { del, get } from '@vercel/blob';
import { handle, HttpError, json, requireEnv, verifyUser } from './_lib/server.js';

const GEMINI = 'https://generativelanguage.googleapis.com';
const MIME_ALIASES = { 'audio/mpeg': 'audio/mp3', 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav', 'audio/vnd.wave': 'audio/wav' };

const SYSTEM_PROMPT = `
You are a supportive and detail-oriented Quality Assurance Coach for Holcim UK Service Desk. Your task is to audit a call recording against the "Call Quality Monitoring Best Practices Policy" with a focus on constructive feedback and agent development.

### COACHING GUIDELINES:
1. **BE BALANCED & OBJECTIVE**: Evaluate performance fairly. If an agent does a great job, reward them with a high score (5). If they struggle, score accurately but frame the feedback constructively.
2. **GROWTH MINDSET**: When noting errors, focus on the "Coaching Opportunity." Explain *how* to improve rather than just stating what went wrong.
3. **EVIDENCE-BASED**: You MUST cite specific timestamps for both praise and constructive feedback (e.g., "[01:15] Great clear explanation", "[02:30] Opportunity to use the customer's name").
4. **PROFESSIONAL TONE**: Write the narrative as if you are speaking directly to a colleague you want to see succeed. Avoid harsh or punitive language.
5. **OUTPUT JSON**: You must output ONLY valid JSON.

### HOLD PROCEDURE SPECIFICS:
- **Hold Music Detected**: Score this section if music is heard. Look for: Permission asked, waiting for an answer, and thanking the user upon return.
- **Dead Air/Silence**: If the agent is silent while working (no music), mark "hold_na": true. You may gently note long silences in the comments as a coaching tip (e.g., "At [02:30], narrating your actions would fill the silence better").
- **No Hold Used**: If no hold music is used, set "hold_na": true.

### SCORING MATRIX (0-5):
- **5 (Exceeds Expectations)**: Flawless execution, warm tone, proactive.
- **3-4 (Meets Expectations)**: Good standard service, minor polish needed.
- **0-2 (Needs Improvement)**: Critical steps missed or negative behavior.

### CATEGORIES:
1. **Greeting & Introduction (5%)**
2. **Communication Style (10%)**
3. **Issue Handling & Clarity (20%)**
4. **Hold Procedure (10%)** - See specific logic above.
5. **Professionalism & Empathy (15%)**
6. **Resolution & Next Steps (15%)**
7. **Call Closure (5%)**
8. **Compliance & System Use (20%)**

### OUTPUT FORMAT (JSON ONLY):
{
  "scores": { "greeting": 0-5, "comm_style": 0-5, "issue_handling": 0-5, "hold_proc": 0-5, "prof_empathy": 0-5, "resolution": 0-5, "closure": 0-5, "compliance": 0-5 },
  "comments": { "greeting": "string", "comm_style": "string", ... },
  "hold_na": boolean,
  "executive_summary": "string",
  "detailed_strengths": ["string"],
  "detailed_improvements": ["string"]
}
`;

// Gemini's upload server answers errors in plain text, its API in JSON; surface either.
const geminiError = async (res, what) => {
  const text = await res.text().catch(() => '');
  let message;
  try { message = JSON.parse(text).error?.message; } catch { /* plain-text body */ }
  message = message || text.trim().slice(0, 300) || `HTTP ${res.status}`;
  console.error(`Gemini ${what} failed (${res.status}): ${text.slice(0, 1000)}`);
  return new HttpError(502, `Gemini: ${what} failed (${res.status}): ${message}`);
};

const uploadToGemini = async (audio, mimeType, displayName, apiKey) => {
  const startRes = await fetch(`${GEMINI}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(audio.length),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
  });
  if (!startRes.ok) throw await geminiError(startRes, 'starting upload');
  const uploadUrl = startRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new HttpError(502, 'Gemini did not return an upload URL');

  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: audio,
  });
  if (!res.ok) throw await geminiError(res, 'uploading audio');
  const { file } = await res.json();
  if (!file?.name || !file?.uri) throw new HttpError(502, 'Gemini did not return the uploaded file');
  return file;
};

const waitUntilActive = async (name, apiKey) => {
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`${GEMINI}/v1beta/${name}`, { headers: { 'x-goog-api-key': apiKey } });
    if (!res.ok) throw await geminiError(res, 'checking upload');
    const { state } = await res.json();
    if (state === 'ACTIVE') return;
    if (state === 'FAILED') throw new HttpError(502, 'Gemini could not process this audio file');
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new HttpError(504, 'Gemini took too long to process the audio file');
};

const runAudit = async (file, apiKey) => {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const res = await fetch(`${GEMINI}/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: `${SYSTEM_PROMPT}\n\nPlease audit this call recording provided in the audio attachment based on the strict policy above.` },
          { file_data: { mime_type: file.mimeType, file_uri: file.uri } },
        ],
      }],
      generationConfig: { response_mime_type: 'application/json' },
    }),
  });
  if (!res.ok) throw await geminiError(res, 'analysis');
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new HttpError(502, 'Invalid response format from Gemini API');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(502, 'Gemini returned malformed JSON. Please try again.');
  }
};

export default {
  fetch: handle(async (request) => {
    if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    const user = await verifyUser(request);
    let body;
    try { body = await request.json(); } catch { throw new HttpError(400, 'Invalid JSON body'); }
    const pathname = String(body?.pathname || '');
    if (!pathname.startsWith(`recordings/${user.uid}/`) || pathname.includes('..')) throw new HttpError(403, 'Invalid recording');
    const apiKey = requireEnv('GEMINI_API_KEY');

    const blob = await get(pathname, { access: 'private' });
    if (blob?.statusCode !== 200) throw new HttpError(404, 'Uploaded recording not found. Please upload it again.');

    let geminiFile;
    try {
      const audio = Buffer.from(await new Response(blob.stream).arrayBuffer());
      const mimeType = MIME_ALIASES[blob.blob.contentType] || blob.blob.contentType;
      geminiFile = await uploadToGemini(audio, mimeType, pathname.split('/').pop().slice(0, 100), apiKey);
      await waitUntilActive(geminiFile.name, apiKey);
      return json(await runAudit(geminiFile, apiKey));
    } finally {
      // Recordings contain personal data: remove both copies as soon as the audit is done (or has failed).
      await del(blob.blob.url).catch(err => console.error('Blob delete failed', err));
      if (geminiFile) {
        await fetch(`${GEMINI}/v1beta/${geminiFile.name}`, { method: 'DELETE', headers: { 'x-goog-api-key': apiKey } })
          .catch(err => console.error('Gemini file delete failed', err));
      }
    }
  }),
};
