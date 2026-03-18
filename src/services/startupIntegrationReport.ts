import { execSync } from "node:child_process";
import { env } from "../config/env";
import { normalizeLokiSelector, GrafanaConnector } from "../connectors/grafana";
import { GoogleCalendarConnector } from "../connectors/googleCalendar";
import { JellyseerrConnector } from "../connectors/jellyseerr";
import { LlmStudioConnector } from "../connectors/llmStudio";
import { TrelloConnector } from "../connectors/trello";
import { GrafanaAlertsChannelService } from "./grafanaAlertsChannel";
import { GithubConnector } from "../connectors/github";

type CheckStatus = "ok" | "fail" | "skipped";

interface CheckResult {
  name: string;
  status: CheckStatus;
  details: string;
  durationMs: number;
}

const CHECK_TIMEOUT_MS = 15_000;

export class StartupIntegrationReportService {
  constructor(
    private readonly alertsChannel: GrafanaAlertsChannelService,
    private readonly grafana: GrafanaConnector,
    private readonly trello: TrelloConnector,
    private readonly googleCalendar: GoogleCalendarConnector,
    private readonly llmStudio: LlmStudioConnector,
    private readonly jellyseerr: JellyseerrConnector,
    private readonly github: GithubConnector
  ) {}

  async postStartupReport(): Promise<void> {
    const gitVersion = getGitVersion();
    const checks = await this.runChecks();
    const lines = [
      "Startup integration report:",
      `- Git version: ${gitVersion}`,
      `- Timestamp: ${new Date().toISOString()}`
    ];

    for (const check of checks) {
      const icon = check.status === "ok" ? "OK" : check.status === "fail" ? "FAIL" : "SKIP";
      lines.push(`- ${icon} ${check.name} (${check.durationMs}ms): ${check.details}`);
    }

    await this.alertsChannel.sendMessage(lines.join("\n"));
  }

  private async runChecks(): Promise<CheckResult[]> {
    const checks: Promise<CheckResult>[] = [];

    checks.push(
      Promise.resolve({
      name: "Matrix",
      status: "ok",
      details: `connected as ${env.MATRIX_BOT_USER_ID}`,
      durationMs: 0
      })
    );

    checks.push(
      this.runCheck("Grafana Alertmanager", env.hasGrafanaCredentials, async () => {
        const alerts = await this.grafana.getAlerts("all", 1);
        return `reachable, sample alerts: ${alerts.length}`;
      })
    );

    checks.push(
      this.runCheck("Grafana Loki", env.hasGrafanaCredentials, async () => {
        const selector = normalizeLokiSelector(env.GRAFANA_LOG_LABEL_SELECTOR);
        const logs = await this.grafana.queryLogs(`${selector} |~ ".+"`, 60 * 60_000, 1);
        return logs.length > 0 ? `reachable, latest log at ${logs[0].timestamp}` : "reachable, no logs in last 1h";
      })
    );

    checks.push(
      this.runCheck("GitHub", env.hasGithubCredentials, async () => {
        const summary = await this.github.getRepoSummary();
        return `reachable, repo ${summary.fullName}`;
      })
    );

    checks.push(
      this.runCheck("Trello", env.hasTrelloCredentials, async () => {
        const counts = await this.trello.getOpenCountsByListName();
        return `reachable, lists with open cards: ${Object.keys(counts).length}`;
      })
    );

    checks.push(
      this.runCheck("Google Calendar", env.hasGoogleCalendarCredentials, async () => {
        const events = await this.googleCalendar.getTodayEvents(1);
        return `reachable, today's sample events: ${events.length}`;
      })
    );

    checks.push(
      this.runCheck("LLM Studio", env.hasLlmStudioCredentials, async () => {
        const reply = await this.llmStudio.chat("Reply with exactly: pong");
        return `reachable, sample reply: ${truncate(reply.replace(/\s+/g, " "), 80)}`;
      })
    );

    checks.push(
      this.runCheck("Jellyseerr", env.hasJellyseerrCredentials, async () => {
        const results = await this.jellyseerr.search("matrix");
        return `reachable, sample search results: ${results.length}`;
      })
    );

    return await Promise.all(checks);
  }

  private async runCheck(
    name: string,
    configured: boolean,
    check: () => Promise<string>
  ): Promise<CheckResult> {
    if (!configured) {
      return { name, status: "skipped", details: "not configured", durationMs: 0 };
    }

    const started = Date.now();
    try {
      const details = await withTimeout(check(), CHECK_TIMEOUT_MS);
      return {
        name,
        status: "ok",
        details,
        durationMs: Date.now() - started
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        name,
        status: "fail",
        details: truncate(message.replace(/\s+/g, " "), 220),
        durationMs: Date.now() - started
      };
    }
  }
}

function getGitVersion(): string {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
    const commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim().length > 0;
    return `${branch}@${commit}${dirty ? " (dirty)" : ""}`;
  } catch {
    return "unknown";
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
    })
  ]);
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit - 3)}...`;
}
