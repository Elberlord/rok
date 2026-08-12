import fs from 'node:fs/promises';
import path from 'node:path';
import OpenAI, { toFile } from 'openai';
import admin from 'firebase-admin';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
if (!serviceAccount.project_id) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON secret.');
if (!process.env.OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY secret.');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});
const db = admin.database();
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pendingFile = '.github/avatar-worker-pending.json';
const outputRoot = path.join('rock_html_base', 'assets', 'user-kasters');

const PROMPT = `Use the uploaded photograph only as the identity reference for the person. Create that same person as a human Kaster from the R.O.K. universe: premium artistic medieval-fantasy character illustration, coherent with a tactical elemental-magic card game. Preserve recognizable facial identity, apparent age, skin tone, hairstyle and key facial characteristics. Full body from head to feet, natural heroic stance, detailed layered fantasy clothing and practical arcane equipment. Neutral caster design rather than a specific elemental allegiance. Transparent background. No scenery, no frame, no card border, no text, no logos, no pedestal, no platform, no cropped feet, and no extra people. The result must work both as the player's profile avatar and as the player's Kaster art/token inside a match.`;

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) throw new Error('Invalid sourceImageData.');
  return { mime: match[1], buffer: Buffer.from(match[2], 'base64') };
}

const snap = await db.ref('avatarJobs').once('value');
const tree = snap.val() || {};
const candidates = [];
for (const [uid, jobs] of Object.entries(tree)) {
  for (const [jobId, job] of Object.entries(jobs || {})) {
    if (job?.status === 'queued' && job?.sourceImageData) candidates.push({ uid, jobId, job });
  }
}
candidates.sort((a,b) => Number(a.job.createdAt||0)-Number(b.job.createdAt||0));
const selected = candidates.slice(0, 2);
const pending = [];
await fs.mkdir(outputRoot, { recursive: true });

for (const entry of selected) {
  const ref = db.ref(`avatarJobs/${entry.uid}/${entry.jobId}`);
  try {
    await ref.update({ status: 'processing', updatedAt: Date.now(), errorMessage: null });
    const { mime, buffer } = parseDataUrl(entry.job.sourceImageData);
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
    const input = await toFile(buffer, `reference.${ext}`, { type: mime });
    const response = await client.images.edit({
      model: 'gpt-image-1',
      image: input,
      prompt: PROMPT,
      input_fidelity: 'high',
      size: '1024x1536',
      quality: 'high',
      background: 'transparent',
      output_format: 'png',
    });
    const b64 = response?.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI returned no image data.');
    const userDir = path.join(outputRoot, entry.uid);
    await fs.mkdir(userDir, { recursive: true });
    const relativePath = path.posix.join('rock_html_base','assets','user-kasters',entry.uid,'caster.png');
    await fs.writeFile(path.join(userDir, 'caster.png'), Buffer.from(b64, 'base64'));
    pending.push({ uid: entry.uid, jobId: entry.jobId, relativePath });
    await ref.update({ generatedPath: relativePath, updatedAt: Date.now() });
  } catch (error) {
    await ref.update({
      status: 'failed',
      errorMessage: String(error?.message || error).slice(0, 800),
      sourceImageData: null,
      updatedAt: Date.now(),
    });
  }
}
await fs.writeFile(pendingFile, JSON.stringify(pending, null, 2));
console.log(`Processed ${selected.length} queued avatar job(s).`);
