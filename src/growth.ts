import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { findManifestByProductOrSlug } from "./manifests.ts";
import { syncAcquisitionToOpcOs, type OpcOsSyncConfig, type OpcOsSyncResult } from "./bridge.ts";

export const CANONICAL_CHANNELS = [
  "x",
  "xiaohongshu",
  "bilibili",
  "hackernews",
  "producthunt",
  "v2ex",
  "github",
  "lead_magnet",
  "newsletter",
  "reddit",
  "wechat",
  "search",
  "referral",
  "direct",
  "other",
] as const;

export type CanonicalChannel = (typeof CANONICAL_CHANNELS)[number];

export const REPURPOSE_FORMATS = [
  "x_thread",
  "xiaohongshu_note",
  "bilibili_script",
  "hackernews_show",
  "v2ex_launch",
] as const;

export type RepurposeFormat = (typeof REPURPOSE_FORMATS)[number];

export interface UtmParams {
  source: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
}

export interface RepurposeInput {
  product: string;
  slug: string;
  title: string;
  summary: string;
  highlights: string[];
  baseUrl: string;
  campaign: string;
}

export interface XThreadDraft {
  channel: "x";
  format: "x_thread";
  utmUrl: string;
  tweets: string[];
  body: string;
}

export interface XiaohongshuNoteDraft {
  channel: "xiaohongshu";
  format: "xiaohongshu_note";
  utmUrl: string;
  headline: string;
  tags: string[];
  body: string;
}

export interface BilibiliScriptDraft {
  channel: "bilibili";
  format: "bilibili_script";
  utmUrl: string;
  videoTitle: string;
  sections: Array<{ window: string; script: string }>;
  pinnedComment: string;
  body: string;
}

export interface HackerNewsShowDraft {
  channel: "hackernews";
  format: "hackernews_show";
  utmUrl: string;
  submissionTitle: string;
  firstComment: string;
  body: string;
}

export interface V2exLaunchDraft {
  channel: "v2ex";
  format: "v2ex_launch";
  utmUrl: string;
  node: "create";
  postTitle: string;
  body: string;
}

export interface RepurposeChannelsMap {
  x_thread: XThreadDraft;
  xiaohongshu_note: XiaohongshuNoteDraft;
  bilibili_script: BilibiliScriptDraft;
  hackernews_show: HackerNewsShowDraft;
  v2ex_launch: V2exLaunchDraft;
}

export interface CosePublishBundle {
  platforms: string[];
  markdown: string;
  gatePolicy: "CONFIRMATION_REQUIRED";
  preflightCommand: string;
}

export interface RepurposeResult extends RepurposeChannelsMap {
  product: string;
  slug: string;
  campaign: string;
  channels: RepurposeChannelsMap;
  cosePublishBundle: CosePublishBundle;
}

export interface AcquisitionInput {
  eventId?: string;
  product: string;
  customerId: string;
  channel: string;
  campaign?: string;
  landingPath?: string;
  at?: string;
  reference?: string;
}

export interface AcquisitionRecord {
  eventId: string;
  product: string;
  customerId: string;
  rawSource: string;
  channel: CanonicalChannel;
  campaign: string;
  landingPath: string;
  reference: string;
  at: string;
  opcOsSyncedAt: string | null;
}

export interface RecordAcquisitionResult {
  acquisition: AcquisitionRecord;
  deduplicated: boolean;
  opcOsSync: OpcOsSyncResult | null;
}

export interface WaitlistInput {
  email: string;
  product: string;
  customerId?: string;
  channel?: string;
  campaign?: string;
  note?: string;
  at?: string;
}

export interface WaitlistRecord {
  waitlistId: string;
  emailHash: string;
  emailMasked: string;
  emailStored: string;
  product: string;
  customerId: string;
  channel: CanonicalChannel;
  campaign: string;
  note: string;
  createdAt: string;
}

export interface DripDraftRecord {
  dripId: string;
  waitlistId: string;
  product: string;
  customerId: string;
  emailHash: string;
  emailMasked: string;
  stepCode: "D0_WELCOME" | "D3_TIPS";
  scheduledAt: string;
  subject: string;
  bodyMarkdown: string;
  status: "queued" | "sent" | "cancelled";
  createdAt: string;
}

export interface JoinWaitlistResult {
  waitlist: WaitlistRecord;
  deduplicated: boolean;
  acquisition: AcquisitionRecord;
  drips: DripDraftRecord[];
  opcOsSync: OpcOsSyncResult | null;
}

export interface CampaignRecord {
  campaignId: string;
  product: string;
  slug: string;
  campaign: string;
  title: string;
  baseUrl: string;
  channels: RepurposeChannelsMap;
  cosePublishBundle: CosePublishBundle;
  createdAt: string;
}

