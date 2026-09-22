// classifyExit の挙動（外部からの停止と通常の失敗の区別）
import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyExit } from "../src/exit.js";

test("終了コード 143 / 130 と SIGTERM / SIGINT は interrupted", () => {
  assert.equal(classifyExit({ status: 143, signal: null }), "interrupted");
  assert.equal(classifyExit({ status: 130, signal: null }), "interrupted");
  assert.equal(classifyExit({ status: null, signal: "SIGTERM" }), "interrupted");
  assert.equal(classifyExit({ status: null, signal: "SIGINT" }), "interrupted");
});

test("それ以外の終了コードとシグナルは failed", () => {
  assert.equal(classifyExit({ status: 1, signal: null }), "failed");
  assert.equal(classifyExit({ status: 2, signal: null }), "failed");
  assert.equal(classifyExit({ status: null, signal: "SIGKILL" }), "failed");
});
