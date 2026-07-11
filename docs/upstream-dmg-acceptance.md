# Upstream DMG Acceptance

Local installs, updater rebuilds, and the scheduled upstream workflow use the
same release profile from `scripts/lib/upstream-dmg-release-profile.js`. Shell
and workflow entrypoints produce reports; `scripts/validate-upstream-dmg.js`
is the only component that decides whether the candidate can be promoted.

## Verdicts

| Verdict | Meaning | Local promotion | Scheduled issue |
|---|---|---:|---:|
| `accepted` | Build and every required release check passed | yes | close obsolete drift issues |
| `accepted_with_warnings` | Only optional fail-soft patches drifted | yes | close obsolete drift issues |
| `rejected` | A required core/feature/integrity contract failed | no | create or update the current fingerprint issue |
| `inconclusive` | Reports are missing or an infrastructure failure prevented a decision | no | no change |

The profile derives required core patches from patch descriptors. Its explicit
feature probe enables `remote-mobile-control` and `ui-tweaks`; these requirements
live in the profile rather than in workflow YAML.

## Transactional Local Install

`install.sh` builds into a hidden sibling candidate directory. It then runs the
feature probe and writes `dist-next/rebuild/upstream-dmg-decision.json`. The
existing app is moved only after an accepted verdict, immediately before the
candidate is renamed into place. A failed rename restores the timestamped
backup.

`--fresh` refreshes the DMG and candidate without deleting the working app
early. Set `CODEX_KEEP_REJECTED_CANDIDATE=1` to retain a rejected candidate for
debugging. `CODEX_ACCEPTANCE_OVERRIDE=1` is a developer-only emergency escape
hatch for a completely built candidate; CI and the updater do not set it.

## Drift Issue Lifecycle

Scheduled runs use the DMG SHA-256 as the identity and the app version only as
a display value. One `upstream-dmg-drift` issue is kept per rejected fingerprint.
When a new fingerprint arrives, open issues for older DMGs are closed as
superseded. An accepted new DMG closes all remaining drift issues. Before any
mutation, the issue job compares the tested HTTP identity with the current DMG
headers so rerunning an obsolete workflow cannot reopen an old issue.

## Manual Validation

Normal local builds run acceptance automatically:

```bash
./install.sh /path/to/Codex.dmg
./scripts/rebuild-candidate.sh /path/to/Codex.dmg
```

The generated decision and its referenced patch reports are sufficient to
reproduce the verdict; upstream intelligence reports remain diagnostic only.
