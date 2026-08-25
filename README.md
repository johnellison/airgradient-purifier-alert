# AirGradient Purifier Alert

A private, mobile-first PWA that ingests one AirGradient Cloud location, stores readings in SQLite, and sends one push or email notification per sustained PM2.5 threshold crossing.

## Run locally

Requires Node 22+. Copy `.env.example` to `.env` and load it with your preferred secret manager, then:

```sh
npm install
npm test
ENABLE_INTERNAL_POLLING=true npm start
```

Open `http://localhost:3000` and sign in with any username plus `APP_PASSWORD`. Basic authentication is intentionally used to keep this single-user app small; production must use HTTPS.

## Required configuration

- `AIRGRADIENT_API_TOKEN`: API access token from AirGradient General Settings → Connectivity. It is used only by the server.
- `AIRGRADIENT_LOCATION_ID`: numeric ID from Locations Administration; this is not the monitor serial number.
- `APP_PASSWORD`: protects the dashboard and settings.
- `CRON_SECRET`: authenticates scheduled ingestion requests.
- `SESSION_SECRET`: reserved for migration to session-based authentication; set a random value.
- `DATABASE_PATH`: persistent-disk path, e.g. `/var/data/airgradient.sqlite`.

For web push, generate VAPID keys with `npx web-push generate-vapid-keys` and set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`. iOS requires installing the PWA to the Home Screen before web push can be enabled. For email fallback, set `RESEND_API_KEY`, `EMAIL_FROM`, and optionally `EMAIL_TO`.

## Deploy

Deploy as a Node web service on a provider with HTTPS and a persistent disk (Render, Fly.io, Railway, or equivalent):

1. Set the root directory to `2-work/airgradient-purifier-alert`, build command to `npm ci`, and start command to `npm start`.
2. Mount a persistent disk and point `DATABASE_PATH` at it. Without persistent storage, readings and alert deduplication state will be lost on redeploy.
3. Add every required secret in the provider’s environment settings. Do not place tokens in build arguments or checked-in files.
4. Schedule `POST https://your-app.example/api/cron/ingest` every five minutes with the `x-cron-secret` header. Leave `ENABLE_INTERNAL_POLLING` unset when using an external scheduler.
5. Verify `/health`, sign in, enable notifications, and use **Send a test**.

To move the monitor, change `AIRGRADIENT_LOCATION_ID` and restart. The server rejects a payload whose returned location ID differs from this value.

## Data behavior

Corrected API values are preferred (`pm02_corrected`, `atmp_corrected`, `rhum_corrected`, `rco2_corrected`) with raw-value fallback. The official schema defines PM2.5 in µg/m³, CO₂ in ppm, temperature in °C, humidity in percent, TVOC in ppb when absolute or as a model-dependent index, and NOx as a model-dependent index.

The UI labels data stale after 10 minutes and offline after 30 by default. Stale or missing readings never clear an active alert or imply safe air. Notification deduplication and the state machine are committed to SQLite only after notification delivery succeeds.

## Security notes

The API token never appears in client assets or API responses. AirGradient’s documented API currently accepts its token as a query parameter, so the server creates that URL only inside the ingestion client; errors are sanitized and never log the request URL. The dashboard, readings, settings, push key, and PWA files require authentication. Only `/health` and the separately secret-protected cron endpoint are public.
