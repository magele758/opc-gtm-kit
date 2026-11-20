import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DISTRIBUTIONS = [
  "chrome_extension",
  "macos_and_web",
  "self_hosted_pro",
  "web_saas",
  "cli_and_sdk",
] as const;

export type DistributionType = (typeof DISTRIBUTIONS)[number];

export const LICENSE_MODELS = [
  "freemium_offline_key",
  "open_core_byok",
  "open_core",
  "commercial_subscription",
  "mit_free",
] as const;

export type LicenseModel = (typeof LICENSE_MODELS)[number];

export const REPO_ROLES = [
  "flagship_paid",
  "open_core",
  "lead_magnet",
  "internal_infra",
] as const;

export type RepoRole = (typeof REPO_ROLES)[number];

export const BILLING_PERIODS = [
  "forever",
  "one_time",
  "monthly",
  "yearly",
] as const;

export type BillingPeriod = (typeof BILLING_PERIODS)[number];

export interface WorkflowStep {
  step: number;
  badge: string;
  title: string;
  description: string;
}

export interface PricingTier {
  id: string;
  name: string;
  priceUsd: number;
  priceLabel: string;
  billingPeriod: BillingPeriod;
  offlineKeyEd25519: boolean;
  highlighted: boolean;
  ctaLabel: string;
  features: string[];
}

export interface ProductPricing {
  currency: string;
  tiers: PricingTier[];
}

export interface PrivacyPledge {
  headline: string;
  points: string[];
}

export interface ProductLinks {
  homeUrl: string;
  githubUrl: string;
  docsUrl: string;
  changelogUrl: string;
}

export interface ProductManifest {
  product: string;
  slug: string;
  displayName: string;
  tagline: string;
  painPoint: string;
  outcome: string;
  distribution: DistributionType;
  licenseModel: LicenseModel;
  repoRole: RepoRole;
  spdx: string;
  activationAction: string;
  permissions: string[];
  permissionJustifications: Record<string, string>;
  byok: boolean;
  localFirst: boolean;
  highlights: string[];
  workflowSteps: WorkflowStep[];
  pricing: ProductPricing;
  privacyPledge: PrivacyPledge;
  links: ProductLinks;
}

export interface LeadMagnetConfig {
  slug: string;
  name: string;
  tagline: string;
  repoRole: RepoRole;
  spdx: string;
  siteUrl: string;
  repoUrl: string;
  targetProductSlug: string;
  utmCampaign: string;
  hookText: string;
}

export interface RepoLicenseInput {
  repo: string;
  role: RepoRole;
  spdx: string;
  dependencyLicenses?: string[];
}

const DEFAULT_MANIFESTS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../manifests",
);

const BUILTIN_ORDER = [
  "pagelens-interpret",
  "pagelens-agent",
  "audiobook",
  "hyper-vibekanban",
] as const;

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function asString(val: unknown, field: string): string {
  if (typeof val !== "string" || val.trim().length === 0) {
    throw new Error(`Invalid manifest field "${field}": expected non-empty string`);
  }
  return val;
}

