import type { ProductManifest, RepoLicenseInput, RepoRole } from "./manifests.ts";

export interface ComplianceOptions {
  entityName?: string;
  contactEmail?: string;
  jurisdiction?: string;
  effectiveDate?: string;
}

export interface CompliancePack {
  privacyPolicyMd: string;
  termsOfServiceMd: string;
  refundPolicyMd: string;
  chromeWebStoreReviewMd: string;
  macosNotarizationChecklistMd: string;
}

export const AUDIT_STATUSES = ["pass", "warning", "critical"] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

export interface LicenseAuditFinding {
  repo: string;
  role: RepoRole;
  spdx: string;
  dependencyLicenses: string[];
  status: AuditStatus;
  contaminated: boolean;
  contaminatingLicenses: string[];
  weakCopyleftLicenses: string[];
  issues: string[];
  remediation: string[];
}

export interface LicenseAuditReport {
  ok: boolean;
  totalRepos: number;
  criticalCount: number;
  warningCount: number;
  findings: LicenseAuditFinding[];
  summaryMarkdown: string;
}

const DEFAULT_PERMISSION_DESCRIPTIONS: Record<string, string> = {
  activeTab:
    "Grants temporary access to the currently active tab strictly upon explicit user gesture (clicking the extension action), avoiding broad <all_urls> host permissions.",
  storage:
    "Stores user preferences, BYOK API keys, templates, and offline Ed25519 license tokens locally in chrome.storage.local without syncing PII to vendor servers.",
  offscreen:
    "Creates an isolated Manifest V3 Offscreen Document solely for low-latency WebAudio processing, speech synthesis playback, and audio mixing that Service Workers cannot perform directly.",
  tabCapture:
    "Captures the active tab's audio stream strictly when the user clicks Start Interpretation to perform real-time speech translation and audio ducking; never records in the background.",
  sidePanel:
    "Renders the primary assistant workspace inside Chrome's native Side Panel so users can inspect structured extractions and controlled form-fill diffs alongside page content.",
  scripting:
    "Executes user-confirmed structured extraction or controlled form-fill scripts in the active tab only after explicit user interaction.",
  contextMenus:
    "Adds a right-click shortcut allowing the user to send selected text directly into the local workspace.",
  notifications:
    "Notifies the user locally when long-running background dubbing or queued batch processing completes.",
};

function resolveComplianceOptions(options?: ComplianceOptions): Required<ComplianceOptions> {
  return {
    entityName: options?.entityName || process.env.OPC_BRAND_NAME || "OPC Studio",
    contactEmail: options?.contactEmail || process.env.OPC_SUPPORT_EMAIL || "support@example.com",
    jurisdiction:
      options?.jurisdiction ||
      process.env.OPC_JURISDICTION ||
      "Singapore / Applicable Local Law",
    effectiveDate: options?.effectiveDate || "2026-01-01",
  };
}

export function generateCompliancePack(
  manifest: ProductManifest,
  options?: ComplianceOptions,
): CompliancePack {
  const cfg = resolveComplianceOptions(options);

  const byokClause = manifest.byok
    ? `### Bring-Your-Own-Key (BYOK) Direct Connection
- **${manifest.displayName}** supports BYOK architecture. Any API keys you enter (e.g., OpenAI, Anthropic, Gemini, or local Ollama endpoints) are stored **exclusively on your local device** (\`chrome.storage.local\` or OS keychain).
- Requests transmit directly from your client environment to your chosen AI provider. **${cfg.entityName}** never proxies, logs, or retains your BYOK credentials or raw prompts.`
    : `### Local-First Inference & Zero Cloud Content Retention
- **${manifest.displayName}** executes document segmentation and audio/model processing locally on your device without uploading private manuscripts or media to **${cfg.entityName}** servers.`;

  const permissionsSection =
    manifest.permissions.length > 0
      ? `### Browser Extension Permissions Disclosure
We strictly adhere to the Chrome Web Store Principle of Least Privilege:
${manifest.permissions
  .map(
    (perm) =>
      `- **\`${perm}\`**: ${
        manifest.permissionJustifications[perm] ||
        DEFAULT_PERMISSION_DESCRIPTIONS[perm] ||
        "Used strictly to deliver user-initiated core product functionality."
      }`,
  )
  .join("\n")}`
      : `### Device & OS Permissions Disclosure
