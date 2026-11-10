# Home Budget (self-hosted)

Tracks recurring payments (rent, utilities, insurance, subscriptions) and day-to-day expenses.
Yearly and quarterly payments are converted to a monthly amount; there is a breakdown by category,
the balance left from income, a monthly CSV export, import of bank CSV statements and optional
sync with the bank through Enable Banking.
The month can start on any day (for example, on payday): starting on the 25th,
"November" is 25 October – 24 November. This is set in the "Left" tile.

**Stack:** Node.js 22 + Fastify 5 · PostgreSQL 16 · nginx · Docker Compose.

```
browser ──► nginx (:8080) ──► app: Fastify (:3000) ──► PostgreSQL (internal network only)
```

## Running

Requires Docker with Compose v2.

```bash
cp .env.example .env
# in .env change POSTGRES_PASSWORD, APP_PASSWORD and SESSION_SECRET
openssl rand -hex 32        # paste the result into SESSION_SECRET

docker compose up -d --build
```

Open http://localhost:8080 and sign in with the password from `APP_PASSWORD`.
Tables are created automatically on the first start (migrations from `app/migrations`).

## Updating

```bash
git pull   # or replace the files
docker compose up -d --build
```

New migrations are applied automatically. Data lives in the `pgdata` Docker volume and survives rebuilds.

## Backup

```bash
# save
docker compose exec -T db pg_dump -U budget budget | gzip > backup-$(date +%F).sql.gz

# restore into an empty database
gunzip -c backup-2026-10-23.sql.gz | docker compose exec -T db psql -U budget budget
```

It is convenient to run the first command from cron once a day.

## Access from outside

Do not expose port 8080 to the internet directly. Options:

- **Home only:** leave it as it is and open it by the server IP on the local network.
- **Tailscale:** the simplest way to reach it from a phone anywhere, without port forwarding.
- **Cloudflare Tunnel** (built in, see below): a public HTTPS address on your own domain without
  opening ports on the router.
- **HTTPS domain:** put Caddy or Traefik in front of nginx and set `COOKIE_SECURE=true` in `.env`.

### Cloudflare Tunnel

Needs a free Cloudflare account and a domain whose DNS is managed by Cloudflare.

1. **Set `APP_PASSWORD` in `.env` first.** Without it the budget is open to anyone who finds the address.
2. Cloudflare dashboard → Zero Trust → Networks → Tunnels → *Create a tunnel* → *Cloudflared*.
   Name it, then copy the token from the install command (the long string after `--token`).
3. In the tunnel add a *Public hostname*: for example `budget.example.com`, service type **HTTP**,
   URL **`web:81`** (port 81 is internal: only there nginx trusts the client IP sent by Cloudflare).
4. In `.env`:

```bash
COMPOSE_PROFILES=tunnel
CLOUDFLARE_TUNNEL_TOKEN=eyJh…
```

5. `docker compose up -d` and open `https://budget.example.com`.

The tunnel container (`cloudflared`) only connects out to Cloudflare; no ports are opened. The local
address `http://<server IP>:8080` keeps working. The session cookie gets the Secure flag automatically
for requests through the tunnel. For bank sync use the public address in `EB_REDIRECT_URL` and in the
Enable Banking application (`https://budget.example.com/api/bank/callback`, `…/privacy.html`,
`…/terms.html`).

Extra protection: Cloudflare Access (Zero Trust → Access → Applications) can require a one-time code
by e-mail before the page is even shown.

## Language

The interface is available in English and Russian; the `EN | RU` switch is in the header and on the
sign-in form. The choice is stored in the `lang` cookie, so the server uses the same language for
error messages, the CSV export header and AI advice. Without a cookie the browser language decides
(Russian for `ru`, English otherwise).

Categories, accounts and standard income sources are stored in the database as their original
(Russian) values and are translated only for display, so existing data works in any language.

To add a language:

1. `app/public/locales/<lang>.js` — interface strings (copy `en.js`), then register it in
   `LOCALES` in `app/public/i18n.js`.
2. `app/src/locales/<lang>.js` — server messages (copy `en.js`), then register it in `LOCALES` and
   `LANGUAGE_NAMES` in `app/src/i18n.js`.

## API

All routes except `/api/login`, `/api/me` and `/api/health` require signing in (session cookie).
Error responses are `{ error: "<code>", message: "<text in the UI language>" }`.

