# Matrix Assistant Bot

A Matrix bot that responds to chat commands and can pull data from:
- Google Calendar (`!calendar today`)
- Trello (`!trello due`)
- Grafana (`!grafana critical`, `!grafana alerts`, `!grafana incident`)
- LLM Studio (`!blimpf`, `!factcheck`)
- Grafana security login alerts (optional, posts SSH password logins to Grafana Alerts room)
- 1Password sign-in alerts (optional, posts successful sign-ins to Grafana Alerts room)

It also sends scheduled Trello announcements in a dedicated room:
- Weekly digest on Monday at 10:30 (local server time)
- 1 hour before a task is due
- 5 minutes before a task is due

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
- `!trello overdue`
- `!trello create "TASK" DATE`
- `!grafana help`
- `!grafana critical [window]`
- `!grafana errors [service] [window]`
- `!grafana alerts [state]`
- `!grafana incident [window]`
- `!grafana service "NAME" [window]`
- `!grafana spikes [window]`
- `!grafana query "LOKI_QUERY" [window]`
- `!blimpf PROMPT`
- `!factcheck` (reply to a message)

`!trello create` supports natural dates like `tomorrow`, `end of week`, `next friday`, `in 3 days`, `the 15th`, and `15`.
Reply to the bot's card-created message to append your reply text to the Trello card description.

Integration commands require credentials in `.env`.

## 4. Configuration

All settings go in `.env`.

See [docs/SETUP.md](docs/SETUP.md) for a simple walkthrough.