export interface GtmSummary {
  totalAcquisitions: number;
  uniqueCustomers: number;
  totalWaitlist: number;
  totalCampaigns: number;
  syncedToOpcOs: number;
  dripOutbox: {
    queued: number;
    sent: number;
    total: number;
  };
  byChannel: Record<string, number>;
  byProduct: Record<
    string,
    {
      acquisitions: number;
      waitlist: number;
      campaigns: number;
    }
  >;
}

export interface GtmStoreOptions {
  dbPath?: string;
  privacyMaskEmail?: boolean;
  opcOsConfig?: OpcOsSyncConfig;
  manifestsDir?: string;
}

export function normalizeChannel(rawSource?: string | null): CanonicalChannel {
  if (!rawSource) return "direct";
  const cleaned = rawSource.trim().toLowerCase();
  if (
    cleaned === "" ||
    cleaned === "direct" ||
    cleaned === "(direct)" ||
    cleaned === "none" ||
    cleaned === "(none)"
  ) {
    return "direct";
  }

  if (
    cleaned === "x" ||
    cleaned === "twitter" ||
    cleaned === "x.com" ||
    cleaned === "twitter.com" ||
    cleaned === "t.co" ||
    cleaned === "x_thread"
  ) {
    return "x";
  }

  if (
    cleaned === "xiaohongshu" ||
    cleaned === "xhs" ||
    cleaned === "rednote" ||
    cleaned === "xiaohongshu.com" ||
    cleaned === "xiaohongshu_note"
  ) {
    return "xiaohongshu";
  }

  if (
    cleaned === "bilibili" ||
    cleaned === "bili" ||
    cleaned === "b23" ||
    cleaned === "b23.tv" ||
    cleaned === "bilibili.com" ||
    cleaned === "bilibili_script"
  ) {
    return "bilibili";
  }

  if (
    cleaned === "hackernews" ||
    cleaned === "hn" ||
    cleaned === "show_hn" ||
    cleaned === "ycombinator" ||
    cleaned === "news.ycombinator.com" ||
    cleaned === "hackernews_show"
  ) {
    return "hackernews";
  }

  if (
    cleaned === "producthunt" ||
    cleaned === "ph" ||
    cleaned === "producthunt.com"
  ) {
    return "producthunt";
  }

  if (cleaned === "v2ex" || cleaned === "v2ex.com" || cleaned === "v2ex_launch") {
    return "v2ex";
  }

  if (cleaned === "github" || cleaned === "gh" || cleaned === "github.com") {
    return "github";
  }

  if (
    cleaned === "lead_magnet" ||
    cleaned === "lead-magnet" ||
    cleaned === "lm" ||
    cleaned === "banner" ||
    cleaned === "rubiks-cube-learn" ||
    cleaned === "bazi-ziwei-learning" ||
    cleaned.startsWith("lm_")
  ) {
    return "lead_magnet";
  }

  if (
    cleaned === "newsletter" ||
    cleaned === "email" ||
    cleaned === "drip" ||
    cleaned === "substack"
  ) {
    return "newsletter";
  }

  if (cleaned === "reddit" || cleaned === "reddit.com") {
    return "reddit";
  }

  if (cleaned === "wechat" || cleaned === "weixin" || cleaned.includes("weixin.qq.com")) {
    return "wechat";
  }

  if (
    cleaned === "google" ||
    cleaned === "bing" ||
    cleaned === "duckduckgo" ||
    cleaned === "baidu" ||
    cleaned === "search" ||
    cleaned === "organic"
  ) {
    return "search";
  }

  if (cleaned === "referral" || /^[a-z0-9.-]+\.[a-z]{2,}$/.test(cleaned)) {
    return "referral";
  }

  return "other";
}

export function buildUtmUrl(baseUrl: string, params: UtmParams): string {
  const url = new URL(baseUrl);
  const cleanSource = params.source.trim().toLowerCase();
  if (!cleanSource) {
    throw new Error("buildUtmUrl requires a non-empty source");
  }
  url.searchParams.set("utm_source", cleanSource);
  if (params.medium && params.medium.trim()) {
    url.searchParams.set("utm_medium", params.medium.trim().toLowerCase());
  }
  if (params.campaign && params.campaign.trim()) {
    url.searchParams.set("utm_campaign", params.campaign.trim());
  }
  if (params.content && params.content.trim()) {
    url.searchParams.set("utm_content", params.content.trim());
  }
  if (params.term && params.term.trim()) {
    url.searchParams.set("utm_term", params.term.trim());
  }
  return url.toString();
}