| Method | Path | What it does |
|---|---|---|
| POST | `/api/login` | `{ "password": "…" }` → a session cookie for 30 days |
| POST | `/api/logout` | sign out |
| GET | `/api/recurring` | all recurring payments |
| POST | `/api/recurring` | create: `name, amount, period (week/month/quarter/year), kind (mandatory/subscription), category, account, day, active` |
| PUT | `/api/recurring/:id` | replace |
| PATCH | `/api/recurring/:id` | `{ "active": false }` — pause |
| DELETE | `/api/recurring/:id` | delete |
| GET | `/api/expenses?month=2026-10` | expenses for a calendar month; or `?from=2026-10-25&to=2026-11-25` — for a period (`to` is exclusive); `&linked=1` — plus recurring payments made within ±62 days around the period |
| GET | `/api/expenses.csv?month=…` / `?from=…&to=…` | the same as CSV (`;` delimiter, opens in Excel) |
| POST | `/api/expenses` | create: `amount, date (YYYY-MM-DD), category, note, account, recurring_id` (recurring payment id or `null`), `for_month` (`YYYY-MM` — which month the payment is for, `null` = auto) |
| PUT | `/api/expenses/:id` | update |
| DELETE | `/api/expenses/:id` | delete |
| GET | `/api/incomes?from=…&to=…` (or `?month=`) | income for a period |
| POST | `/api/incomes` | create: `amount, date, source, note, account` |
| PUT / DELETE | `/api/incomes/:id` | update / delete an income |
| GET | `/api/incomes/sources` | sources already used, most frequent first |
| GET | `/api/insights?from=…&to=…` | saved AI advice for the period and `configured` (whether a key is set) |
| POST | `/api/insights` | `{ periods: [{ label, from, to }] }` — the current and up to 3 previous months → new advice |
| GET / PUT | `/api/settings` | `{ "income": 3200, "periodStart": 25 }` — monthly income and the day the budget month starts on |
| POST | `/api/import/preview` | `{ account, rows: [{ date, datetime, amount, original }] }` → rows with a `new / imported / skipped` status and a name and category suggested by the rules |
| GET | `/api/bank` | whether bank sync is configured, connected banks with their accounts and consent expiry |
| GET | `/api/bank/aspsps?country=CY` | names of the banks available for connecting in a country |
| POST | `/api/bank/connect` | `{ aspsp, country }` → `{ url }` — the bank page to send the browser to |
| GET | `/api/bank/callback?code=…&state=…` | where the bank sends the browser back; authorised by the one-time `state`, redirects to `/?bank=connected` |
| PUT | `/api/bank/accounts/:id` | `{ account }` — which app account the bank account maps to; `{ synced_to }` — reviewed up to this date |
| DELETE | `/api/bank/connections/:id` | disconnect a bank |
| GET | `/api/bank/transactions?account_id=…&from=…` | booked EUR transactions as rows for `/api/import/preview` |
| POST | `/api/import/commit` | `{ account, items: [{ …row, n, action: import/skip, note, category }] }` → `{ imported, skipped }` |

## Income

The "Income" panel is below the recurring payments: amount, source (suggestions: Salary, Freelance,
Refund… plus those entered before; you can type your own), date, note, account. Totals by source
are shown below the form.

The balance is calculated from the actual income for the reporting month. Until something is entered
for the month it uses "Planned income" from the "Left" tile, which also shows "Received … · plan …".

## AI advice

The "Budget advice" panel is below the "Where the money goes" bar: on request the LLM looks at the
current reporting month and the three previous ones and suggests what can be cut and how much that
would save. The result is saved for the month; "Refresh" requests a new analysis (at most 10
requests per hour).

The prompt is in English; the advice is written in the language selected in the interface. Saved
advice stays in the language it was generated in until you press "Refresh".

The LLM is chosen in `.env`; API addresses and default models are already configured:

```bash
LLM_PROVIDER=anthropic   # which LLM
LLM_KEY=sk-ant-…         # this provider's key (not needed for ollama)
LLM_MODEL=               # optional: your own model instead of the default one
LLM_BASE_URL=            # optional: your own API address (a proxy, Ollama on another machine)
```

