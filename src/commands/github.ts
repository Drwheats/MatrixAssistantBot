import { CommandContext } from "../types/commandContext";
import { sendErrorReply } from "../utils/errorReactions";

export async function handleGithubCommand(ctx: CommandContext): Promise<void> {
  if (!ctx.isAdminUser) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "You are not allowed to use GitHub commands."
    });
    return;
  }

  const match = ctx.commandBody.trim().match(/^!github(?:\s+(.+))?$/i);
  const args = (match?.[1] ?? "").trim();
  if (!args || args.toLowerCase() === "help") {
    await sendHelp(ctx);
    return;
  }

  const sub = args.split(/\s+/)[0]?.toLowerCase();

  try {
    if (sub === "summary" || sub === "status") {
      await sendSummary(ctx);
      return;
    }

    if (sub === "updates" || sub === "commits") {
      await sendUpdates(ctx);
      return;
    }

    if (sub === "issues") {
      await sendIssues(ctx);
      return;
    }

    if (sub === "prs" || sub === "pulls" || sub === "pullrequests") {
      await sendPullRequests(ctx);
      return;
    }

    if (sub === "ci" || sub === "runs" || sub === "actions") {
      await sendWorkflowRuns(ctx);
      return;
    }

    await sendHelp(ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await sendErrorReply(ctx, ctx.eventId, `GitHub error: ${message}`);
  }
}

async function sendSummary(ctx: CommandContext): Promise<void> {
  const summary = await ctx.github.getRepoSummary();
  const lines = [
    `GitHub repo: ${summary.fullName}`,
    `- Default branch: ${summary.defaultBranch}`,
    `- Open issues: ${summary.openIssuesCount}`,
    `- Stars: ${summary.stargazersCount}`,
    summary.pushedAt ? `- Last push: ${formatDate(summary.pushedAt)}` : "",
    summary.description ? `- Description: ${summary.description}` : "",
    `- URL: ${summary.htmlUrl}`
  ].filter((line) => line.length > 0);

  await sendText(ctx, lines.join("\n"));
}

async function sendUpdates(ctx: CommandContext): Promise<void> {
  const commits = await ctx.github.getRecentCommits(5);
  const body =
    commits.length === 0
      ? "No recent commits found."
      : [
          "Recent repo updates:",
          ...commits.map((c) => `- ${c.sha} ${c.message} (${c.authorName}${c.authoredAt ? `, ${formatDate(c.authoredAt)}` : ""})`)
        ].join("\n");
  await sendText(ctx, body);
}

async function sendIssues(ctx: CommandContext): Promise<void> {
  const issues = await ctx.github.getOpenIssues(5);
  const body =
    issues.length === 0
      ? "No open issues."
      : [
          "Open issues:",
          ...issues.map((i) => `- #${i.number} ${i.title} (${i.state}${i.updatedAt ? `, updated ${formatDate(i.updatedAt)}` : ""})`)
        ].join("\n");
  await sendText(ctx, body);
}

async function sendPullRequests(ctx: CommandContext): Promise<void> {
  const prs = await ctx.github.getPullRequests(5);
  const body =
    prs.length === 0
      ? "No open pull requests."
      : [
          "Open pull requests:",
          ...prs.map((pr) => `- #${pr.number} ${pr.title} (${pr.state}${pr.updatedAt ? `, updated ${formatDate(pr.updatedAt)}` : ""})`)
        ].join("\n");
  await sendText(ctx, body);
}

async function sendWorkflowRuns(ctx: CommandContext): Promise<void> {
  const runs = await ctx.github.getWorkflowRuns(5);
  const body =
    runs.length === 0
      ? "No workflow runs found."
      : [
          "Recent CI/CD workflow runs:",
          ...runs.map((run) =>
            `- ${run.name}: ${run.status}${run.conclusion ? `/${run.conclusion}` : ""}${
              run.branch ? ` [${run.branch}]` : ""
            }${run.createdAt ? ` at ${formatDate(run.createdAt)}` : ""}`
          )
        ].join("\n");
  await sendText(ctx, body);
}

async function sendHelp(ctx: CommandContext): Promise<void> {
  await sendText(
    ctx,
    [
      "GitHub commands:",
      "!github summary - repo overview",
      "!github updates - latest commits",
      "!github issues - open issues",
      "!github prs - open pull requests",
      "!github ci - recent workflow runs",
      "!github help - this help"
    ].join("\n")
  );
}

async function sendText(ctx: CommandContext, body: string): Promise<void> {
  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body
  });
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}
