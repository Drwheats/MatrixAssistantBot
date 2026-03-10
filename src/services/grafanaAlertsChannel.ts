import { MatrixClient } from "matrix-bot-sdk";
import { env } from "../config/env";
import { BotState, BotStateStore } from "./botStateStore";

const GRAFANA_ALERTS_ROOM_NAME = "Grafana Alerts";

export class GrafanaAlertsChannelService {
  constructor(
    private readonly client: MatrixClient,
    private readonly stateStore: BotStateStore
  ) {}

  async start(): Promise<void> {
    const state = await this.stateStore.load();
    await this.ensureAlertsRoom(state);
  }

  private async ensureAlertsRoom(state: BotState): Promise<string | null> {
    if (state.grafanaAlertsRoomId) {
      return state.grafanaAlertsRoomId;
    }

    const invitees = env.allowedUsers;
    const roomId = await this.client.createRoom({
      name: GRAFANA_ALERTS_ROOM_NAME,
      topic: "Important Grafana alerts",
      preset: "private_chat",
      invite: invitees
    });

    state.grafanaAlertsRoomId = roomId;
    await this.stateStore.save(state);
    return roomId;
  }
}
