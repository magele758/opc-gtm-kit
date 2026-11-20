import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildUtmUrl } from "./growth.ts";
import { generateCompliancePack } from "./legal.ts";
import {
  loadLeadMagnets,
  loadProductManifests,
  type DistributionType,
  type LeadMagnetConfig,
  type LicenseModel,
  type ProductManifest,
} from "./manifests.ts";

export interface LandingPageOptions {
  checkoutBaseUrl?: string;
  apiBaseUrl?: string;
  channel?: string;
  campaign?: string;
  brandName?: string;
  contactEmail?: string;
  linkMode?: "preview" | "static";
}

export interface PortfolioHubOptions {
  brandName?: string;
  baseUrl?: string;
  contactEmail?: string;
  linkMode?: "preview" | "static";
}

export interface LeadMagnetBannerOptions {
  targetUrl?: string;
  sourceSlug?: string;
  hookText?: string;
  ctaLabel?: string;
  position?: "bottom" | "top";
}

export interface StaticSiteBuildOptions {
  outDir: string;
  manifests?: ProductManifest[];
  leadMagnets?: LeadMagnetConfig[];
  checkoutBaseUrl?: string;
  apiBaseUrl?: string;
  baseUrl?: string;
  entityName?: string;
  contactEmail?: string;
}

export interface StaticSiteBuildResult {
  outDir: string;
  files: string[];
  totalFiles: number;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "#";
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    trimmed.startsWith("#")
  ) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:" ||
      parsed.protocol === "mailto:"
    ) {
      return parsed.toString();
    }
    return "#";
  } catch {
    return "#";
  }
}

export function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function formatDistributionBadge(dist: DistributionType): string {
  switch (dist) {
    case "chrome_extension":
      return "Chrome Extension (MV3)";
    case "macos_and_web":
      return "macOS Native + Web";
    case "self_hosted_pro":
      return "Self-Hosted + Mobile Pro";
    case "web_saas":
      return "Web App";
    case "cli_and_sdk":
      return "CLI & SDK";
  }
}

function formatLicenseBadge(model: LicenseModel): string {
  switch (model) {
    case "freemium_offline_key":
      return "Freemium · Ed25519 Offline Key";
    case "open_core_byok":
      return "Open-Core · 100% BYOK";
    case "open_core":
      return "Open-Core · Self-Hostable";
    case "commercial_subscription":
      return "Commercial Pro";
    case "mit_free":
      return "MIT Free Tool";
  }
}

function decorateWithUtmIfPresent(
  rawHref: string,
  channel?: string,
  campaign?: string,
  content?: string,
): string {
  const safeHref = sanitizeUrl(rawHref);
  if (safeHref === "#" || !channel || !channel.trim()) {
    return safeHref;
  }
  if (safeHref.startsWith("http://") || safeHref.startsWith("https://")) {
    return buildUtmUrl(safeHref, {
      source: channel,
      medium: "landing_cta",
      campaign: campaign || "direct_landing",
      content,
    });
  }
  const sep = safeHref.includes("?") ? "&" : "?";
  const params = new URLSearchParams();
  params.set("utm_source", channel.trim().toLowerCase());
  params.set("utm_medium", "landing_cta");
  if (campaign && campaign.trim()) params.set("utm_campaign", campaign.trim());
  if (content && content.trim()) params.set("utm_content", content.trim());
  return `${safeHref}${sep}${params.toString()}`;
}

