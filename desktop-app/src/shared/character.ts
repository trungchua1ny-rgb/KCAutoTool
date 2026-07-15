export interface Character {
  token: string;
  name: string;
  refImagePath: string;
}

export interface CharacterView extends Character {
  refImageDataUrl: string | null;
}

export interface CharacterImageInput {
  bytes: ArrayBuffer;
  mimeType: string;
}

export interface CharacterCreateInput {
  token: string;
  name: string;
  image: CharacterImageInput;
}

export interface CharacterUpdateInput {
  originalToken: string;
  token: string;
  name: string;
  image?: CharacterImageInput;
}

export interface CharactersBridge {
  list: () => Promise<CharacterView[]>;
  create: (input: CharacterCreateInput) => Promise<CharacterView[]>;
  update: (input: CharacterUpdateInput) => Promise<CharacterView[]>;
  remove: (token: string) => Promise<CharacterView[]>;
}

export const CHARACTER_LIST_CHANNEL = "characters:list";
export const CHARACTER_CREATE_CHANNEL = "characters:create";
export const CHARACTER_UPDATE_CHANNEL = "characters:update";
export const CHARACTER_DELETE_CHANNEL = "characters:delete";

const TOKEN_BODY_PATTERN = /^[A-Za-z0-9_]{1,40}$/;
const TOKEN_PATTERN = /(?:^|[^A-Za-z0-9_])(@[A-Za-z0-9_]+)/g;

export function normalizeCharacterToken(value: string): string | null {
  const body = value.trim().replace(/^@+/, "");
  if (!TOKEN_BODY_PATTERN.test(body)) return null;
  return `@${body.toUpperCase()}`;
}

export function parseCharacterTokens(text: string): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const token = match[1].toUpperCase();
    if (seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }

  return tokens;
}