- **${manifest.displayName}** operates strictly within user-selected files and workspaces without background keylogging, screen scraping, or silent telemetry.`;

  const privacyPolicyMd = `# Privacy Policy — ${manifest.displayName}

**Effective Date:** ${cfg.effectiveDate}  
**Maintainer:** ${cfg.entityName}  
**Contact:** ${cfg.contactEmail}

## 1. Local-First Privacy Commitment
**${manifest.displayName}** (\`${manifest.slug}\`) is built on a **Local-First, Privacy-by-Design** architecture: ${manifest.privacyPledge.headline}.

${manifest.privacyPledge.points.map((p) => `- ${p}`).join("\n")}

${byokClause}

${permissionsSection}

## 2. Data We Collect (Minimalist Scope)
1. **Core Product Usage:** Zero raw page DOMs, private PDFs, audio streams, or Git source repositories are uploaded to ${cfg.entityName}.
2. **Waitlist & Optional Updates:** When you voluntarily join our waitlist, we store a SHA-256 cryptographic hash of your email address (and masked preview when \`PRIVACY_MASK_EMAIL=1\`) plus aggregate UTM channel attribution (\`utm_source\`, \`utm_campaign\`).
3. **Offline Ed25519 License Verification:** Pro licenses are verified locally using an embedded Ed25519 public key signature without mandatory continuous phone-home tracking.

## 3. Data Sharing & Third-Party Brokers
We **never** sell, rent, or trade user data to advertisers, data brokers, or credit agencies. Data is never used to train foundation models.

## 4. Your Rights & Deletion Requests
You may clear all local state at any time by uninstalling the extension/application or clearing local storage. For waitlist removal or privacy inquiries, email **${cfg.contactEmail}**.
`;

  const termsOfServiceMd = `# Terms of Service — ${manifest.displayName}

**Effective Date:** ${cfg.effectiveDate}  
**Provider:** ${cfg.entityName} (\`${cfg.contactEmail}\`)

## 1. Scope & License Model (\`${manifest.licenseModel}\`)
Subject to these Terms, **${cfg.entityName}** grants you a revocable, non-exclusive, non-transferable license to use **${manifest.displayName}** (\`${manifest.tagline}\`).

### Pricing & Entitlements
${manifest.pricing.tiers
  .map(
    (t) =>
      `- **${t.name} (${t.priceLabel}, ${t.billingPeriod})**: ${t.features.join("; ")}${
        t.offlineKeyEd25519 ? " [Includes Ed25519 Offline License Key]" : ""
      }`,
  )
  .join("\n")}

## 2. Ed25519 Offline License Keys & Fair Use
- Paid Pro tiers issue a cryptographically signed Ed25519 license key intended for personal or single-seat professional use across your personal devices.
- Public redistribution, keygen tampering, or unauthorized commercial resale of license keys is strictly prohibited and grounds for license revocation.

## 3. BYOK & User Responsibility
- Where BYOK (Bring Your Own Key) or third-party media is used, you are solely responsible for complying with your chosen AI provider's terms of service, API billing limits, and applicable copyright regulations regarding media or documents you process.
- Automated form-filling or Coding Agent actions include human-in-the-loop review safeguards; you remain responsible for reviewing final submissions and code merges.

## 4. Disclaimer of Warranties & Limitation of Liability
THE SOFTWARE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND. TO THE MAXIMUM EXTENT PERMITTED BY LAW, ${cfg.entityName.toUpperCase()}'S AGGREGATE LIABILITY SHALL NOT EXCEED THE AMOUNT YOU PAID FOR ${manifest.displayName.toUpperCase()} IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM.

## 5. Governing Law
These Terms are governed by the laws of **${cfg.jurisdiction}**, without regard to conflict-of-law principles.
`;

  const refundPolicyMd = `# Refund Policy — ${manifest.displayName}

**Effective Date:** ${cfg.effectiveDate}  
**Support Contact:** ${cfg.contactEmail}

## 14-Day No-Questions-Asked Satisfaction Guarantee
We build independent tools for long-term trust. If **${manifest.displayName}** does not fit your workflow or fails to achieve its core activation milestone (*"${manifest.activationAction}"*), you are eligible for a **100% full refund within 14 calendar days** of purchase.

### How to Request a Refund
1. Email **${cfg.contactEmail}** with your order reference or checkout email.
2. Refunds are processed back to your original payment method within 3–5 business days.
3. Upon refund completion, you agree to remove your offline Ed25519 Pro license key from local storage; refunded key IDs are excluded from future Pro update entitlements.
`;

  const cwsPermsList =
    manifest.permissions.length > 0
      ? manifest.permissions
          .map((perm) => {
            const zhOrCustom = manifest.permissionJustifications[perm];
            const enStandard =
              DEFAULT_PERMISSION_DESCRIPTIONS[perm] ||
              "Required solely when invoked by the user to execute the extension's single purpose.";
            return `### Permission: \`${perm}\`
- **Reviewer Justification (English Copy-Paste):** ${enStandard}
- **Product Context Detail:** ${zhOrCustom || enStandard}`;
          })
          .join("\n\n")
      : `_Note: \`${manifest.slug}\` declares zero Chrome extension permissions (distribution: \`${manifest.distribution}\`)._`;

  const chromeWebStoreReviewMd = `# Chrome Web Store (MV3) Review & Compliance Pack — ${manifest.displayName}

**Extension Slug:** \`${manifest.slug}\`  
**Distribution:** \`${manifest.distribution}\`  
**Manifest Version:** Manifest V3 (MV3)

## 1. Single-Purpose Statement (Copy-Paste into CWS Privacy Tab)
> **${manifest.displayName}** has a single, focused purpose: **${manifest.tagline}** — enabling users to achieve *"${manifest.activationAction}"* directly on user-activated tabs with local-first privacy and optional BYOK credentials.

## 2. Narrowest Host & API Permission Justifications
- **Host Permissions Policy:** Uses \`activeTab\` user-gesture invocation rather than broad persistent \`<all_urls>\` background content scripts wherever possible.

${cwsPermsList}

## 3. Remote Code Execution Certification
- **Does this extension use remote code?** **No.**
- **Justification:** All executable JavaScript, CSS, and WebAssembly modules are statically bundled inside the signed CRX/ZIP package submitted to the Chrome Web Store. External network calls (when configured by the user via BYOK) transmit strictly structured JSON/audio payloads to user-configured API endpoints and never \`eval()\` or dynamically load remote scripts.

## 4. CWS Data Usage & Privacy Disclosures Checklist
- **Personally Identifiable Information:** Not collected by the extension runtime.
- **Authentication / API Keys (BYOK):** Stored exclusively in \`chrome.storage.local\` on the user's machine; never transmitted to ${cfg.entityName}.
- **Website Content / Tab Audio:** Processed transiently strictly after explicit user click to fulfill the single purpose; never sold, logged for advertising, or used for creditworthiness.
- **All 3 Limited Use Certifications:** Check **Yes** (complies with Chrome Web Store User Data Policy Limited Use requirements).

## 5. Fast Verification Steps for CWS Reviewers (< 60 Seconds)
1. Install **${manifest.displayName}** in Chrome and pin the toolbar icon.
2. Open any public test page or sample video page and click the **${manifest.displayName}** icon.
3. Verify free/demo mode or enter test BYOK endpoint in Settings; trigger **${manifest.activationAction}**.
4. Confirm zero background activity occurs prior to clicking the extension action.
`;

  const macosNotarizationChecklistMd = `# macOS Signing, Hardened Runtime & Notarization Checklist — ${manifest.displayName}

**Product:** \`${manifest.slug}\` (\`${manifest.distribution}\`)  
**Maintainer:** ${cfg.entityName}

## 1. Build & Universal Binary Hygiene
- [ ] Compile Universal 2 binary (\`arm64\` + \`x86_64\`) or explicit Apple Silicon (\`arm64\`) release target with debug symbols stripped.
- [ ] Verify embedded Ed25519 public key constant is compiled read-only for offline license signature checks.
- [ ] Audit bundled dynamic libraries (\`otool -L\`) to confirm zero GPL/AGPL linked dylibs in proprietary app bundles.

## 2. Hardened Runtime Entitlements (\`entitlements.plist\`)
- [ ] Enable Hardened Runtime (\`--options runtime\`).
- [ ] Include \`com.apple.security.network.client\` only if network/BYOK or license activation check is offered.
- [ ] Include \`com.apple.security.files.user-selected.read-write\` for user-chosen PDFs/exports (e.g., local Index-TTS output).
- [ ] Include \`com.apple.security.cs.allow-unsigned-executable-memory\` **only** if bundled ONNX/PyTorch/Index-TTS ML runtime strictly requires JIT memory allocation.

## 3. Codesign & Apple \`notarytool\` Commands
\`\`\`bash
# 1. Sign nested frameworks/binaries inside-out, then app bundle
codesign --deep --force --verify --verbose \\
  --timestamp --options runtime \\
  --entitlements ./build/entitlements.plist \\
  --sign "Developer ID Application: ${cfg.entityName} (TEAMIDXXXX)" \\
  "./dist/${manifest.displayName}.app"

# 2. Package DMG / ZIP and submit to Apple Notary Service
ditto -c -k --keepParent "./dist/${manifest.displayName}.app" "./dist/${manifest.slug}.zip"
xcrun notarytool submit "./dist/${manifest.slug}.zip" \\
  --keychain-profile "OPC_NOTARY_PROFILE" \\
  --wait

# 3. Staple ticket & verify Gatekeeper acceptance
xcrun stapler staple "./dist/${manifest.displayName}.app"
spctl -a -t exec -vv "./dist/${manifest.displayName}.app"
\`\`\`
`;

  return {
    privacyPolicyMd,
    termsOfServiceMd,
    refundPolicyMd,
    chromeWebStoreReviewMd,
    macosNotarizationChecklistMd,
  };
}