const SHARED_STYLES = `
  :root {
    --bg: #0b1020;
    --bg-card: #121a30;
    --bg-elevated: #182341;
    --text: #f1f5f9;
    --text-muted: #94a3b8;
    --accent: #6366f1;
    --accent-hover: #818cf8;
    --accent-emerald: #10b981;
    --border: rgba(148, 163, 184, 0.18);
    --radius: 14px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", sans-serif;
    background: radial-gradient(circle at 20% 0%, #172042 0%, var(--bg) 55%);
    color: var(--text);
    line-height: 1.65;
    -webkit-font-smoothing: antialiased;
  }
  a { color: #a5b4fc; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .container { max-width: 1100px; margin: 0 auto; padding: 0 24px; }
  .topbar {
    border-bottom: 1px solid var(--border);
    backdrop-filter: blur(10px);
    position: sticky;
    top: 0;
    z-index: 20;
    background: rgba(11, 16, 32, 0.85);
  }
  .topbar-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 64px;
    gap: 16px;
  }
  .brand { font-weight: 700; font-size: 1.05rem; color: var(--text); letter-spacing: -0.01em; }
  .nav-links { display: flex; gap: 18px; font-size: 0.92rem; }
  .pill-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
  .pill {
    display: inline-flex;
    align-items: center;
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 600;
    background: rgba(99, 102, 241, 0.16);
    color: #c7d2fe;
    border: 1px solid rgba(99, 102, 241, 0.35);
  }
  .pill-emerald {
    background: rgba(16, 185, 129, 0.15);
    color: #6ee7b7;
    border-color: rgba(16, 185, 129, 0.35);
  }
  .hero { padding: 72px 0 56px; }
  .pain-box {
    background: rgba(244, 63, 94, 0.09);
    border-left: 3px solid #fb7185;
    padding: 10px 16px;
    border-radius: 0 8px 8px 0;
    color: #fda4af;
    font-size: 0.95rem;
    margin-bottom: 20px;
    max-width: 820px;
  }
  h1 {
    font-size: clamp(2rem, 4.2vw, 3.1rem);
    line-height: 1.18;
    letter-spacing: -0.025em;
    margin-bottom: 16px;
    max-width: 880px;
  }
  .outcome {
    font-size: 1.14rem;
    color: #cbd5e1;
    max-width: 820px;
    margin-bottom: 28px;
  }
  .cta-group { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; margin-bottom: 16px; }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 13px 24px;
    border-radius: 10px;
    font-weight: 600;
    font-size: 0.98rem;
    cursor: pointer;
    border: 1px solid transparent;
    transition: transform 0.12s ease, background 0.15s ease;
    text-decoration: none !important;
  }
  .btn:hover { transform: translateY(-1px); }
  .btn-primary { background: var(--accent); color: #ffffff; }
  .btn-primary:hover { background: var(--accent-hover); }
  .btn-secondary {
    background: rgba(255, 255, 255, 0.05);
    color: var(--text);
    border-color: var(--border);
  }
  .btn-secondary:hover { background: rgba(255, 255, 255, 0.1); }
  .micro-goal { font-size: 0.86rem; color: var(--text-muted); }
  section { padding: 52px 0; border-top: 1px solid var(--border); }
  h2 { font-size: 1.75rem; margin-bottom: 10px; letter-spacing: -0.02em; }
  .section-lead { color: var(--text-muted); margin-bottom: 28px; max-width: 720px; }
  .grid-3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
  .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 22px; }
  .card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 26px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .card-highlight {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.4), 0 16px 38px rgba(15, 23, 42, 0.55);
    background: linear-gradient(180deg, #172243 0%, var(--bg-card) 100%);
  }
  .step-badge {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.78rem;
    color: #818cf8;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .price-tag { font-size: 2.1rem; font-weight: 800; letter-spacing: -0.03em; }
  .feature-list { list-style: none; display: flex; flex-direction: column; gap: 9px; margin: 10px 0 18px; flex: 1; }
  .feature-list li::before { content: "✓ "; color: var(--accent-emerald); font-weight: 700; }
  .perm-table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 0.92rem; }
  .perm-table th, .perm-table td {
    text-align: left;
    padding: 11px 14px;
    border-bottom: 1px solid var(--border);
  }
  .perm-table th { color: var(--text-muted); font-weight: 600; }
  .waitlist-box {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 32px;
    max-width: 680px;
  }
  .form-row { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; }
  .input {
    flex: 1;
    min-width: 220px;
    padding: 12px 15px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: #0b1020;
    color: var(--text);
    font-size: 0.96rem;
  }
  .status-msg { margin-top: 12px; font-size: 0.9rem; min-height: 1.4em; color: #6ee7b7; }
  footer {
    border-top: 1px solid var(--border);
    padding: 36px 0 48px;
    color: var(--text-muted);
    font-size: 0.9rem;
  }
  .footer-inner { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 18px; }
  .footer-links { display: flex; flex-wrap: wrap; gap: 18px; }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    background: rgba(255, 255, 255, 0.08);
    padding: 2px 6px;
    border-radius: 5px;
    font-size: 0.86em;
  }
`;

