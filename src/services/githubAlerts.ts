import { env } from "../config/env";
import { GithubConnector } from "../connectors/github";
import { GrafanaAlertsChannelService } from "./grafanaAlertsChannel";
import { BotStateStore } from "./botStateStore";

const DEFAULT_POLL_MS = 60_000;
const DEFAULT_LIMIT = 20;
const DEFAULT_DEDUPE_LIMIT = 5000;
const FAILED_CI_CONCLUSIONS = new Set(["failure", "timed_out", "startup_failure", "action_required"]);

export class GithubAlertsService {
  private intervalHandle: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly github: GithubConnector,
    private readonly alertsChannel: GrafanaAlertsChannelService,
    private readonly stateStore: BotStateStore
  ) {}

  async start(): Promise<void> {
    if (!env.hasGithubCredentials || !env.githubAlertsEnabled) {
      return;
    }

    try {
      await this.checkAndSend();
    } catch (error) {
      console.error("GitHub alert check failed during startup:", error);
    }

    this.intervalHandle = setInterval(() => {
      this.checkAndSend().catch((error) => {
        console.error("GitHub alert check failed:", error);
      });
    }, env.githubAlertsPollMs ?? DEFAULT_POLL_MS);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private async checkAndSend(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    try {
      const state = await this.stateStore.load();
      const limit = env.githubAlertsLimit ?? DEFAULT_LIMIT;
      const [issues, pulls, runs] = await Promise.all([
        this.github.getOpenIssues(limit),
        this.github.getPullRequests(limit),
        this.github.getWorkflowRuns(limit)
      ]);

      const issueSeen = new Set(state.githubIssueSeenKeys ?? []);
      const pullSeen = new Set(state.githubPullSeenKeys ?? []);
      const failedRunSeen = new Set(state.githubFailedRunSeenKeys ?? []);

      const issueKeys = issues.map((issue) => String(issue.number));
      const pullKeys = pulls.map((pull) => String(pull.number));
      const failedRuns = runs.filter((run) => !!run.conclusion && FAILED_CI_CONCLUSIONS.has(run.conclusion));
      const failedRunKeys = failedRuns.map((run) => String(run.id));

      const firstIssueSync = issueSeen.size === 0;
      const firstPullSync = pullSeen.size === 0;

      if (!firstIssueSync) {
        const freshIssues = issues.filter((issue) => !issueSeen.has(String(issue.number)));
        for (const issue of freshIssues.slice().reverse()) {
          await this.alertsChannel.sendMessage(this.formatIssueAlert(issue));
        }
      }

      if (!firstPullSync) {
        const freshPulls = pulls.filter((pull) => !pullSeen.has(String(pull.number)));
        for (const pull of freshPulls.slice().reverse()) {
          await this.alertsChannel.sendMessage(this.formatPullAlert(pull));
        }
      }

      const freshFailedRuns = failedRuns.filter((run) => !failedRunSeen.has(String(run.id)));
      for (const run of freshFailedRuns.slice().reverse()) {
        await this.alertsChannel.sendMessage(this.formatFailedRunAlert(run));
      }

      state.githubIssueSeenKeys = mergeUnique([...issueSeen], issueKeys, DEFAULT_DEDUPE_LIMIT);
      state.githubPullSeenKeys = mergeUnique([...pullSeen], pullKeys, DEFAULT_DEDUPE_LIMIT);
      state.githubFailedRunSeenKeys = mergeUnique([...failedRunSeen], failedRunKeys, DEFAULT_DEDUPE_LIMIT);
      await this.stateStore.save({
        githubIssueSeenKeys: state.githubIssueSeenKeys,
        githubPullSeenKeys: state.githubPullSeenKeys,
        githubFailedRunSeenKeys: state.githubFailedRunSeenKeys
      });
    } finally {
      this.isRunning = false;
    }
  }

  private formatIssueAlert(issue: { number: number; title: string; updatedAt?: string; htmlUrl: string }): string {
    const repo = `${env.GITHUB_OWNER}/${env.GITHUB_REPO}`;
    const lines = [`GitHub alert: New issue in ${repo}`, `Issue: #${issue.number} ${issue.title}`];
    if (issue.updatedAt) {
      lines.push(`Updated: ${issue.updatedAt}`);
    }
    lines.push(`URL: ${issue.htmlUrl}`);
    return lines.join("\n");
  }

  private formatPullAlert(pull: { number: number; title: string; updatedAt?: string; htmlUrl: string }): string {
    const repo = `${env.GITHUB_OWNER}/${env.GITHUB_REPO}`;
    const lines = [`GitHub alert: New pull request in ${repo}`, `PR: #${pull.number} ${pull.title}`];
    if (pull.updatedAt) {
      lines.push(`Updated: ${pull.updatedAt}`);
    }
    lines.push(`URL: ${pull.htmlUrl}`);
    return lines.join("\n");
  }

  private formatFailedRunAlert(run: {
    id: number;
    name: string;
    status: string;
    conclusion?: string;
    branch?: string;
    createdAt?: string;
    htmlUrl: string;
  }): string {
    const repo = `${env.GITHUB_OWNER}/${env.GITHUB_REPO}`;
    const lines = [
      `GitHub alert: Failed CI/CD run in ${repo}`,
      `Workflow: ${run.name}`,
      `State: ${run.status}${run.conclusion ? `/${run.conclusion}` : ""}`
    ];
    if (run.branch) {
      lines.push(`Branch: ${run.branch}`);
    }
    if (run.createdAt) {
      lines.push(`Created: ${run.createdAt}`);
    }
    lines.push(`URL: ${run.htmlUrl}`);
    return lines.join("\n");
  }
}

function mergeUnique(existing: string[], incoming: string[], limit: number): string[] {
  const set = new Set(existing);
  for (const value of incoming) {
    set.add(value);
  }
  const merged = [...set];
  return merged.length > limit ? merged.slice(-limit) : merged;
}
