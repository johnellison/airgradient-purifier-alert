# Security

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's **Security → Report a vulnerability** flow. Do not open a public issue containing credentials, monitor location details, push subscriptions, or exploit steps.

## Secrets and private data

Never commit `.env`, `.env.local`, `.vercel`, API tokens, location IDs, passwords, VAPID private keys, webhook secrets, or push subscriptions. Before making a fork public, scan its full history with:

```sh
gitleaks git . --redact
```

The AirGradient token is used only in the server-side ingestion client. The dashboard and settings are protected with HTTP Basic authentication and must be served over HTTPS.