export function renderProductLandingPage(
  manifest: ProductManifest,
  options?: LandingPageOptions,
): string {
  const brandName = options?.brandName || process.env.OPC_BRAND_NAME || "OPC Studio";
  const contactEmail =
    options?.contactEmail || process.env.OPC_SUPPORT_EMAIL || "support@example.com";
  const checkoutBase = (
    options?.checkoutBaseUrl ||
    process.env.OPC_CHECKOUT_BASE_URL ||
    "https://checkout.opc.example.com"
  ).replace(/\/+$/, "");
  const apiBase = (options?.apiBaseUrl || "").replace(/\/+$/, "");
  const linkMode = options?.linkMode || "preview";

  const hubHref = linkMode === "static" ? "../index.html" : "/preview";
  const privacyHref =
    linkMode === "static"
      ? "./privacy.html"
      : `/preview/${encodeURIComponent(manifest.slug)}/privacy`;
  const termsHref =
    linkMode === "static"
      ? "./terms.html"
      : `/preview/${encodeURIComponent(manifest.slug)}/terms`;
  const refundHref =
    linkMode === "static"
      ? "./refund.html"
      : `/preview/${encodeURIComponent(manifest.slug)}/refund`;

  const highlightedTier =
    manifest.pricing.tiers.find((t) => t.highlighted) || manifest.pricing.tiers[0];
  const primaryRawHref =
    highlightedTier.priceUsd > 0
      ? `${checkoutBase}/${encodeURIComponent(manifest.slug)}?tier=${encodeURIComponent(highlightedTier.id)}`
      : manifest.links.homeUrl;
  const primaryHref = decorateWithUtmIfPresent(
    primaryRawHref,
    options?.channel,
    options?.campaign,
    "hero_primary",
  );

  const stepsHtml = manifest.workflowSteps
    .map(
      (s) => `
      <article class="card">
        <span class="step-badge">${escapeHtml(s.badge)}</span>
        <h3>${escapeHtml(s.title)}</h3>
        <p style="color: var(--text-muted);">${escapeHtml(s.description)}</p>
      </article>`,
    )
    .join("\n");

  const highlightsHtml = manifest.highlights
    .map((h) => `<li>${escapeHtml(h)}</li>`)
    .join("\n");

  const pricingCardsHtml = manifest.pricing.tiers
    .map((tier) => {
      const rawTierHref =
        tier.priceUsd === 0
          ? manifest.links.githubUrl || manifest.links.homeUrl
          : `${checkoutBase}/${encodeURIComponent(manifest.slug)}?tier=${encodeURIComponent(tier.id)}`;
      const tierHref = decorateWithUtmIfPresent(
        rawTierHref,
        options?.channel,
        options?.campaign,
        `pricing_${tier.id}`,
      );
      return `
      <article class="card ${tier.highlighted ? "card-highlight" : ""}">
        <div class="pill-row" style="margin-bottom: 4px;">
          <span class="pill">${escapeHtml(tier.name)}</span>
          ${
            tier.offlineKeyEd25519
              ? `<span class="pill pill-emerald">Ed25519 Offline Key</span>`
              : ""
          }
        </div>
        <div class="price-tag">${escapeHtml(tier.priceLabel)}</div>
        <ul class="feature-list">
          ${tier.features.map((f) => `<li>${escapeHtml(f)}</li>`).join("\n")}
        </ul>
        <a class="btn ${tier.highlighted ? "btn-primary" : "btn-secondary"} js-utm-link" href="${escapeHtml(tierHref)}">
          ${escapeHtml(tier.ctaLabel)}
        </a>
      </article>`;
    })
    .join("\n");

  const permissionsTableHtml =
    manifest.permissions.length > 0
      ? `
      <div style="margin-top: 22px;">
        <h3 style="font-size: 1.05rem; margin-bottom: 6px;">Transparent MV3 Permission Scope</h3>
        <table class="perm-table">
          <thead>
            <tr>
              <th>Permission</th>
              <th>Exact Local-First Justification</th>
            </tr>
          </thead>
          <tbody>
            ${manifest.permissions
              .map(
                (perm) => `
              <tr>
                <td><code>${escapeHtml(perm)}</code></td>
                <td>${escapeHtml(manifest.permissionJustifications[perm] || "Strictly scoped to explicit user invocation.")}</td>
              </tr>`,
              )
              .join("\n")}
          </tbody>
        </table>
      </div>`
      : "";

  const bootConfig = escapeJsonForScript({
    product: manifest.product,
    slug: manifest.slug,
    apiBase,
    defaultChannel: options?.channel || "",
    defaultCampaign: options?.campaign || "",
  });

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(manifest.displayName)} — ${escapeHtml(manifest.tagline)}</title>
  <meta name="description" content="${escapeHtml(manifest.outcome)}" />
  <style>${SHARED_STYLES}</style>
