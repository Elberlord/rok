'use strict';

const crypto = require('node:crypto');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { getStorage } = require('firebase-admin/storage');
const { onValueCreated } = require('firebase-functions/v2/database');
const OpenAI = require('openai');

initializeApp();

const AVATAR_PROMPT = `
Use the uploaded photo strictly as the identity reference for the person.
Create a R.O.K Lite player Caster avatar: the same person reimagined as a fantasy-medieval magical adventurer suitable for a collectible game card.
Preserve recognizable facial identity, skin tone, hair, apparent age, and major facial characteristics. Do not beautify into a different person.
The character must feel coherent with The Rise of the Kasters: practical medieval-fantasy clothing, subtle arcane details, layered fabrics, leather accessories, and restrained magical ornamentation.
Do not assign a specific elemental domain, faction, class, weapon specialty, or gameplay ability. The player's gameplay kit is defined separately by the game.
Full character illustration, centered, readable silhouette, clear full body, suitable both for profile avatar use and for the player's in-match caster representation or token art.
No pedestal, no scenery, no frame, no text, no logos, no UI, no extra characters.
Transparent background. High-detail fantasy game illustration, polished but not photorealistic statue rendering.
`.trim();

function makeDownloadUrl(bucketName, filePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}

exports.processCasterAvatarJob = onValueCreated({
  ref: '/avatarJobs/{uid}/{jobId}',
  region: 'us-central1',
  timeoutSeconds: 540,
  memory: '1GiB',
  secrets: ['OPENAI_API_KEY'],
}, async (event) => {
  const uid = String(event.params.uid || '');
  const jobId = String(event.params.jobId || '');
  const job = event.data.val() || {};
  if (!uid || !jobId || job.status !== 'queued' || !job.sourcePath) return;

  const db = getDatabase();
  const jobRef = db.ref(`avatarJobs/${uid}/${jobId}`);
  const bucket = getStorage().bucket();
  const sourcePath = String(job.sourcePath || '');
  const resultPath = `casterAvatarResults/${uid}/${jobId}/caster.png`;

  await jobRef.update({ status: 'processing', startedAt: Date.now(), updatedAt: Date.now() });

  try {
    const [sourceBuffer] = await bucket.file(sourcePath).download();

    // Pipeline-only smoke mode. This is intentionally NOT an AI generation.
    // Set ROK_AVATAR_MOCK=1 only while validating Firebase queue/storage wiring.
    if (process.env.ROK_AVATAR_MOCK === '1') {
      const token = crypto.randomUUID();
      await bucket.file(resultPath).save(sourceBuffer, {
        resumable: false,
        metadata: {
          contentType: String(job.sourceContentType || 'image/png'),
          metadata: { firebaseStorageDownloadTokens: token, mock: '1' },
        },
      });
      const resultUrl = makeDownloadUrl(bucket.name, resultPath, token);
      await jobRef.update({ status: 'completed', resultPath, resultUrl, mock: true, completedAt: Date.now(), updatedAt: Date.now() });
      return;
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const image = new File([sourceBuffer], 'caster-source.png', {
      type: String(job.sourceContentType || 'image/png'),
    });

    const response = await openai.images.edit({
      model: 'gpt-image-1',
      image,
      prompt: AVATAR_PROMPT,
      size: '1024x1536',
      quality: 'high',
      background: 'transparent',
      input_fidelity: 'high',
    });

    const b64 = response?.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI no devolvió datos de imagen.');
    const outputBuffer = Buffer.from(b64, 'base64');
    const token = crypto.randomUUID();

    await bucket.file(resultPath).save(outputBuffer, {
      resumable: false,
      metadata: {
        contentType: 'image/png',
        cacheControl: 'private,max-age=3600',
        metadata: { firebaseStorageDownloadTokens: token, ownerUid: uid, jobId },
      },
    });

    const resultUrl = makeDownloadUrl(bucket.name, resultPath, token);
    await jobRef.update({
      status: 'completed',
      resultPath,
      resultUrl,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });

    // The source photo is no longer needed after a successful generation.
    try { await bucket.file(sourcePath).delete({ ignoreNotFound: true }); } catch (_) {}
  } catch (error) {
    console.error('[ROK Caster Avatar] generation failed', { uid, jobId, error });
    await jobRef.update({
      status: 'failed',
      errorCode: String(error?.code || 'avatar-generation-failed').slice(0, 120),
      errorMessage: String(error?.message || 'No se pudo generar el avatar.').slice(0, 300),
      updatedAt: Date.now(),
    });
  }
});

exports.AVATAR_PROMPT = AVATAR_PROMPT;
