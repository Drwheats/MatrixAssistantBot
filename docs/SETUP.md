# Simple Setup Guide

This guide is written for first-time setup.

## Step 1: Install dependencies

From the project folder:

```bash
npm install
```

## Step 2: Create your local config file

```bash
cp .env.example .env
```

Open `.env` and set these first:

- `MATRIX_HOMESERVER_URL`: your homeserver URL (example: `https://matrix.yourdomain.com`)
- `MATRIX_ACCESS_TOKEN`: access token of your bot user
- `MATRIX_BOT_USER_ID`: Matrix ID of bot user (example: `@assistantbot:yourdomain.com`)
- `MATRIX_ALLOWED_USERS`: your Matrix ID, or leave empty to allow everyone

## Step 3: Create the Matrix bot user and token

You need a Matrix account for the bot.

### Option A: Register via Element app (easy)

1. Open Element (web or desktop) connected to your homeserver.
2. Register a new account for the bot (example username: `assistantbot`).
3. Log in as that bot user.
4. Get an access token:
   - In Element Web, open Developer Tools in your browser.
   - In Console, run:
     ```js
     localStorage.getItem("mx_access_token")
     ```
   - Copy the token into `.env` as `MATRIX_ACCESS_TOKEN`.
5. Put the bot user ID in `.env` as `MATRIX_BOT_USER_ID` (example `@assistantbot:yourdomain.com`).

### Option B: Use your homeserver admin tools

If you already know how to generate access tokens for users on your server, use that method.

## Step 4: Invite bot to a room

From your normal Matrix account:

1. Create or open a room.
2. Invite the bot user.
3. Send in room:
   - `!ping`

If setup is correct, bot replies `pong`.

Admin commands require the sender to be listed in `MATRIX_ALLOWED_USERS`.

User-configured prompts and monitors are stored in `user-config.json` in the project root so they persist across updates.

Admin command examples:
- `!admin rename "New Bot Name" !ask`
- `!admin command !ask`
- `!admin allow @friend:yourdomain.com`
- `!admin deny @friend:yourdomain.com`
- `!admin open on`
- `!admin open off`
- `!admin monitor "mushroom" "2026-03-11T15:08:47... Accepted password for mushroom ..."`
- `!admin showmonitoring 10`
- `!admin unmonitor 3`
- `!admin monitorlabel mushroom host=mushroom`
- `!admin setmonitorprompt "PROMPT"`

## Step 5: Configure Google Calendar (optional)

Required only for `!calendar today`.

1. In Google Cloud Console, create a project.
2. Enable **Google Calendar API**.
3. Create a **Service Account**.
4. Create a key for it (JSON key).
5. From that JSON, copy:
   - `client_email` -> `GOOGLE_CALENDAR_CLIENT_EMAIL`
   - `private_key` -> `GOOGLE_CALENDAR_PRIVATE_KEY`
6. Important: Keep escaped newlines in `.env` (`\\n`) as shown in `.env.example`.
7. Share your target Google Calendar with the service account email (from `client_email`) with at least "See all event details".
8. Set `GOOGLE_CALENDAR_ID`:
   - Use `primary` for that account's primary calendar, or
   - Use a specific calendar ID from Google Calendar settings.

Test in room:

- `!calendar today`

## Step 6: Configure Trello (optional)

Required for:
- `!trello due`
- `!trello overdue`
- `!trello create "TASK" DATE`
- Weekly announcement message (Monday 10:30 local time)
- Due reminders (1 hour and 5 minutes before due time)

1. Get API key from Trello developer page https://trello.com/power-ups/admin
2. Generate an API token for your account
3. Find your board ID:
   - Open board, then use browser URL/dev tools or Trello API docs to get board id.
4. Put these in `.env`:
   - `TRELLO_API_KEY`
   - `TRELLO_API_TOKEN`
   - `TRELLO_BOARD_ID`
   - Optional: `TRELLO_DEFAULT_LIST_ID` (used by `!trello create`; if omitted, bot uses first open list)

Test in room:

- `!trello due`
- `!trello overdue`
- `!trello create "Submit report" tomorrow`
- `!trello create "Submit report" next friday`
- `!trello create "Submit report" in 3 days`
- `!trello create "Submit report" the 15th`
- `!trello create "Submit report" 15`

After creating a card, reply to the bot's "Created Trello card..." message with plain text to append that text to the card description.

After the bot starts, it also creates a private room named `Assistant Bot Announcements` on first run and invites users from `MATRIX_ALLOWED_USERS`. Scheduled Trello announcements are sent there.

## Step 7: Configure Grafana (optional)