</head>
<body>
  <header class="topbar">
    <div class="container topbar-inner">
      <a class="brand" href="${escapeHtml(hubHref)}">${escapeHtml(brandName)} · ${escapeHtml(manifest.displayName)}</a>
      <nav class="nav-links">
        <a href="#workflow">3-Step Workflow</a>
        <a href="#pricing">Pricing</a>
        <a href="#trust">Privacy Pledge</a>
        <a href="#waitlist">Early Access</a>
      </nav>
    </div>
  </header>

  <main class="container">
    <section class="hero" style="border-top: none;">
      <div class="pill-row">
        <span class="pill">${escapeHtml(formatDistributionBadge(manifest.distribution))}</span>
        <span class="pill pill-emerald">${escapeHtml(formatLicenseBadge(manifest.licenseModel))}</span>
      </div>
      <div class="pain-box">
        <strong>Pain Point:</strong> ${escapeHtml(manifest.painPoint)}
      </div>
      <h1>${escapeHtml(manifest.displayName)} — ${escapeHtml(manifest.tagline)}</h1>
      <p class="outcome">${escapeHtml(manifest.outcome)}</p>
      <div class="cta-group">
        <a class="btn btn-primary js-utm-link" href="${escapeHtml(primaryHref)}">
          ${escapeHtml(highlightedTier.ctaLabel)}
        </a>
        <a class="btn btn-secondary js-utm-link" href="${escapeHtml(sanitizeUrl(manifest.links.githubUrl))}">
          GitHub / Docs
        </a>
        <a class="btn btn-secondary" href="#waitlist">
          Join Release Waitlist
        </a>
      </div>
      <p class="micro-goal">
        Activation Milestone: <strong>${escapeHtml(manifest.activationAction)}</strong>
      </p>
    </section>

    <section id="workflow">
      <h2>How It Works in 3 Steps</h2>
      <p class="section-lead">Zero configuration bloat — go from install to your first verified result in under two minutes.</p>
      <div class="grid-3">
        ${stepsHtml}
      </div>
      <div class="card" style="margin-top: 22px;">
        <h3>Why Makers &amp; Power Users Switch to ${escapeHtml(manifest.displayName)}</h3>
        <ul class="feature-list" style="margin-bottom: 0;">
          ${highlightsHtml}
        </ul>
      </div>
    </section>

    <section id="pricing">
      <h2>Transparent, Indie-Friendly Pricing</h2>
      <p class="section-lead">Start free immediately. Paid Pro tiers verify offline using cryptographic <strong>Ed25519</strong> public-key signatures — no forced cloud account or recurring SaaS trap.</p>
      <div class="grid-3">
        ${pricingCardsHtml}
      </div>
    </section>

    <section id="trust">
      <h2>Privacy &amp; Local-First Trust Pledge</h2>
      <div class="card">
        <h3>${escapeHtml(manifest.privacyPledge.headline)}</h3>
        <ul class="feature-list" style="margin-bottom: 0;">
          ${manifest.privacyPledge.points.map((pt) => `<li>${escapeHtml(pt)}</li>`).join("\n")}
        </ul>
        ${permissionsTableHtml}
      </div>
    </section>

    <section id="waitlist">
      <div class="waitlist-box">
        <h2>Get Release Drops &amp; Workflow Templates</h2>
        <p style="color: var(--text-muted); margin-top: 6px;">
          Join the privacy-safe waitlist (emails are SHA-256 hashed with masked storage by default) to receive the Day-0 Quick-Start &amp; Day-3 Power Tips sequence.
        </p>
        <form id="waitlist-form" action="${escapeHtml(`${apiBase}/api/v1/waitlist/join`)}" method="POST">
          <input type="hidden" name="product" value="${escapeHtml(manifest.product)}" />
          <input type="hidden" name="channel" value="${escapeHtml(options?.channel || "")}" />
          <input type="hidden" name="campaign" value="${escapeHtml(options?.campaign || "")}" />
          <div class="form-row">
            <input class="input" type="email" name="email" placeholder="you@example.com" required aria-label="Email address" />
            <input class="input" type="text" name="note" placeholder="Optional: your #1 use case" aria-label="Use case note" />
            <button class="btn btn-primary" type="submit">Join Waitlist</button>
          </div>
          <div id="waitlist-status" class="status-msg" role="status" aria-live="polite"></div>
        </form>
      </div>
    </section>
  </main>

  <footer>
    <div class="container footer-inner">
      <div>
        <strong>${escapeHtml(brandName)}</strong> · Contact: <a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a>
      </div>
      <div class="footer-links">
        <a href="${escapeHtml(privacyHref)}">Privacy Policy</a>
        <a href="${escapeHtml(termsHref)}">Terms of Service</a>
        <a href="${escapeHtml(refundHref)}">Refund Policy</a>
        <a href="${escapeHtml(sanitizeUrl(manifest.links.changelogUrl))}">Changelog</a>
      </div>
    </div>
  </footer>

  <script>
    (function() {
      var cfg = ${bootConfig};
      var search = new URLSearchParams(window.location.search);
      var src = search.get("utm_source") || search.get("ref") || cfg.defaultChannel || "";
      var camp = search.get("utm_campaign") || cfg.defaultCampaign || "";
      var med = search.get("utm_medium") || "";

      if (src || camp) {
        var links = document.querySelectorAll(".js-utm-link");
        for (var i = 0; i < links.length; i++) {
          try {
            var u = new URL(links[i].href, window.location.origin);
            if (src && !u.searchParams.get("utm_source")) u.searchParams.set("utm_source", src);
            if (med && !u.searchParams.get("utm_medium")) u.searchParams.set("utm_medium", med);
            if (camp && !u.searchParams.get("utm_campaign")) u.searchParams.set("utm_campaign", camp);
            links[i].href = u.toString();
          } catch (_) {}
        }
      }

      var form = document.getElementById("waitlist-form");
      var statusEl = document.getElementById("waitlist-status");
      if (form && statusEl) {
        form.addEventListener("submit", function(ev) {
          ev.preventDefault();
          var fd = new FormData(form);
          var payload = {
            email: String(fd.get("email") || ""),
            product: cfg.product,
            channel: src || String(fd.get("channel") || "direct"),
            campaign: camp || String(fd.get("campaign") || ""),
            note: String(fd.get("note") || "")
          };
          statusEl.textContent = "Submitting...";
          fetch((cfg.apiBase || "") + "/api/v1/waitlist/join", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          })
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data && data.ok) {
                statusEl.textContent = "You are on the list (" + data.waitlist.emailMasked + ")! D0 Welcome & D3 Tips queued.";
                form.reset();
              } else {
                statusEl.textContent = (data && data.error) ? String(data.error) : "Submission failed.";
              }
            })
            .catch(function() {
              statusEl.textContent = "Network unavailable in offline preview.";
            });
        });
      }
    })();
  </script>
