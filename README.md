# Matrix Assistant Bot

A Matrix bot that responds to chat commands and can pull data from:
- Google Calendar (`!calendar today`)
- Trello (`!trello due`)

## 1. Prerequisites

- Node.js 20+
- A Matrix user account for the bot on your Matrix homeserver

## 2. Install and run

```bash
npm install
cp .env.example .env
npm run dev
```

For production:

```bash
npm run build
npm start
```

## 3. Bot commands

- `!ping`
- `!help`
- `!calendar today`
- `!trello due`

Integration commands require credentials in `.env`.

## 4. Configuration

All settings go in `.env`.

See [docs/SETUP.md](docs/SETUP.md) for a simple walkthrough.
