import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { extractSourceDetails } from "./expectations.js";

test("extracts source expectations and snapshot names", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tui-replay-"));

  try {
    const testDir = path.join(dir, "tests");
    await mkdir(path.join(testDir, "__snapshots__"), { recursive: true });
    await writeFile(
      path.join(testDir, "demo.tui.test.ts"),
      `import { expect, test } from "@microsoft/tui-test";

test("renders text", async ({ terminal }) => {
  terminal.write("hello");
  await expect(terminal.getByText("hello")).toBeVisible();
  await expect(terminal).toMatchSnapshot();
});
`
    );
    await writeFile(
      path.join(testDir, "__snapshots__", "demo.tui.test.ts.snap"),
      "exports[`renders text 1`] = String.raw`hello`;\n"
    );

    const details = await extractSourceDetails(
      {
        tracePoints: [],
        testPath: ["tests", "demo.tui.test.ts", "3", "1"],
        testName: ["renders text"]
      },
      dir
    );

    assert.equal(details.expectations.length, 2);
    assert.equal(details.snapshotNames[0], "renders text 1");
    assert.match(details.expectations[0].snippet, /toBeVisible/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("extracts node assert checks from source", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tui-replay-"));

  try {
    const testDir = path.join(dir, "tests");
    await mkdir(testDir, { recursive: true });
    await writeFile(
      path.join(testDir, "assertions.tui.test.ts"),
      `import assert from "node:assert/strict";
import { test } from "@microsoft/tui-test";

test("previous test", async () => {
  assert.equal(status, "unrelated");
});

test("checks gateway state", async () => {
  assert.ok(server, "server was not created");
  assert.equal(status, "connected");
});
`
    );

    const details = await extractSourceDetails(
      {
        tracePoints: [],
        testPath: ["tests", "assertions.tui.test.ts", "8", "1"],
        testName: ["checks gateway state"]
      },
      dir
    );

    assert.equal(details.expectations.length, 2);
    assert.equal(details.scopeStartLine, 8);
    assert.equal(details.scopeEndLine, 11);
    assert.match(details.expectations[0].snippet, /assert\.ok/);
    assert.match(details.expectations[1].snippet, /connected/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
