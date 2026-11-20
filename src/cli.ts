#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  syncPendingAcquisitionsToOpcOs,
  syncTracesToDataAnalysis,
} from "./bridge.ts";
import { createGtmStore, repurposeContent } from "./growth.ts";
import { auditLicenseMatrix, generateCompliancePack } from "./legal.ts";
import {
  findManifestByProductOrSlug,
  getDefaultRepoLicenseMatrix,
  type RepoLicenseInput,
} from "./manifests.ts";
import { createGtmServer, DEFAULT_HOST, DEFAULT_PORT } from "./server.ts";
import { buildStaticSite } from "./storefront.ts";

const HELP_TEXT = `opc-gtm-kit v0.1.0 — Zero-dependency GTM toolkit for One-Person Companies

Usage:
  opc-gtm <command> [options]

Commands:
  serve            Start local GTM HTTP server & live preview portal (default 127.0.0.1:52332)
  build-site       Generate static Portfolio Hub, Product Landing Pages, Legal HTML & Banner JS
  legal            Generate Privacy, Terms, Refund, CWS MV3 Review & macOS Notarization pack
  audit-licenses   Audit repository & dependency SPDX licenses for AGPL/copyleft contamination
  repurpose        Generate 5-channel UTM launch drafts + human-gated COSE publish bundle
  acquire          Record an idempotent UTM acquisition event in SQLite (+ optional opc-os sync)
  waitlist         Join or list privacy-safe waitlist subscribers & D0/D3 drip drafts
  summary          Display GTM acquisition, channel attribution, waitlist & drip funnel summary
  sync             Sync acquisitions to opc-os and/or 17-column traces to data_analysis

Examples:
  node src/cli.ts serve --port 52332
  node src/cli.ts build-site --out ./dist-site
  node src/cli.ts legal --slug pagelens-interpret --out ./dist-site/legal
  node src/cli.ts audit-licenses
  node src/cli.ts repurpose --slug pagelens-interpret --campaign launch_q4
  node src/cli.ts acquire --product PageLens --customer cust_01 --channel x --campaign launch_q4
  node src/cli.ts waitlist --email maker@example.com --product PageLens --channel hackernews
  node src/cli.ts summary
  node src/cli.ts sync --target all
`;

