# gloomi

Mobile-first social network starter based on the provided gloomi Figma screens. The current implementation is a working product foundation: account registration and Gmail SMTP verification, persisted profiles, follow-aware feed, photo/video posts, likes, comments, discovery/search, expiring stories, notifications, and private conversations over REST plus Socket.IO.

## Stack

- `apps/web`: React, TypeScript, Vite, React Router, TanStack Query, Axios, CSS variables.
- `apps/api`: NestJS REST API, Socket.IO gateway, JWT authentication, DTO validation, bcrypt password hashing, Nodemailer SMTP plus an HTTPS Resend option, private local media lifecycle, S3-compatible storage and optional legacy queue/worker mode.
- `prisma`: PostgreSQL schema and migrations.
- `infrastructure/terraform`: legacy AWS RDS/ECS/CloudFront template. It is not the selected Neon architecture and may create billable resources if applied.
- `wrangler.jsonc` and [Cloudflare deployment guide](docs/cloudflare.md): Cloudflare Pages configuration for the static frontend. The current API requires a Node.js host.
- `render.yaml` and [Render deployment guide](docs/render.md): free Node.js Web Service configuration, Resend HTTPS email, process-local rate limits, and Cloudflare R2 uploads.
- `docker-compose.yml`: local PostgreSQL, Redis, Mailpit, and isolated integration-test databases.

## Local development

Prerequisites: Node.js 20+, Corepack/pnpm 9+, an existing PostgreSQL database, and Gmail SMTP credentials for real email verification. Local direct SMTP mode needs neither Redis, an email worker, nor Docker. See [email setup](docs/email-setup.md).

1. Use the existing PostgreSQL configuration and Gmail SMTP App Password. Keep `.env` private.
2. Create `.env` with the environment values documented below. For Docker, set local `DATABASE_URL` and `DIRECT_URL` to the local database; for Neon, use the pooled URL as `DATABASE_URL` and direct URL as `DIRECT_URL`. Set distinct random JWT and email-code secrets.
3. Install dependencies: `corepack pnpm install`.
4. Generate Prisma Client if needed: `corepack pnpm db:generate`. Database schema changes require separate authorization; do not run migrations against the primary Neon database as part of starting the app.
5. Start the API and frontend: `corepack pnpm dev`.
6. Open `http://localhost:5173`.

Email is sent directly by the API outside production (`EMAIL_DELIVERY_MODE=direct`, the local default). No email worker is required. The optional legacy queue mode needs `EMAIL_DELIVERY_MODE=queue`, Redis and a separate `corepack pnpm dev:worker` process.

The API listens on `http://localhost:3000`; endpoints are under `/api`. Swagger is not enabled yet. Development now uses private local filesystem media storage by default, with no S3 bucket required. Files live under the ignored `uploads/` directory and survive restarts. The optional cloud S3 adapter remains available. See [local media and real browser testing](docs/local-media.md). No demonstration content is injected at startup; the separate `db:demo` command is explicit, labeled and idempotent.

## Required environment values

- `DATABASE_URL`: PostgreSQL URL used by the API runtime. For local Docker Compose: `postgresql://gloomi:gloomi@localhost:5432/gloomi?schema=public`. For Neon, use the pooled connection string.
- `DIRECT_URL` (optional): direct PostgreSQL URL preferred by Prisma CLI for migrations. For Neon use its direct endpoint; locally it can equal `DATABASE_URL`.
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`: independent high-entropy secrets.
- `EMAIL_CODE_PEPPER`: independent high-entropy secret for HMAC hashing verification codes.
- `WEB_ORIGIN`: exact allowed browser origin(s), comma-separated.
- Email-code and outbox encryption key: `EMAIL_CODE_PEPPER` (at least 32 bytes; AWS runtime loads it from Secrets Manager).
- Gmail SMTP: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER`, `SMTP_PASSWORD` (Google App Password), `SMTP_FROM` (verified sender address), `SMTP_FROM_NAME`; optional timeouts `SMTP_CONNECTION_TIMEOUT`, `SMTP_GREETING_TIMEOUT`, and `SMTP_SOCKET_TIMEOUT`.
- Local Mailpit: `SMTP_HOST=localhost`, `SMTP_PORT=1025`, blank user/password, `SMTP_SECURE=false`, `SMTP_FROM=no-reply@gloomi.local`.
- Cookie settings: `COOKIE_SAME_SITE` (`lax` by default; use `none` only for cross-site HTTPS deployments), optional `COOKIE_DOMAIN`.
- Local media: `MEDIA_STORAGE_PROVIDER=local` (development default), optional `LOCAL_MEDIA_DIR` and `API_PUBLIC_ORIGIN`. No `.env` change is needed for the existing local development configuration.
- Optional S3 media: `MEDIA_STORAGE_PROVIDER=s3`, `AWS_REGION` and `S3_BUCKET`; AWS SDK default credential chain is used. Objects remain private and are delivered with five-minute signed URLs.
- `EMAIL_DELIVERY_MODE`: `direct` (default outside production) sends SMTP after committing PostgreSQL verification state; `queue` (production default) retains the encrypted outbox and BullMQ worker.
- `REDIS_URL`: required in production for distributed auth rate limiting, and for optional BullMQ delivery. Local direct mode does not connect to Redis and uses process-local request counters, plus persisted code attempt/cooldown limits.

