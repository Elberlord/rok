import fs from 'node:fs/promises';
import admin from 'firebase-admin';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
if (!serviceAccount.project_id) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON secret.');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
}, 'finalizer');

const app = admin.app('finalizer');
const db = app.database();

try {
  let pending = [];
  try {
    pending = JSON.parse(await fs.readFile('.github/avatar-worker-pending.json', 'utf8'));
  } catch (_) {}

  const repo = process.env.GITHUB_REPOSITORY || '';
  const branch = process.env.GITHUB_REF_NAME || 'main';

  for (const item of pending) {
    const resultUrl = `https://raw.githubusercontent.com/${repo}/${branch}/${item.relativePath}`;
    await db.ref(`avatarJobs/${item.uid}/${item.jobId}`).update({
      status: 'completed',
      resultUrl,
      completedAt: Date.now(),
      updatedAt: Date.now(),
      sourceImageData: null,
    });
    console.log(`Published completed avatar URL for job ${item.jobId}.`);
  }

  console.log(`Finalized ${pending.length} avatar job(s).`);
} finally {
  try { await app.delete(); } catch (_) {}
}
