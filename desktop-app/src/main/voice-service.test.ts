import assert from "node:assert/strict";
import test from "node:test";
import { buildVoiceSrt, buildWordVoiceSrt } from "./voice-service";

test("builds continuous SRT cues from Edge TTS word timing", () => {
  const srt = buildVoiceSrt([
    { text: "Xin", start: 0, end: 0.2 },
    { text: "chào.", start: 0.21, end: 0.6 },
    { text: "Cảnh", start: 0.95, end: 1.2 },
    { text: "tiếp", start: 1.21, end: 1.45 },
  ]);
  assert.match(srt, /00:00:00,000 --> 00:00:00,600/);
  assert.match(srt, /Xin chào\./);
  assert.match(srt, /00:00:00,950 --> 00:00:01,450/);
  assert.match(srt, /Cảnh tiếp/);
});

test("exports one continuous SRT cue per synthesized word", () => {
  const srt = buildWordVoiceSrt([
    { text: "Xin", start: 0, end: 0.2 },
    { text: "chào", start: 0.21, end: 0.6 },
  ]);
  assert.match(srt, /1\n00:00:00,000 --> 00:00:00,200\nXin/);
  assert.match(srt, /2\n00:00:00,210 --> 00:00:00,600\nchào/);
});
