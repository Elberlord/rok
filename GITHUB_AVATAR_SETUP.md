# ROK Avatar Generator — prueba con GitHub Actions

Esta variante NO usa Firebase Storage ni Cloudflare.

## Flujo
1. El navegador reduce la foto a un JPEG de hasta 1024 px y la guarda temporalmente como Base64 dentro de `avatarJobs/{uid}/{jobId}` en Firebase Realtime Database.
2. GitHub Actions revisa la cola cada 5 minutos (también se puede ejecutar manualmente con **Run workflow**).
3. El Action usa OpenAI GPT Image 1 con alta fidelidad de la imagen de referencia y salida PNG transparente.
4. El PNG final se guarda en `rock_html_base/assets/user-kasters/{uid}/caster.png`.
5. El Action actualiza `resultUrl` en Firebase y elimina la foto Base64 original del job.
6. ROK recibe la URL y permite usarla como avatar y como arte del Kaster dentro de la partida.

## ÚNICA CONFIGURACIÓN MANUAL
En GitHub, abre **Settings → Secrets and variables → Actions** y crea dos Repository secrets:

- `OPENAI_API_KEY`: tu API key de OpenAI.
- `FIREBASE_SERVICE_ACCOUNT_JSON`: pega completo el JSON de la cuenta de servicio de Firebase (Firebase Console → Project settings → Service accounts → Generate new private key).

Luego ve a **Settings → Actions → General → Workflow permissions** y habilita **Read and write permissions** si tu repositorio lo tiene en solo lectura. El workflow también declara `contents: write`.

No necesitas crear un token personal de GitHub: Actions recibe `GITHUB_TOKEN` automáticamente.

## Para probar sin esperar
GitHub → Actions → `ROK Caster Avatar Worker` → `Run workflow`.

Para funcionamiento automático, el workflow revisa la cola cada 5 minutos.

## Nota
La URL `raw.githubusercontent.com` requiere que el repositorio sea público para que el juego pueda cargar el avatar sin autenticación. Esto es una solución de prototipo.