Do not commit `.env`. Configure credentials locally through a secure mechanism. Gmail delivery requires a Google App Password and verified sender mailbox. No external resource is created automatically.

## AWS preparation

The Terraform under `infrastructure/terraform` is a legacy deployment template and does not create anything unless applied. It includes RDS, ECS, Redis, ALB, and CloudFront resources that can incur charges and does not represent the selected Neon architecture. Review and redesign it before any use; no `terraform apply` was run.

Neon is the intended managed PostgreSQL provider. AWS S3 is the intended media provider. Local Docker Compose remains available for PostgreSQL, Redis, Mailpit, and isolated tests. S3 provisioning and all deployment work require separate review and authorization because they may incur costs.

Before applying, validate the Terraform plan in the intended AWS account. Never run `terraform apply` from this repository without explicit operator review.

## Current API surface

- `POST /api/auth/register`, `/login`, `/verify-email`, `/resend-code`, `/refresh`, `/logout`, `/logout-all`, `/password-reset/request`, `/password-reset/confirm`; `GET /api/auth/me` and `/api/auth/csrf`.
- `GET /api/feed`, `/explore`, `/search/users`, `/profiles/:username`; authenticated profile changes via `PATCH /api/profiles/me`.
- `POST /api/posts`, `/posts/:id/like`, `/posts/:id/save`, `/posts/:id/comments`; `GET /api/posts/:id/comments` and `/api/saved`.
- `POST /api/profiles/:id/follow`, `/unfollow`; `GET/POST /api/stories`.
- `GET /api/conversations`; `POST /api/conversations/:peerId`; `GET/POST /api/conversations/:id/messages`.
- Socket.IO namespace `/messages`: `conversation:join`, `message:send`, and `message:new`.
- `GET /api/notifications`; authenticated media flow: `POST /api/media/uploads`, `POST /api/media/uploads/:id/finalize`, `POST /api/media/avatar`, `DELETE /api/media/:id`.

## Known gaps

Large multipart uploads, media scanning/transcoding, Highlights, native pronouns, per-post privacy/comment policies, mentions/repost/story-reaction events, moderation/report workflows, browser push and deployment remain incomplete. Local media supports video Range responses and has been verified with real PNG/JPEG/WebM uploads, PostgreSQL persistence, two-account social actions and a real browser. The optional S3 adapter has not been tested against a live bucket. Gmail SMTP authentication and read-only Neon connectivity have been verified separately. No production deployment, Terraform apply, paid AWS resource or primary-database migration was performed.

## GLOOMI interface preview

Run `corepack pnpm dev:web` and open `http://127.0.0.1:5173`. The login, registration, and password reset screens render without a running API. Account operations and authenticated content use the existing API at `http://localhost:3000/api` (or `VITE_API_URL`). Start the already configured API with `corepack pnpm dev:api`; previewing the frontend does not require migrations or Docker.

The interface uses a real Grand Hotel text wordmark and Montserrat for UI, both served from local WOFF2 files with OFL licenses. The SVG fallback remains available. Compare the three evaluated logo fonts at `/brand-comparison.html`; use `/phone-preview` for an optional interactive mobile frame. Home, Explore, Profile, Create, Stories, Messenger, Activity and Reels share design tokens and component styles. The design follows Figma file `PQ6moPWAuKox5sVu9IFrDZ` (feed `4:19659`, Explore `4:19754`, Create `4:19994`, Profile `4:20206`, Story `4:20717`).

Create supports drag/drop, image/video previews, square/portrait image crop, caption/location, upload progress, cancellation, text drafts and real publication. User/profile data comes from the API; public discovery fills an otherwise empty feed. Privacy approval, persistent messages with Socket.IO updates and REST fallback, notification read markers, direct post links, save/unsave and sending posts to existing conversations use real backend endpoints. See [scope and test commands](docs/local-media.md) for the explicitly deferred features and isolated real integration suite.

Validation: `corepack pnpm --filter @gloomi/web build` and `corepack pnpm --filter @gloomi/web typecheck`. With the frontend running and Node.js 22+ available, run `node apps/web/scripts/smoke-ui.mjs` from the repository root. The smoke check uses headless Chromium and isolated API fixtures to exercise login, password reset, likes, comments, saving, profile navigation, search, and mobile/tablet layouts. It never contacts the database, email, or media storage. Screenshots are saved under the ignored `.cache/ui-smoke/` directory. On systems without Edge or Chrome in the standard Windows paths, set `BROWSER_PATH` to a Chromium executable. Live API integration and media uploads still need verification against the configured services.

## Integration testing

Docker Compose provides separate databases on ports 5433 and 5434 for API and migration tests. Start them with `docker compose up -d postgres-test postgres-migration-test redis mailpit`, set `DATABASE_URL_TEST`, `DATABASE_URL_MIGRATION_TEST`, and `REDIS_URL_TEST` to those local services, then run `corepack pnpm test:integration`. The test runner rejects non-loopback hosts and non-test database names; it never targets production RDS.
