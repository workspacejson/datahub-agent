import { IDENTIFIER_TYPE_LABEL } from "../model/identifier-types";
import type { IdentifierType } from "../model/identifier-types";
import { useCopyFeedback } from "../hooks/use-copy-feedback";

export interface ProofIndicatorProps {
  /** Which visual variant: inline for hero/parity strip, block for receipt tables. */
  variant: "compact" | "block";
  /** The meaning-first label a reader sees first. */
  label: string;
  /** The canonical identifier value, revealed on demand. */
  value: string;
  /** The type of identifier, shown as a tag in the expanded panel. */
  identifierType: IdentifierType;
  /** Custom copy button text (e.g. "Copy SHA" vs "Copy URN"). */
  copyLabel?: string;
  /** A real, constructable URL. Only present when one genuinely exists. */
  openUrl?: string;
}

/**
 * Meaning-first, proof-on-demand.
 *
 * The semantic label is always visible. The canonical identifier, its type,
 * and copy/open actions are one interaction away — behind a native
 * details/summary element, not a tooltip. This is consistent with the existing
 * disclosure pattern in `ImpactView` and `ReceiptsView`, and follows the
 * design rule that load-bearing information is never tucked behind a tooltip.
 *
 * No animation on expansion. Layout-changing animation across tables, parity
 * strips and hero rows would make the interface feel less stable, not more.
 *
 * No nested details. Inside existing disclosures, render a proof row, not
 * another expandable.
 */
export function ProofIndicator({
  variant,
  label,
  value,
  identifierType,
  copyLabel = "Copy",
  openUrl,
}: ProofIndicatorProps) {
  const { copyStatus, copy } = useCopyFeedback(value, copyLabel);

  return (
    <details className={`proof-indicator proof-indicator--${variant}`}>
      <summary className="proof-indicator__summary">
        <span className="proof-indicator__label">{label}</span>
      </summary>
      <div className="proof-indicator__panel">
        <span className="proof-indicator__type">{IDENTIFIER_TYPE_LABEL[identifierType]}</span>
        <code className="proof-indicator__value mono">{value}</code>
        <div className="proof-indicator__actions">
          <button className="proof-indicator__copy" type="button" onClick={copy}>{copyLabel}</button>
          {openUrl && (
            <a className="proof-indicator__open" href={openUrl} target="_blank" rel="noreferrer">Open</a>
          )}
          {copyStatus && <span className="proof-indicator__status" role="status">{copyStatus}</span>}
        </div>
      </div>
    </details>
  );
}
