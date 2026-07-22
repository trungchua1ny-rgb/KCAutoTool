import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeScreenplayProject,
  parseScreenplay,
  screenplayShotsToSrt,
} from "./screenplay";

test("parses screenplay headings, action, dialogue, ambience and sound effects", () => {
  const shots = parseScreenplay(`CẢNH 01 — NỘI. PHÒNG KHÁCH — ĐÊM

Hành động: Minh bước vào phòng và đặt chìa khóa lên bàn.
MINH:
“Có ai ở ngoài đó không?”
Ambience: Mưa đều ngoài cửa sổ.
Âm thanh: Chìa khóa chạm mặt bàn.

CẢNH 02 — NGOẠI. HIÊN NHÀ — ĐÊM
Hành động: Cánh cửa hé mở, gió lay tấm rèm.
Âm thanh: Bản lề cửa kêu nhẹ.`);

  assert.equal(shots.length, 2);
  assert.equal(shots[0].dialogueCues[0].speaker, "MINH");
  assert.equal(shots[0].dialogueCues[0].text, "Có ai ở ngoài đó không?");
  assert.match(shots[0].ambience, /Mưa đều/);
  assert.match(shots[0].soundEffects.join(" "), /Chìa khóa/);
  assert.ok([4, 6, 8].includes(shots[0].durationSeconds));
});

test("creates a continuous 4, 6, or 8-second shot contract for Phase 3", () => {
  const shots = parseScreenplay(`CẢNH 01 — PHÒNG — NGÀY
Hành động: Một người mở cửa.

CẢNH 02 — HÀNH LANG — NGÀY
Hành động: Người đó bước nhanh qua hành lang.`).map((shot, index) => ({
    ...shot,
    durationSeconds: index === 0 ? 4 as const : 6 as const,
    approved: true,
  }));
  const srt = screenplayShotsToSrt(shots, "sound-only");
  assert.match(srt, /00:00:00,000 --> 00:00:04,000/);
  assert.match(srt, /00:00:04,000 --> 00:00:10,000/);
  assert.match(srt, /NO SPOKEN DIALOGUE/);
});

test("normalizes screenplay projects and defaults to the safe sound-only track", () => {
  const project = normalizeScreenplayProject({ scriptText: "A scene" });
  assert.equal(project.dialogueMode, "sound-only");
  assert.equal(project.soundBible.musicPolicy, "none-in-flow");
  assert.equal(project.dialogueLanguage, "vi-VN");
});