export function hashEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function maskEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const atIndex = normalized.indexOf("@");
  if (atIndex <= 0 || atIndex === normalized.length - 1) {
    throw new Error("Invalid email format");
  }
  const local = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);
  if (!domain.includes(".")) {
    throw new Error("Invalid email domain");
  }
  const visiblePrefix = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visiblePrefix}***@${domain}`;
}

export function repurposeContent(input: RepurposeInput): RepurposeResult {
  const highlights =
    input.highlights.length > 0
      ? input.highlights
      : [input.summary];

  const xUrl = buildUtmUrl(input.baseUrl, {
    source: "x",
    medium: "social",
    campaign: input.campaign,
    content: "x_thread",
  });
  const xhsUrl = buildUtmUrl(input.baseUrl, {
    source: "xiaohongshu",
    medium: "social",
    campaign: input.campaign,
    content: "xiaohongshu_note",
  });
  const biliUrl = buildUtmUrl(input.baseUrl, {
    source: "bilibili",
    medium: "video",
    campaign: input.campaign,
    content: "bilibili_script",
  });
  const hnUrl = buildUtmUrl(input.baseUrl, {
    source: "hackernews",
    medium: "community",
    campaign: input.campaign,
    content: "hackernews_show",
  });
  const v2exUrl = buildUtmUrl(input.baseUrl, {
    source: "v2ex",
    medium: "community",
    campaign: input.campaign,
    content: "v2ex_launch",
  });

  const tweets: string[] = [
    `1/ Shipped ${input.title} (${input.product})!\n\n${input.summary}\n\nBuilt local-first with zero cloud lock-in. Here is how it works:`,
    ...highlights.slice(0, 3).map((item, idx) => `${idx + 2}/ ${item}`),
    `${Math.min(highlights.length, 3) + 2}/ Why indie & local-first matters:\n- Own your workflow & keys (BYOK / local processing)\n- Cryptographic Ed25519 offline license verification\n- No forced SaaS subscription bloat\n\nTry it here: ${xUrl}`,
  ];

  const x_thread: XThreadDraft = {
    channel: "x",
    format: "x_thread",
    utmUrl: xUrl,
    tweets,
    body: tweets.join("\n\n---\n\n"),
  };

  const xhsTags = [
    `#${input.product.replace(/\s+/g, "")}`,
    "#独立开发",
    "#效率神器",
    "#AI工具",
    "#本地优先",
  ];
  const xhsHeadline = `独立开发肝出来了！${input.title}`;
  const xhsBody = `${xhsHeadline}

${input.summary}

核心亮点直接拉满：
${highlights.map((h, idx) => `${idx + 1}. ${h}`).join("\n")}

坚持隐私优先与本地可控，无强制云账号绑定，支持免费体验与买断制离线激活。
直达体验入口：${xhsUrl}

${xhsTags.join(" ")}`;

  const xiaohongshu_note: XiaohongshuNoteDraft = {
    channel: "xiaohongshu",
    format: "xiaohongshu_note",
    utmUrl: xhsUrl,
    headline: xhsHeadline,
    tags: xhsTags,
    body: xhsBody,
  };

  const biliSections = [
    {
      window: "00:00 - 00:10 (Hook)",
      script: `为什么我决定自己动手做「${input.title}」？10 秒钟直接给你看真实效果。`,
    },
    {
      window: "00:10 - 00:25 (Pain Point)",
      script: `过去处理这类任务最头疼的问题：${input.summary}`,
    },
    {
      window: "00:25 - 01:05 (Live Demo)",
      script: highlights.map((h, i) => `演示看点 ${i + 1}：${h}`).join("；"),
    },
    {
      window: "01:05 - 01:30 (Trust & CTA)",
      script: `支持免费上手，Pro 采用 Ed25519 离线验签买断/透明定价，数据留在本地。置顶评论获取体验链接！`,
    },
  ];
  const biliPinned = `【置顶体验入口】${input.title}：${biliUrl}`;

  const bilibili_script: BilibiliScriptDraft = {
    channel: "bilibili",
    format: "bilibili_script",
    utmUrl: biliUrl,
    videoTitle: `【独立开发实录】${input.title} — 本地优先 & 零云端锁定实测演示`,
    sections: biliSections,
    pinnedComment: biliPinned,
    body: [
      `# ${input.title} (90s Bilibili 演示脚本)`,
      ...biliSections.map((s) => `**[${s.window}]**\n${s.script}`),
      `**置顶评论：** ${biliPinned}`,
    ].join("\n\n"),
  };

  const hnSubmissionTitle = `Show HN: ${input.title} – ${input.summary.slice(0, 72)}`;
  const hnFirstComment = `Hi HN! Maker of ${input.product} (\`${input.slug}\`) here.

I built **${input.title}** to solve a workflow friction I hit constantly: ${input.summary}

Key engineering choices:
${highlights.map((h) => `- ${h}`).join("\n")}
- Local-first privacy posture with optional BYOK direct provider calls and offline Ed25519 signature verification for Pro licenses (no mandatory cloud account or telemetry phone-home).

Live page / download: ${hnUrl}

Would love candid feedback on the UX, edge cases, and architecture!`;

  const hackernews_show: HackerNewsShowDraft = {
    channel: "hackernews",
    format: "hackernews_show",
    utmUrl: hnUrl,
    submissionTitle: hnSubmissionTitle,
    firstComment: hnFirstComment,
    body: `${hnSubmissionTitle}\nURL: ${hnUrl}\n\n${hnFirstComment}`,
  };

  const v2exTitle = `[分享创造] ${input.title}：${input.summary}`;
  const v2exBody = `各位 V 友好，最近独立打磨完成了 **${input.title}**（\`${input.slug}\`），发到 \`/go/create\` 请大家体验拍砖。

### 解决什么痛点
${input.summary}

### 核心特性
${highlights.map((h) => `- ${h}`).join("\n")}

### 隐私与授权设计
- 坚持 Local-First / BYOK 路线，不偷偷中转用户正文或密钥。
- 提供可直接使用的免费档；Pro 支持 Ed25519 离线签名校验，断网照常验签。

体验地址：${v2exUrl}

欢迎反馈任何 Bug 或需求建议！`;

  const v2ex_launch: V2exLaunchDraft = {
    channel: "v2ex",
    format: "v2ex_launch",
    utmUrl: v2exUrl,
    node: "create",
    postTitle: v2exTitle,
    body: `${v2exTitle}\n\n${v2exBody}`,
  };

  const channels: RepurposeChannelsMap = {
    x_thread,
    xiaohongshu_note,
    bilibili_script,
    hackernews_show,
    v2ex_launch,
  };

  const safeSlug = input.slug.replace(/[^a-zA-Z0-9_-]/g, "-");
  const safeCampaign = input.campaign.replace(/[^a-zA-Z0-9_-]/g, "-");
  const preflightCommand = `cose stage --bundle ./cose-${safeSlug}-${safeCampaign}.md --gateway chromegate-gateway --gate CONFIRMATION_REQUIRED --dry-run`;

  const bundleMarkdown = `---
product: "${input.product.replace(/"/g, '\\"')}"
slug: "${input.slug.replace(/"/g, '\\"')}"
campaign: "${input.campaign.replace(/"/g, '\\"')}"
gateway: "chromegate-gateway"
gate_policy: "CONFIRMATION_REQUIRED"
platforms:
  - x
  - xiaohongshu
  - bilibili
  - hackernews
  - v2ex
---

# COSE Human-Gated Distribution Bundle: ${input.title}

> **Human-in-the-Loop Gate:** \`CONFIRMATION_REQUIRED\` — \`chromegate-gateway\` stages drafts in browser tabs and halts before final submission until explicitly approved by a human operator.

## 1. X / Twitter Thread (\`${xUrl}\`)
${x_thread.body}

## 2. Xiaohongshu Note (\`${xhsUrl}\`)
${xiaohongshu_note.body}

## 3. Bilibili Video Script (\`${biliUrl}\`)
${bilibili_script.body}

## 4. Hacker News Show HN (\`${hnUrl}\`)
${hackernews_show.body}

## 5. V2EX /go/create (\`${v2exUrl}\`)
${v2ex_launch.body}
`;

  const cosePublishBundle: CosePublishBundle = {
    platforms: ["x", "xiaohongshu", "bilibili", "hackernews", "v2ex"],
    markdown: bundleMarkdown,
    gatePolicy: "CONFIRMATION_REQUIRED",
    preflightCommand,
  };

  return {
    product: input.product,
    slug: input.slug,
    campaign: input.campaign,
    ...channels,
    channels,
    cosePublishBundle,
  };
}

