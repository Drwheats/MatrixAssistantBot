import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function readBatteryPercent(): Promise<number | null> {
  if (process.platform !== "darwin") {
    return null;
  }

  try {
    const { stdout } = await execFileAsync("pmset", ["-g", "batt"], { timeout: 5_000 });
    const match = stdout.match(/(\d+)%/);
    if (!match) {
      return null;
    }
    const percent = Number.parseInt(match[1], 10);
    return Number.isFinite(percent) ? percent : null;
  } catch {
    return null;
  }
}

export async function readCpuUsagePercent(): Promise<number | null> {
  if (process.platform !== "darwin") {
    return null;
  }

  try {
    const { stdout } = await execFileAsync("top", ["-l", "1", "-n", "0"], { timeout: 8_000 });
    const match = stdout.match(/CPU usage:\s+([\d.]+)%\s+user,\s+([\d.]+)%\s+sys,.*?([\d.]+)%\s+idle/i);
    if (!match) {
      return null;
    }
    const idle = Number.parseFloat(match[3]);
    if (!Number.isFinite(idle)) {
      return null;
    }
    const usage = Math.max(0, 100 - idle);
    return usage;
  } catch {
    return null;
  }
}

export async function readThermalStatus(): Promise<{ isAnomalous: boolean; message: string } | null> {
  if (process.platform !== "darwin") {
    return null;
  }

  try {
    const { stdout } = await execFileAsync("pmset", ["-g", "therm"], { timeout: 5_000 });
    const pressureMatch = stdout.match(/Thermal pressure:\s*([a-z]+)/i);
    const pressure = pressureMatch ? pressureMatch[1].toLowerCase() : null;
    const speedLimitMatches = [...stdout.matchAll(/([A-Za-z_]+_Speed_Limit)\s+(\d+)/g)];
    const speedLimits = speedLimitMatches
      .map((match) => ({ name: match[1], value: Number.parseInt(match[2], 10) }))
      .filter((entry) => Number.isFinite(entry.value));

    const slowdowns = speedLimits.filter((entry) => entry.value < 100);
    const hasPressure = pressure && pressure !== "nominal";
    if (!hasPressure && slowdowns.length === 0) {
      return { isAnomalous: false, message: "Thermal status nominal." };
    }

    const parts: string[] = [];
    if (hasPressure) {
      parts.push(`Thermal pressure ${pressure}`);
    }
    if (slowdowns.length > 0) {
      parts.push(
        `Speed limits: ${slowdowns.map((entry) => `${entry.name} ${entry.value}%`).join(", ")}`
      );
    }
    return { isAnomalous: true, message: parts.join(" | ") };
  } catch {
    return null;
  }
}

export async function readMemoryUsage(): Promise<{ usedBytes: number; totalBytes: number } | null> {
  if (process.platform !== "darwin") {
    return null;
  }

  try {
    const { stdout } = await execFileAsync("top", ["-l", "1", "-n", "0"], { timeout: 8_000 });
    const match = stdout.match(/PhysMem:\s+([\d.]+)([MG])\s+used.*?([\d.]+)([MG])\s+unused/i);
    if (!match) {
      return null;
    }
    const used = toBytes(match[1], match[2]);
    const unused = toBytes(match[3], match[4]);
    if (used === null || unused === null) {
      return null;
    }
    return { usedBytes: used, totalBytes: used + unused };
  } catch {
    return null;
  }
}

export async function readDiskUsage(path = "/"): Promise<{
  usedBytes: number;
  totalBytes: number;
  usedPercent: number;
} | null> {
  if (process.platform !== "darwin") {
    return null;
  }

  try {
    const { stdout } = await execFileAsync("df", ["-k", path], { timeout: 5_000 });
    const lines = stdout.trim().split("\n");
    if (lines.length < 2) {
      return null;
    }
    const parts = lines[1].split(/\s+/);
    if (parts.length < 5) {
      return null;
    }
    const totalKb = Number.parseInt(parts[1], 10);
    const usedKb = Number.parseInt(parts[2], 10);
    const percentRaw = parts[4]?.replace("%", "");
    const usedPercent = percentRaw ? Number.parseInt(percentRaw, 10) : null;
    if (!Number.isFinite(totalKb) || !Number.isFinite(usedKb)) {
      return null;
    }
    return {
      usedBytes: usedKb * 1024,
      totalBytes: totalKb * 1024,
      usedPercent: Number.isFinite(usedPercent) ? usedPercent! : Math.round((usedKb / totalKb) * 100)
    };
  } catch {
    return null;
  }
}

export async function readActiveSshConnections(): Promise<string[] | null> {
  if (process.platform !== "darwin") {
    return null;
  }

  try {
    const { stdout } = await execFileAsync("who", [], { timeout: 5_000 });
    const lines = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length === 0) {
      return [];
    }
    const sshLines = lines.filter((line) => /\(.+\)$/.test(line) && !line.includes("console"));
    return sshLines;
  } catch {
    return null;
  }
}

function toBytes(value: string, unit: string): number | null {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const upper = unit.toUpperCase();
  if (upper === "G") {
    return Math.round(numeric * 1024 * 1024 * 1024);
  }
  if (upper === "M") {
    return Math.round(numeric * 1024 * 1024);
  }
  return null;
}
