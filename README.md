# AirGradient Purifier Alert

A private, mobile-first PWA that ingests one AirGradient Cloud location, stores readings in a private Vercel Blob, and sends one push or email notification per sustained PM2.5 threshold crossing.

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
- `BLOB_READ_WRITE_TOKEN`: injected automatically when the private Vercel Blob store is connected.

For web push, generate VAPID keys with `npx web-push generate-vapid-keys` and set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`. iOS requires installing the PWA to the Home Screen before web push can be enabled. For email fallback, set `RESEND_API_KEY`, `EMAIL_FROM`, and optionally `EMAIL_TO`.

## Deploy

Deploy as a Node web service on Vercel:

1. Link the repository with `vercel link` and connect a private Blob store in the Singapore region.
2. Add every required secret in Vercel’s environment settings. Do not place tokens in build arguments or checked-in files.
3. Deploy with `vercel --prod`. The checked-in `vercel.json` schedules `GET /api/cron/ingest` every five minutes and Vercel authenticates it with `CRON_SECRET`.
4. Verify `/health`, sign in, enable notifications, and use **Send a test**.

To move the monitor, change `AIRGRADIENT_LOCATION_ID` and restart. The server rejects a payload whose returned location ID differs from this value.

## Data behavior

Corrected API values are preferred (`pm02_corrected`, `atmp_corrected`, `rhum_corrected`, `rco2_corrected`) with raw-value fallback. The official schema defines PM2.5 in µg/m³, CO₂ in ppm, temperature in °C, humidity in percent, TVOC in ppb when absolute or as a model-dependent index, and NOx as a model-dependent index.

The UI labels data stale after 10 minutes and offline after 30 by default. Stale or missing readings never clear an active alert or imply safe air. Notification deduplication, settings, subscriptions, and up to 48 hours of readings are stored in a private Blob with conditional writes.

## Security notes

The API token never appears in client assets or API responses. AirGradient’s documented API currently accepts its token as a query parameter, so the server creates that URL only inside the ingestion client; errors are sanitized and never log the request URL. The dashboard, readings, settings, push key, and PWA files require authentication. Only `/health` and the separately secret-protected cron endpoint are public.