</body>
</html>`;
}

export function renderPortfolioHub(
  manifests: ProductManifest[],
  leadMagnets: LeadMagnetConfig[],
  options?: PortfolioHubOptions,
): string {
  const brandName = options?.brandName || process.env.OPC_BRAND_NAME || "OPC Studio";
  const contactEmail =
    options?.contactEmail || process.env.OPC_SUPPORT_EMAIL || "support@example.com";
  const linkMode = options?.linkMode || "preview";

  const productCards = manifests
    .map((m) => {
      const pageHref =
        linkMode === "static"
          ? `./${encodeURIComponent(m.slug)}/index.html`
          : `/preview/${encodeURIComponent(m.slug)}`;
      const privacyHref =
        linkMode === "static"
          ? `./${encodeURIComponent(m.slug)}/privacy.html`
          : `/preview/${encodeURIComponent(m.slug)}/privacy`;
      const priceSummary = m.pricing.tiers.map((t) => `${t.name}: ${t.priceLabel}`).join(" · ");

      return `
      <article class="card">
        <div class="pill-row" style="margin-bottom: 4px;">
          <span class="pill">${escapeHtml(formatDistributionBadge(m.distribution))}</span>
          <span class="pill pill-emerald">${escapeHtml(formatLicenseBadge(m.licenseModel))}</span>
        </div>
        <h3>${escapeHtml(m.displayName)}</h3>
        <p style="color: #cbd5e1;">${escapeHtml(m.tagline)}</p>
        <p style="font-size: 0.88rem; color: var(--text-muted); flex: 1;">
          <strong>Pricing:</strong> ${escapeHtml(priceSummary)}<br />
          <strong>Activation:</strong> ${escapeHtml(m.activationAction)}
        </p>
        <div class="cta-group" style="margin-bottom: 0;">
          <a class="btn btn-primary" href="${escapeHtml(pageHref)}">Explore ${escapeHtml(m.displayName)}</a>
          <a class="btn btn-secondary" href="${escapeHtml(privacyHref)}">Privacy</a>
        </div>
      </article>`;
    })
    .join("\n");

  const leadMagnetCards = leadMagnets
    .map((lm) => {
      const target = manifests.find((m) => m.slug === lm.targetProductSlug);
      const targetBase =
        linkMode === "static"
          ? `https://opc.example.com/${lm.targetProductSlug}`
          : target?.links.homeUrl || `https://opc.example.com/${lm.targetProductSlug}`;
      const attributedUrl = buildUtmUrl(targetBase, {
        source: lm.slug,
        medium: "banner",
        campaign: lm.utmCampaign,
        content: lm.targetProductSlug,
      });
      const scriptSrc =
        linkMode === "static"
          ? `./banners/${encodeURIComponent(lm.slug)}.js`
          : `/preview/banner/${encodeURIComponent(lm.slug)}.js`;

      return `
      <article class="card">
        <div class="pill-row" style="margin-bottom: 4px;">
          <span class="pill">Free Lead Magnet</span>
          <span class="pill pill-emerald">→ ${escapeHtml(lm.targetProductSlug)}</span>
        </div>
        <h3>${escapeHtml(lm.name)}</h3>
        <p style="color: var(--text-muted);">${escapeHtml(lm.tagline)}</p>
        <p style="font-size: 0.9rem;">
          <strong>Contextual Hook:</strong> ${escapeHtml(lm.hookText)}
        </p>
        <p style="font-size: 0.84rem; color: var(--text-muted);">
          Embed Snippet: <code>&lt;script src="${escapeHtml(scriptSrc)}" defer&gt;&lt;/script&gt;</code>
        </p>
        <div class="cta-group" style="margin-bottom: 0;">
          <a class="btn btn-secondary" href="${escapeHtml(sanitizeUrl(lm.siteUrl))}">Open Free Tool</a>
          <a class="btn btn-primary" href="${escapeHtml(sanitizeUrl(attributedUrl))}">Attributed Flagship Link</a>
        </div>
      </article>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(brandName)} — Local-First &amp; Open-Core Product Matrix</title>
  <style>${SHARED_STYLES}</style>
</head>
<body>
  <header class="topbar">
    <div class="container topbar-inner">
      <span class="brand">${escapeHtml(brandName)} · Product Matrix</span>
      <nav class="nav-links">
        <a href="#products">Flagship Products</a>
        <a href="#lead-magnets">Free Tools &amp; Funnel</a>
      </nav>
    </div>
  </header>

  <main class="container">
    <section class="hero" style="border-top: none;">
      <div class="pill-row">
        <span class="pill">One-Person Company (OPC) Suite</span>
        <span class="pill pill-emerald">Local-First · BYOK · Ed25519 Offline Keys</span>
      </div>
      <h1>Focused Indie Software That Respects Your Keys, Files, and Attention</h1>
      <p class="outcome">
        Every tool in the ${escapeHtml(brandName)} portfolio runs local-first with transparent free tiers, cryptographic offline Pro licensing, and zero ad-tech surveillance.
      </p>
    </section>

    <section id="products">
      <h2>Flagship &amp; Open-Core Products (${manifests.length})</h2>
      <p class="section-lead">Production-grade browser extensions, native macOS studios, and multi-agent developer command centers.</p>
      <div class="grid-2">
        ${productCards}
      </div>
    </section>

    <section id="lead-magnets">
      <h2>Free Interactive Learning Tools &amp; Lead Magnets (${leadMagnets.length})</h2>
      <p class="section-lead">Standalone MIT-licensed interactive tools driving contextual, UTM-attributed discovery to flagship products.</p>
      <div class="grid-2">
        ${leadMagnetCards}
      </div>
    </section>
  </main>

  <footer>
    <div class="container footer-inner">
      <div><strong>${escapeHtml(brandName)}</strong> · Powered by <code>opc-gtm-kit</code></div>
      <div>Support: <a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a></div>
    </div>
  </footer>
</body>
</html>`;
}