export function validateManifest(raw: unknown): ProductManifest {
  if (!isRecord(raw)) {
    throw new Error("Invalid product manifest: expected JSON object");
  }

  const product = asString(raw.product, "product");
  const slug = asString(raw.slug, "slug");
  const tagline = asString(raw.tagline, "tagline");
  const displayName =
    typeof raw.displayName === "string" && raw.displayName.trim().length > 0
      ? raw.displayName
      : product;
  const painPoint =
    typeof raw.painPoint === "string" && raw.painPoint.trim().length > 0
      ? raw.painPoint
      : tagline;
  const outcome =
    typeof raw.outcome === "string" && raw.outcome.trim().length > 0
      ? raw.outcome
      : tagline;

  const distribution = asString(raw.distribution, "distribution") as DistributionType;
  if (!DISTRIBUTIONS.includes(distribution)) {
    throw new Error(`Unsupported distribution "${distribution}" in manifest "${slug}"`);
  }

  const licenseModel = asString(raw.licenseModel, "licenseModel") as LicenseModel;
  if (!LICENSE_MODELS.includes(licenseModel)) {
    throw new Error(`Unsupported licenseModel "${licenseModel}" in manifest "${slug}"`);
  }

  const repoRoleRaw = typeof raw.repoRole === "string" ? raw.repoRole : "flagship_paid";
  const repoRole = (REPO_ROLES.includes(repoRoleRaw as RepoRole)
    ? repoRoleRaw
    : "flagship_paid") as RepoRole;

  const spdx = typeof raw.spdx === "string" && raw.spdx.length > 0 ? raw.spdx : "MIT";
  const activationAction = asString(raw.activationAction, "activationAction");

  const permissions = Array.isArray(raw.permissions)
    ? raw.permissions.filter((p): p is string => typeof p === "string")
    : [];

  const permissionJustifications: Record<string, string> = {};
  if (isRecord(raw.permissionJustifications)) {
    for (const [k, v] of Object.entries(raw.permissionJustifications)) {
      if (typeof v === "string") {
        permissionJustifications[k] = v;
      }
    }
  }

  const highlights = Array.isArray(raw.highlights)
    ? raw.highlights.filter((h): h is string => typeof h === "string")
    : [tagline];

  const workflowSteps: WorkflowStep[] = Array.isArray(raw.workflowSteps)
    ? raw.workflowSteps
        .filter(isRecord)
        .map((step, idx) => ({
          step: typeof step.step === "number" ? step.step : idx + 1,
          badge: typeof step.badge === "string" ? step.badge : `0${idx + 1}`,
          title: asString(step.title, `workflowSteps[${idx}].title`),
          description: asString(step.description, `workflowSteps[${idx}].description`),
        }))
    : [];

  if (!isRecord(raw.pricing) || !Array.isArray(raw.pricing.tiers) || raw.pricing.tiers.length === 0) {
    throw new Error(`Manifest "${slug}" must define pricing.tiers`);
  }

  const pricing: ProductPricing = {
    currency: typeof raw.pricing.currency === "string" ? raw.pricing.currency : "USD",
    tiers: raw.pricing.tiers.filter(isRecord).map((tier, idx) => ({
      id: asString(tier.id, `pricing.tiers[${idx}].id`),
      name: asString(tier.name, `pricing.tiers[${idx}].name`),
      priceUsd: typeof tier.priceUsd === "number" ? tier.priceUsd : 0,
      priceLabel: asString(tier.priceLabel, `pricing.tiers[${idx}].priceLabel`),
      billingPeriod: (typeof tier.billingPeriod === "string" &&
      BILLING_PERIODS.includes(tier.billingPeriod as BillingPeriod)
        ? tier.billingPeriod
        : "one_time") as BillingPeriod,
      offlineKeyEd25519: Boolean(tier.offlineKeyEd25519),
      highlighted: Boolean(tier.highlighted),
      ctaLabel:
        typeof tier.ctaLabel === "string" && tier.ctaLabel.length > 0
          ? tier.ctaLabel
          : `Get ${String(tier.name)}`,
      features: Array.isArray(tier.features)
        ? tier.features.filter((f): f is string => typeof f === "string")
        : [],
    })),
  };

  const privacyPledge: PrivacyPledge = isRecord(raw.privacyPledge)
    ? {
        headline:
          typeof raw.privacyPledge.headline === "string"
            ? raw.privacyPledge.headline
            : "Local-First & Privacy-Respecting Architecture",
        points: Array.isArray(raw.privacyPledge.points)
          ? raw.privacyPledge.points.filter((p): p is string => typeof p === "string")
          : [],
      }
    : {
        headline: "Local-First & Privacy-Respecting Architecture",
        points: [],
      };

  const baseSite = process.env.OPC_SITE_URL || "https://opc.example.com";
  const rawLinks = isRecord(raw.links) ? raw.links : {};
  const links: ProductLinks = {
    homeUrl:
      typeof rawLinks.homeUrl === "string" ? rawLinks.homeUrl : `${baseSite}/${slug}`,
    githubUrl:
      typeof rawLinks.githubUrl === "string"
        ? rawLinks.githubUrl
        : `https://github.com/opc-example/${slug}`,
    docsUrl:
      typeof rawLinks.docsUrl === "string" ? rawLinks.docsUrl : `${baseSite}/${slug}/docs`,
    changelogUrl:
      typeof rawLinks.changelogUrl === "string"
        ? rawLinks.changelogUrl
        : `${baseSite}/${slug}/changelog`,
  };

  return {
    product,
    slug,
    displayName,
    tagline,
    painPoint,
    outcome,
    distribution,
    licenseModel,
    repoRole,
    spdx,
    activationAction,
    permissions,
    permissionJustifications,
    byok: Boolean(raw.byok),
    localFirst: raw.localFirst === undefined ? true : Boolean(raw.localFirst),
    highlights,
    workflowSteps,
    pricing,
    privacyPledge,
    links,
  };
}

