# Render Free API deployment

`render.yaml` defines the existing NestJS API as a Render Node.js Web Service. It does not create a database, run migrations, or add a Redis service. The API keeps its current REST routes, Socket.IO namespace and Prisma schema.

## Render settings

Use the repository root and the included Blueprint, or set these commands manually:

- Build: `corepack pnpm install --frozen-lockfile && corepack pnpm db:generate && corepack pnpm build:api`
- Start: `corepack pnpm --filter @gloomi/api start`
- Health check: `/api/health`
- Runtime: Node
- Instance: Free

The API reads Render's injected `PORT` and binds to `0.0.0.0`. Do not run `db:migrate` in the build or start command. Review and run `corepack pnpm db:migrate` separately only when an approved schema release is needed.

## Required Render environment

Set these in Render's service environment. Generate three separate random values of at least 32 bytes for the JWT secrets and email pepper. Do not place secret values in Git.

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Neon pooled PostgreSQL connection URL (`sslmode=require`) |
| `JWT_ACCESS_SECRET` | Random secret, at least 32 bytes |
| `JWT_REFRESH_SECRET` | Different random secret, at least 32 bytes |
| `EMAIL_CODE_PEPPER` | Different random secret, at least 32 bytes |
| `WEB_ORIGIN` | Exact production Pages custom origin, e.g. `https://gloomi.example` |
| `COOKIE_DOMAIN` | Shared apex domain, e.g. `gloomi.example` |
| `COOKIE_SAME_SITE` | `lax` |
| `API_PUBLIC_ORIGIN` | Public API custom origin, e.g. `https://api.gloomi.example` |
| `EMAIL_DELIVERY_MODE` | `direct` |
| `EMAIL_TRANSPORT` | `resend` |
| `RESEND_API_KEY` | Server-side Resend API key |
| `SMTP_FROM` | Verified sender address on the domain configured with Resend |
| `SMTP_FROM_NAME` | `Gloomi` (already set in `render.yaml`) |
| `RATE_LIMIT_STORE` | `memory` for one Free instance |
| `MEDIA_STORAGE_PROVIDER` | `s3` (already set in `render.yaml`) |
| `S3_ENDPOINT` | `https://<Cloudflare-account-id>.r2.cloudflarestorage.com` |
| `S3_BUCKET` | Name of the private Cloudflare R2 bucket |
| `AWS_REGION` | `auto` (already set in `render.yaml`) |
| `AWS_ACCESS_KEY_ID` | R2 S3 API token access key ID |
| `AWS_SECRET_ACCESS_KEY` | R2 S3 API token secret |

Render supplies `PORT`; do not hard-code it. `DIRECT_URL` is only needed if an operator later runs Prisma migrations from Render; it is not needed for API startup. Do not set `REDIS_URL` for this configuration.

## Free-tier behavior and service dependencies

`EMAIL_DELIVERY_MODE=direct` skips the BullMQ queue and outbox dispatcher. `RATE_LIMIT_STORE=memory` opts the single API instance into process-local auth rate limits, so no Redis service is needed. The counters reset when Render restarts the service and are not shared if the deployment is later scaled; use Redis for a multi-instance or stronger production setup.

Render Free sleeps after 15 minutes without traffic and may restart at any time. The first request after sleeping can take around a minute. Its filesystem is ephemeral, so `MEDIA_STORAGE_PROVIDER=local` loses uploaded files on restart, redeploy, or spin-down. R2 is an S3-compatible persistent object store and is supported here with signed PUT uploads and signed GET reads. The application verifies MIME, signature, and exact size before attaching an upload. Configure the private R2 bucket's CORS to allow the exact Pages origin, `PUT`, `GET`, and `HEAD`, the `Content-Type` request header, and response headers needed by image/video playback such as `Content-Type`, `Accept-Ranges`, `Content-Range`, and `Content-Length`. Do not make the bucket public.

R2 uses the AWS S3 API endpoint and credentials, while the API keeps all credentials on Render. R2 signed HTML-form POST is unsupported, so when `S3_ENDPOINT` is present the API returns a short-lived signed PUT URL. R2 storage and operations have a free usage allowance, but usage beyond the account's allowance may be billable.

Render Free blocks outbound SMTP ports 25, 465, and 587. `EMAIL_TRANSPORT=resend` sends verification and password-reset mail over HTTPS through Resend; Nodemailer remains available by setting `EMAIL_TRANSPORT=smtp` on a host that permits SMTP. Verify the sender domain with Resend before launch. The API key never goes into the frontend bundle.

## Cookies, CORS, and frontend

Use custom domains under the same registrable domain: for example, Cloudflare Pages at `gloomi.example` and Render's API mapped to `api.gloomi.example`. Point the API DNS record to Render and keep Cloudflare proxy/WebSocket support enabled. The frontend sends credentialed requests and `X-CSRF-Token`; the API allows credentials and the exact `WEB_ORIGIN`. With sibling subdomains, `SameSite=Lax`, `Secure`, and `COOKIE_DOMAIN=gloomi.example` permit the refresh and readable CSRF cookies to work without third-party-cookie behavior. Do not use `pages.dev` with `onrender.com` for the production auth flow: those are unrelated sites and the refresh cookie may be blocked as a third-party cookie.

In Cloudflare Pages set `VITE_API_URL=https://api.gloomi.example/api`. Build from the repo root with `corepack pnpm install --frozen-lockfile && corepack pnpm build:web` and publish `apps/web/dist`. Configure the exact production Pages origin in Render's `WEB_ORIGIN` and R2's bucket CORS.

The `/api/health` endpoint is a liveness check only; it does not test Neon, R2, or email-provider connectivity. `/api/health/email` reports the selected mail provider and its last configured/delivery state.