function classifyLicense(rawLicense: string): "strong_copyleft" | "weak_copyleft" | "permissive" {
  const norm = rawLicense.trim().toUpperCase();
  if (
    norm.includes("AGPL") ||
    norm.includes("SSPL") ||
    norm.includes("BUSL") ||
    norm.includes("BSL-1") ||
    norm.includes("CC-BY-NC") ||
    norm.includes("NONCOMMERCIAL") ||
    norm.includes("EUPL") ||
    /(^|[^L])GPL/.test(norm)
  ) {
    return "strong_copyleft";
  }
  if (norm.includes("LGPL") || norm.includes("MPL") || norm.includes("EPL") || norm.includes("CDDL")) {
    return "weak_copyleft";
  }
  return "permissive";
}

export function auditLicenseMatrix(repos: RepoLicenseInput[]): LicenseAuditReport {
  const findings: LicenseAuditFinding[] = repos.map((entry) => {
    const depLicenses = entry.dependencyLicenses ?? [];
    const allDepsStrong = depLicenses.filter((l) => classifyLicense(l) === "strong_copyleft");
    const allDepsWeak = depLicenses.filter((l) => classifyLicense(l) === "weak_copyleft");
    const rootClass = classifyLicense(entry.spdx);

    const isCommercialRole = entry.role === "flagship_paid" || entry.role === "open_core";
    const contaminatingLicenses: string[] = [];
    const weakCopyleftLicenses: string[] = [...allDepsWeak];
    const issues: string[] = [];
    const remediation: string[] = [];

    if (isCommercialRole) {
      if (rootClass === "strong_copyleft") {
        contaminatingLicenses.push(entry.spdx);
        issues.push(
          `Repository "${entry.repo}" (${entry.role}) uses strong/network copyleft root license "${entry.spdx}", conflicting with proprietary Pro buyout/closed-extension distribution.`,
        );
        remediation.push(
          `Relicense "${entry.repo}" to MIT or Apache-2.0 for open-core modules (only valid if 100% copyright is first-party owned or covered by contributor CLA), or keep closed Pro artifacts in a cleanly separated repository.`,
        );
      }

      if (allDepsStrong.length > 0) {
        for (const lic of allDepsStrong) {
          if (!contaminatingLicenses.includes(lic)) {
            contaminatingLicenses.push(lic);
          }
        }
        issues.push(
          `Commercial "${entry.role}" product "${entry.repo}" pulls strong copyleft/non-commercial dependency license(s): ${allDepsStrong.join(", ")}.`,
        );
        remediation.push(
          `Remove or replace ${allDepsStrong.join(", ")} dependencies with permissive (MIT / Apache-2.0 / BSD-3-Clause) equivalents before shipping Chrome Web Store bundles, macOS binaries, or SaaS endpoints.`,
        );
        remediation.push(
          `Do NOT bundle AGPL/GPL libraries inside proprietary Ed25519-gated builds; if invoking an optional local tool (e.g. FFmpeg/TTS), allow user-installed external binary invocation over standard OS pipes without static/dynamic linking, and verify AGPL network-use triggers do not apply.`,
        );
      }

      if (rootClass === "weak_copyleft") {
        weakCopyleftLicenses.push(entry.spdx);
      }
      if (weakCopyleftLicenses.length > 0) {
        issues.push(
          `Weak copyleft license(s) detected (${weakCopyleftLicenses.join(", ")}) in "${entry.repo}": single-file bundling (Webpack/esbuild/CRX) or static macOS linking may trigger LGPL/MPL disclosure obligations.`,
        );
        remediation.push(
          `Keep MPL-2.0 modified files isolated with source notices, and avoid statically linking LGPL libraries into closed-source binaries without object-relinking provisions.`,
        );
      }
    } else if (entry.role === "lead_magnet") {
      const ncDeps = [entry.spdx, ...depLicenses].filter((l) =>
        l.toUpperCase().includes("CC-BY-NC"),
      );
      if (ncDeps.length > 0) {
        contaminatingLicenses.push(...ncDeps);
        issues.push(
          `Lead magnet "${entry.repo}" contains Non-Commercial license (${ncDeps.join(", ")}), which risks infringement when used as commercial funnel acquisition for paid OPC products.`,
        );
        remediation.push(
          `Replace CC-BY-NC assets/code in "${entry.repo}" with MIT/CC-BY-4.0/CC0 equivalents so UTM funnel monetization stays clean.`,
        );
      } else if (rootClass === "strong_copyleft" || allDepsStrong.length > 0) {
        weakCopyleftLicenses.push(
          ...[...(rootClass === "strong_copyleft" ? [entry.spdx] : []), ...allDepsStrong],
        );
        issues.push(
          `Lead magnet "${entry.repo}" uses copyleft (${[entry.spdx, ...allDepsStrong].join(", ")}); never copy code directly from this repo into flagship_paid or open_core products.`,
        );
        remediation.push(
          `Maintain strict one-way isolation: integrate only via external UTM banner links, never shared internal packages.`,
        );
      }
    }

    const contaminated = contaminatingLicenses.length > 0;
    const status: AuditStatus = contaminated
      ? "critical"
      : issues.length > 0
        ? "warning"
        : "pass";

    return {
      repo: entry.repo,
      role: entry.role,
      spdx: entry.spdx,
      dependencyLicenses: depLicenses,
      status,
      contaminated,
      contaminatingLicenses,
      weakCopyleftLicenses,
      issues,
      remediation,
    };
  });

  const criticalCount = findings.filter((f) => f.status === "critical").length;
  const warningCount = findings.filter((f) => f.status === "warning").length;
  const ok = criticalCount === 0;

  const tableRows = findings
    .map(
      (f) =>
        `| \`${f.repo}\` | \`${f.role}\` | \`${f.spdx}\` | ${
          f.dependencyLicenses.length > 0 ? f.dependencyLicenses.join(", ") : "—"
        } | **${f.status.toUpperCase()}** |`,
    )
    .join("\n");

  const detailBlocks = findings
    .filter((f) => f.status !== "pass")
    .map(
      (f) => `### \`${f.repo}\` (${f.status.toUpperCase()})
${f.issues.map((i) => `- **Issue:** ${i}`).join("\n")}
${f.remediation.map((r) => `- **Remediation:** ${r}`).join("\n")}`,
    )
    .join("\n\n");

  const summaryMarkdown = `# OPC License & Copyleft Contamination Audit

- **Overall Status:** ${ok ? "PASS (Zero Copyleft Contamination)" : `ACTION REQUIRED (${criticalCount} critical, ${warningCount} warning)`}
- **Audited Repositories:** ${findings.length}

| Repository | Role | Root SPDX | Dependency Licenses | Status |
| :--- | :--- | :--- | :--- | :--- |
${tableRows}

${detailBlocks || "All commercial and funnel repositories passed license boundary checks."}
`;

  return {
    ok,
    totalRepos: findings.length,
    criticalCount,
    warningCount,
    findings,
    summaryMarkdown,
  };
}
