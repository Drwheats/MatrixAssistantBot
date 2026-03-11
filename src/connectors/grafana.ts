import { env } from "../config/env";

export interface GrafanaLogEntry {
  timestamp: string;
  message: string;
  labels: Record<string, string>;
}

export interface GrafanaAlertSummary {
  name: string;
  severity: string;
  state: string;
  startsAt: string;
  summary: string;
}

interface LokiQueryRangeResponse {
  data?: {
    result?: Array<{
      stream?: Record<string, string>;
      values?: Array<[string, string]>;
    }>;
  };
}

interface GrafanaAlert {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  startsAt?: string;
  status?: { state?: string };
}

export class GrafanaConnector {
  async getCriticalLogs(windowMs: number, limit = 10): Promise<GrafanaLogEntry[]> {
    if (!env.hasGrafanaCredentials) {
      throw new Error("Grafana is not configured.");
    }

    const selector = normalizeLokiSelector(env.GRAFANA_LOG_LABEL_SELECTOR);
    const query = `${selector} |~ "(?i)(critical|fatal|panic|sev1|p1)"`;
    return this.queryLokiRange(query, windowMs, limit);
  }

  async getErrorLogs(windowMs: number, limit = 10, service?: string): Promise<GrafanaLogEntry[]> {
    if (!env.hasGrafanaCredentials) {
      throw new Error("Grafana is not configured.");
    }

    const selector = this.withServiceMatcher(normalizeLokiSelector(env.GRAFANA_LOG_LABEL_SELECTOR), service);
    const query = `${selector} |~ "(?i)(error|exception|failed|timeout)"`;
    return this.queryLokiRange(query, windowMs, limit);
  }

  async getAlerts(state: "firing" | "pending" | "resolved" | "all", limit = 20): Promise<GrafanaAlertSummary[]> {
    if (!env.hasGrafanaCredentials) {
      throw new Error("Grafana is not configured.");
    }

    const url = new URL(`${env.GRAFANA_URL}/api/alertmanager/grafana/api/v2/alerts`);
    url.searchParams.set("active", "true");

    const response = await fetch(url, {
      headers: this.authHeaders()
    });

    if (!response.ok) {
      const text = await response.text();
      const details = text ? ` - ${text}` : "";
      const safeQuery = truncateForLog(query, 400);
      throw new Error(
        `Grafana API error: ${response.status} ${response.statusText}${details}. Query: ${safeQuery}`
      );
    }

    const alerts = (await response.json()) as GrafanaAlert[];
    const normalized = alerts.map((alert) => {
      const name = alert.labels?.alertname ?? "unknown_alert";
      const severity = alert.labels?.severity ?? "unknown";
      const alertState = (alert.status?.state ?? "unknown").toLowerCase();
      const summary = alert.annotations?.summary ?? alert.annotations?.description ?? "";
      return {
        name,
        severity,
        state: alertState,
        startsAt: alert.startsAt ?? "",
        summary
      };
    });

    const filtered = state === "all" ? normalized : normalized.filter((a) => a.state === state);
    return filtered.slice(0, limit);
  }

