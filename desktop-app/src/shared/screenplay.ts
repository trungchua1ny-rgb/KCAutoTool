export type ProjectProductionKind = "narrated" | "screenplay";
export type ScreenplayDialogueMode = "sound-only" | "native-dialogue";
export type ScreenplayParseStatus = "draft" | "review" | "approved";
export type ScreenplayShotDuration = 4 | 6 | 8;

export interface ScreenplayDialogueCue {
  speaker: string;
  text: string;
  delivery: string;
}

export interface ScreenplayShot {
  id: string;
  order: number;
  heading: string;
  location: string;
  timeOfDay: string;
  action: string;
  dialogueCues: ScreenplayDialogueCue[];
  ambience: string;
  soundEffects: string[];
  durationSeconds: ScreenplayShotDuration;
  approved: boolean;
}

export interface SoundBible {
  ambienceRules: string;
  soundEffectRules: string;
  dialogueRules: string;
  musicPolicy: "none-in-flow";
}

export interface ScreenplayProject {
  scriptText: string;
  scriptFileName: string;
  scriptPath: string;
  dialogueMode: ScreenplayDialogueMode;
  dialogueLanguage: string;
  nativeDialoguePilotConfirmed: boolean;
  parseStatus: ScreenplayParseStatus;
  shots: ScreenplayShot[];
  soundBible: SoundBible;
  reviewedAt: string;
  updatedAt: string;
}

export const DEFAULT_SOUND_BIBLE: SoundBible = {
  ambienceRules: "Use source-grounded room tone and environmental ambience. Keep ambience continuous across connected shots.",
  soundEffectRules: "Use only visible, story-relevant sound effects. Keep effects natural, synchronized, and quieter than any dialogue.",
  dialogueRules: "No narrator or voice-over. Spoken dialogue must be verbatim, character-bound, short, and synchronized with visible mouth movement.",
  musicPolicy: "none-in-flow",
};

export const DEFAULT_SCREENPLAY_PROJECT: ScreenplayProject = {
  scriptText: "",
  scriptFileName: "",
  scriptPath: "",
  dialogueMode: "sound-only",
  dialogueLanguage: "vi-VN",
  nativeDialoguePilotConfirmed: false,
  parseStatus: "draft",
  shots: [],
  soundBible: structuredClone(DEFAULT_SOUND_BIBLE),
  reviewedAt: "",
  updatedAt: "",
};

function text(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function duration(value: unknown): ScreenplayShotDuration {
  return value === 4 || value === 6 ? value : 8;
}

export function normalizeSoundBible(value: unknown): SoundBible {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    ambienceRules: text(source.ambienceRules, 4_000) || DEFAULT_SOUND_BIBLE.ambienceRules,
    soundEffectRules: text(source.soundEffectRules, 4_000) || DEFAULT_SOUND_BIBLE.soundEffectRules,
    dialogueRules: text(source.dialogueRules, 4_000) || DEFAULT_SOUND_BIBLE.dialogueRules,
    musicPolicy: "none-in-flow",
  };
}

export function normalizeScreenplayProject(value: unknown): ScreenplayProject {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const shots = Array.isArray(source.shots)
    ? source.shots.slice(0, 1_000).flatMap((entry, index): ScreenplayShot[] => {
      if (!entry || typeof entry !== "object") return [];
      const shot = entry as Record<string, unknown>;
      const dialogueCues = Array.isArray(shot.dialogueCues)
        ? shot.dialogueCues.slice(0, 4).flatMap((cue): ScreenplayDialogueCue[] => {
          if (!cue || typeof cue !== "object") return [];
          const item = cue as Record<string, unknown>;
          const speaker = text(item.speaker, 80);
          const cueText = text(item.text, 500);
          return speaker && cueText ? [{ speaker, text: cueText, delivery: text(item.delivery, 160) }] : [];
        })
        : [];
      return [{
        id: text(shot.id, 100) || `shot-${String(index + 1).padStart(3, "0")}`,
        order: index + 1,
        heading: text(shot.heading, 240) || `CẢNH ${index + 1}`,
        location: text(shot.location, 160),
        timeOfDay: text(shot.timeOfDay, 80),
        action: text(shot.action, 4_000),
        dialogueCues,
        ambience: text(shot.ambience, 1_000),
        soundEffects: Array.isArray(shot.soundEffects)
          ? shot.soundEffects.map((item) => text(item, 240)).filter(Boolean).slice(0, 20)
          : [],
        durationSeconds: duration(shot.durationSeconds),
        approved: shot.approved === true,
      }];
    })
    : [];
  return {
    scriptText: typeof source.scriptText === "string" ? source.scriptText.slice(0, 2 * 1024 * 1024) : "",
    scriptFileName: text(source.scriptFileName, 260),
    scriptPath: text(source.scriptPath, 4_096),
    dialogueMode: source.dialogueMode === "native-dialogue" ? "native-dialogue" : "sound-only",
    dialogueLanguage: text(source.dialogueLanguage, 40) || "vi-VN",
    nativeDialoguePilotConfirmed: source.nativeDialoguePilotConfirmed === true,
    parseStatus: source.parseStatus === "approved" ? "approved" : source.parseStatus === "review" ? "review" : "draft",
    shots,
    soundBible: normalizeSoundBible(source.soundBible),
    reviewedAt: text(source.reviewedAt, 64),
    updatedAt: text(source.updatedAt, 64),
  };
}

