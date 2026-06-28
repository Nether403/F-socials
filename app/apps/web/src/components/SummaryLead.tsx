import type { JSX } from 'react';
import type { AnalysisReport } from '../api/types';
import { topFramingSignal, severityTagCls } from './reportView';

// Summary_Lead: rendered expanded above every disclosure drawer, before any interaction.
// Lens, not judge — it re-presents the TLDR and the single most-important framing signal the
// report already carries; it issues no verdict and rates no creator. It reads `report` immutably.
//
// Honest absence (Req 1.6–1.8): the TLDR portion shows only for a non-whitespace TLDR; the
// signal portion shows only when a framing signal exists; when neither applies it states plainly
// that no summary is available rather than implying a judgment.
export function SummaryLead({ report }: { report: AnalysisReport }): JSX.Element {
  const tldr = report.tldr?.trim() ? report.tldr : undefined;
  const top = topFramingSignal(report.framingSignals);

  return (
    <div className="card summary-lead">
      {tldr && (
        <div>
          <div className="section-label">Summary</div>
          <p className="tldr">{tldr}</p>
        </div>
      )}

      {top && (
        <div className="top-signal">
          {/* Adjacent text label carries the "most important" meaning so the amber underline
              below is never the sole signal of emphasis (color-never-alone, Req 1.4, 7.1). */}
          <div className="section-label">Most important framing signal</div>
          <div className="row">
            <h4 className="mis-underline">{top.technique}</h4>
            <span className={`tag ${severityTagCls(top.severity)}`}>{top.severity} severity</span>
          </div>
          <p>{top.description}</p>
        </div>
      )}

      {!tldr && !top && <p className="tldr">No summary available for this analysis.</p>}
    </div>
  );
}
