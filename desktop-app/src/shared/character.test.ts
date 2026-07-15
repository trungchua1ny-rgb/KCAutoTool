import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeCharacterToken,
  parseCharacterTokens,
} from "./character";

test("normalizes character tokens", () => {
  assert.equal(normalizeCharacterToken("ancestor"), "@ANCESTOR");
  assert.equal(normalizeCharacterToken(" @hero_02 "), "@HERO_02");
  assert.equal(normalizeCharacterToken("@"), null);
  assert.equal(normalizeCharacterToken("two words"), null);
  assert.equal(normalizeCharacterToken("bad-token"), null);
});

test("parses unique tokens in prompt order", () => {
  assert.deepEqual(
    parseCharacterTokens(
      "@ancestor walks with @HERO_02. Later @Ancestor appears again.",
    ),
    ["@ANCESTOR", "@HERO_02"],
  );
});

test("does not parse email fragments as character tokens", () => {
  assert.deepEqual(parseCharacterTokens("Send mail to user@example.com"), []);
});

