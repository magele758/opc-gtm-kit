# opc-gtm-kit

**Zero-Dependency Go-To-Market (GTM) Toolkit for One-Person Companies (OPC)**  
**一人公司（OPC）零外部依赖全链路商业化与增长工具箱**

[![License: MIT](https://img.shields.io/badge/License-MIT-indigo.svg)](./LICENSE)
[![Runtime: Node.js Native TS](https://img.shields.io/badge/Node.js-%3E%3D22.6%20Native%20TS-10b981.svg)](https://nodejs.org)
[![Dependencies: Zero](https://img.shields.io/badge/Runtime%20Dependencies-0-6366f1.svg)](./package.json)

`opc-gtm-kit` turns product manifests into high-conversion landing pages, embeddable lead-magnet banners, Chrome Web Store MV3 & macOS notarization compliance packs, AGPL copyleft contamination audits, 5-channel UTM launch drafts (`cose` + `chromegate-gateway` ready), privacy-masked SQLite waitlists with D0/D3 drip sequences, and automated bridges to `opc-os` and `data_analysis`.

`opc-gtm-kit` 专为独立开发者与一人公司（OPC）设计，**零外部运行时依赖**（直接基于 Node.js 原生 TypeScript、`node:sqlite`、`node:http`、`node:crypto` 开箱即跑，无需 `npm install`），覆盖**高转化落地页生成、免费引流工具挂件、CWS MV3 过审与 AGPL 传染审计、五渠道一鱼多吃内容分发、隐私安全候补名单与自动化同步桥接**。

---

## Quick Start / 30 秒极速上手

No `npm install` or build step required on Node.js with native TypeScript + `node:sqlite`:

```bash
# 1. Run the full test suite immediately
node --test src/*.test.ts

# 2. Launch the GTM API & Live Storefront Preview Server (127.0.0.1:52332)
node src/cli.ts serve

# 3. Open live previews in your browser:
#    Portfolio Matrix Hub:  http://127.0.0.1:52332/preview
#    Product Landing Page:  http://127.0.0.1:52332/preview/pagelens-interpret
#    Privacy Policy Page:   http://127.0.0.1:52332/preview/pagelens-interpret/privacy

# 4. Build static deployable site + legal pages + lead-magnet JS banners
node src/cli.ts build-site --out ./dist-site
```

---

## Core Capabilities / 核心模块一览

### 1. Built-in OPC Product Matrix & Lead Magnets (`src/manifests.ts`, `manifests/*.json`)
Ships with 4 production-ready product manifests and 2 contextual lead-magnet configurations:

| Slug | Product | Distribution | License Model | Pricing |
| :--- | :--- | :--- | :--- | :--- |
| `pagelens-interpret` | `PageLens` | `chrome_extension` | `freemium_offline_key` | Free + Pro $19/yr or **$29 buyout** |
| `pagelens-agent` | `PageLens` | `chrome_extension` | `open_core_byok` | OSS Free + Pro **$39** |
| `audiobook` | `audiobook` | `macos_and_web` | `freemium_offline_key` | Free + Desktop Pro **$29** |
| `hyper-vibekanban` | `hyper-vibekanban` | `self_hosted_pro` | `open_core` | Self-Hosted Free + Remote Pro **$49/yr** |

- **Lead Magnets**: `rubiks-cube-learn` (→ `pagelens-interpret`) & `bazi-ziwei-learning` (→ `audiobook`), driving UTM-attributed traffic from free interactive learning tools to flagship products.

### 2. High-Conversion Storefront & Lead-Magnet Banner Generator (`src/storefront.ts`)
- `renderProductLandingPage(manifest, options)`: Single-file responsive HTML5 landing page featuring a **10-second Hero** (Pain Point → Outcome + UTM-preserving CTAs), **3-Step Workflow**, **Transparent Pricing Cards** (highlighting offline cryptographic **Ed25519** license verification), **Local-First & MV3 Permission Trust Pledge**, interactive **Waitlist Form**, and Legal Footer. Strictly XSS-safe (`escapeHtml`, `sanitizeUrl`, `\u003c`-escaped script JSON).
- `renderPortfolioHub(manifests, leadMagnets)`: Unified OPC Brand & Product Matrix portal (`index.html`).
- `renderLeadMagnetBannerJs(targetManifest, utmCampaign)`: Self-contained vanilla JS floating banner (`textContent`-safe, session-dismissible) for embedding into free web tools.

### 3. Legal, Store Review & License Compliance Kit (`src/legal.ts`)
- `generateCompliancePack(manifest, options)`: Generates:
  - `privacyPolicyMd` (tailored for BYOK, local-first processing, SHA-256 waitlist hashing, GDPR/CCPA)
  - `termsOfServiceMd` (Ed25519 offline license fair-use terms & BYOK disclaimers)
  - `refundPolicyMd` (14-day satisfaction guarantee)
  - `chromeWebStoreReviewMd` (**MV3 Single-Purpose statement**, exact per-permission justification for `activeTab`, `storage`, `offscreen`, `tabCapture`, `sidePanel`, `scripting`, Remote Code certification, and < 60s reviewer steps)
  - `macosNotarizationChecklistMd` (Hardened Runtime entitlements, `codesign`, `xcrun notarytool submit`, `stapler`, `spctl`)
- `auditLicenseMatrix(repos)`: Detects `AGPL`, `GPL`, `SSPL`, `BUSL`, and `CC-BY-NC` contamination across `flagship_paid`, `open_core`, `lead_magnet`, and `internal_infra` repositories with concrete remediation guidance.

### 4. UTM Attribution, 5-Channel Repurposing & SQLite Drip Engine (`src/growth.ts`)
- `normalizeChannel(rawSource)` & `buildUtmUrl(baseUrl, params)`: Deterministic channel taxonomy (`x`, `xiaohongshu`, `bilibili`, `hackernews`, `producthunt`, `v2ex`, `github`, `lead_magnet`, `direct`, etc.).
- `repurposeContent(input)`: One-fish-multi-eat launch drafts across **5 channels** (`x_thread`, `xiaohongshu_note`, `bilibili_script`, `hackernews_show`, `v2ex_launch`) with channel-specific UTM links + a **`cosePublishBundle`** (`gatePolicy: "CONFIRMATION_REQUIRED"`) ready for `cose` + `chromegate-gateway` human-gated browser publishing.
- **SQLite Engine (`node:sqlite` `DatabaseSync`)**:
  - Tables: `gtm_acquisitions`, `gtm_waitlist`, `gtm_campaigns`, `gtm_drip_outbox`.
  - `recordAcquisition(...)`: Idempotent acquisition tracking + optional real-time forwarding to `opc-os`.
  - `joinWaitlist(...)`: Stores SHA-256 `emailHash` + masked preview (`al***@example.com`) by default (`PRIVACY_MASK_EMAIL=1`), derives deterministic `customerId`, records `acquired` attribution, and enqueues **D0 Welcome** + **D3 Power Tips** drip drafts.

### 5. Bridges to `opc-os` & `data_analysis` (`src/bridge.ts`)
- `syncAcquisitionToOpcOs(acq, config)`: Posts `{ product, customerId, eventId, kind: "acquired", channel, at, reference }` to `${opcOsUrl}/api/zoom/growth/events` with `Authorization: Bearer ${opcOsToken}`.
- `exportTraces(product?)` & `syncTracesToDataAnalysis(...)`: Exports canonical **17-column `TRACE_COLUMNS`** rows (`event_name: "acquired" | "waitlist_joined"`) and syncs to `${dataAnalysisUrl}/api/v1/import/traces`.

---

## HTTP Server Endpoints / HTTP 接口契约

Default bind: `127.0.0.1:52332` (CORS restricted to `localhost` / `127.0.0.1`).

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Service health & live GTM summary stats |
| `GET` | `/api/v1/summary?product=...` | Funnel & channel attribution metrics |
| `GET` | `/api/v1/manifests` | List all product manifests & lead magnets |
| `GET` | `/api/v1/manifests/:slug` | Get a single product manifest |
| `GET` | `/preview` | Live Portfolio Matrix Hub HTML |
| `GET` | `/preview/:slug` | Live Product Landing Page HTML (supports `?utm_source=...`) |
| `GET` | `/preview/:slug/privacy` | Live Privacy Policy HTML (also `/terms`, `/refund`) |
| `GET` | `/preview/banner/:leadMagnet.js` | Embeddable Lead-Magnet Banner JS |
| `POST` | `/api/v1/storefront/build` | Build static HTML/JS bundle (`{ outDir, dryRun? }`) |
| `POST` | `/api/v1/legal/generate` | Generate CWS MV3, macOS & legal Markdown pack |
| `POST` | `/api/v1/legal/audit-licenses` | Run SPDX / AGPL copyleft contamination audit |
| `POST` | `/api/v1/repurpose` | Generate & save 5-channel UTM drafts + `cosePublishBundle` |
| `GET` | `/api/v1/campaigns?product=...` | List saved repurpose campaigns |
| `POST` | `/api/v1/utm/acquire` | Record idempotent UTM acquisition (+ auto-sync to `opc-os`) |
| `POST` | `/api/v1/waitlist/join` | Join waitlist + enqueue D0/D3 drips (+ auto-sync to `opc-os`) |
| `GET` | `/api/v1/waitlist?product=...` | List masked waitlist subscribers & drip outbox |
| `GET` | `/api/v1/export/traces?product=...` | Export canonical 17-column `TRACE_COLUMNS` JSON |
| `POST` | `/api/v1/sync/opc-os` | Batch sync pending acquisitions to `opc-os` |
| `POST` | `/api/v1/sync/data-analysis` | Push 17-column trace rows to `data_analysis` |

---

## CLI Reference / 命令行用法

```bash
# Start HTTP server
node src/cli.ts serve --port 52332

# Build static storefront into ./dist-site
node src/cli.ts build-site --out ./dist-site

# Generate legal & CWS MV3 review pack
node src/cli.ts legal --slug pagelens-interpret --out ./dist-site/legal

# Audit repository licenses for AGPL/copyleft contamination
node src/cli.ts audit-licenses

# Generate 5-channel launch content + human-gated COSE bundle
node src/cli.ts repurpose --slug audiobook --campaign launch_2026 --out ./dist-site/cose-audiobook.md

# Record UTM acquisition & join waitlist
node src/cli.ts acquire --product PageLens --customer cust_demo --channel hackernews --campaign show_hn
node src/cli.ts waitlist --email user@example.com --product PageLens --channel x

# View summary & run upstream sync
node src/cli.ts summary
node src/cli.ts sync --target all
```

---

## Environment Variables / 环境变量配置

All variables are optional; see [`.env.example`](./.env.example):

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `PORT` | `52332` | HTTP server port |
| `HOST` | `127.0.0.1` | HTTP bind address |
| `GTM_DB_PATH` | `./data/gtm.db` | SQLite database file path (`:memory:` supported) |
| `PRIVACY_MASK_EMAIL` | `1` | Mask stored emails (`al***@example.com`) alongside SHA-256 hash |
| `OPC_BRAND_NAME` | `OPC Studio` | Default studio/entity name on pages & legal templates |
| `OPC_SITE_URL` | `https://opc.example.com` | Base public site URL |
| `OPC_CHECKOUT_BASE_URL` | `https://checkout.opc.example.com` | Base checkout URL for paid tiers |
| `OPC_SUPPORT_EMAIL` | `support@example.com` | Contact email in storefront & compliance docs |
| `OPC_OS_URL` / `OPC_OS_TOKEN` | _(unset)_ | Optional `opc-os` growth webhook target & bearer token |
| `DATA_ANALYSIS_URL` / `DATA_ANALYSIS_TOKEN` | _(unset)_ | Optional `data_analysis` trace import target & bearer token |

---

## License

[MIT](./LICENSE)