export class GtmStore {
  readonly dbPath: string;
  readonly db: DatabaseSync;
  private readonly privacyMaskEmailDefault: boolean;
  private readonly defaultOpcOsConfig?: OpcOsSyncConfig;
  private readonly manifestsDir?: string;

  constructor(options?: GtmStoreOptions) {
    this.dbPath =
      options?.dbPath ||
      process.env.GTM_DB_PATH ||
      resolve(process.cwd(), "data/gtm.db");

    if (this.dbPath !== ":memory:") {
      mkdirSync(dirname(this.dbPath), { recursive: true });
    }

    this.privacyMaskEmailDefault =
      options?.privacyMaskEmail !== undefined
        ? options.privacyMaskEmail
        : process.env.PRIVACY_MASK_EMAIL !== "0";

    this.defaultOpcOsConfig = options?.opcOsConfig;
    this.manifestsDir = options?.manifestsDir;

    this.db = new DatabaseSync(this.dbPath);
    if (this.dbPath !== ":memory:") {
      this.db.exec("PRAGMA journal_mode = WAL;");
    }
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS gtm_acquisitions (
        event_id TEXT PRIMARY KEY,
        product TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        raw_source TEXT NOT NULL,
        channel TEXT NOT NULL,
        campaign TEXT NOT NULL DEFAULT '',
        landing_path TEXT NOT NULL DEFAULT '/',
        reference TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        opc_os_synced_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_gtm_acq_product_at
        ON gtm_acquisitions(product, created_at);
      CREATE INDEX IF NOT EXISTS idx_gtm_acq_channel
        ON gtm_acquisitions(channel);

      CREATE TABLE IF NOT EXISTS gtm_waitlist (
        waitlist_id TEXT PRIMARY KEY,
        email_hash TEXT NOT NULL,
        email_stored TEXT NOT NULL,
        email_masked TEXT NOT NULL,
        product TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        campaign TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE(product, email_hash)
      );

      CREATE INDEX IF NOT EXISTS idx_gtm_wl_product
        ON gtm_waitlist(product, created_at);

      CREATE TABLE IF NOT EXISTS gtm_campaigns (
        campaign_id TEXT PRIMARY KEY,
        product TEXT NOT NULL,
        slug TEXT NOT NULL,
        campaign TEXT NOT NULL,
        title TEXT NOT NULL,
        base_url TEXT NOT NULL,
        channels_json TEXT NOT NULL,
        cose_bundle_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_gtm_camp_product
        ON gtm_campaigns(product, created_at);

      CREATE TABLE IF NOT EXISTS gtm_drip_outbox (
        drip_id TEXT PRIMARY KEY,
        waitlist_id TEXT NOT NULL,
        product TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        email_hash TEXT NOT NULL,
        email_masked TEXT NOT NULL,
        step_code TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        subject TEXT NOT NULL,
        body_markdown TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        created_at TEXT NOT NULL,
        UNIQUE(waitlist_id, step_code)
      );

      CREATE INDEX IF NOT EXISTS idx_gtm_drip_product_status
        ON gtm_drip_outbox(product, status, scheduled_at);
    `);
  }

  private resolveOpcOsConfig(override?: OpcOsSyncConfig): OpcOsSyncConfig | undefined {
    if (override && override.opcOsUrl) {
      return override;
    }
    if (this.defaultOpcOsConfig && this.defaultOpcOsConfig.opcOsUrl) {
      return this.defaultOpcOsConfig;
    }
    const envUrl = process.env.OPC_OS_URL;
    if (envUrl && envUrl.trim().length > 0) {
      return {
        opcOsUrl: envUrl.trim(),
        opcOsToken: process.env.OPC_OS_TOKEN || "",
      };
    }
    return undefined;
  }

  private mapAcquisitionRow(row: Record<string, unknown>): AcquisitionRecord {
    return {
      eventId: String(row.event_id),
      product: String(row.product),
      customerId: String(row.customer_id),
      rawSource: String(row.raw_source),
      channel: String(row.channel) as CanonicalChannel,
      campaign: String(row.campaign),
      landingPath: String(row.landing_path),
      reference: String(row.reference),
      at: String(row.created_at),
      opcOsSyncedAt: row.opc_os_synced_at ? String(row.opc_os_synced_at) : null,
    };
  }

  async recordAcquisition(
    input: AcquisitionInput,
    options?: { autoSyncOpcOs?: boolean; opcOsConfig?: OpcOsSyncConfig },
  ): Promise<RecordAcquisitionResult> {
    const product = input.product.trim();
    const customerId = input.customerId.trim();
    if (!product) throw new Error("recordAcquisition requires non-empty product");
    if (!customerId) throw new Error("recordAcquisition requires non-empty customerId");

    const eventId =
      input.eventId && input.eventId.trim().length > 0
        ? input.eventId.trim()
        : `acq_${randomUUID()}`;
    const rawSource = (input.channel || "direct").trim();
    const channel = normalizeChannel(rawSource);
    const campaign = (input.campaign || "").trim();
    const landingPath = (input.landingPath || "/").trim();
    const reference = (input.reference || "").trim();
    const at = input.at && input.at.trim().length > 0 ? input.at.trim() : new Date().toISOString();

    const insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO gtm_acquisitions (
        event_id, product, customer_id, raw_source, channel,
        campaign, landing_path, reference, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = insertStmt.run(
      eventId,
      product,
      customerId,
      rawSource,
      channel,
      campaign,
      landingPath,
      reference,
      at,
    );

    const deduplicated = Number(info.changes) === 0;
    const selectStmt = this.db.prepare(
      `SELECT * FROM gtm_acquisitions WHERE event_id = ?`,
    );
    const existingRow = selectStmt.get(eventId) as Record<string, unknown> | undefined;
    if (!existingRow) {
      throw new Error(`Failed to read acquisition "${eventId}" after insert`);
    }

    let acquisition = this.mapAcquisitionRow(existingRow);
    let opcOsSync: OpcOsSyncResult | null = null;

    const shouldAutoSync = options?.autoSyncOpcOs !== false;
    const syncCfg = shouldAutoSync ? this.resolveOpcOsConfig(options?.opcOsConfig) : undefined;

    if (syncCfg && !acquisition.opcOsSyncedAt) {
      opcOsSync = await syncAcquisitionToOpcOs(acquisition, syncCfg);
      if (opcOsSync.ok) {
        const syncedAt = new Date().toISOString();
        this.markAcquisitionSynced(acquisition.eventId, syncedAt);
        acquisition = {
          ...acquisition,
          opcOsSyncedAt: syncedAt,
        };
      }
    }

    return {
      acquisition,
      deduplicated,
      opcOsSync,
    };
  }

  markAcquisitionSynced(eventId: string, syncedAt: string = new Date().toISOString()): void {
    this.db
      .prepare(`UPDATE gtm_acquisitions SET opc_os_synced_at = ? WHERE event_id = ?`)
      .run(syncedAt, eventId);
  }

  async joinWaitlist(
    input: WaitlistInput,
    options?: {
      privacyMaskEmail?: boolean;
      autoSyncOpcOs?: boolean;
      opcOsConfig?: OpcOsSyncConfig;
    },
  ): Promise<JoinWaitlistResult> {
    const emailNormalized = input.email.trim().toLowerCase();
    const emailMasked = maskEmail(emailNormalized);
    const emailHash = hashEmail(emailNormalized);

    const product = input.product.trim();
    if (!product) {
      throw new Error("joinWaitlist requires non-empty product");
    }

    const maskEnabled =
      options?.privacyMaskEmail !== undefined
        ? options.privacyMaskEmail
        : process.env.PRIVACY_MASK_EMAIL !== undefined
          ? process.env.PRIVACY_MASK_EMAIL !== "0"
          : this.privacyMaskEmailDefault;

    const emailStored = maskEnabled ? emailMasked : emailNormalized;
    const customerId =
      input.customerId && input.customerId.trim().length > 0
        ? input.customerId.trim()
        : `cust_${emailHash.slice(0, 16)}`;

    const rawChannel = input.channel || "direct";
    const channel = normalizeChannel(rawChannel);
    const campaign = (input.campaign || "").trim();
    const note = (input.note || "").trim();
    const createdAt =
      input.at && input.at.trim().length > 0 ? input.at.trim() : new Date().toISOString();

    const waitlistCandidateId = `wl_${randomUUID()}`;
    const insertWl = this.db.prepare(`
      INSERT OR IGNORE INTO gtm_waitlist (
        waitlist_id, email_hash, email_stored, email_masked,
        product, customer_id, channel, campaign, note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const wlResult = insertWl.run(
      waitlistCandidateId,
      emailHash,
      emailStored,
      emailMasked,
      product,
      customerId,
      channel,
      campaign,
      note,
      createdAt,
    );
    const deduplicated = Number(wlResult.changes) === 0;

    const wlRow = this.db
      .prepare(`SELECT * FROM gtm_waitlist WHERE product = ? AND email_hash = ?`)
      .get(product, emailHash) as Record<string, unknown> | undefined;

    if (!wlRow) {
      throw new Error("Failed to read waitlist record after insert");
    }

    const waitlist: WaitlistRecord = {
      waitlistId: String(wlRow.waitlist_id),
      emailHash: String(wlRow.email_hash),
      emailMasked: String(wlRow.email_masked),
      emailStored: String(wlRow.email_stored),
      product: String(wlRow.product),
      customerId: String(wlRow.customer_id),
      channel: String(wlRow.channel) as CanonicalChannel,
      campaign: String(wlRow.campaign),
      note: String(wlRow.note),
      createdAt: String(wlRow.created_at),
    };

    const acqEventId = `acq_wl_${product.replace(/[^a-zA-Z0-9_-]/g, "_")}_${emailHash.slice(0, 16)}`;
    const acqResult = await this.recordAcquisition(
      {
        eventId: acqEventId,
        product,
        customerId: waitlist.customerId,
        channel: rawChannel,
        campaign,
        landingPath: `/waitlist/${product.toLowerCase()}`,
        at: waitlist.createdAt,
        reference: `waitlist:${waitlist.waitlistId}`,
      },
      {
        autoSyncOpcOs: options?.autoSyncOpcOs,
        opcOsConfig: options?.opcOsConfig,
      },
    );

    const manifest = findManifestByProductOrSlug(product, this.manifestsDir);
    const displayName = manifest ? manifest.displayName : product;
    const activationGoal = manifest
      ? manifest.activationAction
      : `完成 ${product} 首次核心工作流体验`;
    const homeUrl = manifest
      ? manifest.links.homeUrl
      : `${process.env.OPC_SITE_URL || "https://opc.example.com"}/${product.toLowerCase()}`;

    const baseDateMs = Date.parse(waitlist.createdAt);
    const d0Time = Number.isNaN(baseDateMs) ? new Date().toISOString() : new Date(baseDateMs).toISOString();
    const d3Time = Number.isNaN(baseDateMs)
      ? new Date(Date.now() + 3 * 86_400_000).toISOString()
      : new Date(baseDateMs + 3 * 86_400_000).toISOString();

    const insertDrip = this.db.prepare(`
      INSERT OR IGNORE INTO gtm_drip_outbox (
        drip_id, waitlist_id, product, customer_id, email_hash, email_masked,
        step_code, scheduled_at, subject, body_markdown, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)
    `);

    insertDrip.run(
      `drip_d0_${waitlist.waitlistId}`,
      waitlist.waitlistId,
      product,
      waitlist.customerId,
      waitlist.emailHash,
      waitlist.emailMasked,
      "D0_WELCOME",
      d0Time,
      `Welcome to ${displayName} — Quick-Start & Local-First Setup`,
      `Hi there,\n\nThanks for joining the **${displayName}** early-access & release list!\n\n- **Fastest first win:** ${activationGoal}\n- **Privacy posture:** Local-first execution with zero data broker tracking.\n- **Start here:** ${homeUrl}\n`,
      waitlist.createdAt,
    );

    insertDrip.run(
      `drip_d3_${waitlist.waitlistId}`,
      waitlist.waitlistId,
      product,
      waitlist.customerId,
      waitlist.emailHash,
      waitlist.emailMasked,
      "D3_TIPS",
      d3Time,
      `3 Power Tips for ${displayName} (+ Offline Pro Key Guide)`,
      `Hi again,\n\nHere are 3 quick workflow tips to get the most out of **${displayName}**:\n\n1. Trigger your core milestone: **${activationGoal}**.\n2. Keep sensitive data local (BYOK / on-device pipeline).\n3. Need batch queues or Pro workflows? Unlock Pro with an **Ed25519 offline license key** — works completely offline without mandatory cloud sign-in: ${homeUrl}\n`,
      waitlist.createdAt,
    );

    const drips = this.listDripOutboxByWaitlistId(waitlist.waitlistId);

    return {
      waitlist,
      deduplicated,
      acquisition: acqResult.acquisition,
      drips,
      opcOsSync: acqResult.opcOsSync,
    };
  }

  saveCampaign(input: RepurposeInput, repurposed?: RepurposeResult): CampaignRecord {
    const result = repurposed ?? repurposeContent(input);
    const campaignId = `camp_${randomUUID()}`;
    const createdAt = new Date().toISOString();

    this.db
      .prepare(`
        INSERT INTO gtm_campaigns (
          campaign_id, product, slug, campaign, title, base_url,
          channels_json, cose_bundle_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        campaignId,
        input.product,
        input.slug,
        input.campaign,
        input.title,
        input.baseUrl,
        JSON.stringify(result.channels),
        JSON.stringify(result.cosePublishBundle),
        createdAt,
      );

    return {
      campaignId,
      product: input.product,
      slug: input.slug,
      campaign: input.campaign,
      title: input.title,
      baseUrl: input.baseUrl,
      channels: result.channels,
      cosePublishBundle: result.cosePublishBundle,
      createdAt,
    };
  }

  listAcquisitions(product?: string, onlyUnsynced: boolean = false): AcquisitionRecord[] {
    let sql = `SELECT * FROM gtm_acquisitions WHERE 1=1`;
    const params: string[] = [];
    if (product && product.trim()) {
      sql += ` AND product = ?`;
      params.push(product.trim());
    }
    if (onlyUnsynced) {
      sql += ` AND opc_os_synced_at IS NULL`;
    }
    sql += ` ORDER BY created_at ASC, event_id ASC`;
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapAcquisitionRow(r));
  }

  listWaitlist(product?: string): WaitlistRecord[] {
    let sql = `SELECT * FROM gtm_waitlist`;
    const params: string[] = [];
    if (product && product.trim()) {
      sql += ` WHERE product = ?`;
      params.push(product.trim());
    }
    sql += ` ORDER BY created_at ASC, waitlist_id ASC`;
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map((wlRow) => ({
      waitlistId: String(wlRow.waitlist_id),
      emailHash: String(wlRow.email_hash),
      emailMasked: String(wlRow.email_masked),
      emailStored: String(wlRow.email_stored),
      product: String(wlRow.product),
      customerId: String(wlRow.customer_id),
      channel: String(wlRow.channel) as CanonicalChannel,
      campaign: String(wlRow.campaign),
      note: String(wlRow.note),
      createdAt: String(wlRow.created_at),
    }));
  }

  listDripOutboxByWaitlistId(waitlistId: string): DripDraftRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM gtm_drip_outbox WHERE waitlist_id = ? ORDER BY scheduled_at ASC, step_code ASC`,
      )
      .all(waitlistId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapDripRow(r));
  }

  listDripOutbox(product?: string): DripDraftRecord[] {
    let sql = `SELECT * FROM gtm_drip_outbox`;
    const params: string[] = [];
    if (product && product.trim()) {
      sql += ` WHERE product = ?`;
      params.push(product.trim());
    }
    sql += ` ORDER BY scheduled_at ASC, drip_id ASC`;
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapDripRow(r));
  }

  private mapDripRow(r: Record<string, unknown>): DripDraftRecord {
    return {
      dripId: String(r.drip_id),
      waitlistId: String(r.waitlist_id),
      product: String(r.product),
      customerId: String(r.customer_id),
      emailHash: String(r.email_hash),
      emailMasked: String(r.email_masked),
      stepCode: String(r.step_code) as "D0_WELCOME" | "D3_TIPS",
      scheduledAt: String(r.scheduled_at),
      subject: String(r.subject),
      bodyMarkdown: String(r.body_markdown),
      status: String(r.status) as "queued" | "sent" | "cancelled",
      createdAt: String(r.created_at),
    };
  }

  listCampaigns(product?: string): CampaignRecord[] {
    let sql = `SELECT * FROM gtm_campaigns`;
    const params: string[] = [];
    if (product && product.trim()) {
      sql += ` WHERE product = ? OR slug = ?`;
      params.push(product.trim(), product.trim());
    }
    sql += ` ORDER BY created_at DESC, campaign_id DESC`;
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      campaignId: String(r.campaign_id),
      product: String(r.product),
      slug: String(r.slug),
      campaign: String(r.campaign),
      title: String(r.title),
      baseUrl: String(r.base_url),
      channels: JSON.parse(String(r.channels_json)) as RepurposeChannelsMap,
      cosePublishBundle: JSON.parse(String(r.cose_bundle_json)) as CosePublishBundle,
      createdAt: String(r.created_at),
    }));
  }

  summary(product?: string): GtmSummary {
    const acquisitions = this.listAcquisitions(product);
    const waitlist = this.listWaitlist(product);
    const campaigns = this.listCampaigns(product);
    const drips = this.listDripOutbox(product);

    const uniqueCustomerSet = new Set<string>();
    const byChannel: Record<string, number> = {};
    const byProduct: Record<
      string,
      { acquisitions: number; waitlist: number; campaigns: number }
    > = {};

    const ensureProduct = (prod: string) => {
      if (!byProduct[prod]) {
        byProduct[prod] = { acquisitions: 0, waitlist: 0, campaigns: 0 };
      }
      return byProduct[prod];
    };

    let syncedToOpcOs = 0;
    for (const acq of acquisitions) {
      uniqueCustomerSet.add(acq.customerId);
      byChannel[acq.channel] = (byChannel[acq.channel] || 0) + 1;
      ensureProduct(acq.product).acquisitions += 1;
      if (acq.opcOsSyncedAt) {
        syncedToOpcOs += 1;
      }
    }

    for (const wl of waitlist) {
      uniqueCustomerSet.add(wl.customerId);
      ensureProduct(wl.product).waitlist += 1;
    }

    for (const camp of campaigns) {
      ensureProduct(camp.product).campaigns += 1;
    }

    let queued = 0;
    let sent = 0;
    for (const d of drips) {
      if (d.status === "queued") queued += 1;
      if (d.status === "sent") sent += 1;
    }

    return {
      totalAcquisitions: acquisitions.length,
      uniqueCustomers: uniqueCustomerSet.size,
      totalWaitlist: waitlist.length,
      totalCampaigns: campaigns.length,
      syncedToOpcOs,
      dripOutbox: {
        queued,
        sent,
        total: drips.length,
      },
      byChannel,
      byProduct,
    };
  }

  close(): void {
    this.db.close();
  }
}

