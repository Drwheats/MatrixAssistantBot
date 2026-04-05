import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BotStateStore } from "./botStateStore";
import { QuietHoursService, isWithinQuietHours, shouldFlush } from "./quietHours";

test("quiet-hours boundaries in Eastern time", () => {
  assert.equal(isWithinQuietHours(new Date("2026-01-15T05:59:00Z")), false); // 12:59 AM ET
  assert.equal(isWithinQuietHours(new Date("2026-01-15T06:00:00Z")), true); // 1:00 AM ET
  assert.equal(isWithinQuietHours(new Date("2026-01-15T12:59:00Z")), true); // 7:59 AM ET
  assert.equal(isWithinQuietHours(new Date("2026-01-15T13:00:00Z")), false); // 8:00 AM ET
});

test("flush window starts at 8:30 AM Eastern", () => {
  assert.equal(shouldFlush(new Date("2026-01-15T13:29:00Z")), false); // 8:29 AM ET
  assert.equal(shouldFlush(new Date("2026-01-15T13:30:00Z")), true); // 8:30 AM ET
  assert.equal(shouldFlush(new Date("2026-01-15T15:00:00Z")), true); // 10:00 AM ET
});

test("DST handling uses America/New_York local clock", () => {
  assert.equal(isWithinQuietHours(new Date("2026-07-10T04:59:00Z")), false); // 12:59 AM EDT
  assert.equal(isWithinQuietHours(new Date("2026-07-10T05:00:00Z")), true); // 1:00 AM EDT
  assert.equal(shouldFlush(new Date("2026-07-10T12:30:00Z")), true); // 8:30 AM EDT
});

test("sendText defers during quiet hours and flushes one digest per room", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quiet-hours-test-"));
  try {
    const stateStore = new BotStateStore(join(dir, "assistant-state.json"));
    const sent: Array<{ roomId: string; body: string }> = [];
    const service = new QuietHoursService(stateStore, async (roomId, content) => {
      sent.push({ roomId, body: String(content.body ?? "") });
      return `$${sent.length}`;
    });

    await service.sendText("!room-a", "first overnight", { msgtype: "m.text", body: "first overnight" }, new Date("2026-01-15T06:10:00Z"));
    await service.sendText("!room-a", "second overnight", { msgtype: "m.text", body: "second overnight" }, new Date("2026-01-15T07:10:00Z"));
    await service.sendText("!room-b", "other room overnight", { msgtype: "m.text", body: "other room overnight" }, new Date("2026-01-15T07:30:00Z"));

    assert.equal(sent.length, 0);
    const stateBeforeFlush = await stateStore.load();
    assert.equal(stateBeforeFlush.deferredMessages.length, 3);

    await service.flushIfDue(new Date("2026-01-15T13:29:00Z")); // 8:29 AM ET
    assert.equal(sent.length, 0);

    await service.flushIfDue(new Date("2026-01-15T13:30:00Z")); // 8:30 AM ET
    assert.equal(sent.length, 2);
    assert.equal(sent[0].roomId, "!room-a");
    assert.match(sent[0].body, /Quiet-hours digest/);
    assert.match(sent[0].body, /first overnight/);
    assert.match(sent[0].body, /second overnight/);
    assert.equal(sent[1].roomId, "!room-b");
    assert.match(sent[1].body, /other room overnight/);

    const stateAfterFlush = await stateStore.load();
    assert.equal(stateAfterFlush.deferredMessages.length, 0);
    assert.ok(stateAfterFlush.lastDeferredFlushISO);

    await service.flushIfDue(new Date("2026-01-15T15:00:00Z"));
    assert.equal(sent.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sendText sends immediately outside quiet hours", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quiet-hours-test-"));
  try {
    const stateStore = new BotStateStore(join(dir, "assistant-state.json"));
    const sent: Array<{ roomId: string; body: string }> = [];
    const service = new QuietHoursService(stateStore, async (roomId, content) => {
      sent.push({ roomId, body: String(content.body ?? "") });
      return "event-id";
    });

    const eventId = await service.sendText(
      "!room-a",
      "daytime message",
      { msgtype: "m.text", body: "daytime message" },
      new Date("2026-01-15T15:00:00Z")
    );

    assert.equal(eventId, "event-id");
    assert.equal(sent.length, 1);
    const state = await stateStore.load();
    assert.equal(state.deferredMessages.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

