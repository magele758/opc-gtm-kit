import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  exportTraces,
  syncPendingAcquisitionsToOpcOs,
  syncTracesToDataAnalysis,
  TRACE_COLUMNS,
  type OpcOsSyncConfig,
} from "./bridge.ts";
import {
  createGtmStore,
  repurposeContent,
  type GtmStore,
  type RepurposeInput,
} from "./growth.ts";
import { auditLicenseMatrix, generateCompliancePack } from "./legal.ts";
import {
  findManifestByProductOrSlug,
  getDefaultRepoLicenseMatrix,
  getLeadMagnet,
  getProductManifest,
  loadLeadMagnets,
  loadProductManifests,
  validateManifest,
  type RepoLicenseInput,
} from "./manifests.ts";
import {
  buildStaticSite,
  renderLeadMagnetBannerJs,
  renderMarkdownPageHtml,
  renderPortfolioHub,
  renderProductLandingPage,
} from "./storefront.ts";

export const SERVICE_NAME = "opc-gtm-kit" as const;
export const SERVICE_VERSION = "0.1.0" as const;
export const DEFAULT_PORT = 52332 as const;
export const DEFAULT_HOST = "127.0.0.1" as const;

export interface GtmServerOptions {
  port?: number;
  host?: string;
  dbPath?: string;
  store?: GtmStore;
  manifestsDir?: string;
  opcOsUrl?: string;
  opcOsToken?: string;
  dataAnalysisUrl?: string;
  dataAnalysisToken?: string;
  checkoutBaseUrl?: string;
  brandName?: string;
  contactEmail?: string;
  privacyMaskEmail?: boolean;
}

export interface GtmServerHandle {
  server: Server;
  store: GtmStore;
  host: string;
  port: number;
  start: (portOverride?: number, hostOverride?: string) => Promise<{
    host: string;
    port: number;
    baseUrl: string;
  }>;
  stop: () => Promise<void>;
  listen: Server["listen"];
  close: Server["close"];
  address: Server["address"];
}

const MAX_BODY_BYTES = 1_048_576; // 1 MiB

function isAllowedLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

function applyHeaders(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  const origin = req.headers.origin;
  if (isAllowedLocalOrigin(origin) && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  const payload = JSON.stringify(data);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(payload);
}

function sendHtml(res: ServerResponse, statusCode: number, html: string): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
}

function sendJs(res: ServerResponse, statusCode: number, js: string): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.end(js);
}

async function readRequestBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error("Payload too large");
    }
    chunks.push(buf);
  }

  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};

  const contentType = (req.headers["content-type"] || "").toLowerCase();
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(raw);
    const out: Record<string, unknown> = {};
    for (const [k, v] of params.entries()) {
      out[k] = v;
    }
    return out;
  }

  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected JSON object body");
  }
  return parsed as Record<string, unknown>;
}