| `LLM_PROVIDER` | LLM | Default model | Where to get a key |
|---|---|---|---|
| `anthropic` | Claude (official SDK) | `claude-opus-5-5` | console.anthropic.com → API Keys |
| `openai` | OpenAI | `gpt-5` | platform.openai.com → API keys |
| `gemini` | Google Gemini | `gemini-2.5-pro` | aistudio.google.com → Get API key |
| `mistral` | Mistral | `mistral-large-latest` | console.mistral.ai |
| `deepseek` | DeepSeek | `deepseek-chat` | platform.deepseek.com |
| `openrouter` | OpenRouter (any model) | `openai/gpt-5` | openrouter.ai/keys |
| `groq` | Groq | `llama-3.3-70b-versatile` | console.groq.com/keys |
| `xai` | xAI Grok | `grok-4` | console.x.ai |
| `ollama` | a local model (Ollama on the host, `http://host.docker.internal:11434`) | `llama3.1` | no key needed |

The default models, apart from Claude, are a starting point: if a provider renames a model, set your
own in `LLM_MODEL`. After changing `.env` run `docker compose up -d --build`.

**What is sent to the provider:** totals and number of expenses by category for 4 months, actual and
planned income (by source), recurring payments and subscriptions, the 20 largest spending items
(name up to 60 characters, category, amount) and totals by account. Account numbers and full
statement descriptions are not sent. With `ollama` the data never leaves your machine. An analysis
with Claude costs roughly 5–15 cents.

**How it works** (`app/src/llm/`): the base class `LlmProvider` (`base.js`) provides the shared
`generateJson()` method, JSON parsing and the common `LlmError` (an error code plus parameters; the
route turns it into a message in the UI language). Subclasses implement `complete()` for their
provider's API — `AnthropicProvider` (Anthropic SDK), `OpenAICompatibleProvider` and its subclasses
(OpenAI, Mistral, DeepSeek, OpenRouter, Groq, xAI), `GeminiProvider`, `OllamaProvider`. A new LLM is
a subclass with its own `id`, `label`, `baseUrl`, `defaultModel` plus a line in the `index.js` registry.

## Recurring payments and actual payments

Recurring payments and subscriptions are a reference list: their planned amounts are not added to
the totals. All figures at the top are calculated only from actual expenses in the reporting month.

- **"Expenses this month"** — every entry in the expenses table, including rent and subscription payments.
- **"Mandatory" and "Subscriptions"** — the part of those expenses linked to recurring payments of
  the corresponding kind; below the amount — "paid 2 of 3 · plan … / mo".
- **"Left"** = income − expenses for the month. Below it, for reference, "… of recurring payments
  still expected" — the plans of monthly payments not yet paid in this period (it does not affect
  the balance).
- **Linking to a payment:** the "Recurring payment" field in the expense form or in an import row.
  A payment in the list shows "paid 30.10, 01.11 · €2,313.47" or "not charged yet". Extra payments
  (the second part of the rent, a utilities top-up) are ordinary expenses and all count in the total.
- **CSV import:** the link is filled in automatically when the amount and a word of the name match
  (Netflix 15.99 ↔ "NETFLIX.COM 4421"). The choice is remembered in a rule together with the name
  and the category.
- **Which month a payment is for:** it counts for the nearest charge date according to the "Charge
  day" field. Rent charged on the 1st and paid on 27.09 is the payment for 01.10, so it lands in the
  reporting month that contains 1 October (taking "Month starts on day N" into account). In
  September such a payment is shown with a "for October" mark but is not included in the totals.
  If no charge day is set, the month is determined by the payment date. In the expense form the
  month can be chosen manually in the "For month" field.
- If a recurring payment is deleted, the expenses linked to it become ordinary ones.

## CSV import

The "Import CSV" button is in the header. Revolut and Bank of Cyprus are detected by their headers.
For any other CSV you choose the date, description and amount (or debit) columns. Pending and
non-EUR operations are skipped. Credits are shown with an "income" mark and a source field instead
of a category; transfers between your own accounts can be unchecked — this is remembered.

- Checked rows become expenses; unchecked ones are remembered as hidden and are not shown again.
  A hidden row can be brought back with the "Show hidden" checkbox.
- A transaction is recognised by a fingerprint of the original statement data (account, date/time,
  amount, description), so it is not duplicated on a repeated upload even if it was renamed or the
  expense was deleted.
- If you change the name or the category, this is remembered as a rule for the same bank description
  (without digits: card numbers and payment references) and filled in on later imports.