let defaultStoreInstance: GtmStore | null = null;
let defaultStorePath: string | null = null;

export function createGtmStore(options?: GtmStoreOptions): GtmStore {
  return new GtmStore(options);
}

export function getDefaultStore(): GtmStore {
  const desiredPath =
    process.env.GTM_DB_PATH || resolve(process.cwd(), "data/gtm.db");
  if (!defaultStoreInstance || defaultStorePath !== desiredPath) {
    defaultStoreInstance = new GtmStore({ dbPath: desiredPath });
    defaultStorePath = desiredPath;
  }
  return defaultStoreInstance;
}

export async function recordAcquisition(
  input: AcquisitionInput,
  options?: {
    store?: GtmStore;
    autoSyncOpcOs?: boolean;
    opcOsConfig?: OpcOsSyncConfig;
  },
): Promise<RecordAcquisitionResult> {
  const store = options?.store ?? getDefaultStore();
  return store.recordAcquisition(input, {
    autoSyncOpcOs: options?.autoSyncOpcOs,
    opcOsConfig: options?.opcOsConfig,
  });
}

export async function joinWaitlist(
  input: WaitlistInput,
  options?: {
    store?: GtmStore;
    privacyMaskEmail?: boolean;
    autoSyncOpcOs?: boolean;
    opcOsConfig?: OpcOsSyncConfig;
  },
): Promise<JoinWaitlistResult> {
  const store = options?.store ?? getDefaultStore();
  return store.joinWaitlist(input, {
    privacyMaskEmail: options?.privacyMaskEmail,
    autoSyncOpcOs: options?.autoSyncOpcOs,
    opcOsConfig: options?.opcOsConfig,
  });
}