  async getIncidentSnapshot(windowMs: number): Promise<{
    criticalCount: number;
    topServices: Array<{ service: string; count: number }>;
    firingAlerts: GrafanaAlertSummary[];
    latestCritical?: string;
  }> {
    const criticalLogs = await this.getCriticalLogs(windowMs, 100);
    const firingAlerts = await this.getAlerts("firing", 5);

    const serviceLabel = env.GRAFANA_INCIDENT_SERVICE_LABEL || "service";
    const counts = new Map<string, number>();
    for (const log of criticalLogs) {
      const service = log.labels[serviceLabel] || log.labels.app || log.labels.job || "unknown";
      counts.set(service, (counts.get(service) ?? 0) + 1);
    }

    const topServices = [...counts.entries()]
      .map(([service, count]) => ({ service, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      criticalCount: criticalLogs.length,
      topServices,
      firingAlerts,
      latestCritical: criticalLogs[0]?.timestamp
    };
  }

  async queryLogs(query: string, windowMs: number, limit = 20): Promise<GrafanaLogEntry[]> {
    if (!env.hasGrafanaCredentials) {
      throw new Error("Grafana is not configured.");
    }

    return this.queryLokiRange(query, windowMs, limit);
  }

  async getErrorCountsByService(windowMs: number, limit = 10): Promise<Array<{ service: string; count: number }>> {
    const logs = await this.getErrorLogs(windowMs, 500);
    return this.aggregateByService(logs, limit);
  }

  async getErrorCountsByServicePreviousWindow(
    windowMs: number,
    limit = 10
  ): Promise<Array<{ service: string; count: number }>> {
    const selector = normalizeLokiSelector(env.GRAFANA_LOG_LABEL_SELECTOR);
    const query = `${selector} |~ "(?i)(error|exception|failed|timeout)"`;
    const endMs = Date.now() - windowMs;
    const logs = await this.queryLokiRange(query, windowMs, 500, endMs);
    return this.aggregateByService(logs, limit);
  }

  async getServiceSnapshot(
    service: string,
    windowMs: number
  ): Promise<{
    criticalCount: number;
    errorCount: number;
    recentLogs: GrafanaLogEntry[];
  }> {
    const critical = await this.getCriticalLogs(windowMs, 100);
    const errors = await this.getErrorLogs(windowMs, 100);
    const serviceLabel = env.GRAFANA_INCIDENT_SERVICE_LABEL || "service";
    const normalized = service.toLowerCase();

    const criticalFiltered = critical.filter((log) =>
      this.matchesService(log.labels, normalized, serviceLabel)
    );
    const errorFiltered = errors.filter((log) => this.matchesService(log.labels, normalized, serviceLabel));

    const recentLogs = [...criticalFiltered, ...errorFiltered]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 8);

    return {
      criticalCount: criticalFiltered.length,
      errorCount: errorFiltered.length,
      recentLogs
    };
  }

  private async queryLokiRange(query: string, windowMs: number, limit: number, endMs = Date.now()): Promise<GrafanaLogEntry[]> {
    const startMs = endMs - windowMs;

    const url = new URL(
      `${env.GRAFANA_URL}/api/datasources/proxy/uid/${env.GRAFANA_LOKI_DATASOURCE_UID}/loki/api/v1/query_range`
    );
    url.searchParams.set("query", query);
    url.searchParams.set("start", String(startMs * 1_000_000));
    url.searchParams.set("end", String(endMs * 1_000_000));
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("direction", "backward");

    const response = await fetch(url, {
      headers: this.authHeaders()
    });

    if (!response.ok) {
      throw new Error(`Grafana API error: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as LokiQueryRangeResponse;
    const result = payload.data?.result ?? [];
    const logs: GrafanaLogEntry[] = [];
    for (const stream of result) {
      const labels = stream.stream ?? {};
      const values = stream.values ?? [];
      for (const [ns, message] of values) {
        logs.push({
          timestamp: new Date(Number(ns) / 1_000_000).toISOString(),
          message: message.trim(),
          labels
        });
      }
    }

    return logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${env.GRAFANA_TOKEN!}`
    };
  }

  private aggregateByService(logs: GrafanaLogEntry[], limit: number): Array<{ service: string; count: number }> {
    const serviceLabel = env.GRAFANA_INCIDENT_SERVICE_LABEL || "service";
    const counts = new Map<string, number>();
    for (const log of logs) {
      const service = log.labels[serviceLabel] || log.labels.app || log.labels.job || "unknown";
      counts.set(service, (counts.get(service) ?? 0) + 1);
    }

    return [...counts.entries()]
      .map(([service, count]) => ({ service, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  private withServiceMatcher(selector: string, service?: string): string {
    if (!service) {
      return selector;
    }

    const safeService = service.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const base = selector.trim();
    if (base === "{}") {
      return `{service="${safeService}"}`;
    }

    if (base.endsWith("}")) {
      return `${base.slice(0, -1)},service="${safeService}"}`;
    }

    return selector;
  }

  private matchesService(labels: Record<string, string>, normalizedService: string, serviceLabel: string): boolean {
    const candidates = [labels[serviceLabel], labels.app, labels.job]
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.toLowerCase());
    return candidates.some((v) => v.includes(normalizedService));
  }
}

export function normalizeLokiSelector(selector?: string): string {
  const raw = typeof selector === "string" ? selector.trim() : "";
  if (!raw) {
    return "{}";
  }
  if (!raw.startsWith("{") || !raw.endsWith("}")) {
    return "{}";
  }
  const inner = raw.slice(1, -1).trim();
  if (!inner) {
    return "{}";
  }
  const cleaned = inner
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(",");
  return cleaned.length > 0 ? `{${cleaned}}` : "{}";
}

function truncateForLog(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit - 3)}...`;
}
