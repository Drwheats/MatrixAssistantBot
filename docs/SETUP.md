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

Required only for `!trello due`.

1. Get API key from Trello developer page.
2. Generate an API token for your account.
3. Find your board ID:
   - Open board, then use browser URL/dev tools or Trello API docs to get board id.
4. Put these in `.env`:
   - `TRELLO_API_KEY`
   - `TRELLO_API_TOKEN`
   - `TRELLO_BOARD_ID`

Test in room:

- `!trello due`

## Step 7: Run bot

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
- No bot reply: confirm bot is in room, token is valid, and homeserver URL is correct.