export function loadProductManifests(manifestsDir: string = DEFAULT_MANIFESTS_DIR): ProductManifest[] {
  const entries = readdirSync(manifestsDir).filter(
    (name) => name.endsWith(".json") && name !== "lead-magnets.json",
  );

  const manifests = entries.map((filename) => {
    const rawText = readFileSync(join(manifestsDir, filename), "utf8");
    return validateManifest(JSON.parse(rawText));
  });

  manifests.sort((a, b) => {
    const idxA = BUILTIN_ORDER.indexOf(a.slug as (typeof BUILTIN_ORDER)[number]);
    const idxB = BUILTIN_ORDER.indexOf(b.slug as (typeof BUILTIN_ORDER)[number]);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.slug.localeCompare(b.slug);
  });

  return manifests;
}

export function getProductManifest(
  slug: string,
  manifestsDir: string = DEFAULT_MANIFESTS_DIR,
): ProductManifest | undefined {
  return loadProductManifests(manifestsDir).find((m) => m.slug === slug);
}

export function findManifestByProductOrSlug(
  key: string,
  manifestsDir: string = DEFAULT_MANIFESTS_DIR,
): ProductManifest | undefined {
  const lowered = key.trim().toLowerCase();
  const manifests = loadProductManifests(manifestsDir);
  return (
    manifests.find((m) => m.slug.toLowerCase() === lowered) ??
    manifests.find((m) => m.product.toLowerCase() === lowered)
  );
}

export function loadLeadMagnets(manifestsDir: string = DEFAULT_MANIFESTS_DIR): LeadMagnetConfig[] {
  const filePath = join(manifestsDir, "lead-magnets.json");
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error("lead-magnets.json must contain a JSON array");
  }
  return raw.filter(isRecord).map((item, idx) => ({
    slug: asString(item.slug, `leadMagnets[${idx}].slug`),
    name: asString(item.name, `leadMagnets[${idx}].name`),
    tagline: asString(item.tagline, `leadMagnets[${idx}].tagline`),
    repoRole: (typeof item.repoRole === "string" &&
    REPO_ROLES.includes(item.repoRole as RepoRole)
      ? item.repoRole
      : "lead_magnet") as RepoRole,
    spdx: typeof item.spdx === "string" ? item.spdx : "MIT",
    siteUrl: asString(item.siteUrl, `leadMagnets[${idx}].siteUrl`),
    repoUrl: asString(item.repoUrl, `leadMagnets[${idx}].repoUrl`),
    targetProductSlug: asString(item.targetProductSlug, `leadMagnets[${idx}].targetProductSlug`),
    utmCampaign: asString(item.utmCampaign, `leadMagnets[${idx}].utmCampaign`),
    hookText: asString(item.hookText, `leadMagnets[${idx}].hookText`),
  }));
}

export function getLeadMagnet(
  slug: string,
  manifestsDir: string = DEFAULT_MANIFESTS_DIR,
): LeadMagnetConfig | undefined {
  return loadLeadMagnets(manifestsDir).find((lm) => lm.slug === slug);
}

export function getDefaultRepoLicenseMatrix(
  manifestsDir: string = DEFAULT_MANIFESTS_DIR,
): RepoLicenseInput[] {
  const products = loadProductManifests(manifestsDir).map((m) => ({
    repo: m.slug,
    role: m.repoRole,
    spdx: m.spdx,
    dependencyLicenses: ["MIT", "Apache-2.0", "ISC"],
  }));
  const leadMagnets = loadLeadMagnets(manifestsDir).map((lm) => ({
    repo: lm.slug,
    role: lm.repoRole,
    spdx: lm.spdx,
    dependencyLicenses: ["MIT"],
  }));
  return [
    ...products,
    ...leadMagnets,
    {
      repo: "opc-gtm-kit",
      role: "internal_infra",
      spdx: "MIT",
      dependencyLicenses: [],
    },
  ];
}
