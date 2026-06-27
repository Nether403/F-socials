import type { AnalysisReport, ReportStatus, SourceType } from './types';

const API = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

export interface SubmitInput {
  sourceType: SourceType;
  url?: string;
  transcript?: string;
}

// Decide what kind of input the user pasted.
export function detectInput(raw: string): SubmitInput {
  const t = raw.trim();
  if (/^https?:\/\//i.test(t)) {
    if (/youtube\.com|youtu\.be/i.test(t)) return { sourceType: 'youtube', url: t };
    return { sourceType: 'article', url: t };
  }
  return { sourceType: 'transcript', transcript: t };
}

export interface SubmitResult {
  reportId: string;
  status: ReportStatus;
  cached: boolean;
}

export async function submitAnalysis(input: SubmitInput): Promise<SubmitResult> {
  const res = await fetch(`${API}/api/v1/analyses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? 'Rate limit reached. Try again later.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export async function getReport(id: string): Promise<AnalysisReport> {
  const res = await fetch(`${API}/api/v1/analyses/${id}`);
  if (!res.ok) throw new Error(`Could not load report (${res.status})`);
  return res.json();
}

export async function getReportBySlug(slug: string): Promise<AnalysisReport> {
  const res = await fetch(`${API}/api/v1/r/${slug}`);
  if (res.status === 404) throw new Error('This shared report could not be found.');
  if (!res.ok) throw new Error(`Could not load shared report (${res.status})`);
  return res.json();
}

const TERMINAL: ReportStatus[] = ['ready', 'failed', 'needs_review'];

// Poll until the report reaches a terminal status (or timeout).
export async function pollReport(
  id: string,
  onTick?: (status: ReportStatus) => void,
  opts: { intervalMs?: number; maxTries?: number } = {},
): Promise<AnalysisReport> {
  const intervalMs = opts.intervalMs ?? 1500;
  const maxTries = opts.maxTries ?? 40;
  for (let i = 0; i < maxTries; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const report = await getReport(id);
    onTick?.(report.status);
    if (TERMINAL.includes(report.status)) return report;
  }
  throw new Error('Analysis timed out. Please try again.');
}
