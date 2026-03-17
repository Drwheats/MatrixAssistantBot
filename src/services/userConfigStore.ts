import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export interface UserConfig {
  globalPrompt?: string;
  globalFactcheckPrompt?: string;
  monitorPrompt?: string;
  llmModel?: string;
  monitors: Array<{
    id: string;
    name: string;
    selector: string;
    pattern: string;
    createdAt: string;
  }>;
}

const DEFAULT_CONFIG: UserConfig = {
  monitors: []
};

export class UserConfigStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<UserConfig> {
    if (!existsSync(this.filePath)) {
      return { ...DEFAULT_CONFIG };
    }

    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<UserConfig>;
      return {
        globalPrompt: typeof parsed.globalPrompt === "string" ? parsed.globalPrompt : undefined,
        globalFactcheckPrompt:
          typeof parsed.globalFactcheckPrompt === "string" ? parsed.globalFactcheckPrompt : undefined,
        monitorPrompt: typeof parsed.monitorPrompt === "string" ? parsed.monitorPrompt : undefined,
        llmModel: typeof parsed.llmModel === "string" ? parsed.llmModel : undefined,
        monitors: Array.isArray(parsed.monitors) ? (parsed.monitors as UserConfig["monitors"]) : []
      };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  async save(update: Partial<UserConfig>): Promise<void> {
    const current = await this.load();
    const merged: UserConfig = {
      globalPrompt: update.globalPrompt ?? current.globalPrompt,
      globalFactcheckPrompt: update.globalFactcheckPrompt ?? current.globalFactcheckPrompt,
      monitorPrompt: update.monitorPrompt ?? current.monitorPrompt,
      llmModel: update.llmModel ?? current.llmModel,
      monitors: Array.isArray(update.monitors) ? update.monitors : current.monitors ?? []
    };
    await writeFile(this.filePath, JSON.stringify(merged, null, 2), "utf8");
  }
}