export async function runCli(
  argv: string[],
  io: { stdout: (msg: string) => void; stderr: (msg: string) => void } = {
    stdout: (msg) => console.log(msg),
    stderr: (msg) => console.error(msg),
  },
): Promise<number> {
  const command = argv[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    io.stdout(HELP_TEXT);
    return 0;
  }

  const restArgs = argv.slice(1);

  try {
    if (command === "serve") {
      const { values } = parseArgs({
        args: restArgs,
        options: {
          port: { type: "string", short: "p" },
          host: { type: "string" },
          db: { type: "string" },
        },
        strict: false,
      });

      const port = values.port ? Number(values.port) : Number(process.env.PORT || DEFAULT_PORT);
      const host = typeof values.host === "string" ? values.host : DEFAULT_HOST;
      const dbPath = typeof values.db === "string" ? values.db : undefined;

      const handle = createGtmServer({ port, host, dbPath });
      const info = await handle.start();
      io.stdout(
        `[opc-gtm-kit] Listening on ${info.baseUrl} (preview: ${info.baseUrl}/preview)`,
      );

      const shutdown = async () => {
        await handle.stop();
        process.exit(0);
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
      return 0;
    }

    if (command === "build-site") {
      const { values } = parseArgs({
        args: restArgs,
        options: {
          out: { type: "string", short: "o" },
          "checkout-url": { type: "string" },
          "api-url": { type: "string" },
          "base-url": { type: "string" },
          entity: { type: "string" },
          email: { type: "string" },
        },
        strict: false,
      });

      const outDir = typeof values.out === "string" ? values.out : "./dist-site";
      const result = buildStaticSite({
        outDir,
        checkoutBaseUrl:
          typeof values["checkout-url"] === "string"
            ? values["checkout-url"]
            : undefined,
        apiBaseUrl:
          typeof values["api-url"] === "string" ? values["api-url"] : undefined,
        baseUrl:
          typeof values["base-url"] === "string" ? values["base-url"] : undefined,
        entityName:
          typeof values.entity === "string" ? values.entity : undefined,
        contactEmail:
          typeof values.email === "string" ? values.email : undefined,
      });

      io.stdout(JSON.stringify({ ok: true, ...result }, null, 2));
      return 0;
    }

    if (command === "legal") {
      const { values } = parseArgs({
        args: restArgs,
        options: {
          slug: { type: "string", short: "s" },
          out: { type: "string", short: "o" },
          entity: { type: "string" },
          email: { type: "string" },
          jurisdiction: { type: "string" },
        },
        strict: false,
      });

      const slug = typeof values.slug === "string" ? values.slug : "pagelens-interpret";
      const manifest = findManifestByProductOrSlug(slug);
      if (!manifest) {
        io.stderr(`Unknown product or manifest slug: ${slug}`);
        return 1;
      }

      const pack = generateCompliancePack(manifest, {
        entityName: typeof values.entity === "string" ? values.entity : undefined,
        contactEmail: typeof values.email === "string" ? values.email : undefined,
        jurisdiction:
          typeof values.jurisdiction === "string" ? values.jurisdiction : undefined,
      });

      if (typeof values.out === "string" && values.out.trim()) {
        const targetDir = resolve(values.out.trim());
        mkdirSync(targetDir, { recursive: true });
        writeFileSync(join(targetDir, "PRIVACY_POLICY.md"), pack.privacyPolicyMd, "utf8");
        writeFileSync(join(targetDir, "TERMS_OF_SERVICE.md"), pack.termsOfServiceMd, "utf8");
        writeFileSync(join(targetDir, "REFUND_POLICY.md"), pack.refundPolicyMd, "utf8");
        writeFileSync(join(targetDir, "CWS_MV3_REVIEW.md"), pack.chromeWebStoreReviewMd, "utf8");
        writeFileSync(
          join(targetDir, "MACOS_NOTARIZATION_CHECKLIST.md"),
          pack.macosNotarizationChecklistMd,
          "utf8",
        );
        io.stdout(
          JSON.stringify(
            {
              ok: true,
              slug: manifest.slug,
              outDir: targetDir,
              files: [
                "PRIVACY_POLICY.md",
                "TERMS_OF_SERVICE.md",
                "REFUND_POLICY.md",
                "CWS_MV3_REVIEW.md",
                "MACOS_NOTARIZATION_CHECKLIST.md",
              ],
            },
            null,
            2,
          ),
        );
      } else {
        io.stdout(JSON.stringify({ ok: true, slug: manifest.slug, pack }, null, 2));
      }
      return 0;
    }

    if (command === "audit-licenses") {
      const { values } = parseArgs({
        args: restArgs,
        options: {
          file: { type: "string", short: "f" },
          json: { type: "boolean" },
        },
        strict: false,
      });

      let repos: RepoLicenseInput[];
      if (typeof values.file === "string" && values.file.trim()) {
        const raw = JSON.parse(readFileSync(resolve(values.file.trim()), "utf8")) as unknown;
        if (!Array.isArray(raw)) {
          throw new Error("--file must point to a JSON array of repo license entries");
        }
        repos = raw as RepoLicenseInput[];
      } else {
        repos = getDefaultRepoLicenseMatrix();
      }

      const report = auditLicenseMatrix(repos);
      if (values.json) {
        io.stdout(JSON.stringify(report, null, 2));
      } else {
        io.stdout(report.summaryMarkdown);
      }
      return report.ok ? 0 : 2;
    }

    if (command === "repurpose") {
      const { values } = parseArgs({
        args: restArgs,
        options: {
          slug: { type: "string", short: "s" },
          campaign: { type: "string", short: "c" },
          "base-url": { type: "string" },
          out: { type: "string", short: "o" },
          db: { type: "string" },
        },
        strict: false,
      });

      const slug = typeof values.slug === "string" ? values.slug : "pagelens-interpret";
      const manifest = findManifestByProductOrSlug(slug);
      if (!manifest) {
        io.stderr(`Unknown product or manifest slug: ${slug}`);
        return 1;
      }

      const campaign =
        typeof values.campaign === "string"
          ? values.campaign
          : `launch_${manifest.slug.replace(/-/g, "_")}`;
      const baseUrl =
        typeof values["base-url"] === "string"
          ? values["base-url"]
          : manifest.links.homeUrl;

      const store = createGtmStore({
        dbPath: typeof values.db === "string" ? values.db : undefined,
      });
      try {
        const input = {
          product: manifest.product,
          slug: manifest.slug,
          title: `${manifest.displayName} — ${manifest.tagline}`,
          summary: manifest.outcome,
          highlights: manifest.highlights,
          baseUrl,
          campaign,
        };
        const result = repurposeContent(input);
        const saved = store.saveCampaign(input, result);

        if (typeof values.out === "string" && values.out.trim()) {
          const bundlePath = resolve(values.out.trim());
          mkdirSync(resolve(bundlePath, ".."), { recursive: true });
          writeFileSync(bundlePath, result.cosePublishBundle.markdown, "utf8");
        }

        io.stdout(
          JSON.stringify(
            {
              ok: true,
              campaignId: saved.campaignId,
              channels: result.channels,
              cosePublishBundle: result.cosePublishBundle,
            },
            null,
            2,
          ),
        );
      } finally {
        store.close();
      }
      return 0;
    }

    if (command === "acquire") {
      const { values } = parseArgs({
        args: restArgs,
        options: {
          product: { type: "string" },
          customer: { type: "string" },
          channel: { type: "string" },
          campaign: { type: "string" },
          "event-id": { type: "string" },
          path: { type: "string" },
          ref: { type: "string" },
          db: { type: "string" },
        },
        strict: false,
      });

      const product = typeof values.product === "string" ? values.product : "";
      const customerId = typeof values.customer === "string" ? values.customer : "";
      if (!product || !customerId) {
        io.stderr("Usage: opc-gtm acquire --product <name> --customer <id> [--channel x]");
        return 1;
      }

      const store = createGtmStore({
        dbPath: typeof values.db === "string" ? values.db : undefined,
      });
      try {
        const res = await store.recordAcquisition({
          eventId:
            typeof values["event-id"] === "string" ? values["event-id"] : undefined,
          product,
          customerId,
          channel: typeof values.channel === "string" ? values.channel : "direct",
          campaign:
            typeof values.campaign === "string" ? values.campaign : undefined,
          landingPath: typeof values.path === "string" ? values.path : undefined,
          reference: typeof values.ref === "string" ? values.ref : undefined,
        });
        io.stdout(JSON.stringify({ ok: true, ...res }, null, 2));
      } finally {
        store.close();
      }
      return 0;
    }

    if (command === "waitlist") {
      const { values } = parseArgs({
        args: restArgs,
        options: {
          email: { type: "string" },
          product: { type: "string" },
          channel: { type: "string" },
          campaign: { type: "string" },
          note: { type: "string" },
          list: { type: "boolean" },
          db: { type: "string" },
        },
        strict: false,
      });

      const store = createGtmStore({
        dbPath: typeof values.db === "string" ? values.db : undefined,
      });
      try {
        const product =
          typeof values.product === "string" ? values.product : undefined;
        if (values.list || !values.email) {
          const subscribers = store.listWaitlist(product);
          const drips = store.listDripOutbox(product);
          io.stdout(
            JSON.stringify(
              { ok: true, count: subscribers.length, subscribers, drips },
              null,
              2,
            ),
          );
          return 0;
        }

        if (!product) {
          io.stderr("Usage: opc-gtm waitlist --email <addr> --product <name>");
          return 1;
        }

        const joined = await store.joinWaitlist({
          email: String(values.email),
          product,
          channel: typeof values.channel === "string" ? values.channel : undefined,
          campaign:
            typeof values.campaign === "string" ? values.campaign : undefined,
          note: typeof values.note === "string" ? values.note : undefined,
        });
        io.stdout(JSON.stringify({ ok: true, ...joined }, null, 2));
      } finally {
        store.close();
      }
      return 0;
    }

    if (command === "summary") {
      const { values } = parseArgs({
        args: restArgs,
        options: {
          product: { type: "string" },
          db: { type: "string" },
        },
        strict: false,
      });

      const store = createGtmStore({
        dbPath: typeof values.db === "string" ? values.db : undefined,
      });
      try {
        const product =
          typeof values.product === "string" ? values.product : undefined;
        io.stdout(
          JSON.stringify(
            { ok: true, product: product ?? null, summary: store.summary(product) },
            null,
            2,
          ),
        );
      } finally {
        store.close();
      }
      return 0;
    }

    if (command === "sync") {
      const { values } = parseArgs({
        args: restArgs,
        options: {
          target: { type: "string" },
          product: { type: "string" },
          "opc-os-url": { type: "string" },
          "opc-os-token": { type: "string" },
          "data-analysis-url": { type: "string" },
          "data-analysis-token": { type: "string" },
          db: { type: "string" },
        },
        strict: false,
      });

      const target = typeof values.target === "string" ? values.target : "all";
      const product =
        typeof values.product === "string" ? values.product : undefined;

      const store = createGtmStore({
        dbPath: typeof values.db === "string" ? values.db : undefined,
      });

      try {
        const out: Record<string, unknown> = { ok: true, target };

        if (target === "opc-os" || target === "all") {
          const opcOsUrl =
            (typeof values["opc-os-url"] === "string" && values["opc-os-url"]) ||
            process.env.OPC_OS_URL ||
            "";
          const opcOsToken =
            (typeof values["opc-os-token"] === "string"
              ? values["opc-os-token"]
              : undefined) ??
            process.env.OPC_OS_TOKEN ??
            "";
          if (opcOsUrl) {
            out.opcOs = await syncPendingAcquisitionsToOpcOs(
              store,
              { opcOsUrl, opcOsToken },
              product,
            );
          } else {
            out.opcOs = { skipped: true, reason: "OPC_OS_URL not configured" };
          }
        }

        if (target === "data-analysis" || target === "all") {
          const dataAnalysisUrl =
            (typeof values["data-analysis-url"] === "string" &&
              values["data-analysis-url"]) ||
            process.env.DATA_ANALYSIS_URL ||
            "";
          const dataAnalysisToken =
            (typeof values["data-analysis-token"] === "string"
              ? values["data-analysis-token"]
              : undefined) ??
            process.env.DATA_ANALYSIS_TOKEN ??
            "";
          if (dataAnalysisUrl) {
            out.dataAnalysis = await syncTracesToDataAnalysis({
              dataAnalysisUrl,
              dataAnalysisToken,
              product,
              store,
            });
          } else {
            out.dataAnalysis = {
              skipped: true,
              reason: "DATA_ANALYSIS_URL not configured",
            };
          }
        }

        io.stdout(JSON.stringify(out, null, 2));
      } finally {
        store.close();
      }
      return 0;
    }

    io.stderr(`Unknown command "${command}". Run "opc-gtm --help" for usage.`);
    return 1;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.stderr(`Error: ${message}`);
    return 1;
  }
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  runCli(process.argv.slice(2)).then((code) => {
    if (code !== 0) {
      process.exitCode = code;
    }
  });
}
