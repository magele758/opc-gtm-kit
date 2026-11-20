import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { runCli } from "./cli.ts";
import {
  auditLicenseMatrix,
  buildStaticSite,
  buildUtmUrl,
  createGtmServer,
  createGtmStore,
  exportTraces,
  generateCompliancePack,
  getDefaultRepoLicenseMatrix,
  getProductManifest,
  hashEmail,
  loadLeadMagnets,
  loadProductManifests,
  maskEmail,
  normalizeChannel,
  renderLeadMagnetBannerJs,
  renderPortfolioHub,
  renderProductLandingPage,
  repurposeContent,
  TRACE_COLUMNS,
  validateManifest,
} from "./index.ts";

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) {
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

describe("opc-gtm-kit — Built-in Manifests & Lead Magnets", () => {
  it("loads all 4 built-in OPC product manifests and 2 lead magnets with valid schemas", () => {
    const manifests = loadProductManifests();
    assert.equal(manifests.length, 4);
    assert.deepEqual(
      manifests.map((m) => m.slug),
      ["pagelens-interpret", "pagelens-agent", "audiobook", "hyper-vibekanban"],
    );

    const interpret = getProductManifest("pagelens-interpret");
    assert.ok(interpret);
    assert.equal(interpret.product, "PageLens");
    assert.equal(interpret.distribution, "chrome_extension");
    assert.equal(interpret.licenseModel, "freemium_offline_key");
    assert.deepEqual(interpret.permissions, [
      "activeTab",
      "storage",
      "offscreen",
      "tabCapture",
    ]);
    assert.ok(interpret.pricing.tiers.some((t) => t.priceUsd === 29));
    assert.ok(interpret.pricing.tiers.some((t) => t.priceUsd === 19));

    const agent = getProductManifest("pagelens-agent");
    assert.ok(agent);
    assert.equal(agent.licenseModel, "open_core_byok");
    assert.ok(agent.pricing.tiers.some((t) => t.priceUsd === 39));

    const audiobook = getProductManifest("audiobook");
    assert.ok(audiobook);
    assert.equal(audiobook.distribution, "macos_and_web");
    assert.ok(audiobook.pricing.tiers.some((t) => t.priceUsd === 29));

    const kanban = getProductManifest("hyper-vibekanban");
    assert.ok(kanban);
    assert.equal(kanban.distribution, "self_hosted_pro");
    assert.ok(kanban.pricing.tiers.some((t) => t.priceUsd === 49));

    const leadMagnets = loadLeadMagnets();
    assert.equal(leadMagnets.length, 2);
    assert.deepEqual(
      leadMagnets.map((lm) => lm.slug),
      ["rubiks-cube-learn", "bazi-ziwei-learning"],
    );
  });
});

describe("opc-gtm-kit — Storefront Generator, XSS Safety & Lead Magnet Banner", () => {
  it("renders high-conversion landing page with UTM preservation, Ed25519 pricing, and strict XSS escaping", () => {
    const base = getProductManifest("pagelens-interpret")!;
    const hostileManifest = validateManifest({
      ...base,
      displayName: `PageLens </script><script>alert("xss")</script>`,
      tagline: `Tagline <img src=x onerror="alert(1)">`,
      painPoint: `Pain "quoted" & <injected>`,
      links: {
        ...base.links,
        githubUrl: "javascript:alert(document.cookie)",
      },
    });

    const html = renderProductLandingPage(hostileManifest, {
      checkoutBaseUrl: "https://checkout.opc.example.com",
      channel: "hackernews",
      campaign: "show_hn_2026",
    });

    assert.ok(html.startsWith("<!DOCTYPE html>"));
    // XSS payloads must be escaped/neutralized
    assert.ok(!html.includes(`<script>alert("xss")</script>`));
    assert.ok(!html.includes(`<img src=x onerror="alert(1)">`));
    assert.ok(!html.includes(`href="javascript:`));
    assert.ok(html.includes("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"));

    // Conversion & trust elements present
    assert.ok(html.includes("Ed25519 Offline Key"));
    assert.ok(html.includes("/api/v1/waitlist/join"));
    assert.ok(html.includes("utm_source=hackernews"));
    assert.ok(html.includes("utm_campaign=show_hn_2026"));
    assert.ok(html.includes("Privacy Policy"));
    assert.ok(html.includes("Terms of Service"));
    assert.ok(html.includes("Refund Policy"));
  });

  it("renders Portfolio Hub, Lead Magnet Banner JS, and builds static site bundle", () => {
    const manifests = loadProductManifests();
    const leadMagnets = loadLeadMagnets();

    const hubHtml = renderPortfolioHub(manifests, leadMagnets);
    for (const m of manifests) {
      assert.ok(hubHtml.includes(m.displayName));
    }
    for (const lm of leadMagnets) {
      assert.ok(hubHtml.includes(lm.slug));
    }

    const bannerJs = renderLeadMagnetBannerJs(manifests[0], "lm_rubiks_cube_learn", {
      sourceSlug: "rubiks-cube-learn",
      hookText: `Try </script><script>evil()</script> safely`,
    });
    assert.ok(bannerJs.includes("utm_source=rubiks-cube-learn"));
    assert.ok(bannerJs.includes("utm_medium=banner"));
    assert.ok(bannerJs.includes("utm_campaign=lm_rubiks_cube_learn"));
    assert.ok(!bannerJs.includes("</script>"));
    assert.ok(bannerJs.includes("textContent"));

    const tempOut = mkdtempSync(join(tmpdir(), "opc-gtm-site-"));
    try {
      const built = buildStaticSite({ outDir: tempOut, manifests, leadMagnets });
      assert.equal(built.totalFiles, 1 + manifests.length * 4 + leadMagnets.length);
      assert.ok(existsSync(join(tempOut, "index.html")));
      assert.ok(existsSync(join(tempOut, "pagelens-interpret/index.html")));
      assert.ok(existsSync(join(tempOut, "pagelens-interpret/privacy.html")));
      assert.ok(existsSync(join(tempOut, "banners/rubiks-cube-learn.js")));
    } finally {
      rmSync(tempOut, { recursive: true, force: true });
    }
  });
});

describe("opc-gtm-kit — Legal Compliance Kit & Copyleft Contamination Auditor", () => {
  it("generates CWS MV3 single-purpose & per-permission pack and macOS notarization checklist", () => {
    const manifest = getProductManifest("pagelens-interpret")!;
    const pack = generateCompliancePack(manifest, {
      entityName: "Acme OPC Labs",
      contactEmail: "legal@example.com",
    });

    assert.ok(pack.privacyPolicyMd.includes("Acme OPC Labs"));
    assert.ok(pack.privacyPolicyMd.includes("legal@example.com"));
    assert.ok(pack.privacyPolicyMd.includes("BYOK"));
    assert.ok(pack.termsOfServiceMd.includes("Ed25519"));
    assert.ok(pack.refundPolicyMd.includes("14-Day"));

    // CWS MV3 Review specifics
    assert.ok(pack.chromeWebStoreReviewMd.includes("Single-Purpose Statement"));
    for (const perm of ["activeTab", "storage", "offscreen", "tabCapture"]) {
      assert.ok(pack.chromeWebStoreReviewMd.includes(`\`${perm}\``));
    }
    assert.ok(pack.chromeWebStoreReviewMd.includes("Does this extension use remote code?"));

    // macOS Notarization specifics
    assert.ok(pack.macosNotarizationChecklistMd.includes("xcrun notarytool submit"));
    assert.ok(pack.macosNotarizationChecklistMd.includes("codesign"));
  });

  it("passes clean OPC matrix and flags AGPL / GPL / CC-BY-NC contamination accurately", () => {
    const defaultReport = auditLicenseMatrix(getDefaultRepoLicenseMatrix());
    assert.equal(defaultReport.ok, true);
    assert.equal(defaultReport.criticalCount, 0);

    const contaminatedReport = auditLicenseMatrix([
      {
        repo: "pagelens-interpret",
        role: "flagship_paid",
        spdx: "LicenseRef-Proprietary",
        dependencyLicenses: ["MIT", "AGPL-3.0-only"],
      },
      {
        repo: "hyper-vibekanban",
        role: "open_core",
        spdx: "Apache-2.0",
        dependencyLicenses: ["MIT", "LGPL-2.1-only"],
      },
      {
        repo: "rubiks-cube-learn",
        role: "lead_magnet",
        spdx: "MIT",
        dependencyLicenses: ["CC-BY-NC-4.0"],
      },
    ]);

    assert.equal(contaminatedReport.ok, false);
    assert.equal(contaminatedReport.criticalCount, 2);
    assert.equal(contaminatedReport.warningCount, 1);

    const flagshipFinding = contaminatedReport.findings.find(
      (f) => f.repo === "pagelens-interpret",
    )!;
    assert.equal(flagshipFinding.contaminated, true);
    assert.deepEqual(flagshipFinding.contaminatingLicenses, ["AGPL-3.0-only"]);
    assert.ok(flagshipFinding.remediation.length > 0);
  });
});

describe("opc-gtm-kit — 5-Channel Repurposing, UTM Attribution & SQLite Drip Engine", () => {
  it("normalizes channels and produces 5 channel drafts + CONFIRMATION_REQUIRED cose bundle", () => {
    assert.equal(normalizeChannel("twitter.com"), "x");
    assert.equal(normalizeChannel("xhs"), "xiaohongshu");
    assert.equal(normalizeChannel("b23.tv"), "bilibili");
    assert.equal(normalizeChannel("news.ycombinator.com"), "hackernews");
    assert.equal(normalizeChannel("v2ex"), "v2ex");
    assert.equal(normalizeChannel("rubiks-cube-learn"), "lead_magnet");
    assert.equal(normalizeChannel(""), "direct");

    const url = buildUtmUrl("https://opc.example.com/audiobook", {
      source: "x",
      medium: "social",
      campaign: "autumn_drop",
      content: "thread_1",
    });
    assert.equal(
      url,
      "https://opc.example.com/audiobook?utm_source=x&utm_medium=social&utm_campaign=autumn_drop&utm_content=thread_1",
    );

    const manifest = getProductManifest("audiobook")!;
    const repurposed = repurposeContent({
      product: manifest.product,
      slug: manifest.slug,
      title: manifest.displayName,
      summary: manifest.outcome,
      highlights: manifest.highlights,
      baseUrl: manifest.links.homeUrl,
      campaign: "audiobook_v1",
    });

    assert.ok(repurposed.x_thread.utmUrl.includes("utm_source=x"));
    assert.ok(repurposed.xiaohongshu_note.utmUrl.includes("utm_source=xiaohongshu"));
    assert.ok(repurposed.bilibili_script.utmUrl.includes("utm_source=bilibili"));
    assert.ok(repurposed.hackernews_show.utmUrl.includes("utm_source=hackernews"));
    assert.ok(repurposed.v2ex_launch.utmUrl.includes("utm_source=v2ex"));

    assert.equal(repurposed.cosePublishBundle.gatePolicy, "CONFIRMATION_REQUIRED");
    assert.equal(repurposed.cosePublishBundle.platforms.length, 5);
    assert.ok(repurposed.cosePublishBundle.preflightCommand.includes("chromegate-gateway"));
    assert.ok(repurposed.cosePublishBundle.markdown.includes("CONFIRMATION_REQUIRED"));
  });

  it("handles idempotent acquisitions, privacy-masked waitlist hashing, and D0/D3 drip queueing", async () => {
    const store = createGtmStore({ dbPath: ":memory:", privacyMaskEmail: true });
    try {
      const firstAcq = await store.recordAcquisition({
        eventId: "evt_fixed_1",
        product: "PageLens",
        customerId: "cust_abc",
        channel: "twitter",
        campaign: "q4_launch",
      });
      assert.equal(firstAcq.deduplicated, false);
      assert.equal(firstAcq.acquisition.channel, "x");

      const dupAcq = await store.recordAcquisition({
        eventId: "evt_fixed_1",
        product: "PageLens",
        customerId: "cust_abc",
        channel: "twitter",
      });
      assert.equal(dupAcq.deduplicated, true);
      assert.equal(store.listAcquisitions("PageLens").length, 1);

      const rawEmail = "Founder.Alice@Example.com";
      const wl = await store.joinWaitlist({
        email: rawEmail,
        product: "PageLens",
        channel: "hn",
        campaign: "show_hn",
        at: "2026-11-20T10:00:00.000Z",
      });

      assert.equal(wl.deduplicated, false);
      assert.equal(wl.waitlist.emailHash, hashEmail(rawEmail));
      assert.equal(wl.waitlist.emailMasked, maskEmail(rawEmail));
      assert.equal(wl.waitlist.emailStored, "fo***@example.com");
      assert.ok(wl.waitlist.customerId.startsWith("cust_"));
      assert.equal(wl.drips.length, 2);
      assert.deepEqual(
        wl.drips.map((d) => d.stepCode),
        ["D0_WELCOME", "D3_TIPS"],
      );
      assert.equal(wl.drips[0].scheduledAt, "2026-11-20T10:00:00.000Z");
      assert.equal(wl.drips[1].scheduledAt, "2026-11-23T10:00:00.000Z");

      // Idempotent repeat join
      const wlRepeat = await store.joinWaitlist({
        email: rawEmail,
        product: "PageLens",
        channel: "hn",
      });
      assert.equal(wlRepeat.deduplicated, true);
      assert.equal(store.listDripOutbox("PageLens").length, 2);

      const traces = exportTraces("PageLens", { store });
      assert.equal(TRACE_COLUMNS.length, 17);
      assert.equal(traces.length, 3); // 2 acquisitions + 1 waitlist_joined
      for (const row of traces) {
        assert.deepEqual(Object.keys(row), [...TRACE_COLUMNS]);
      }
    } finally {
      store.close();
    }
  });
});

describe("opc-gtm-kit — HTTP Server, Mock opc-os & data_analysis Sync, and CLI", () => {
  it("serves previews, records UTM & waitlist, and syncs to mock opc-os and data_analysis", async () => {
    const receivedOpcOsEvents: Array<{
      authHeader: string | undefined;
      body: Record<string, unknown>;
    }> = [];
    const receivedDataAnalysisBatches: Array<{
      authHeader: string | undefined;
      body: Record<string, unknown>;
    }> = [];

    const mockUpstream = createServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/api/zoom/growth/events") {
        const body = await readJsonBody(req);
        receivedOpcOsEvents.push({
          authHeader: req.headers.authorization,
          body,
        });
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, accepted: true }));
        return;
      }

      if (req.method === "POST" && req.url === "/api/v1/import/traces") {
        const body = await readJsonBody(req);
        receivedDataAnalysisBatches.push({
          authHeader: req.headers.authorization,
          body,
        });
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, imported: (body.traces as unknown[]).length }));
        return;
      }

      res.statusCode = 404;
      res.end();
    });

    await new Promise<void>((resolvePromise) => {
      mockUpstream.listen(0, "127.0.0.1", () => resolvePromise());
    });
    const upstreamPort = (mockUpstream.address() as AddressInfo).port;
    const upstreamUrl = `http://127.0.0.1:${upstreamPort}`;

    const gtmHandle = createGtmServer({
      port: 0,
      host: "127.0.0.1",
      dbPath: ":memory:",
      opcOsUrl: upstreamUrl,
      opcOsToken: "test_opc_os_token_placeholder",
      dataAnalysisUrl: upstreamUrl,
      dataAnalysisToken: "test_da_token_placeholder",
    });

    const { baseUrl } = await gtmHandle.start();

    try {
      // 1. Health + CORS validation
      const healthRes = await fetch(`${baseUrl}/api/health`, {
        headers: { Origin: "http://localhost:5173" },
      });
      assert.equal(healthRes.status, 200);
      assert.equal(
        healthRes.headers.get("access-control-allow-origin"),
        "http://localhost:5173",
      );
      const healthJson = (await healthRes.json()) as {
        ok: boolean;
        service: string;
        version: string;
      };
      assert.equal(healthJson.ok, true);
      assert.equal(healthJson.service, "opc-gtm-kit");

      // Disallowed external origin must not get CORS header
      const externalCorsRes = await fetch(`${baseUrl}/api/health`, {
        headers: { Origin: "https://untrusted.example.org" },
      });
      assert.equal(externalCorsRes.headers.get("access-control-allow-origin"), null);

      // 2. Manifests + Live Preview HTML/JS routes
      const manifestsRes = await fetch(`${baseUrl}/api/v1/manifests`);
      assert.equal(manifestsRes.status, 200);
      const manifestsJson = (await manifestsRes.json()) as {
        manifests: unknown[];
        leadMagnets: unknown[];
      };
      assert.equal(manifestsJson.manifests.length, 4);
      assert.equal(manifestsJson.leadMagnets.length, 2);

      const singleManifestRes = await fetch(
        `${baseUrl}/api/v1/manifests/pagelens-interpret`,
      );
      assert.equal(singleManifestRes.status, 200);

      const missingManifestRes = await fetch(
        `${baseUrl}/api/v1/manifests/non-existent`,
      );
      assert.equal(missingManifestRes.status, 404);

      const hubPreview = await fetch(`${baseUrl}/preview`);
      assert.equal(hubPreview.status, 200);
      assert.ok((await hubPreview.text()).includes("Product Matrix"));

      const bannerPreview = await fetch(
        `${baseUrl}/preview/banner/rubiks-cube-learn.js`,
      );
      assert.equal(bannerPreview.status, 200);
      assert.ok((await bannerPreview.text()).includes("lm_rubiks_cube_learn"));

      const previewLanding = await fetch(
        `${baseUrl}/preview/pagelens-interpret?utm_source=v2ex&utm_campaign=v2_launch`,
      );
      assert.equal(previewLanding.status, 200);
      const landingHtml = await previewLanding.text();
      assert.ok(landingHtml.includes("PageLens Interpret"));
      assert.ok(landingHtml.includes("utm_source=v2ex"));

      const previewPrivacy = await fetch(
        `${baseUrl}/preview/pagelens-interpret/privacy`,
      );
      assert.equal(previewPrivacy.status, 200);
      assert.ok((await previewPrivacy.text()).includes("Privacy Policy"));

      const previewTerms = await fetch(
        `${baseUrl}/preview/pagelens-interpret/terms`,
      );
      assert.equal(previewTerms.status, 200);

      const previewRefund = await fetch(
        `${baseUrl}/preview/pagelens-interpret/refund`,
      );
      assert.equal(previewRefund.status, 200);

      // Storefront dry-run & forbidden path guard
      const dryBuildRes = await fetch(`${baseUrl}/api/v1/storefront/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      });
      assert.equal(dryBuildRes.status, 200);
      assert.equal(((await dryBuildRes.json()) as { totalFiles: number }).totalFiles, 19);

      const blockedBuildRes = await fetch(`${baseUrl}/api/v1/storefront/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outDir: "/etc/opc-forbidden" }),
      });
      assert.equal(blockedBuildRes.status, 400);

      // Legal HTTP endpoints
      const legalGenRes = await fetch(`${baseUrl}/api/v1/legal/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: "pagelens-agent" }),
      });
      assert.equal(legalGenRes.status, 200);

      const legalAuditRes = await fetch(`${baseUrl}/api/v1/legal/audit-licenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(legalAuditRes.status, 200);
      assert.equal(
        ((await legalAuditRes.json()) as { report: { ok: boolean } }).report.ok,
        true,
      );

      // 3. POST /api/v1/utm/acquire -> auto-syncs to opc-os
      const acqRes = await fetch(`${baseUrl}/api/v1/utm/acquire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: "acq_live_001",
          product: "PageLens",
          customerId: "cust_live_001",
          channel: "x",
          campaign: "launch_day",
          reference: "https://x.com/example/status/1",
        }),
      });
      assert.equal(acqRes.status, 200);
      const acqData = (await acqRes.json()) as {
        ok: boolean;
        opcOsSync: { ok: boolean; status: number };
      };
      assert.equal(acqData.ok, true);
      assert.equal(acqData.opcOsSync.ok, true);
      assert.equal(receivedOpcOsEvents.length, 1);
      assert.equal(
        receivedOpcOsEvents[0].authHeader,
        "Bearer test_opc_os_token_placeholder",
      );
      assert.equal(receivedOpcOsEvents[0].body.kind, "acquired");
      assert.equal(receivedOpcOsEvents[0].body.eventId, "acq_live_001");
      assert.equal(receivedOpcOsEvents[0].body.channel, "x");

      // 4. POST /api/v1/waitlist/join -> creates D0/D3 drips + syncs acquired to opc-os
      const wlRes = await fetch(`${baseUrl}/api/v1/waitlist/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "subscriber@example.com",
          product: "audiobook",
          channel: "bilibili",
          campaign: "bili_demo",
          note: "Want long technical PDF dubbing",
        }),
      });
      assert.equal(wlRes.status, 200);
      const wlData = (await wlRes.json()) as {
        ok: boolean;
        drips: Array<{ stepCode: string }>;
        waitlist: { emailMasked: string };
      };
      assert.equal(wlData.ok, true);
      assert.equal(wlData.waitlist.emailMasked, "su***@example.com");
      assert.equal(wlData.drips.length, 2);
      assert.equal(receivedOpcOsEvents.length, 2);

      // 5. POST /api/v1/repurpose & GET /api/v1/campaigns
      const repRes = await fetch(`${baseUrl}/api/v1/repurpose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: "hyper-vibekanban",
          campaign: "kanban_release",
        }),
      });
      assert.equal(repRes.status, 200);
      const repJson = (await repRes.json()) as {
        ok: boolean;
        cosePublishBundle: { gatePolicy: string };
      };
      assert.equal(repJson.ok, true);
      assert.equal(repJson.cosePublishBundle.gatePolicy, "CONFIRMATION_REQUIRED");

      const campListRes = await fetch(
        `${baseUrl}/api/v1/campaigns?product=hyper-vibekanban`,
      );
      const campListJson = (await campListRes.json()) as { campaigns: unknown[] };
      assert.equal(campListJson.campaigns.length, 1);

      const wlListRes = await fetch(`${baseUrl}/api/v1/waitlist?product=audiobook`);
      const wlListJson = (await wlListRes.json()) as {
        count: number;
        drips: unknown[];
      };
      assert.equal(wlListJson.count, 1);
      assert.equal(wlListJson.drips.length, 2);

      const exportRes = await fetch(`${baseUrl}/api/v1/export/traces`);
      assert.equal(exportRes.status, 200);
      const exportJson = (await exportRes.json()) as {
        columns: string[];
        count: number;
      };
      assert.equal(exportJson.columns.length, 17);
      assert.equal(exportJson.count, 3);

      const summaryRes = await fetch(`${baseUrl}/api/v1/summary?product=PageLens`);
      assert.equal(summaryRes.status, 200);
      assert.equal(
        ((await summaryRes.json()) as { summary: { totalAcquisitions: number } })
          .summary.totalAcquisitions,
        1,
      );

      // 6. POST /api/v1/sync/opc-os & POST /api/v1/sync/data-analysis
      const syncOpcRes = await fetch(`${baseUrl}/api/v1/sync/opc-os`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(syncOpcRes.status, 200);

      const syncDaRes = await fetch(`${baseUrl}/api/v1/sync/data-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(syncDaRes.status, 200);
      const syncDaJson = (await syncDaRes.json()) as {
        ok: boolean;
        exportedCount: number;
      };
      assert.equal(syncDaJson.ok, true);
      assert.equal(syncDaJson.exportedCount, 3);
      assert.equal(receivedDataAnalysisBatches.length, 1);
      assert.equal(
        receivedDataAnalysisBatches[0].authHeader,
        "Bearer test_da_token_placeholder",
      );
      assert.deepEqual(receivedDataAnalysisBatches[0].body.columns, [
        ...TRACE_COLUMNS,
      ]);
    } finally {
      await gtmHandle.stop();
      await new Promise<void>((resolvePromise) => {
        mockUpstream.close(() => resolvePromise());
      });
    }
  });

  it("executes CLI commands cleanly against temporary SQLite database", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "opc-gtm-cli-"));
    const dbFile = join(tmpDir, "cli-test.db");
    const logs: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: (m: string) => logs.push(m),
      stderr: (m: string) => errors.push(m),
    };

    try {
      const codeAudit = await runCli(["audit-licenses", "--json"], io);
      assert.equal(codeAudit, 0);
      assert.equal(JSON.parse(logs.at(-1)!).ok, true);

      const codeAcq = await runCli(
        [
          "acquire",
          "--product",
          "PageLens",
          "--customer",
          "cust_cli_1",
          "--channel",
          "v2ex",
          "--db",
          dbFile,
        ],
        io,
      );
      assert.equal(codeAcq, 0);

      const codeWl = await runCli(
        [
          "waitlist",
          "--email",
          "cli.tester@example.com",
          "--product",
          "PageLens",
          "--channel",
          "x",
          "--db",
          dbFile,
        ],
        io,
      );
      assert.equal(codeWl, 0);

      const codeRep = await runCli(
        [
          "repurpose",
          "--slug",
          "pagelens-interpret",
          "--campaign",
          "cli_camp",
          "--out",
          join(tmpDir, "cose-bundle.md"),
          "--db",
          dbFile,
        ],
        io,
      );
      assert.equal(codeRep, 0);
      assert.ok(existsSync(join(tmpDir, "cose-bundle.md")));

      const codeLegal = await runCli(
        ["legal", "--slug", "audiobook", "--out", join(tmpDir, "legal-out")],
        io,
      );
      assert.equal(codeLegal, 0);
      assert.ok(existsSync(join(tmpDir, "legal-out/MACOS_NOTARIZATION_CHECKLIST.md")));

      const codeBuild = await runCli(
        ["build-site", "--out", join(tmpDir, "site-out")],
        io,
      );
      assert.equal(codeBuild, 0);
      assert.ok(existsSync(join(tmpDir, "site-out/index.html")));

      const codeSync = await runCli(["sync", "--target", "all", "--db", dbFile], io);
      assert.equal(codeSync, 0);

      const codeSummary = await runCli(["summary", "--db", dbFile], io);
      assert.equal(codeSummary, 0);
      const parsedSummary = JSON.parse(logs.at(-1)!) as {
        summary: {
          totalAcquisitions: number;
          totalWaitlist: number;
          totalCampaigns: number;
        };
      };
      assert.equal(parsedSummary.summary.totalAcquisitions, 2);
      assert.equal(parsedSummary.summary.totalWaitlist, 1);
      assert.equal(parsedSummary.summary.totalCampaigns, 1);
      assert.equal(errors.length, 0);

      // Verify README/package check
      const pkg = JSON.parse(
        readFileSync(new URL("../package.json", import.meta.url), "utf8"),
      ) as { dependencies?: Record<string, string> };
      assert.equal(pkg.dependencies, undefined);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
