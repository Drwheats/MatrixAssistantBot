import { CommandContext } from "../types/commandContext";

const DEFAULT_WINDOW = "24h";

export async function handleGrafanaCommand(ctx: CommandContext): Promise<void> {
  if (!ctx.isAdminUser) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "You are not allowed to use Grafana commands."
    });
    return;
  }

  const match = ctx.commandBody.trim().match(/^!grafana(?:\s+(.+))?$/i);
  const args = (match?.[1] ?? "").trim();
  if (!args || args.toLowerCase() === "help") {
    await sendHelp(ctx);
    return;
  }

  const tokens = args.split(/\s+/);
  const sub = tokens[0].toLowerCase();

  try {
    if (sub === "critical") {
      const windowRaw = tokens[1] ?? DEFAULT_WINDOW;
      const windowMs = parseWindowToMs(windowRaw);
      if (!windowMs) {
        await invalidWindow(ctx, windowRaw);
        return;
      }

      const logs = await ctx.grafana.getCriticalLogs(windowMs, 10);
      const body =
        logs.length === 0
          ? `No critical logs in the last ${windowRaw}.`
          : [
              `Critical logs in last ${windowRaw}:`,
              ...logs.map((l) => `- ${formatEST(l.timestamp)} EST: ${compact(l.message)}`)
            ].join("\n");
      await sendText(ctx, body);
      return;
    }

    if (sub === "alerts") {
      const state = normalizeAlertState(tokens[1] ?? "firing");
      if (!state) {
        await sendText(ctx, "Usage: !grafana alerts [firing|pending|resolved|all]");
        return;
      }

      const alerts = await ctx.grafana.getAlerts(state, 10);
      const body =
        alerts.length === 0
          ? `No ${state} alerts.`
          : [
              `Grafana alerts (${state}):`,
              ...alerts.map(
                (a) =>
                  `- [${a.severity}] ${a.name} (${a.state})${a.startsAt ? ` since ${formatEST(a.startsAt)} EST` : ""}${
                    a.summary ? ` - ${compact(a.summary, 120)}` : ""
                  }`
              )
            ].join("\n");
      await sendText(ctx, body);
      return;
    }

    if (sub === "incident") {
      const windowRaw = tokens[1] ?? DEFAULT_WINDOW;
      const windowMs = parseWindowToMs(windowRaw);
      if (!windowMs) {
        await invalidWindow(ctx, windowRaw);
        return;
      }

      const summary = await ctx.grafana.getIncidentSnapshot(windowMs);
      const topServicesLine =
        summary.topServices.length === 0
          ? "none"
          : summary.topServices.map((s) => `${s.service}(${s.count})`).join(", ");
      const body = [
        `Incident snapshot (${windowRaw}):`,
        `- Critical logs: ${summary.criticalCount}`,
        `- Top impacted services: ${topServicesLine}`,
        `- Firing alerts: ${summary.firingAlerts.length}`,
        summary.latestCritical ? `- Latest critical log: ${formatEST(summary.latestCritical)} EST` : ""
      ]
        .filter((line) => line.length > 0)
        .join("\n");
      await sendText(ctx, body);
      return;
    }

    if (sub === "errors") {
      const parsed = parseServiceAndWindow(args, "errors", DEFAULT_WINDOW);
      if (!parsed) {
        await sendText(ctx, 'Usage: !grafana errors [service] [window]\nExamples: !grafana errors 6h, !grafana errors api 6h, !grafana errors "api service" 6h');
        return;
      }

      const windowMs = parseWindowToMs(parsed.windowRaw);
      if (!windowMs) {
        await invalidWindow(ctx, parsed.windowRaw);
        return;
      }

      const logs = await ctx.grafana.getErrorLogs(windowMs, 10, parsed.service);
      const scope = parsed.service ? ` for ${parsed.service}` : "";
      const body =
        logs.length === 0
          ? `No error logs${scope} in the last ${parsed.windowRaw}.`
          : [
              `Error logs${scope} in last ${parsed.windowRaw}:`,
              ...logs.map((l) => `- ${formatEST(l.timestamp)} EST: ${compact(l.message)}`)
            ].join("\n");
      await sendText(ctx, body);
      return;
    }

    if (sub === "service") {
      const parsed = parseServiceAndWindow(args, "service", DEFAULT_WINDOW);
      if (!parsed?.service) {
        await sendText(
          ctx,
          'Usage: !grafana service "NAME" [window]\nExamples: !grafana service "payments-api" 24h, !grafana service api 6h'
        );
        return;
      }

      const windowMs = parseWindowToMs(parsed.windowRaw);
      if (!windowMs) {
        await invalidWindow(ctx, parsed.windowRaw);
        return;
      }

      const snapshot = await ctx.grafana.getServiceSnapshot(parsed.service, windowMs);
      const lines = [
        `Service snapshot: ${parsed.service} (${parsed.windowRaw})`,
        `- Critical logs: ${snapshot.criticalCount}`,
        `- Error logs: ${snapshot.errorCount}`
      ];
      if (snapshot.recentLogs.length > 0) {
        lines.push("- Recent logs:");
        lines.push(...snapshot.recentLogs.map((l) => `  ${formatEST(l.timestamp)} EST: ${compact(l.message, 160)}`));
      }
      await sendText(ctx, lines.join("\n"));
      return;
    }

    if (sub === "spikes") {
      const windowRaw = tokens[1] ?? DEFAULT_WINDOW;
      const windowMs = parseWindowToMs(windowRaw);
      if (!windowMs) {
        await invalidWindow(ctx, windowRaw);
        return;
      }

      const current = await ctx.grafana.getErrorCountsByService(windowMs, 20);
      const previous = await ctx.grafana.getErrorCountsByServicePreviousWindow(windowMs, 20);
      const previousMap = new Map(previous.map((p) => [p.service, p.count]));
      const spikes = current
        .map((c) => {
          const before = previousMap.get(c.service) ?? 0;
          return {
            service: c.service,
            now: c.count,
            before,
            delta: c.count - before
          };
        })
        .filter((x) => x.delta > 0)
        .sort((a, b) => b.delta - a.delta)
        .slice(0, 8);

      const body =
        spikes.length === 0
          ? `No rising error spikes in the last ${windowRaw} compared to the previous ${windowRaw}.`
          : [
              `Error spikes (${windowRaw} vs previous ${windowRaw}):`,
              ...spikes.map((s) => `- ${s.service}: ${s.now} now vs ${s.before} before (delta +${s.delta})`)
            ].join("\n");
      await sendText(ctx, body);
      return;
    }

    if (sub === "query") {
      const parsed = parseQueryAndWindow(args);
      if (!parsed) {
        await sendText(
          ctx,
          'Usage: !grafana query "LOKI_QUERY" [window]\nExample: !grafana query "{app=\\"api\\"} |= \\"panic\\"" 2h'
        );
        return;
      }

      const windowMs = parseWindowToMs(parsed.windowRaw);
      if (!windowMs) {
        await invalidWindow(ctx, parsed.windowRaw);
        return;
      }

      const logs = await ctx.grafana.queryLogs(parsed.query, windowMs, 10);
      const body =
        logs.length === 0
          ? `No results for query in last ${parsed.windowRaw}.`
          : [`Query results (${parsed.windowRaw}):`, ...logs.map((l) => `- ${formatEST(l.timestamp)} EST: ${compact(l.message)}`)].join("\n");
      await sendText(ctx, body);
      return;
    }

    await sendHelp(ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isBadRequest = typeof message === "string" && message.includes("400");
    const hint = isBadRequest ? " (Bad request: check label selector or query syntax.)" : "";
    await sendText(ctx, `Grafana error: ${message}${hint}`);
  }
}

