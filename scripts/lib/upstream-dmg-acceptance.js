"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { sourceInfoFromGit } = require("./build-info.js");
const { optionalDriftFromReport } = require("./patch-report.js");
const { readPatchReport, validatePatchReport } = require("./patch-validation.js");
const { UPSTREAM_DMG_RELEASE_PROFILE } = require("./upstream-dmg-release-profile.js");

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function readJsonIfPresent(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readReportResult(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { report: null, error: filePath ? `missing report: ${filePath}` : "report path not provided" };
  }
  try {
    return { report: readPatchReport(filePath), error: null };
  } catch (error) {
    return { report: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function integrityFailures(report) {
  const findings = report?.postPatchIntegrity?.findings;
  if (!Array.isArray(findings) || findings.length === 0) {
    return [];
  }
  return findings.map((finding) => ({
    code: "post-patch-integrity",
    check: "core",
    name: finding.symbol ?? finding.path ?? "post-patch integrity",
    status: "failed",
    reason: finding.reason ?? "Post-patch integrity check failed",
  }));
}

function validationBlockers(check, failures) {
  return failures.map((failure) => {
    const separator = failure.indexOf(": ");
    return {
      code: "required-patch",
      check,
      name: separator < 0 ? failure : failure.slice(0, separator),
      status: "failed",
      reason: failure,
    };
  });
}

function driftWarnings(check, report) {
  return optionalDriftFromReport(report).map((warning) => ({
    code: "optional-patch-drift",
    check,
    name: warning.name,
    status: warning.status,
    reason: warning.reason ?? null,
  }));
}

function httpIdentity(metadata) {
  if (metadata == null) {
    return null;
  }
  const identity = {
    etag: metadata.etag ?? null,
    lastModified: metadata.lastModified ?? metadata.last_modified ?? null,
    contentLength: metadata.contentLength ?? metadata.content_length ?? null,
  };
  if (Object.values(identity).every((value) => value == null || value === "unknown" || value === "no-etag")) {
    return null;
  }
  identity.key = crypto
    .createHash("sha256")
    .update(`${identity.lastModified ?? ""}|${identity.etag ?? ""}|${identity.contentLength ?? ""}`)
    .digest("hex");
  return identity;
}

function buildDmgInfo({ dmgPath, metadata, buildInfo }) {
  const upstreamDmg = buildInfo?.upstreamDmg ?? {};
  return {
    path: dmgPath ? path.resolve(dmgPath) : metadata?.path ?? null,
    url: metadata?.url ?? null,
    sha256: dmgPath && fs.existsSync(dmgPath) ? sha256File(dmgPath) : metadata?.sha256 ?? upstreamDmg.sha256 ?? null,
    sizeBytes: dmgPath && fs.existsSync(dmgPath) ? fs.statSync(dmgPath).size : metadata?.sizeBytes ?? metadata?.size_bytes ?? upstreamDmg.sizeBytes ?? null,
    appVersion: upstreamDmg.appVersion ?? metadata?.appVersion ?? metadata?.app_version ?? null,
    httpIdentity: httpIdentity(metadata),
  };
}

function evaluateUpstreamDmg(options) {
  const profile = options.profile ?? UPSTREAM_DMG_RELEASE_PROFILE;
  let metadata = null;
  let buildInfo = null;
  const inputErrors = [];
  try {
    metadata = readJsonIfPresent(options.metadataPath);
  } catch (error) {
    inputErrors.push(`invalid DMG metadata: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    buildInfo = readJsonIfPresent(options.buildInfoPath);
  } catch (error) {
    inputErrors.push(`invalid build metadata: ${error instanceof Error ? error.message : String(error)}`);
  }
  const core = readReportResult(options.coreReportPath);
  const remoteProfile = profile.featureChecks[0];
  const remote = readReportResult(options.featureReportPath);
  const blockers = [];
  const warnings = [];
  const inconclusiveReasons = [...inputErrors];

  if (core.report) {
    blockers.push(...validationBlockers("core", validatePatchReport(core.report, profile.corePatchProfile)));
    blockers.push(...integrityFailures(core.report));
    warnings.push(...driftWarnings("core", core.report));
  } else {
    inconclusiveReasons.push(core.error);
  }

  if (remoteProfile && remote.report) {
    blockers.push(...validationBlockers(
      remoteProfile.id,
      validatePatchReport(remote.report, profile.corePatchProfile, remoteProfile.requirements),
    ));
    blockers.push(...integrityFailures(remote.report).map((failure) => ({ ...failure, check: remoteProfile.id })));
    warnings.push(...driftWarnings(remoteProfile.id, remote.report));
  } else if (remoteProfile) {
    inconclusiveReasons.push(remote.error);
  }

  if (options.buildStatus !== "success") {
    inconclusiveReasons.push(`candidate build status: ${options.buildStatus ?? "unknown"}`);
  }
  if (options.featureInspectStatus !== "success") {
    inconclusiveReasons.push(`remote-mobile inspect status: ${options.featureInspectStatus ?? "unknown"}`);
  }

  const dmg = buildDmgInfo({ dmgPath: options.dmgPath, metadata, buildInfo });
  if (!dmg.sha256) {
    inconclusiveReasons.push("DMG fingerprint is unavailable");
  }
  const verdict = blockers.length > 0
    ? "rejected"
    : inconclusiveReasons.length > 0
      ? "inconclusive"
      : warnings.length > 0
        ? "accepted_with_warnings"
        : "accepted";
  const source = buildInfo?.source ?? sourceInfoFromGit(options.repoRoot ?? process.cwd()) ?? null;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    profile: profile.id,
    verdict,
    dmg,
    source,
    checks: {
      build: { status: options.buildStatus ?? "unknown" },
      core: { status: core.report ? "completed" : "missing", reportPath: options.coreReportPath ?? null },
      featureProbe: {
        status: remote.report ? (options.featureInspectStatus ?? "unknown") : "missing",
        reportPath: options.featureReportPath ?? null,
      },
    },
    blockers,
    warnings,
    inconclusiveReasons: [...new Set(inconclusiveReasons.filter(Boolean))],
    run: {
      id: options.runId ?? null,
      attempt: options.runAttempt ?? null,
      url: options.runUrl ?? null,
      source: options.source ?? "local",
    },
  };
}

function decisionMarkdown(decision) {
  const lines = [
    "## Upstream DMG acceptance",
    "",
    `- Verdict: \`${decision.verdict}\``,
    `- Profile: \`${decision.profile}\``,
    `- DMG SHA-256: \`${decision.dmg.sha256 ?? "unknown"}\``,
    `- App version: \`${decision.dmg.appVersion ?? "unknown"}\``,
    `- Required blockers: \`${decision.blockers.length}\``,
    `- Optional warnings: \`${decision.warnings.length}\``,
  ];
  if (decision.blockers.length > 0) {
    lines.push("", "### Blockers", ...decision.blockers.map((item) => `- ${item.check}: ${item.reason}`));
  }
  if (decision.warnings.length > 0) {
    lines.push("", "### Optional drift", ...decision.warnings.map((item) => `- ${item.check}: ${item.name} (${item.status})`));
  }
  if (decision.inconclusiveReasons.length > 0) {
    lines.push("", "### Inconclusive reasons", ...decision.inconclusiveReasons.map((reason) => `- ${reason}`));
  }
  return `${lines.join("\n")}\n`;
}

module.exports = {
  decisionMarkdown,
  evaluateUpstreamDmg,
  httpIdentity,
};