export function renderLeadMagnetBannerJs(
  targetManifest: ProductManifest,
  utmCampaign: string,
  options?: LeadMagnetBannerOptions,
): string {
  const baseTargetUrl = options?.targetUrl || targetManifest.links.homeUrl;
  const sourceSlug = options?.sourceSlug || "lead_magnet";
  const attributedHref = buildUtmUrl(baseTargetUrl, {
    source: sourceSlug,
    medium: "banner",
    campaign: utmCampaign,
    content: targetManifest.slug,
  });

  const highlightedTier =
    targetManifest.pricing.tiers.find((t) => t.highlighted) ||
    targetManifest.pricing.tiers[0];

  const bannerConfig = escapeJsonForScript({
    slug: targetManifest.slug,
    displayName: targetManifest.displayName,
    hookText:
      options?.hookText ||
      `${targetManifest.displayName}: ${targetManifest.tagline}`,
    ctaLabel:
      options?.ctaLabel ||
      `Try ${targetManifest.displayName} (${highlightedTier.priceLabel}) →`,
    href: sanitizeUrl(attributedHref),
    position: options?.position === "top" ? "top" : "bottom",
    storageKey: `opc_lm_dismissed_${targetManifest.slug}_${utmCampaign}`,
  });

  return `(function() {
  "use strict";
  var cfg = ${bannerConfig};
  if (typeof document === "undefined") return;
  try {
    if (window.sessionStorage && window.sessionStorage.getItem(cfg.storageKey) === "1") {
      return;
    }
  } catch (_) {}

  function mountBanner() {
    if (document.querySelector('[data-opc-banner="' + cfg.slug + '"]')) return;

    var bar = document.createElement("aside");
    bar.setAttribute("role", "complementary");
    bar.setAttribute("data-opc-banner", cfg.slug);
    bar.style.cssText = [
      "position:fixed",
      "left:16px",
      "right:16px",
      cfg.position === "top" ? "top:16px" : "bottom:16px",
      "max-width:880px",
      "margin:0 auto",
      "z-index:2147483000",
      "background:#121a30",
      "color:#f1f5f9",
      "border:1px solid rgba(99,102,241,0.45)",
      "border-radius:12px",
      "padding:12px 16px",
      "box-shadow:0 14px 34px rgba(0,0,0,0.45)",
      "display:flex",
      "align-items:center",
      "justify-content:space-between",
      "gap:14px",
      "flex-wrap:wrap",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      "font-size:14px"
    ].join(";");

    var textSpan = document.createElement("span");
    textSpan.style.cssText = "flex:1;min-width:200px;line-height:1.45;";
    textSpan.textContent = cfg.hookText;

    var actions = document.createElement("div");
    actions.style.cssText = "display:flex;align-items:center;gap:10px;";

    var cta = document.createElement("a");
    cta.href = cfg.href;
    cta.target = "_blank";
    cta.rel = "noopener noreferrer";
    cta.textContent = cfg.ctaLabel;
    cta.style.cssText = [
      "background:#6366f1",
      "color:#ffffff",
      "padding:8px 14px",
      "border-radius:8px",
      "font-weight:600",
      "text-decoration:none",
      "white-space:nowrap"
    ].join(";");

    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Dismiss recommendation");
    closeBtn.textContent = "×";
    closeBtn.style.cssText = [
      "background:transparent",
      "border:none",
      "color:#94a3b8",
      "font-size:20px",
      "line-height:1",
      "cursor:pointer",
      "padding:4px 6px"
    ].join(";");
    closeBtn.addEventListener("click", function() {
      try {
        if (window.sessionStorage) window.sessionStorage.setItem(cfg.storageKey, "1");
      } catch (_) {}
      if (bar.parentNode) bar.parentNode.removeChild(bar);
    });

    actions.appendChild(cta);
    actions.appendChild(closeBtn);
    bar.appendChild(textSpan);
    bar.appendChild(actions);
    document.body.appendChild(bar);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountBanner);
  } else {
    mountBanner();
  }
})();
`;
}