function isForbiddenSystemPath(outDir: string): boolean {
  const normalized = outDir.trim();
  if (normalized.includes("\0")) return true;
  const blockedPrefixes = ["/etc", "/bin", "/sbin", "/usr", "/System", "/Library"];
  return blockedPrefixes.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

export function createGtmServer(options?: GtmServerOptions): GtmServerHandle {
  const configuredPort =
    options?.port !== undefined
      ? options.port
      : Number(process.env.PORT || DEFAULT_PORT);
  const configuredHost = options?.host || process.env.HOST || DEFAULT_HOST;
  const manifestsDir = options?.manifestsDir;

  const resolveOpcOs = (bodyOverride?: {
    opcOsUrl?: string;
    opcOsToken?: string;
  }): OpcOsSyncConfig | undefined => {
    const url =
      bodyOverride?.opcOsUrl ||
      options?.opcOsUrl ||
      process.env.OPC_OS_URL ||
      "";
    if (!url.trim()) return undefined;
    const token =
      bodyOverride?.opcOsToken ??
      options?.opcOsToken ??
      process.env.OPC_OS_TOKEN ??
      "";
    return {
      opcOsUrl: url.trim(),
      opcOsToken: token,
    };
  };

  const ownsStore = !options?.store;
  const store =
    options?.store ??
    createGtmStore({
      dbPath: options?.dbPath,
      privacyMaskEmail: options?.privacyMaskEmail,
      opcOsConfig: resolveOpcOs(),
      manifestsDir,
    });

  const server = createServer(async (req, res) => {
    applyHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    const method = req.method || "GET";
    const parsedUrl = new URL(
      req.url || "/",
      `http://${req.headers.host || `${configuredHost}:${configuredPort}`}`,
    );
    const pathname = parsedUrl.pathname.replace(/\/+$/, "") || "/";

    try {
      // 1. Health check
      if (method === "GET" && pathname === "/api/health") {
        sendJson(res, 200, {
          ok: true,
          service: SERVICE_NAME,
          version: SERVICE_VERSION,
          stats: store.summary(),
        });
        return;
      }

      // 2. Summary
      if (method === "GET" && pathname === "/api/v1/summary") {
        const product = parsedUrl.searchParams.get("product") || undefined;
        sendJson(res, 200, {
          ok: true,
          product: product ?? null,
          summary: store.summary(product),
        });
        return;
      }

      // 3. Manifests
      if (method === "GET" && pathname === "/api/v1/manifests") {
        const manifests = loadProductManifests(manifestsDir);
        const leadMagnets = loadLeadMagnets(manifestsDir);
        sendJson(res, 200, {
          ok: true,
          manifests,
          leadMagnets,
        });
        return;
      }

      if (method === "GET" && pathname.startsWith("/api/v1/manifests/")) {
        const slug = decodeURIComponent(pathname.slice("/api/v1/manifests/".length));
        const manifest = getProductManifest(slug, manifestsDir);
        if (!manifest) {
          sendJson(res, 404, { ok: false, error: `Unknown manifest slug "${slug}"` });
          return;
        }
        sendJson(res, 200, { ok: true, manifest });
        return;
      }

      // 4. Live Storefront Preview routes
      if (method === "GET" && (pathname === "/" || pathname === "/preview")) {
        const manifests = loadProductManifests(manifestsDir);
        const leadMagnets = loadLeadMagnets(manifestsDir);
        const html = renderPortfolioHub(manifests, leadMagnets, {
          brandName: options?.brandName,
          contactEmail: options?.contactEmail,
          linkMode: "preview",
        });
        sendHtml(res, 200, html);
        return;
      }

      if (method === "GET" && pathname.startsWith("/preview/banner/") && pathname.endsWith(".js")) {
        const lmSlug = decodeURIComponent(
          pathname.slice("/preview/banner/".length, -".js".length),
        );
        const lm = getLeadMagnet(lmSlug, manifestsDir);
        if (!lm) {
          sendJson(res, 404, { ok: false, error: `Unknown lead magnet "${lmSlug}"` });
          return;
        }
        const target =
          getProductManifest(lm.targetProductSlug, manifestsDir) ||
          loadProductManifests(manifestsDir)[0];
        const js = renderLeadMagnetBannerJs(target, lm.utmCampaign, {
          sourceSlug: lm.slug,
          hookText: lm.hookText,
        });
        sendJs(res, 200, js);
        return;
      }

      if (method === "GET" && pathname.startsWith("/preview/")) {
        const rest = pathname.slice("/preview/".length).split("/");
        const slug = decodeURIComponent(rest[0] || "");
        const subpage = rest[1] || "";

        const manifest = getProductManifest(slug, manifestsDir);
        if (!manifest) {
          sendJson(res, 404, { ok: false, error: `Unknown product slug "${slug}"` });
          return;
        }

        if (!subpage) {
          const channel =
            parsedUrl.searchParams.get("utm_source") ||
            parsedUrl.searchParams.get("channel") ||
            undefined;
          const campaign =
            parsedUrl.searchParams.get("utm_campaign") ||
            parsedUrl.searchParams.get("campaign") ||
            undefined;
          const html = renderProductLandingPage(manifest, {
            checkoutBaseUrl: options?.checkoutBaseUrl,
            apiBaseUrl: "",
            channel,
            campaign,
            brandName: options?.brandName,
            contactEmail: options?.contactEmail,
            linkMode: "preview",
          });
          sendHtml(res, 200, html);
          return;
        }

        const pack = generateCompliancePack(manifest, {
          entityName: options?.brandName,
          contactEmail: options?.contactEmail,
        });

        if (subpage === "privacy") {
          sendHtml(
            res,
            200,
            renderMarkdownPageHtml(
              `${manifest.displayName} Privacy Policy`,
              pack.privacyPolicyMd,
              { backHref: `/preview/${encodeURIComponent(slug)}`, brandName: options?.brandName },
            ),
          );
          return;
        }

        if (subpage === "terms") {
          sendHtml(
            res,
            200,
            renderMarkdownPageHtml(
              `${manifest.displayName} Terms of Service`,
              pack.termsOfServiceMd,
              { backHref: `/preview/${encodeURIComponent(slug)}`, brandName: options?.brandName },
            ),
          );
          return;
        }

        if (subpage === "refund") {
          sendHtml(
            res,
            200,
            renderMarkdownPageHtml(
              `${manifest.displayName} Refund Policy`,
              pack.refundPolicyMd,
              { backHref: `/preview/${encodeURIComponent(slug)}`, brandName: options?.brandName },
            ),
          );
          return;
        }

        sendJson(res, 404, { ok: false, error: `Unknown preview subpage "${subpage}"` });
        return;
      }

      // 5. Storefront static site builder
      if (method === "POST" && pathname === "/api/v1/storefront/build") {
        const body = await readRequestBody(req);
        const manifests = loadProductManifests(manifestsDir);
        const leadMagnets = loadLeadMagnets(manifestsDir);
        const outDir = typeof body.outDir === "string" ? body.outDir.trim() : "";

        if (!outDir || body.dryRun === true) {
          const plannedFiles = [
            "index.html",
            ...manifests.flatMap((m) => [
              `${m.slug}/index.html`,
              `${m.slug}/privacy.html`,
              `${m.slug}/terms.html`,
              `${m.slug}/refund.html`,
            ]),
            ...leadMagnets.map((lm) => `banners/${lm.slug}.js`),
          ];
          sendJson(res, 200, {
            ok: true,
            dryRun: true,
            files: plannedFiles,
            totalFiles: plannedFiles.length,
          });
          return;
        }

        if (isForbiddenSystemPath(outDir)) {
          sendJson(res, 400, { ok: false, error: "Forbidden output directory path" });
          return;
        }

        const result = buildStaticSite({
          outDir,
          manifests,
          leadMagnets,
          checkoutBaseUrl:
            typeof body.checkoutBaseUrl === "string"
              ? body.checkoutBaseUrl
              : options?.checkoutBaseUrl,
          apiBaseUrl: typeof body.apiBaseUrl === "string" ? body.apiBaseUrl : undefined,
          entityName:
            typeof body.entityName === "string" ? body.entityName : options?.brandName,
          contactEmail:
            typeof body.contactEmail === "string"
              ? body.contactEmail
              : options?.contactEmail,
        });

        sendJson(res, 200, {
          ok: true,
          dryRun: false,
          ...result,
        });
        return;
      }

      // 6. Legal & Compliance pack + License audit
      if (method === "POST" && pathname === "/api/v1/legal/generate") {
        const body = await readRequestBody(req);
        let manifest = undefined;
        if (typeof body.slug === "string" && body.slug.trim()) {
          manifest = findManifestByProductOrSlug(body.slug, manifestsDir);
        } else if (body.manifest) {
          manifest = validateManifest(body.manifest);
        }

        if (!manifest) {
          sendJson(res, 400, {
            ok: false,
            error: "Provide a valid built-in `slug` or custom `manifest` object",
          });
          return;
        }

        const pack = generateCompliancePack(manifest, {
          entityName:
            typeof body.entityName === "string" ? body.entityName : options?.brandName,
          contactEmail:
            typeof body.contactEmail === "string"
              ? body.contactEmail
              : options?.contactEmail,
          jurisdiction:
            typeof body.jurisdiction === "string" ? body.jurisdiction : undefined,
        });

        sendJson(res, 200, {
          ok: true,
          slug: manifest.slug,
          product: manifest.product,
          pack,
        });
        return;
      }

      if (method === "POST" && pathname === "/api/v1/legal/audit-licenses") {
        const body = await readRequestBody(req);
        const repos = Array.isArray(body.repos)
          ? (body.repos as RepoLicenseInput[])
          : getDefaultRepoLicenseMatrix(manifestsDir);
        const report = auditLicenseMatrix(repos);
        sendJson(res, 200, {
          ok: true,
          report,
        });
        return;
      }

      // 7. Content repurposing + Campaign list
      if (method === "POST" && pathname === "/api/v1/repurpose") {
        const body = await readRequestBody(req);
        const slugOrProduct =
          typeof body.slug === "string"
            ? body.slug
            : typeof body.product === "string"
              ? body.product
              : "";
        const matched = slugOrProduct
          ? findManifestByProductOrSlug(slugOrProduct, manifestsDir)
          : undefined;

        const product =
          typeof body.product === "string" && body.product.trim()
            ? body.product.trim()
            : matched?.product || "";
        const slug =
          typeof body.slug === "string" && body.slug.trim()
            ? body.slug.trim()
            : matched?.slug || product.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const title =
          typeof body.title === "string" && body.title.trim()
            ? body.title.trim()
            : matched
              ? `${matched.displayName} — ${matched.tagline}`
              : "";
        const summary =
          typeof body.summary === "string" && body.summary.trim()
            ? body.summary.trim()
            : matched?.outcome || matched?.tagline || "";
        const highlights = Array.isArray(body.highlights)
          ? body.highlights.filter((h): h is string => typeof h === "string")
          : matched?.highlights || [];
        const baseUrl =
          typeof body.baseUrl === "string" && body.baseUrl.trim()
            ? body.baseUrl.trim()
            : matched?.links.homeUrl || `https://opc.example.com/${slug}`;
        const campaign =
          typeof body.campaign === "string" && body.campaign.trim()
            ? body.campaign.trim()
            : `launch_${slug.replace(/-/g, "_")}`;

        if (!product || !title || !summary) {
          sendJson(res, 400, {
            ok: false,
            error: "Provide a known `slug` or explicit `product`, `title`, and `summary`",
          });
          return;
        }

        const input: RepurposeInput = {
          product,
          slug,
          title,
          summary,
          highlights,
          baseUrl,
          campaign,
        };
        const repurposed = repurposeContent(input);
        const campaignRecord = store.saveCampaign(input, repurposed);

        sendJson(res, 200, {
          ok: true,
          campaignRecord,
          channels: repurposed.channels,
          cosePublishBundle: repurposed.cosePublishBundle,
        });
        return;
      }

      if (method === "GET" && pathname === "/api/v1/campaigns") {
        const product = parsedUrl.searchParams.get("product") || undefined;
        sendJson(res, 200, {
          ok: true,
          campaigns: store.listCampaigns(product),
        });
        return;
      }

      // 8. UTM Acquisition endpoint (+ auto-sync to OPC_OS_URL)
      if (method === "POST" && pathname === "/api/v1/utm/acquire") {
        const body = await readRequestBody(req);
        const product = typeof body.product === "string" ? body.product.trim() : "";
        const customerId =
          typeof body.customerId === "string" ? body.customerId.trim() : "";
        const channel =
          typeof body.channel === "string"
            ? body.channel
            : typeof body.utm_source === "string"
              ? body.utm_source
              : "direct";

        if (!product || !customerId) {
          sendJson(res, 400, {
            ok: false,
            error: "`product` and `customerId` are required",
          });
          return;
        }

        const result = await store.recordAcquisition(
          {
            eventId: typeof body.eventId === "string" ? body.eventId : undefined,
            product,
            customerId,
            channel,
            campaign:
              typeof body.campaign === "string"
                ? body.campaign
                : typeof body.utm_campaign === "string"
                  ? body.utm_campaign
                  : undefined,
            landingPath:
              typeof body.landingPath === "string" ? body.landingPath : undefined,
            at: typeof body.at === "string" ? body.at : undefined,
            reference:
              typeof body.reference === "string" ? body.reference : undefined,
          },
          {
            autoSyncOpcOs: true,
            opcOsConfig: resolveOpcOs(),
          },
        );

        sendJson(res, 200, {
          ok: true,
          ...result,
        });
        return;
      }

      // 9. Waitlist Join & List
      if (method === "POST" && pathname === "/api/v1/waitlist/join") {
        const body = await readRequestBody(req);
        const email = typeof body.email === "string" ? body.email.trim() : "";
        const product = typeof body.product === "string" ? body.product.trim() : "";

        if (!email || !product) {
          sendJson(res, 400, {
            ok: false,
            error: "`email` and `product` are required",
          });
          return;
        }

        const result = await store.joinWaitlist(
          {
            email,
            product,
            customerId:
              typeof body.customerId === "string" ? body.customerId : undefined,
            channel: typeof body.channel === "string" ? body.channel : undefined,
            campaign: typeof body.campaign === "string" ? body.campaign : undefined,
            note: typeof body.note === "string" ? body.note : undefined,
            at: typeof body.at === "string" ? body.at : undefined,
          },
          {
            autoSyncOpcOs: true,
            opcOsConfig: resolveOpcOs(),
          },
        );

        sendJson(res, 200, {
          ok: true,
          ...result,
        });
        return;
      }

      if (method === "GET" && pathname === "/api/v1/waitlist") {
        const product = parsedUrl.searchParams.get("product") || undefined;
        const subscribers = store.listWaitlist(product);
        const drips = store.listDripOutbox(product);
        sendJson(res, 200, {
          ok: true,
          count: subscribers.length,
          subscribers,
          drips,
        });
        return;
      }

      // 10. Export canonical 17-column traces
      if (method === "GET" && pathname === "/api/v1/export/traces") {
        const product = parsedUrl.searchParams.get("product") || undefined;
        const traces = exportTraces(product, { store });
        sendJson(res, 200, {
          ok: true,
          columns: [...TRACE_COLUMNS],
          count: traces.length,
          traces,
        });
        return;
      }

      // 11. Explicit sync endpoints for opc-os & data_analysis
      if (method === "POST" && pathname === "/api/v1/sync/opc-os") {
        const body = await readRequestBody(req);
        const syncCfg = resolveOpcOs({
          opcOsUrl: typeof body.opcOsUrl === "string" ? body.opcOsUrl : undefined,
          opcOsToken:
            typeof body.opcOsToken === "string" ? body.opcOsToken : undefined,
        });

        if (!syncCfg) {
          sendJson(res, 400, {
            ok: false,
            error: "Configure `OPC_OS_URL` or pass `opcOsUrl` in request body",
          });
          return;
        }

        const product =
          typeof body.product === "string" && body.product.trim()
            ? body.product.trim()
            : undefined;
        const batchResult = await syncPendingAcquisitionsToOpcOs(
          store,
          syncCfg,
          product,
        );
        sendJson(res, 200, {
          ...batchResult,
        });
        return;
      }

      if (method === "POST" && pathname === "/api/v1/sync/data-analysis") {
        const body = await readRequestBody(req);
        const dataAnalysisUrl =
          (typeof body.dataAnalysisUrl === "string" && body.dataAnalysisUrl.trim()) ||
          options?.dataAnalysisUrl ||
          process.env.DATA_ANALYSIS_URL ||
          "";
        const dataAnalysisToken =
          (typeof body.dataAnalysisToken === "string"
            ? body.dataAnalysisToken
            : undefined) ??
          options?.dataAnalysisToken ??
          process.env.DATA_ANALYSIS_TOKEN ??
          "";

        if (!dataAnalysisUrl) {
          sendJson(res, 400, {
            ok: false,
            error:
              "Configure `DATA_ANALYSIS_URL` or pass `dataAnalysisUrl` in request body",
          });
          return;
        }

        const product =
          typeof body.product === "string" && body.product.trim()
            ? body.product.trim()
            : undefined;

        const syncResult = await syncTracesToDataAnalysis({
          dataAnalysisUrl,
          dataAnalysisToken,
          product,
          store,
        });

        sendJson(res, 200, {
          ...syncResult,
        });
        return;
      }

      sendJson(res, 404, {
        ok: false,
        error: `Not found: ${method} ${pathname}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isClientErr =
        message.includes("Invalid") ||
        message.includes("Expected JSON") ||
        message.includes("Unexpected token") ||
        message.includes("required") ||
        message.includes("Payload too large");
      sendJson(res, isClientErr ? 400 : 500, {
        ok: false,
        error: message,
      });
    }
  });

  let activePort = configuredPort;
  let activeHost = configuredHost;

  return {
    server,
    store,
    get host() {
      return activeHost;
    },
    get port() {
      return activePort;
    },
    start(portOverride?: number, hostOverride?: string) {
      const targetPort = portOverride !== undefined ? portOverride : configuredPort;
      const targetHost = hostOverride || configuredHost;
      return new Promise((resolvePromise, rejectPromise) => {
        const onError = (err: Error) => {
          server.removeListener("error", onError);
          rejectPromise(err);
        };
        server.once("error", onError);
        server.listen(targetPort, targetHost, () => {
          server.removeListener("error", onError);
          const addr = server.address() as AddressInfo | null;
          activePort = addr ? addr.port : targetPort;
          activeHost = targetHost;
          resolvePromise({
            host: activeHost,
            port: activePort,
            baseUrl: `http://${activeHost}:${activePort}`,
          });
        });
      });
    },
    stop() {
      return new Promise((resolvePromise, rejectPromise) => {
        server.close((err) => {
          if (ownsStore) {
            try {
              store.close();
            } catch {
              // already closed
            }
          }
          if (err) rejectPromise(err);
          else resolvePromise();
        });
      });
    },
    listen: server.listen.bind(server),
    close: server.close.bind(server),
    address: server.address.bind(server),
  };
}
