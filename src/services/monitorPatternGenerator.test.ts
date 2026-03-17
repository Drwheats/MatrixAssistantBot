import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHeuristicMonitorPattern,
  buildMonitorSystemPrompt,
  buildOpenAiCompatibleBaseUrl,
  extractMonitorRegexCandidate,
  validateMonitorPattern
} from "./monitorPatternGenerator";

test("extractMonitorRegexCandidate accepts a single-line regex fragment", () => {
  const candidate = extractMonitorRegexCandidate(String.raw`Accepted password for mushroom from \b\d{1,3}(?:\.\d{1,3}){3}\b port \d+ ssh2`);
  assert.equal(
    candidate,
    String.raw`Accepted password for mushroom from \b\d{1,3}(?:\.\d{1,3}){3}\b port \d+ ssh2`
  );
});

test("extractMonitorRegexCandidate rejects prose and wrapped output", () => {
  assert.equal(extractMonitorRegexCandidate("Here is the regex: foo.*bar"), null);
  assert.equal(extractMonitorRegexCandidate('{"pattern":"foo.*bar"}'), null);
  assert.equal(extractMonitorRegexCandidate("```regex\nfoo.*bar\n```"), null);
  assert.equal(extractMonitorRegexCandidate("pattern: foo.*bar"), null);
});

test("validateMonitorPattern accepts a regex that matches the sample log", () => {
  const sample = "2026-03-11T15:08:47Z Accepted password for mushroom from 192.168.0.1 port 2222 ssh2";
  const pattern = String.raw`Accepted password for mushroom from \b\d{1,3}(?:\.\d{1,3}){3}\b port \d+ ssh2`;
  assert.equal(validateMonitorPattern(pattern, sample), true);
});

test("validateMonitorPattern rejects invalid or non-matching output", () => {
  const sample = "level=error req_id=4d3c2b1a timeout after 1532ms while syncing user 9182";
  assert.equal(validateMonitorPattern("(", sample), false);
  assert.equal(validateMonitorPattern("this pattern should match similar logs", sample), false);
  assert.equal(validateMonitorPattern("Accepted password", sample), false);
});

test("buildMonitorSystemPrompt appends the custom prompt after built-in rules", () => {
  const prompt = buildMonitorSystemPrompt("Prefer host-specific wording when it is stable.");
  assert.match(prompt, /Return ONLY the regex fragment\./);
  assert.match(prompt, /Additional user instructions:/);
  assert.match(prompt, /Prefer host-specific wording when it is stable\./);
});

test("buildOpenAiCompatibleBaseUrl normalizes supported LM Studio base URLs", () => {
  assert.equal(buildOpenAiCompatibleBaseUrl("http://127.0.0.1:1234"), "http://127.0.0.1:1234/v1");
  assert.equal(buildOpenAiCompatibleBaseUrl("http://127.0.0.1:1234/api/v1"), "http://127.0.0.1:1234/v1");
  assert.equal(buildOpenAiCompatibleBaseUrl("http://127.0.0.1:1234/api/v1/chat"), "http://127.0.0.1:1234/v1");
});

test("buildHeuristicMonitorPattern generalizes login success logs", () => {
  const sample = "(N) 2026-03-16T22:34:32 - WebAPI login success. IP: ::ffff:192.168.68.64";
  const pattern = buildHeuristicMonitorPattern(sample);
  assert.equal(pattern, String.raw`WebAPI\s+login\s+success\.\s+IP:\s+(?:::ffff:)?\d{1,3}(?:\.\d{1,3}){3}`);
  assert.equal(validateMonitorPattern(pattern ?? "", "WebAPI login success. IP: ::ffff:192.168.68.64"), true);
});

test("buildHeuristicMonitorPattern generalizes torrent title logs", () => {
  const sample = '(N) 2026-03-16T22:34:11 - Added new torrent. Torrent: "The Stuff (1985) [1080p] [YTS.AG]"';
  const pattern = buildHeuristicMonitorPattern(sample);
  assert.equal(pattern, String.raw`Added\s+new\s+torrent\.\s+Torrent:\s+".*?"`);
  assert.equal(validateMonitorPattern(pattern ?? "", 'Added new torrent. Torrent: "Another Movie (2024) [1080p]"'), true);
});
