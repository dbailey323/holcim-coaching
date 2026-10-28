// Audits a call recording with Gemini, keeping the API key and prompt on the server.
// The browser drives three steps so recordings of any length stay under Vercel's 4.5 MB request limit:
//   POST ?step=start   {name, mimeType, size}  -> {session}  opens a resumable Gemini file upload
//   POST ?step=chunk&offset=N[&final=1]  raw bytes, X-Upload-Session header -> {file} on the final chunk
//   POST ?step=analyze {file}                  -> audit JSON; the uploaded file is deleted afterwards
import { handle, HttpError, json, requireEnv, seal, unseal, verifyUser } from './_lib/server.js';

const GEMINI = 'https://generativelanguage.googleapis.com';
const MAX_BYTES = 200 * 1024 * 1024;
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

const geminiError = async (res, what) => {
  let message = `${what} failed (${res.status})`;
  try { message = (await res.json()).error?.message || message; } catch { /* non-JSON body */ }
  return new HttpError(502, `Gemini: ${message}`);
};

const readJson = async (request) => {
  try { return await request.json(); } catch { throw new HttpError(400, 'Invalid JSON body'); }
};

const start = async (request, user) => {
  const { name, mimeType, size } = await readJson(request);
  const mime = MIME_ALIASES[mimeType] || mimeType;
  if (typeof mime !== 'string' || !mime.startsWith('audio/')) throw new HttpError(400, 'Please upload an audio file (WAV or MP3).');
  if (!Number.isInteger(size) || size <= 0 || size > MAX_BYTES) throw new HttpError(400, 'Recording must be under 200 MB.');

  const res = await fetch(`${GEMINI}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': requireEnv('GEMINI_API_KEY'),
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(size),
      'X-Goog-Upload-Header-Content-Type': mime,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: String(name || 'call-recording').slice(0, 100) } }),
  });
  if (!res.ok) throw await geminiError(res, 'Starting upload');
  const url = res.headers.get('x-goog-upload-url');
  if (!url) throw new HttpError(502, 'Gemini did not return an upload URL');
  return json({ session: seal(JSON.stringify({ url, size, uid: user.uid })) });
};

const chunk = async (request, user) => {
  const session = JSON.parse(unseal(request.headers.get('x-upload-session') || ''));
  if (session.uid !== user.uid) throw new HttpError(403, 'Upload session belongs to another user');

  const params = new URL(request.url).searchParams;
  const offset = Number(params.get('offset'));
  const final = params.get('final') === '1';
  const body = Buffer.from(await request.arrayBuffer());
  if (!Number.isInteger(offset) || offset < 0 || offset + body.length > session.size) throw new HttpError(400, 'Invalid chunk offset');
  if (final && offset + body.length !== session.size) throw new HttpError(400, 'Upload incomplete');

  const res = await fetch(session.url, {
    method: 'POST',
    headers: {
      'x-goog-api-key': requireEnv('GEMINI_API_KEY'),
      'X-Goog-Upload-Offset': String(offset),
      'X-Goog-Upload-Command': final ? 'upload, finalize' : 'upload',
    },
    body,
  });
  if (!res.ok) throw await geminiError(res, 'Uploading audio');
  if (!final) return json({ ok: true });

  const { file } = await res.json();
  if (!file?.name || !file?.uri) throw new HttpError(502, 'Gemini did not return the uploaded file');
  return json({ file: seal(JSON.stringify({ name: file.name, uri: file.uri, mimeType: file.mimeType, uid: user.uid })) });
};

const waitUntilActive = async (name, apiKey) => {
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`${GEMINI}/v1beta/${name}`, { headers: { 'x-goog-api-key': apiKey } });
    if (!res.ok) throw await geminiError(res, 'Checking upload');
    const { state } = await res.json();
    if (state === 'ACTIVE') return;
    if (state === 'FAILED') throw new HttpError(502, 'Gemini could not process this audio file');
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new HttpError(504, 'Gemini took too long to process the audio file');
};

const analyze = async (request, user) => {
  const { file: token } = await readJson(request);
  const file = JSON.parse(unseal(token || ''));
  if (file.uid !== user.uid) throw new HttpError(403, 'File belongs to another user');
  const apiKey = requireEnv('GEMINI_API_KEY');
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  try {
    await waitUntilActive(file.name, apiKey);
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
    if (!res.ok) throw await geminiError(res, 'Analysis');
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new HttpError(502, 'Invalid response format from Gemini API');
    try {
      return json(JSON.parse(text));
    } catch {
      throw new HttpError(502, 'Gemini returned malformed JSON. Please try again.');
    }
  } finally {
    // Recordings contain personal data; don't leave them in Gemini storage for the default 48 hours.
    await fetch(`${GEMINI}/v1beta/${file.name}`, { method: 'DELETE', headers: { 'x-goog-api-key': apiKey } }).catch(() => {});
  }
};

const STEPS = { start, chunk, analyze };

export default {
  fetch: handle(async (request) => {
    if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    const user = await verifyUser(request);
    const step = STEPS[new URL(request.url).searchParams.get('step')];
    if (!step) throw new HttpError(400, 'Unknown step');
    return step(request, user);
  }),
};
