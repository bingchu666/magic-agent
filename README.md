# Magic Agent V1

Magic-focused SaaS built with Next.js App Router.

## What is implemented

- Auth domain: session-based sign-in with `User/Admin` role model.
- Chat-Agent domain: `/chat` with thread list, SSE response streaming, lesson cards, and file attachment context.
- Video library domain: multi-source dynamic recommendation (YouTube/Bilibili/Vimeo/Dailymotion/custom + internal library fallback), cross-source fusion ranking, URL validation, dedupe, and admin CRUD/publish APIs.
- File-intelligence domain: upload -> enqueue -> async processing -> summary/translation -> reusable insights.
- Admin domain: `/admin/videos` and `/admin/moderation` for catalog operations and audit/event visibility.

## API Surface

- `POST /api/chat/stream`
- `POST /api/files/presign`
- `PUT /api/files/{fileId}/upload`
- `POST /api/files/{fileId}/enqueue`
- `GET /api/files/{fileId}`
- `GET /api/videos/recommend`
- `POST /api/admin/videos`
- `PATCH /api/admin/videos/{id}`
- `POST /api/admin/videos/{id}/publish`

## Multi-source recommendation config

Main env vars:

- `VIDEO_PROVIDERS_ENABLED`
- `VIDEO_ALLOWED_DOMAINS`
- `VIDEO_PROVIDER_TIMEOUT_MS`
- `VIDEO_PROVIDER_MAX_CANDIDATES`
- `VIDEO_RECOMMEND_TOP_N`
- `VIDEO_RECOMMEND_CACHE_TTL_MS`
- `VIDEO_VALIDATE_ACCESSIBILITY`
- `YOUTUBE_API_KEY`, `VIMEO_API_KEY`, `DAILYMOTION_API_KEY` and optional custom provider keys/base urls.

## Local run

```bash
npm install
npm run dev
```

## Deploy online (Vercel)

```bash
# 1) login once
npx vercel login

# 2) sync .env to Vercel production and deploy production
npm run deploy:online
```

This deploy script requires these keys in `.env`:

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_MODEL`

## Verify

```bash
npm test
npm run build
```

## Notes

- This repo currently uses an in-memory data layer for rapid iteration.
- For production, swap `src/lib/data/memory-db.ts` with Postgres + Drizzle + pgvector adapters while keeping the same domain contracts.