Required for `!grafana` commands.

1. Create a Grafana API token with read access to logs/alerts.
2. Find your Loki datasource UID in Grafana.
3. Put these in `.env`:
   - `GRAFANA_URL`
   - `GRAFANA_TOKEN`
   - `GRAFANA_LOKI_DATASOURCE_UID`
   - Optional: `GRAFANA_LOG_LABEL_SELECTOR` (for example `{app="api"}`)
   - Optional: `GRAFANA_INCIDENT_SERVICE_LABEL` (defaults to `service`)
   - Optional: `GRAFANA_SECURITY_LOGIN_ALERTS_ENABLED` (enable SSH password login alerts)
   - Optional: `GRAFANA_SECURITY_LOGIN_QUERY` (override Loki query for password logins)
   - Optional: `GRAFANA_SECURITY_LOGIN_LABEL_SELECTOR` (override label selector for password logins)
   - Optional: `GRAFANA_SECURITY_LOGIN_POLL_MS` (poll interval, default 15000)
   - Optional: `GRAFANA_SECURITY_LOGIN_LOOKBACK_MS` (lookback window, default 300000)
   - Optional: `GRAFANA_SECURITY_LOGIN_LIMIT` (max logs per poll, default 50)

Test in room:

- `!grafana help`
- `!grafana critical 24h`
- `!grafana errors api 6h`
- `!grafana alerts firing`
- `!grafana incident 24h`
- `!grafana service "payments-api" 24h`
- `!grafana spikes 6h`
- `!grafana query "{app=\"api\"} |= \"panic\"" 2h`

When enabled, the bot will post SSH password login logs to the private `Grafana Alerts` room as they appear.

Optional qbittorrent download alerts (from Loki logs):
- `GRAFANA_QBITTORRENT_ALERTS_ENABLED` (enable qbittorrent alerts)
- `GRAFANA_QBITTORRENT_POLL_MS` (poll interval, default 15000)
- `GRAFANA_QBITTORRENT_LOOKBACK_MS` (lookback window, default 300000)
- `GRAFANA_QBITTORRENT_LIMIT` (max logs per poll, default 50)

When enabled, the bot will post qbittorrent download start/finish events to the `Grafana Alerts` room.
Default label selector is `{container="qbittorrent",job="qbittorrent"}`. You can override it via:
- `!admin setqbitlabel "{container=\"qbittorrent\",host=\"mushroom\"}"`
- `!admin addqbitlabel host=mushroom`
- `!admin clearqbitlabel`

## Step 8: Configure LLM Studio (optional)

Required for:
- `!blimpf PROMPT` (default prompt command; can be renamed)
- `!factcheck` (reply to a message)

1. Run LLM Studio and enable the OpenAI-compatible API server.
2. Choose the base URL the bot can reach:
   - If the bot runs on the same machine as LLM Studio, use `http://127.0.0.1:1234`
   - If the bot runs on another machine, use your LAN IP (example `http://192.168.2.61:1234`)
3. Put these in `.env`:
   - `LLM_STUDIO_BASE_URL` (example `http://127.0.0.1:1234` or `http://192.168.2.61:1234`)
   - `LLM_STUDIO_MODEL` (model name loaded in LLM Studio, required)
   - Optional: `LLM_STUDIO_API_KEY` (if you enabled auth in LLM Studio)
   - Optional: `LLM_STUDIO_TEMPERATURE` (default 0.2)
   - Optional: `LLM_STUDIO_MAX_TOKENS` (default 700)
   - Optional: `LLM_STUDIO_TIMEOUT_MS` (default 30000)
   - Optional: `LLM_STUDIO_GLOBAL_PROMPT` (system prompt applied to all LLM requests)
   - Optional: `LLM_STUDIO_FACTCHECK_PROMPT` (system prompt for factchecks)

Test in room:

- `!blimpf Write a one-sentence summary of this channel.`
- Reply to any message with `!factcheck`

Admin prompt overrides:
- `!admin setglobalprompt "PROMPT"`
- `!admin setglobalfactcheckprompt "PROMPT"`
- `!admin setmonitorprompt "PROMPT"`

## Step 9: Run bot

Development:

```bash
npm run dev
```

Production build:

```bash
npm run build
npm start
```

## Troubleshooting

- `Unknown command`: use `!help` to list commands.
- `Google Calendar is not configured`: one or more Google env vars are missing.
- `Trello is not configured`: one or more Trello env vars are missing.
- `Grafana is not configured`: one or more Grafana env vars are missing.
- No bot reply: confirm bot is in room, token is valid, and homeserver URL is correct.
