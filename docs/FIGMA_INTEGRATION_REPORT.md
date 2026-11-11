# GLOOMI Figma Make UI

Implementation continued in the open `gloomi-work` repository. The ZIP was inspected from a separate temp extraction; its mock service and mock product data were not copied into the application.

## UI changes

- `apps/web/src/feed-pages.tsx`: Make style Feed header, Stories rail, feed/discover switch, story viewer, Explore/Search grid and post detail classes, retaining real query hooks and `PostCard` actions.
- `apps/web/src/profile-page.tsx`: Make profile composition styles applied to API driven avatar, statistics, bio, follow/message actions, tabs, real publication grid and editor.
- `apps/web/src/activity-page.tsx`: Make spacing and notification list styling applied to real notification and follow request data/actions.
- `apps/web/src/messenger.tsx`: Make conversation list and chat styles applied to REST data, Socket.IO and REST fallback.
- `apps/web/src/create-post.tsx`: Make picker treatment applied to device file selection, preview/crop, caption, upload progress, cancellation and publication.
- `apps/web/src/app.tsx`: Make navigation and deep-link route aliases, with existing authentication/session handling.
- `apps/web/src/main.tsx`, `apps/web/src/styles/figma-make.css`: theme and responsive desktop/tablet/mobile layer for Feed, Profile, Explore/Search, Notifications, Reels, Direct/Conversation, Story Viewer, Publication Details, Media Picker, global sidebar and mobile navigation.
- `docs/FIGMA_INTEGRATION_REPORT.md`: implementation notes and AWS handoff.

Auth screens continue using the existing responsive AuthFrame, local Grand Hotel wordmark and Montserrat UI font; no ZIP auth mocks were imported. Media Picker uses the device file chooser. There is no backend API for a browsable server media library, Story replies, music, tags or Highlights; those mock-only features were not presented as working.

## Verification

- `corepack pnpm --filter @gloomi/web typecheck` — passed.
- `corepack pnpm --filter @gloomi/web build` — passed (Vite production output in `apps/web/dist`).
- `corepack pnpm --filter @gloomi/api test` — passed, 10 files / 61 tests.
- `node apps/web/scripts/smoke-ui.mjs` — passed. Uses isolated browser API fixtures and exercised auth/verification/reset, Feed like/comment/save, Profile, Search, Notifications, Create dialog and mobile/tablet navigation. Desktop 1440 and mobile 390 screenshots were inspected; tablet width 820 and 320/390 auth overflow checks passed. Direct messaging, Story viewing, upload against the live API and real Reels media were not exercised in this smoke run.
- `git diff --check` — passed.

No `.env`, backend, Prisma schema/migrations, AWS, Neon, SMTP, production API configuration, or infrastructure was changed. No deployment or server connection was attempted.

## AWS handoff (not deployed)

Build from the repository root:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @gloomi/web build
```

The static frontend artifact is `apps/web/dist/` (HTML plus generated JS/CSS/assets). Transfer that directory to the existing EC2 using the serving mechanism already configured there; confirm its document root and fallback routing before replacing files. Do not change production API URL, cookie, CORS or backend settings as part of this frontend release.

Before an authorized release, identify the current serving process/path, copy the live frontend directory to a timestamped backup, upload the new `dist` into a separate release directory, switch the document root/symlink atomically, then request `/` and representative client routes. Rollback by switching the document root/symlink to the backup and reloading the web server using its confirmed service manager. The server currently has no confirmed Docker, PM2, Nginx or document-root details, so deployment commands must be tailored after access is authorized and the existing setup is inspected.

## Mobile first final pass (2026-11-11)

- `apps/web/src/styles/figma-make.css`: added tablet sidebar compaction for 681-820 px, safe-area padding for fixed mobile navigation, 44-48 px touch targets, 16 px mobile form text to avoid iOS focus zoom, and viewport-aware sizing for chat, Story Viewer, Reels and dialogs. Narrow screens also get smaller story/action gaps; landscape has dedicated Reels/Story sizing.
- `apps/web/scripts/smoke-ui.mjs`: added isolated Chromium overflow checks for Feed at 320, 360, 375, 390, 393, 412, 430 and 768 px; landscape 844x390; Profile and Direct at 320, 390 and 430 px. Captures 390 px mobile and 768 px tablet Feed screenshots in `.cache/ui-smoke/`.
- Verification: frontend TypeScript passed; Vite production build passed; API suite passed (10 files / 61 tests); browser smoke passed using API fixtures only; `git diff --check` passed. Smoke covered the listed Feed/Profile/Direct viewports plus existing auth, Explore/Search, Notifications and Create dialog flows. No live account, media upload, Story or Reels video was exercised.
- A first API test invocation included the unsupported Vitest `--runInBand` flag and failed before running tests; rerunning the repository's normal `corepack pnpm --filter @gloomi/api test` command passed.
- No backend, schema, environment, production API configuration, AWS or infrastructure files were changed. No server connection or deployment was attempted.
