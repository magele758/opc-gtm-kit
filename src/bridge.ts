import {
  getDefaultStore,
  type AcquisitionRecord,
  type GtmStore,
} from "./growth.ts";

export const TRACE_COLUMNS = [
  "trace_id",
  "event_name",
  "event_time",
  "product",
  "user_id",
  "session_id",
  "channel",
  "campaign",
  "source",
  "medium",
  "landing_path",
  "referrer",
  "plan_tier",
  "revenue_usd",
  "currency",
  "status",
  "metadata_json",
] as const;

export type TraceColumn = (typeof TRACE_COLUMNS)[number];
export type TraceEventName = "acquired" | "waitlist_joined";

export interface TraceRow {
  trace_id: string;
  event_name: TraceEventName;
  event_time: string;
  product: string;
  user_id: string;
  session_id: string;
  channel: string;
  campaign: string;
  source: string;
  medium: string;
  landing_path: string;
  referrer: string;
  plan_tier: string;
  revenue_usd: number;
  currency: string;
  status: string;
  metadata_json: string;
}

export interface OpcOsSyncConfig {
  opcOsUrl: string;
  opcOsToken: string;
  fetchImpl?: typeof fetch;
}

export interface OpcOsSyncResult {
  ok: boolean;
  status: number;
  eventId: string;
  endpoint: string;
  responseBody: unknown;
}

export interface BatchOpcOsSyncResult {
  ok: boolean;
  attemptedCount: number;
  syncedCount: number;
  results: OpcOsSyncResult[];
}

export interface DataAnalysisSyncConfig {
  dataAnalysisUrl: string;
  dataAnalysisToken?: string;
  product?: string;
  store?: GtmStore;
  fetchImpl?: typeof fetch;
}

export interface DataAnalysisSyncResult {
  ok: boolean;
  status: number;
  endpoint: string;
  exportedCount: number;
  columns: readonly TraceColumn[];
  responseBody: unknown;
}

function trimTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export async function syncAcquisitionToOpcOs(
  acq: Pick<
    AcquisitionRecord,
    "product" | "customerId" | "eventId" | "channel" | "at" | "reference"
  >,
  config: OpcOsSyncConfig,
): Promise<OpcOsSyncResult> {
  const endpoint = `${trimTrailingSlash(config.opcOsUrl)}/api/zoom/growth/events`;
  const fetchFn = config.fetchImpl ?? globalThis.fetch;

  const payload = {
    product: acq.product,
    customerId: acq.customerId,
    eventId: acq.eventId,
    kind: "acquired" as const,
    channel: acq.channel,
    at: acq.at,
    reference: acq.reference,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.opcOsToken}`,
  };

  const res = await fetchFn(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  let responseBody: unknown = null;
  const text = await res.text();
  if (text.length > 0) {
    try {
      responseBody = JSON.parse(text);
    } catch {
      responseBody = text;
    }
  }

  return {
    ok: res.ok,
    status: res.status,
    eventId: acq.eventId,
    endpoint,
    responseBody,
  };
}

export async function syncPendingAcquisitionsToOpcOs(
  store: GtmStore,
  config: OpcOsSyncConfig,
  product?: string,
): Promise<BatchOpcOsSyncResult> {
  const pending = store.listAcquisitions(product, true);
  const results: OpcOsSyncResult[] = [];
  let syncedCount = 0;

  for (const acq of pending) {
    const syncRes = await syncAcquisitionToOpcOs(acq, config);
    if (syncRes.ok) {
      store.markAcquisitionSynced(acq.eventId);
      syncedCount += 1;
    }
    results.push(syncRes);
  }

  return {
    ok: results.every((r) => r.ok),
    attemptedCount: pending.length,
    syncedCount,
    results,
  };
}

export function exportTraces(
  product?: string,
  options?: { store?: GtmStore },
): TraceRow[] {
  const store = options?.store ?? getDefaultStore();
  const acquisitions = store.listAcquisitions(product);
  const waitlistRows = store.listWaitlist(product);

  const rows: TraceRow[] = [];

  for (const acq of acquisitions) {
    const medium =
      acq.channel === "lead_magnet"
        ? "banner"
        : acq.channel === "direct"
          ? "none"
          : "utm";

    rows.push({
      trace_id: acq.eventId,
      event_name: "acquired",
      event_time: acq.at,
      product: acq.product,
      user_id: acq.customerId,
      session_id: `sess_${acq.eventId}`,
      channel: acq.channel,
      campaign: acq.campaign,
      source: acq.rawSource,
      medium,
      landing_path: acq.landingPath,
      referrer: acq.reference,
      plan_tier: "free",
      revenue_usd: 0,
      currency: "USD",
      status: "ok",
      metadata_json: JSON.stringify({
        service: "opc-gtm-kit",
        opc_os_synced: Boolean(acq.opcOsSyncedAt),
      }),
    });
  }

  for (const wl of waitlistRows) {
    rows.push({
      trace_id: `trace_${wl.waitlistId}`,
      event_name: "waitlist_joined",
      event_time: wl.createdAt,
      product: wl.product,
      user_id: wl.customerId,
      session_id: `sess_${wl.waitlistId}`,
      channel: wl.channel,
      campaign: wl.campaign,
      source: wl.channel,
      medium: "waitlist_form",
      landing_path: `/waitlist/${wl.product.toLowerCase()}`,
      referrer: `waitlist:${wl.waitlistId}`,
      plan_tier: "free",
      revenue_usd: 0,
      currency: "USD",
      status: "ok",
      metadata_json: JSON.stringify({
        service: "opc-gtm-kit",
        email_hash: wl.emailHash,
        email_masked: wl.emailMasked,
        has_note: wl.note.length > 0,
      }),
    });
  }

  rows.sort((a, b) => a.event_time.localeCompare(b.event_time));
  return rows;
}

export async function syncTracesToDataAnalysis(
  tracesOrConfig: TraceRow[] | DataAnalysisSyncConfig,
  maybeConfig?: DataAnalysisSyncConfig,
): Promise<DataAnalysisSyncResult> {
  let traces: TraceRow[];
  let config: DataAnalysisSyncConfig;

  if (Array.isArray(tracesOrConfig)) {
    if (!maybeConfig || !maybeConfig.dataAnalysisUrl) {
      throw new Error(
        "syncTracesToDataAnalysis(traces, config) requires config.dataAnalysisUrl",
      );
    }
    traces = tracesOrConfig;
    config = maybeConfig;
  } else {
    config = tracesOrConfig;
    traces = exportTraces(config.product, { store: config.store });
  }

  const endpoint = `${trimTrailingSlash(config.dataAnalysisUrl)}/api/v1/import/traces`;
  const fetchFn = config.fetchImpl ?? globalThis.fetch;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.dataAnalysisToken && config.dataAnalysisToken.trim().length > 0) {
    headers.Authorization = `Bearer ${config.dataAnalysisToken.trim()}`;
  }

  const canonicalRecords = traces.map((t) => {
    const ts = Date.parse(t.event_time);
    return {
      event_id: t.trace_id,
      trace_id: t.trace_id,
      span_id: t.trace_id.slice(0, 32),
      parent_span_id: null,
      session_id: t.session_id,
      user_id: t.user_id,
      event_type: "gtm",
      event_name: t.event_name,
      service_name: t.product,
      page_path: t.landing_path,
      page_url: t.referrer,
      page_title: t.product,
      status_code: "200",
      duration_ms: 0,
      created_at: t.event_time,
      timestamp_ms: Number.isFinite(ts) ? ts : Date.now(),
      properties: t.metadata_json,
    };
  });

  const payload = {
    session_id: "opc_commercial",
    dataset_name: "opc_gtm_traces",
    records: canonicalRecords,
    columns: [...TRACE_COLUMNS],
    traces,
    rows: traces,
  };

  const res = await fetchFn(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  let responseBody: unknown = null;
  const text = await res.text();
  if (text.length > 0) {
    try {
      responseBody = JSON.parse(text);
    } catch {
      responseBody = text;
    }
  }

  return {
    ok: res.ok,
    status: res.status,
    endpoint,
    exportedCount: traces.length,
    columns: TRACE_COLUMNS,
    responseBody,
  };
}
