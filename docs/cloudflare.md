# Cloudflare deployment

The frontend is a static Vite application and is configured for Cloudflare Pages in the repository root `wrangler.jsonc`. Build from the repository root with `corepack pnpm install --frozen-lockfile` and `corepack pnpm build:web`; Pages publishes `apps/web/dist`. The existing NestJS API deployment is configured separately for Render in [the Render guide](render.md).

## Cloudflare Pages

Create a Pages project connected to this repository and use:

- Framework preset: `None`
- Root directory: `/`
- Build command: `corepack pnpm install --frozen-lockfile && corepack pnpm build:web`
- Build output directory: `apps/web/dist`
- Build environment variable: `VITE_API_URL=https://api.example.com/api` (replace with the public API URL)

Alternatively, install Wrangler and run `wrangler pages deploy apps/web/dist --project-name gloomi` after building. The `wrangler.jsonc` file identifies the Pages project and output directory. Vite's generated assets use relative URLs, and Pages serves the app's client-side routes through its SPA fallback behavior.

Set `VITE_API_URL` for both Preview and Production environments. It is compiled into public browser code; it must contain only the API's public URL, never credentials. When changing this value, rebuild and redeploy the Pages site.

## API and domain routing

The current API is a Node.js NestJS/Express application, not a Cloudflare Worker. It uses Socket.IO, Prisma/PostgreSQL and persistent media storage. Its default production settings require Redis for rate limiting and select queued email; the included Render configuration explicitly selects one-instance memory rate limits and direct HTTPS email so those defaults do not create hidden Redis dependencies. Keep the API on a Node.js host that supports long-running processes and WebSockets. Point `api.example.com` through Cloudflare DNS to that host, then set `VITE_API_URL=https://api.example.com/api` in Pages. Cloudflare DNS/proxy can front the API hostname; verify WebSocket support and request body limits for the selected proxy and API host.

Use the same registrable domain for the Pages site and API (for example, `example.com` and `api.example.com`) so the refresh cookie can be shared. On the API host configure:

- `WEB_ORIGIN=https://example.com` (and any exact additional frontend origins, comma-separated)
- `COOKIE_SAME_SITE=lax`
- `COOKIE_DOMAIN=.example.com`
- `NODE_ENV=production`
- `API_PUBLIC_ORIGIN=https://api.example.com`
- `MEDIA_STORAGE_PROVIDER=s3` with a persistent S3-compatible private bucket, or another production-persistent media provider
- PostgreSQL, independent high-entropy JWT secrets, `EMAIL_CODE_PEPPER`, SMTP, and production Redis settings documented in the README

Never set `VITE_API_URL` or any API secret in the frontend build to make backend credentials available. Set runtime secrets in the API host's secret manager. Do not use the local filesystem media provider for an ephemeral serverless deployment.

## Deployment sequence

1. Provision the API host, PostgreSQL, Redis, email delivery and persistent private media storage.
2. Set the API runtime variables and deploy the Node.js API using `corepack pnpm build:api` and `corepack pnpm --filter @gloomi/api start`.
3. Configure the API origin, cookie domain and exact frontend origin as above; confirm HTTPS and WebSocket connectivity.
4. Set Pages `VITE_API_URL` to the deployed API URL, then build and deploy the frontend.
5. Apply Prisma migrations as a separately reviewed release operation with the production `DIRECT_URL`: `corepack pnpm db:migrate`.

No Cloudflare account resources, database migrations, or external services are created by this repository configuration.
