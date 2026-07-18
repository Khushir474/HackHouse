# DueBot Setup Guide

This guide walks a new team member through standing up DueBot's infrastructure
from scratch: the Supabase database, the LLM provider, the Cloudflare Worker
deployment, and a local dev environment. Follow the sections in order — each
one produces values the next section needs.

**Never commit secrets.** Every API key, service-role key, and database URL
below is shared through team chat (or your team's password manager) and
pasted into a local, gitignored file (`.dev.vars`) or a Cloudflare secret
store. None of these values belong in `wrangler.jsonc`, `.dev.vars.example`,
or any file that gets committed.

## 1. Supabase (database)

1. Create a free project at [supabase.com](https://supabase.com), naming it
   `duebot`.
2. Open the SQL Editor for the project and run the three migration files in
   `supabase/migrations/` **in order**, pasting each one's contents and
   clicking "Run":
   - `0001_schema.sql` — creates the five core tables (`companies`,
     `conversations`, `messages`, `calendar_slots`, `calendar_bookings`).
   - `0002_book_slot.sql` — creates the atomic `book_slot(...)` function used
     to claim a calendar slot without race conditions.
   - `0003_seed.sql` — inserts the three demo companies (Acme Robotics,
     Nimbus Analytics, Voltway) and seeds a week of calendar availability
     for their CFO and customer-reference contacts.
3. Once the migrations succeed, go to **Project Settings → API** and copy two
   values:
   - **Project URL** → this becomes `DATABASE_URL`.
   - **service_role key** (not the `anon` key) → this becomes
     `DATABASE_SERVICE_KEY`.
4. Share both values with the team over team chat (e.g. Slack DM or a
   pinned message in a private channel) or your team's secrets manager.
   **Do not commit them to the repo, paste them into a PR, or put them in any
   tracked file.**

## 2. LLM provider

DueBot talks to any OpenAI-compatible chat completions endpoint, so the
provider is swappable with configuration only — no code changes.

**Default: Groq**

1. Create an API key at [console.groq.com](https://console.groq.com).
2. This becomes `LLM_API_KEY`.
3. Use model `llama-3.3-70b-versatile` (this is the default `LLM_MODEL`).

**Swapping to NVIDIA NIM**

If Groq capacity or pricing becomes an issue, switch providers by changing
three environment values — no code change is required:

```
LLM_BASE_URL=https://integrate.api.nvidia.com/v1
LLM_MODEL=meta/llama-3.3-70b-instruct
LLM_API_KEY=<key from build.nvidia.com>
```

Get the NIM key from [build.nvidia.com](https://build.nvidia.com).

## 3. Cloudflare (deployment)

1. Sign up for a free Cloudflare account at
   [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) if you
   don't already have one.
2. Authenticate the CLI:

   ```bash
   npx wrangler login
   ```

3. Deploy the worker:

   ```bash
   npm run deploy
   ```

4. Set the two secret values (these prompt for input and are never written to
   disk or logged):

   ```bash
   npx wrangler secret put LLM_API_KEY
   npx wrangler secret put DATABASE_SERVICE_KEY
   ```

5. The remaining configuration is non-secret and lives in `wrangler.jsonc`
   under `"vars"`:

   ```jsonc
   "vars": {
     "LLM_BASE_URL": "https://api.groq.com/openai/v1",
     "LLM_MODEL": "llama-3.3-70b-versatile",
     "DATABASE_URL": "https://your-project-ref.supabase.co"
   }
   ```

   `DATABASE_URL` is a project URL, not a credential, so it's safe to commit
   as a plain var — the sensitive half is `DATABASE_SERVICE_KEY`, which stays
   a secret (step 4).

## 4. Local development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the example env file and fill in the values shared in team chat
   (section 1 and 2 above):

   ```bash
   cp .dev.vars.example .dev.vars
   ```

   `.dev.vars` is gitignored — edit it in place and paste in `LLM_API_KEY`,
   `DATABASE_URL`, and `DATABASE_SERVICE_KEY`.

3. Start the local dev server:

   ```bash
   npm run dev
   ```

4. Try the CLI chat script against the running worker to confirm everything
   is wired up:

   ```bash
   npm run chat "burn multiple for Acme Robotics"
   ```

If this returns a sensible answer, the database, LLM provider, and worker are
all correctly connected.