function parseHeading(line: string): { heading: string; location: string; timeOfDay: string } | null {
  const normalized = line.trim();
  if (!/^(?:CẢNH|SCENE|INT\.?|EXT\.?|NỘI\.?|NGOẠI\.?)/iu.test(normalized)) return null;
  const parts = normalized.split(/\s+[—–-]\s+/).map((part) => part.trim()).filter(Boolean);
  return {
    heading: normalized,
    location: parts.length > 1 ? parts[1] : normalized.replace(/^(?:CẢNH|SCENE)\s*\d*\s*/iu, "").trim(),
    timeOfDay: parts.length > 2 ? parts.at(-1) || "" : "",
  };
}

function chooseDuration(action: string, dialogueCues: ScreenplayDialogueCue[]): ScreenplayShotDuration {
  const dialogueUnits = dialogueCues.reduce((sum, cue) => sum + cue.text.split(/\s+/u).filter(Boolean).length, 0);
  const actionUnits = action.split(/\s+/u).filter(Boolean).length;
  const estimated = Math.max(4, 1.5 + dialogueUnits / 2.8 + Math.min(3, actionUnits / 12));
  return estimated <= 4.5 ? 4 : estimated <= 6.5 ? 6 : 8;
}

export function parseScreenplay(textValue: string): ScreenplayShot[] {
  const source = textValue.replace(/\r\n?/g, "\n").trim();
  if (!source) return [];
  const lines = source.split("\n");
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (parseHeading(line) && current.some((item) => item.trim())) {
      blocks.push(current);
      current = [line];
    } else if (!line.trim() && current.some((item) => item.trim()) && !current.some((item) => parseHeading(item))) {
      blocks.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.some((item) => item.trim())) blocks.push(current);

  return blocks.filter((block) => block.some((line) => line.trim())).map((block, index) => {
    const nonEmpty = block.map((line) => line.trim()).filter(Boolean);
    const headingInfo = nonEmpty.map(parseHeading).find(Boolean) || {
      heading: `CẢNH ${index + 1}`,
      location: "",
      timeOfDay: "",
    };
    const action: string[] = [];
    const dialogueCues: ScreenplayDialogueCue[] = [];
    const soundEffects: string[] = [];
    let ambience = "";
    let section: "action" | "sound" | "ambience" = "action";
    let pendingSpeaker = "";
    for (const line of nonEmpty) {
      if (line === headingInfo.heading) continue;
      if (/^(?:HÀNH ĐỘNG|ACTION)\s*:/iu.test(line)) {
        section = "action";
        const remainder = line.replace(/^[^:]+:/u, "").trim();
        if (remainder) action.push(remainder);
        continue;
      }
      if (/^(?:ÂM THANH|SFX|SOUND EFFECTS?)\s*:/iu.test(line)) {
        section = "sound";
        const remainder = line.replace(/^[^:]+:/u, "").trim();
        if (remainder) soundEffects.push(remainder);
        continue;
      }
      if (/^(?:AMBIENCE|KHÔNG GIAN ÂM THANH)\s*:/iu.test(line)) {
        section = "ambience";
        ambience = line.replace(/^[^:]+:/u, "").trim();
        continue;
      }
      const speaker = line.match(/^([\p{Lu}\d _-]{2,40})\s*:\s*(.*)$/u);
      if (speaker && !/^(HÀNH ĐỘNG|ACTION|ÂM THANH|SFX|AMBIENCE)$/iu.test(speaker[1])) {
        pendingSpeaker = speaker[1].trim();
        if (speaker[2].trim()) dialogueCues.push({ speaker: pendingSpeaker, text: speaker[2].trim().replace(/^[“"]|[”"]$/g, ""), delivery: "" });
        continue;
      }
      if (pendingSpeaker && /^[“"].+[”"]$/u.test(line)) {
        dialogueCues.push({ speaker: pendingSpeaker, text: line.replace(/^[“"]|[”"]$/g, ""), delivery: "" });
        pendingSpeaker = "";
        continue;
      }
      if (section === "sound") soundEffects.push(line.replace(/^[-•]\s*/u, ""));
      else if (section === "ambience") ambience = `${ambience} ${line}`.trim();
      else action.push(line);
    }
    const actionText = action.join(" ").trim();
    return {
      id: `shot-${String(index + 1).padStart(3, "0")}`,
      order: index + 1,
      ...headingInfo,
      action: actionText,
      dialogueCues,
      ambience,
      soundEffects: soundEffects.filter(Boolean),
      durationSeconds: chooseDuration(actionText, dialogueCues),
      approved: false,
    };
  });
}

function srtTime(milliseconds: number): string {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const millis = milliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

export function screenplayShotsToSrt(shots: ScreenplayShot[], mode: ScreenplayDialogueMode): string {
  let cursor = 0;
  return shots.map((shot, index) => {
    const start = cursor;
    cursor += shot.durationSeconds * 1_000;
    const dialogue = mode === "native-dialogue" && shot.dialogueCues.length
      ? shot.dialogueCues.map((cue) => `${cue.speaker}: “${cue.text}”`).join(" | ")
      : "NO SPOKEN DIALOGUE";
    const content = [
      `SHOT ${shot.order}: ${shot.heading}`,
      `ACTION: ${shot.action || "Hold a source-grounded establishing composition."}`,
      `DIALOGUE: ${dialogue}`,
      `AMBIENCE: ${shot.ambience || "Source-grounded environmental room tone."}`,
      `SFX: ${shot.soundEffects.join("; ") || "Only synchronized sounds caused by visible action."}`,
    ].join("\n");
    return `${index + 1}\n${srtTime(start)} --> ${srtTime(cursor)}\n${content}`;
  }).join("\n\n");
}