function parseWindowToMs(raw: string): number | null {
  const match = raw.trim().toLowerCase().match(/^(\d+)(m|h|d)$/);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  if (!Number.isInteger(amount) || amount <= 0) {
    return null;
  }

  const unit = match[2];
  if (unit === "m") return amount * 60_000;
  if (unit === "h") return amount * 3_600_000;
  if (unit === "d") return amount * 86_400_000;
  return null;
}

function normalizeAlertState(raw: string): "firing" | "pending" | "resolved" | "all" | null {
  const value = raw.trim().toLowerCase();
  if (value === "firing" || value === "pending" || value === "resolved" || value === "all") {
    return value;
  }
  return null;
}

function formatEST(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function compact(value: string, max = 200): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}...`;
}

async function sendHelp(ctx: CommandContext): Promise<void> {
  await sendText(
    ctx,
    [
      "Grafana commands:",
      "!grafana critical [window] - critical logs (default 24h, window examples: 30m, 6h, 2d)",
      "!grafana errors [service] [window] - error logs by optional service",
      "!grafana alerts [state] - alert list (state: firing|pending|resolved|all)",
      "!grafana incident [window] - compact incident summary",
      "!grafana service \"NAME\" [window] - one-service summary",
      "!grafana spikes [window] - compare error counts to previous window",
      "!grafana query \"LOKI_QUERY\" [window] - raw Loki query"
    ].join("\n")
  );
}

async function invalidWindow(ctx: CommandContext, raw: string): Promise<void> {
  await sendText(ctx, `Invalid window "${raw}". Use formats like 30m, 6h, or 2d.`);
}

async function sendText(ctx: CommandContext, body: string): Promise<void> {
  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body
  });
}

function parseServiceAndWindow(
  args: string,
  subcommand: "errors" | "service",
  defaultWindow: string
): { service?: string; windowRaw: string } | null {
  const rest = args.replace(new RegExp(`^${subcommand}\\s*`, "i"), "").trim();
  if (!rest) {
    return subcommand === "errors" ? { windowRaw: defaultWindow } : null;
  }

  const quoted = rest.match(/^"([^"]+)"(?:\s+(.+))?$/);
  if (quoted) {
    const service = quoted[1].trim();
    const maybeWindow = (quoted[2] ?? "").trim();
    return {
      service,
      windowRaw: maybeWindow || defaultWindow
    };
  }

  const parts = rest.split(/\s+/);
  if (parts.length === 1) {
    if (parseWindowToMs(parts[0])) {
      return subcommand === "errors" ? { windowRaw: parts[0] } : null;
    }
    return {
      service: parts[0],
      windowRaw: defaultWindow
    };
  }

  const maybeWindow = parts[parts.length - 1];
  if (!parseWindowToMs(maybeWindow)) {
    return subcommand === "errors"
      ? { service: rest, windowRaw: defaultWindow }
      : { service: rest, windowRaw: defaultWindow };
  }

  return {
    service: parts.slice(0, -1).join(" "),
    windowRaw: maybeWindow
  };
}

function parseQueryAndWindow(args: string): { query: string; windowRaw: string } | null {
  const rest = args.replace(/^query\s*/i, "").trim();
  const quoted = rest.match(/^"([^"]+)"(?:\s+(\S+))?$/);
  if (quoted) {
    return {
      query: quoted[1],
      windowRaw: quoted[2] ?? DEFAULT_WINDOW
    };
  }

  const unquoted = rest.match(/^(.+?)(?:\s+(\S+))?$/);
  if (!unquoted) {
    return null;
  }

  const maybeWindow = unquoted[2];
  if (maybeWindow && parseWindowToMs(maybeWindow)) {
    return {
      query: unquoted[1].trim(),
      windowRaw: maybeWindow
    };
  }

  return {
    query: rest,
    windowRaw: DEFAULT_WINDOW
  };
}
