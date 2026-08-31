# AirGradient Purifier Alert

An open-source, single-household PWA that ingests one AirGradient Cloud location, stores readings in a private Vercel Blob, and sends one push or email notification per sustained PM2.5 threshold crossing.

All deployment-specific values—including the AirGradient location ID, display label, timezone, credentials, and notification keys—are environment variables. The repository contains no monitor location or account data.

## How phone notifications work

The dashboard is a Progressive Web App (PWA). On Android it can be installed from the browser. On iPhone, open it in Safari, choose **Share → Add to Home Screen**, launch it from the new icon, then press **Enable notifications**. iOS only allows a Home Screen web app to request push permission after a user action.

When enabled, the browser creates a push subscription and sends it to this app's authenticated server. The subscription is stored in the private Blob. A threshold event or authenticated webhook makes the server send an encrypted Web Push message using VAPID. The phone's browser push service wakes the service worker and displays the notification even when the dashboard is closed; the server and scheduled ingestion still need to be running.

## Run locally

Requires Node 22+. Copy `.env.example` to `.env` and load it with your preferred secret manager, then:

```sh
npm install
npm test
ENABLE_INTERNAL_POLLING=true npm start
```

Open `http://localhost:3000` and sign in with `APP_USERNAME` and `APP_PASSWORD`. Basic authentication is intentionally used to keep this single-user app small; production must use HTTPS.

## Required configuration

- `AIRGRADIENT_API_TOKEN`: API access token from AirGradient General Settings → Connectivity. It is used only by the server.
- `AIRGRADIENT_LOCATION_ID`: numeric ID from Locations Administration; this is not the monitor serial number.
- `APP_NAME`, `LOCATION_LABEL`, and `TIME_ZONE`: private display configuration for this deployment.
- `APP_USERNAME` and `APP_PASSWORD`: protect the dashboard and settings.
- `CRON_SECRET`: authenticates scheduled ingestion requests.
- `WEBHOOK_SECRET`: optional bearer token for the generic notification webhook.
- `SESSION_SECRET`: reserved for migration to session-based authentication; set a random value.
- `BLOB_READ_WRITE_TOKEN`: injected automatically when the private Vercel Blob store is connected.

For web push, generate VAPID keys with `npx web-push generate-vapid-keys` and set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`. For email fallback, set `RESEND_API_KEY`, `EMAIL_FROM`, and optionally `EMAIL_TO`.

## Deploy

Deploy as a Node web service on Vercel:

1. Fork or clone this repository, then copy `.env.example` to `.env` and fill in your own values.
2. Link the repository with `vercel link` and connect a **private** Blob store in a region close to you.
3. Add every required value in Vercel’s environment settings. Do not place tokens in build arguments or checked-in files.
4. Deploy with `vercel --prod`. The checked-in `vercel.json` schedules `GET /api/cron/ingest` every five minutes and Vercel authenticates it with `CRON_SECRET`.
5. Verify `/health`, sign in, install the PWA, enable notifications, and use **Send a test**.

To move the monitor, change `AIRGRADIENT_LOCATION_ID` and restart. The server rejects a payload whose returned location ID differs from this value.

## Generic notification webhook

Set a strong `WEBHOOK_SECRET` to let another trusted automation send Web Push through the same installed PWA:

```sh
curl -X POST https://your-app.example/api/webhook/notify \
  -H "Authorization: Bearer $WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"title":"Air alert","body":"Smoke is approaching the house","url":"/"}'
```

The endpoint accepts `title` (120 characters), `body` (required, 500 characters), and an optional notification-click `url`. It never accepts or returns a push subscription or VAPID private key.

## Other open-source webhook-to-phone options

- [Kukuroo](https://github.com/saiday/kukuroo) is a small MIT-licensed webhook-to-Web-Push gateway on Cloudflare Workers. It is probably the recent X release that inspired this request. It is elegant but intentionally Safari-only and requires a newer iOS/macOS version.
- [ntfy](https://github.com/binwiederhier/ntfy) provides a very simple HTTP publish API plus open-source iOS and Android apps. It is the strongest option if installing a native receiver app is acceptable.
- [Bark](https://github.com/Finb/Bark) is a simple MIT-licensed iPhone webhook receiver using its native app and APNs.
- [Gotify](https://github.com/gotify) is excellent for self-hosted Android notifications but has no official iOS client.
- [Apprise API](https://github.com/caronc/apprise-api) routes one webhook to many notification providers, but adds a separate Python service and is unnecessary for this small deployment.

The built-in standards-based Web Push remains the default because it works directly from this Vercel app without another hosted service or native receiver app.

## Data behavior

Corrected API values are preferred (`pm02_corrected`, `atmp_corrected`, `rhum_corrected`, `rco2_corrected`) with raw-value fallback. The official schema defines PM2.5 in µg/m³, CO₂ in ppm, temperature in °C, humidity in percent, TVOC in ppb when absolute or as a model-dependent index, and NOx as a model-dependent index.

The UI labels data stale after 10 minutes and offline after 30 by default. Stale or missing readings never clear an active alert or imply safe air. Notification deduplication, settings, subscriptions, and up to 48 hours of readings are stored in a private Blob with conditional writes.

## Security notes

The API token never appears in client assets or API responses. AirGradient’s documented API currently accepts its token as a query parameter, so the server creates that URL only inside the ingestion client; errors are sanitized and never log the request URL. The dashboard, readings, settings, push key, and PWA files require authentication. Only `/health`, the secret-protected cron endpoint, and the optional secret-protected notification webhook bypass dashboard authentication.
