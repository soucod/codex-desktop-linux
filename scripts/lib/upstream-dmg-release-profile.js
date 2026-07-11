"use strict";

const UPSTREAM_DMG_RELEASE_PROFILE = Object.freeze({
  id: "upstream-release",
  corePatchProfile: "upstream-build",
  featureChecks: Object.freeze([
    Object.freeze({
      id: "drift-sensitive-features",
      requirements: Object.freeze({
        requiredEnabledFeatures: Object.freeze(["remote-mobile-control", "ui-tweaks"]),
        requiredAppliedPatches: Object.freeze([
          "linux-app-server-conversation-hydration",
          "linux-completed-item-recovery",
          "feature:remote-mobile-control:linux-remote-control-load-gate",
          "feature:remote-mobile-control:linux-remote-control-status-read-guard",
          "feature:remote-mobile-control:linux-remote-control-status-wait",
          "feature:ui-tweaks:sidebar-project-name-style",
          "feature:ui-tweaks:model-picker-default-advanced-view",
          "feature:ui-tweaks:model-picker-include-gpt-5-6",
          "feature:ui-tweaks:model-picker-inline-model-list",
          "feature:ui-tweaks:model-picker-dynamic-supported-reasoning-efforts",
          "feature:ui-tweaks:reasoning-effort-labels-english",
        ]),
        requiredSuccessfulPatches: Object.freeze([
          "feature:remote-mobile-control:linux-remote-mobile-conversation-hydration",
        ]),
      }),
    }),
  ]),
});

module.exports = { UPSTREAM_DMG_RELEASE_PROFILE };