## Bank sync

An optional alternative to CSV files: transactions are read from the bank through
[Enable Banking](https://enablebanking.com), a licensed open banking (PSD2) aggregator, and go
through the same review list as a CSV import — you check, rename, pick categories and confirm.
Nothing is imported without review and there is no background sync.

Banks do not give individuals direct API access (it requires a payment provider licence), hence the
aggregator. Enable Banking lets a private person use a production application with their own
accounts only; check their current terms and pricing when you register.

**Setup**

1. Register at enablebanking.com and create a **production** application. Add the redirect URL
   `<site address>/api/bank/callback` (for example `http://localhost:8080/api/bank/callback`; if
   their control panel insists on HTTPS, use the address behind Caddy / Tailscale).
   The form also asks for a privacy URL and a terms URL: the app serves both, `<site address>/privacy.html`
   and `<site address>/terms.html` (edit `app/public/privacy.html` and `terms.html` to your liking).
2. Save the private key they give you as `secrets/enablebanking.pem` next to `docker-compose.yml`
   (the `secrets/` folder is in `.gitignore` and is mounted read-only into the app container).
3. In their control panel press "Activate by linking accounts" and link the accounts you want to read.
   The application only returns data for linked accounts.
4. Set in `.env` and run `docker compose up -d --build`:

```bash
EB_APP_ID=<application id>
EB_PRIVATE_KEY_FILE=/run/secrets/enablebanking.pem
EB_REDIRECT_URL=http://localhost:8080/api/bank/callback   # exactly as registered
```

**Use:** "Import CSV" → "From the bank". Choose the country and the bank, press "Connect bank",
sign in at the bank and confirm access; you come back with the accounts listed. For each account
choose which app account it belongs to and press "Sync": the transactions since the chosen date
appear in the review list below. After an import the next sync starts a week before that day, and
transactions already imported or hidden are recognised and not offered again.

**Good to know**

- The bank's consent expires (for most banks after up to 180 days). The panel shows the date and
  offers "Renew access" two weeks before; renewing keeps the account mapping.
- Many banks give history older than 90 days only within the first hour after signing in.
- Only booked EUR transactions are loaded; pending ones are skipped until the bank books them.
- Transactions imported earlier from a CSV file are not recognised as the same ones (the bank API
  words descriptions differently), so on the first sync uncheck them once — they are remembered as
  hidden. This is why the first sync starts at the current budget month by default.
- What is stored: the Enable Banking session id, the consent expiry, account names and the last 4
  characters of the IBAN. Bank credentials never pass through this app.

## Structure

```
docker-compose.yml         db, app, nginx; optional Cloudflare Tunnel (profile `tunnel`)
.env.example
nginx/default.conf         proxy, gzip, security headers (CSP); port 81 for the tunnel
app/
  Dockerfile
  package.json
  migrations/001_init.sql  recurring, expenses, settings tables
  migrations/002_import.sql  import_tx (statement transactions already seen), import_rules (renames)
  migrations/003_recurring_link.sql  links from expenses and import rules to recurring payments
  migrations/004_for_month.sql  which month a recurring payment is for
  migrations/005_incomes.sql  income, import of credits, separate rules for expenses and income
  migrations/006_ai_insights.sql  saved AI advice
  migrations/007_bank_sync.sql  bank connections and accounts for bank sync
  src/server.js            Fastify, running migrations
  src/auth.js              password sign-in, signed cookie
  src/i18n.js              language from the `lang` cookie, server messages
  src/locales/*.js         server messages by language
  src/routes/*.js          REST API with JSON Schema validation
  src/llm/*.js             LLM providers
  src/bank/enablebanking.js  Enable Banking client (JWT, sessions, transactions)
  public/                  interface (HTML + CSS + JS, no build step)
  public/i18n.js           interface translation, number and date formats
  public/locales/*.js      interface strings by language
  public/csv.js            CSV statement parsing (Revolut, BoC, manual mode)
```

## Development without Docker

```bash
cd app
npm install
DATABASE_URL=postgres://user:pass@localhost:5432/budget \
SESSION_SECRET=$(openssl rand -hex 32) APP_PASSWORD=dev npm run dev
# http://localhost:3000
```

## Ideas for later

- Scheduled background bank sync into a review queue.
- Charts by month, category limits.
