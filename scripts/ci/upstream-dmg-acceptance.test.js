"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { evaluateUpstreamDmg } = require("../lib/upstream-dmg-acceptance.js");
const { UPSTREAM_DMG_RELEASE_PROFILE } = require("../lib/upstream-dmg-release-profile.js");

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "upstream-acceptance-"));
  try {
    const dmg = path.join(root, "Codex.dmg");
    fs.writeFileSync(dmg, "dmg fixture");
    return fn({ root, dmg });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function patch(name, extra = {}) {
  return { name, status: "applied", ...extra };
}

function requiredCoreReport() {
  const { requiredPatchNamesForProfile } = require("../patches/runner.js");
  return {
    patches: requiredPatchNamesForProfile("upstream-build").map((name) => patch(name, { ciPolicy: "required-upstream" })),
  };
}

function remoteReport() {
  const requirements = UPSTREAM_DMG_RELEASE_PROFILE.featureChecks[0].requirements;
  const names = new Set([...requirements.requiredAppliedPatches, ...requirements.requiredSuccessfulPatches]);
  const core = requiredCoreReport();
  return {
    enabledFeatures: ["remote-mobile-control", "ui-tweaks"],
    patches: [...core.patches, ...names].map((entry) => typeof entry === "string" ? patch(entry) : entry),
  };
}

function writeJson(root, name, value) {
  const filePath = path.join(root, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`);
  return filePath;
}

function evaluate(root, dmg, overrides = {}) {
  const core = writeJson(root, "core.json", overrides.core ?? requiredCoreReport());
  const remote = writeJson(root, "remote.json", overrides.remote ?? remoteReport());
  return evaluateUpstreamDmg({
    dmgPath: dmg,
    coreReportPath: overrides.corePath ?? core,
    featureReportPath: overrides.remotePath ?? remote,
    buildStatus: overrides.buildStatus ?? "success",
    featureInspectStatus: overrides.featureInspectStatus ?? "success",
    repoRoot: root,
  });
}

test("accepts a candidate when the shared release profile passes", () => withFixture(({ root, dmg }) => {
  const decision = evaluate(root, dmg);
  assert.equal(decision.verdict, "accepted");
  assert.equal(decision.blockers.length, 0);
}));

test("keeps optional drift non-blocking", () => withFixture(({ root, dmg }) => {
  const core = requiredCoreReport();
  core.patches.push(patch("optional-ui", { status: "skipped-optional", ciPolicy: "optional", reason: "needle moved" }));
  const decision = evaluate(root, dmg, { core });
  assert.equal(decision.verdict, "accepted_with_warnings");
  assert.equal(decision.warnings.length, 1);
}));

test("rejects required patch and post-patch integrity failures", () => withFixture(({ root, dmg }) => {
  const core = requiredCoreReport();
  core.patches[0].status = "failed-required";
  core.patches[0].reason = "needle moved";
  core.postPatchIntegrity = { findings: [{ symbol: "brokenSymbol", reason: "undeclared symbol" }] };
  const decision = evaluate(root, dmg, { core });
  assert.equal(decision.verdict, "rejected");
  assert.ok(decision.blockers.some((item) => item.code === "post-patch-integrity"));
}));

test("rejects a missing required remote-mobile contract entry", () => withFixture(({ root, dmg }) => {
  const remote = remoteReport();
  remote.patches = remote.patches.filter((entry) => entry.name !== "feature:ui-tweaks:sidebar-project-name-style");
  const decision = evaluate(root, dmg, { remote });
  assert.equal(decision.verdict, "rejected");
  assert.ok(decision.blockers.some((item) => item.check === "drift-sensitive-features"));
}));

test("the local and GitHub CLI surfaces use the same verdict", () => withFixture(({ root, dmg }) => {
  const core = writeJson(root, "cli-core.json", requiredCoreReport());
  const remote = writeJson(root, "cli-remote.json", remoteReport());
  const cli = path.join(__dirname, "../validate-upstream-dmg.js");
  const verdicts = [];
  for (const source of ["local", "github-actions"]) {
    const output = path.join(root, `${source}.json`);
    const result = spawnSync(process.execPath, [
      cli, "--dmg", dmg, "--core-report", core, "--feature-report", remote,
      "--build-status", "success", "--feature-inspect-status", "success",
      "--output", output, "--source", source, "--repo-root", root,
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    verdicts.push(JSON.parse(fs.readFileSync(output, "utf8")).verdict);
  }
  assert.deepEqual(verdicts, ["accepted", "accepted"]);
}));

test("marks unstructured build failures and missing reports inconclusive", () => withFixture(({ root, dmg }) => {
  const decision = evaluate(root, dmg, {
    buildStatus: "failure",
    corePath: path.join(root, "missing-core.json"),
    remotePath: path.join(root, "missing-remote.json"),
    featureInspectStatus: "failure",
  });
  assert.equal(decision.verdict, "inconclusive");
  assert.ok(decision.inconclusiveReasons.length >= 2);
}));

test("marks malformed reports inconclusive instead of throwing", () => withFixture(({ root, dmg }) => {
  const malformed = path.join(root, "malformed.json");
  fs.writeFileSync(malformed, "{not-json");
  const remote = writeJson(root, "valid-remote.json", remoteReport());
  const decision = evaluateUpstreamDmg({
    dmgPath: dmg,
    coreReportPath: malformed,
    featureReportPath: remote,
    buildStatus: "success",
    featureInspectStatus: "success",
    repoRoot: root,
  });
  assert.equal(decision.verdict, "inconclusive");
  assert.ok(decision.inconclusiveReasons.length > 0);
}));

test("a structured rejection wins over incomplete checks", () => withFixture(({ root, dmg }) => {
  const core = requiredCoreReport();
  core.patches[0].status = "failed-required";
  const decision = evaluate(root, dmg, {
    core,
    buildStatus: "failure",
    remotePath: path.join(root, "missing-remote.json"),
    featureInspectStatus: "failure",
  });
  assert.equal(decision.verdict, "rejected");
}));