export function renderMarkdownPageHtml(
  title: string,
  markdown: string,
  options?: { backHref?: string; brandName?: string },
): string {
  const brandName = options?.brandName || process.env.OPC_BRAND_NAME || "OPC Studio";
  const backHref = sanitizeUrl(options?.backHref || "/preview");

  const lines = markdown.split("\n");
  const htmlBlocks: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("### ")) {
      htmlBlocks.push(`<h3 style="margin-top:20px;">${escapeHtml(trimmed.slice(4))}</h3>`);
    } else if (trimmed.startsWith("## ")) {
      htmlBlocks.push(`<h2 style="margin-top:28px;font-size:1.35rem;">${escapeHtml(trimmed.slice(3))}</h2>`);
    } else if (trimmed.startsWith("# ")) {
      htmlBlocks.push(`<h1>${escapeHtml(trimmed.slice(2))}</h1>`);
    } else if (trimmed.startsWith("- ")) {
      htmlBlocks.push(`<p style="padding-left:16px;">• ${escapeHtml(trimmed.slice(2))}</p>`);
    } else {
      htmlBlocks.push(`<p style="color:#cbd5e1;margin-top:8px;">${escapeHtml(trimmed)}</p>`);
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} — ${escapeHtml(brandName)}</title>
  <style>${SHARED_STYLES}</style>
