import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTags, parseTags } from "./tags.ts";

test("splits on commas and trims", () => {
  assert.deepEqual(parseTags(" JCL ,Volleyball"), ["JCL", "Volleyball"]);
});

test("drops empty pieces and case-insensitive duplicates, keeping the first spelling", () => {
  assert.deepEqual(parseTags("JCL,, jcl , Ryerson,"), ["JCL", "Ryerson"]);
});

test("empty text means no tags", () => {
  assert.deepEqual(parseTags("  ,  "), []);
});

test("keeps at most 5 tags of at most 24 characters, like the database", () => {
  assert.deepEqual(parseTags("a,b,c,d,e,f,g"), ["a", "b", "c", "d", "e"]);
  assert.equal(parseTags("x".repeat(40))[0].length, 24);
});

test("collapses inner whitespace", () => {
  assert.deepEqual(parseTags("Point   Beach"), ["Point Beach"]);
});

test("round-trips through the edit box", () => {
  assert.deepEqual(parseTags(formatTags(["JCL", "Volleyball"])), ["JCL", "Volleyball"]);
});
