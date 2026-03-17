# Matrix Assistant Bot

A Matrix bot that responds to chat commands and can pull data from:
- Google Calendar (`!calendar today`)
- Trello (`!trello due`)
- Grafana (`!grafana critical`, `!grafana alerts`, `!grafana incident`)
- LLM Studio (`!blimpf` by default, plus `!factcheck`)
- Seerr (Jellyseerr) (`!blimpf download`)
- Grafana security login alerts (optional, posts SSH password logins to Grafana Alerts room)
- Grafana qbittorrent alerts (optional, posts downloads started/finished to Grafana Alerts room)

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
- `!blimpf PROMPT` (default prompt command; can be renamed)
- `!blimpf download MOVIE`
- `!blimpf weather`
- `!blimpf rundown`
- `!factcheck` (reply to a message)
- `!admin rename "NAME" [!command]`
- `!admin command !name`
- `!admin allow @user:server`
- `!admin deny @user:server`
- `!admin allowseerr @user:server`
- `!admin denyseerr @user:server`
- `!admin users`
- `!admin open on|off|status`
- `!admin listprompts`
- `!admin changemodel MODEL_NAME`
- `!admin promptinfo`
- `!admin sysinfo`
- `!admin location NAME`
- `!admin setglobalprompt "PROMPT"`
- `!admin setglobalfactcheckprompt "PROMPT"`
- `!admin setmonitorprompt "PROMPT"`
- `!admin status`
- `!admin monitors`
- `!admin showmonitoring [N]`
- `!admin showmonitor [N]`
- `!admin monitor show [N]`
- `!admin unmonitor N`
- `!admin unmonitor name`
- `!admin monitor "container" "sample log"`
- `!admin monitorlabel name key=value`
- `!admin setqbitlabel "{label=\"value\"}"`
- `!admin addqbitlabel key=value`
- `!admin clearqbitlabel`

`!trello create` supports natural dates like `tomorrow`, `end of week`, `next friday`, `in 3 days`, `the 15th`, and `15`.
Reply to the bot's card-created message to append your reply text to the Trello card description.

Integration commands require credentials in `.env`.
Admin commands require the user to be listed in `MATRIX_ALLOWED_USERS`.

LLM Studio supports optional global prompts via:
- `LLM_STUDIO_GLOBAL_PROMPT`
- `LLM_STUDIO_FACTCHECK_PROMPT`

User-configured prompts and monitors are stored in `user-config.json` so they persist across updates.

Qbittorrent alerts use a default Loki label selector of `{container="qbittorrent",job="qbittorrent"}`.
Override it with `!admin setqbitlabel "{container=\"qbittorrent\",host=\"mushroom\"}"` or add labels via
`!admin addqbitlabel host=mushroom`.

## 4. Configuration

All settings go in `.env`.

See [docs/SETUP.md](docs/SETUP.md) for a simple walkthrough.