</head>
<body>
  <header class="topbar">
    <div class="container topbar-inner">
      <a class="brand" href="${escapeHtml(backHref)}">← Back to ${escapeHtml(brandName)}</a>
    </div>
  </header>
  <main class="container" style="padding-top:48px;padding-bottom:64px;max-width:860px;">
    <article class="card">
      ${htmlBlocks.join("\n")}
    </article>
  </main>
</body>
</html>`;
}

export function buildStaticSite(options: StaticSiteBuildOptions): StaticSiteBuildResult {
  const outDir = resolve(options.outDir);
  const manifests = options.manifests ?? loadProductManifests();
  const leadMagnets = options.leadMagnets ?? loadLeadMagnets();
  const brandName = options.entityName || process.env.OPC_BRAND_NAME || "OPC Studio";
  const contactEmail = options.contactEmail || process.env.OPC_SUPPORT_EMAIL || "support@example.com";

  mkdirSync(outDir, { recursive: true });
  const writtenFiles: string[] = [];

  const hubPath = join(outDir, "index.html");
  writeFileSync(
    hubPath,
    renderPortfolioHub(manifests, leadMagnets, {
      brandName,
      baseUrl: options.baseUrl,
      contactEmail,
      linkMode: "static",
    }),
    "utf8",
  );
  writtenFiles.push("index.html");

  for (const manifest of manifests) {
    const productDir = join(outDir, manifest.slug);
    mkdirSync(productDir, { recursive: true });

    const landingHtml = renderProductLandingPage(manifest, {
      checkoutBaseUrl: options.checkoutBaseUrl,
      apiBaseUrl: options.apiBaseUrl,
      brandName,
      contactEmail,
      linkMode: "static",
    });
    writeFileSync(join(productDir, "index.html"), landingHtml, "utf8");
    writtenFiles.push(`${manifest.slug}/index.html`);

    const compliance = generateCompliancePack(manifest, {
      entityName: brandName,
      contactEmail,
    });
    writeFileSync(
      join(productDir, "privacy.html"),
      renderMarkdownPageHtml(`${manifest.displayName} Privacy Policy`, compliance.privacyPolicyMd, {
        backHref: "./index.html",
        brandName,
      }),
      "utf8",
    );
    writtenFiles.push(`${manifest.slug}/privacy.html`);

    writeFileSync(
      join(productDir, "terms.html"),
      renderMarkdownPageHtml(`${manifest.displayName} Terms of Service`, compliance.termsOfServiceMd, {
        backHref: "./index.html",
        brandName,
      }),
      "utf8",
    );
    writtenFiles.push(`${manifest.slug}/terms.html`);

    writeFileSync(
      join(productDir, "refund.html"),
      renderMarkdownPageHtml(`${manifest.displayName} Refund Policy`, compliance.refundPolicyMd, {
        backHref: "./index.html",
        brandName,
      }),
      "utf8",
    );
    writtenFiles.push(`${manifest.slug}/refund.html`);
  }

  const bannersDir = join(outDir, "banners");
  mkdirSync(bannersDir, { recursive: true });
  for (const lm of leadMagnets) {
    const target =
      manifests.find((m) => m.slug === lm.targetProductSlug) || manifests[0];
    if (target) {
      const js = renderLeadMagnetBannerJs(target, lm.utmCampaign, {
        sourceSlug: lm.slug,
        hookText: lm.hookText,
      });
      writeFileSync(join(bannersDir, `${lm.slug}.js`), js, "utf8");
      writtenFiles.push(`banners/${lm.slug}.js`);
    }
  }

  return {
    outDir,
    files: writtenFiles,
    totalFiles: writtenFiles.length,
  };
}
