import { GrafanaAlertsChannelService } from "./grafanaAlertsChannel";
import { LlmStudioConnector } from "../connectors/llmStudio";
import { readBatteryPercent, readCpuUsagePercent, readThermalStatus } from "../utils/sysinfo";

const CHECK_INTERVAL_MS = 60_000;
const ALERT_COOLDOWN_MS = 2 * 60 * 60_000;
const BATTERY_LOW_THRESHOLD = 50;
const BATTERY_RECOVER_THRESHOLD = 55;
const CPU_HIGH_THRESHOLD = 85;
const CPU_RECOVER_THRESHOLD = 70;

type AlertKind = "battery" | "cpu" | "thermal";

interface AlertState {
  active: boolean;
  lastSentAt: number | null;
}

export class HardwareAlertsService {
  private timer: NodeJS.Timeout | null = null;
  private readonly alertState: Record<AlertKind, AlertState> = {
    battery: { active: false, lastSentAt: null },
    cpu: { active: false, lastSentAt: null },
    thermal: { active: false, lastSentAt: null }
  };

  constructor(
    private readonly alertsChannel: GrafanaAlertsChannelService,
    private readonly llmStudio: LlmStudioConnector
  ) {}

  async start(): Promise<void> {
    await this.checkOnce();
    this.timer = setInterval(() => {
      void this.checkOnce();
    }, CHECK_INTERVAL_MS);
  }

  private async checkOnce(): Promise<void> {
    if (this.llmStudio.isBusy()) {
      return;
    }

    const battery = await readBatteryPercent();
    if (battery !== null) {
      const low = battery < BATTERY_LOW_THRESHOLD;
      if (low) {
        await this.maybeAlert(
          "battery",
          `Hardware alert: Battery below ${BATTERY_LOW_THRESHOLD}% (currently ${battery}%).`
        );
      } else if (battery >= BATTERY_RECOVER_THRESHOLD) {
        this.alertState.battery.active = false;
      }
    }

    const cpuUsage = await readCpuUsagePercent();
    if (cpuUsage !== null) {
      const high = cpuUsage >= CPU_HIGH_THRESHOLD;
      if (high) {
        await this.maybeAlert(
          "cpu",
          `Hardware alert: High CPU usage detected (${cpuUsage.toFixed(1)}%).`
        );
      } else if (cpuUsage <= CPU_RECOVER_THRESHOLD) {
        this.alertState.cpu.active = false;
      }
    }

    const thermal = await readThermalStatus();
    if (thermal) {
      if (thermal.isAnomalous) {
        await this.maybeAlert("thermal", `Hardware alert: ${thermal.message}`);
      } else {
        this.alertState.thermal.active = false;
      }
    }
  }

  private async maybeAlert(kind: AlertKind, message: string): Promise<void> {
    const state = this.alertState[kind];
    const now = Date.now();
    if (state.active && state.lastSentAt && now - state.lastSentAt < ALERT_COOLDOWN_MS) {
      return;
    }

    state.active = true;
    state.lastSentAt = now;
    await this.alertsChannel.sendMessage(message);
  }
}
