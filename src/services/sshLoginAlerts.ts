import { GrafanaAlertsChannelService } from "./grafanaAlertsChannel";
import { readActiveSshConnections } from "../utils/sysinfo";

const CHECK_INTERVAL_MS = 15_000;

export class SshLoginAlertsService {
  private timer: NodeJS.Timeout | null = null;
  private knownConnections = new Set<string>();

  constructor(private readonly alertsChannel: GrafanaAlertsChannelService) {}

  async start(): Promise<void> {
    const initial = await readActiveSshConnections();
    if (initial) {
      this.knownConnections = new Set(initial);
    }

    this.timer = setInterval(() => {
      void this.checkOnce();
    }, CHECK_INTERVAL_MS);
  }

  private async checkOnce(): Promise<void> {
    const current = await readActiveSshConnections();
    if (!current) {
      return;
    }

    const currentSet = new Set(current);
    const newConnections: string[] = [];
    for (const entry of currentSet) {
      if (!this.knownConnections.has(entry)) {
        newConnections.push(entry);
      }
    }

    if (newConnections.length > 0) {
      const lines = [
        "Security alert: SSH login detected.",
        `Active SSH connections: ${currentSet.size}`,
        ...newConnections.map((entry) => `- ${entry}`)
      ];
      await this.alertsChannel.sendMessage(lines.join("\n"));
    }

    this.knownConnections = currentSet;
  }
}
