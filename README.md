# Teamly — server

The backend for **Teamly**, an open-source tool for monitoring how your brand
shows up across AI search — ChatGPT, Claude, Gemini, Grok, and Perplexity. It runs your
tracked prompts against each model, then analyses the answers for brand mentions,
sentiment, competitor overtakes, and the sources the models cite.

It's **free, self-hostable, and bring-your-own-keys**: you supply your own LLM provider
API keys (stored encrypted, per account), so there are no usage caps and no paid tiers.

> Frontend lives in a separate repo (`teamly-web`, a Next.js app).

## How it works

An Express API fronts a BullMQ pipeline backed by Redis. A scan flows through five stages:

```
scan-orchestrate → llm-query → analysis → scoring → alert
```

- **scan-orchestrate** — fans a brand's enabled prompts out across its enabled models.
- **llm-query** — calls each provider with the account's decrypted key for that provider.
- **analysis** — extracts brand/competitor mentions, sentiment, and citations.
- **scoring** — rolls results into a visibility score.
- **alert** — flags regressions (e.g. a competitor overtaking you) and emails.

Postgres, Auth, and Row-Level Security come from **Supabase**. The server talks to it with
the Supabase JS client using the service-role key; Prisma owns the schema and migrations.

## Self-host quickstart

**Prerequisites:** Docker (or Node 22.23.4 or later in the 22.x line + a Redis instance) and a free
[Supabase](https://supabase.com) project.

1. **Clone and configure.**

   ```bash
   git clone https://github.com/jideabdqudus/teamly-server teamly-server && cd teamly-server
   cp .env.example .env
   ```

   Fill in `.env` — the essentials:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`
   - `DATABASE_URL`
   - `TEAMLY_BACKEND_API_KEY` — any strong secret
   - `CREDENTIALS_ENCRYPTION_KEY` — generate with `openssl rand -base64 32`. This encrypts
     every account's stored LLM keys, so **keep it stable** (rotating it invalidates them).

2. **Apply the schema** to your Supabase database:

   ```bash
   docker compose run --rm server npx prisma migrate deploy
   ```

3. **Start it.**

   ```bash
   docker compose up --build
   ```

   The API (with workers) comes up on `http://localhost:3001`, backed by a Redis container.
   Interactive API docs: `http://localhost:3001/api/docs`.

4. **Bring your keys.** In the frontend, open **Settings → API Keys** and add at least one
   provider key (OpenAI, Anthropic, Google, xAI, or Perplexity), toggle the models you want
   under **AI Models**, then run a scan.

### Running without Docker

```bash
nvm install
nvm use
npm install
npm run db:deploy
npm run dev
```

You'll need a Redis reachable at `REDIS_URL` (defaults to `redis://localhost:6379`).
The `nvm` commands use the version pinned in `.nvmrc`; other version managers can
use `.node-version`.

### Deploying the runtime security update on Render

For Docker services, deploy this Dockerfile with a fresh build (clear the build
cache) to refresh Node.js and the Alpine CA certificates in both stages.
For native Node services, Render reads `.node-version`; if `NODE_VERSION` is set
in the dashboard, update it to `22.23.4` because it takes precedence.
Rebuild and redeploy every affected web service, worker, and cron job, then confirm
`node --version` in the deployed service reports `v22.23.4` or a later 22.x patch.

## Bring your own keys (BYOK)

Provider keys are **account-level** (shared across all brands in the account) and stored
**AES-256-GCM encrypted** at rest under `CREDENTIALS_ENCRYPTION_KEY`. They're never logged
or returned raw — the API only ever exposes a masked form. Each scan decrypts the relevant
key in-memory for the call. A scan requires at least one valid, enabled provider key; models
without a key are skipped gracefully.

## Development

```bash
npm run dev          # watch mode (API + workers)
npm run build        # prisma generate + tsc
npm run lint         # eslint
npm run db:migrate   # create a new migration (prisma migrate dev)
npm run db:studio    # Prisma Studio
```

## License

[GNU AGPL-3.0](LICENSE). If you run a modified version as a network service, the AGPL
requires you to offer your users the corresponding source.
