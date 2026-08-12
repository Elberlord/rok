# R.O.K Lite · Caster Avatar Worker

Backend para procesar solicitudes creadas por el cliente en:

`/avatarJobs/{uid}/{jobId}`

Flujo:
1. El cliente autenticado sube su foto a Firebase Storage.
2. El cliente crea un job `queued` en Realtime Database.
3. `processCasterAvatarJob` cambia el estado a `processing`.
4. El worker usa la foto como referencia de identidad y genera el arte del Kaster.
5. El PNG resultante se guarda en `casterAvatarResults/{uid}/{jobId}/caster.png`.
6. El job se marca `completed` con `resultUrl`.
7. El usuario decide si quiere usar ese resultado como avatar de cuenta.
8. Tras una generación real exitosa, el worker elimina la foto fuente.

## Despliegue

Este directorio es código de Firebase Functions. Debe incorporarse al proyecto Firebase real antes de desplegarse.
Configura el secreto `OPENAI_API_KEY` usando Firebase Functions Secrets y despliega `processCasterAvatarJob`.

## Prueba sin IA

Hay dos modos de prueba de cableado:

- Cliente: abre el juego con `?avatarMock=1`. La foto subida se usa temporalmente como resultado para validar UI + Storage + RTDB + selección de avatar. No genera arte.
- Worker: establece `ROK_AVATAR_MOCK=1` en un entorno de prueba. El worker copia la fuente al resultado. No llama a OpenAI.

No uses los modos mock como experiencia de producción.
