import { Fingerprint } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";

import { Icon } from "./Icon";
import { IDENTIFIER_TYPE_LABEL } from "../model/identifier-types";
import type { IdentifierType } from "../model/identifier-types";
import { useCopyFeedback } from "../hooks/use-copy-feedback";

export interface ProofPopoverProps {
  label: string;
  value: string;
  identifierType: IdentifierType;
  copyLabel?: string;
  openUrl?: string;
}

export function ProofPopover({
  label,
  value,
  identifierType,
  copyLabel = "Copy",
  openUrl,
}: ProofPopoverProps) {
  const { copyStatus, copy } = useCopyFeedback(value, copyLabel);

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="proof-popover__trigger" type="button">
          <Icon icon={Fingerprint} className="semantic-icon" />
          <span>{label}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="proof-popover__panel"
          collisionPadding={8}
          align="start"
          sideOffset={4}
          aria-label={label}
        >
          <Popover.Arrow className="proof-popover__arrow" />
          <span className="proof-popover__type">{IDENTIFIER_TYPE_LABEL[identifierType]}</span>
          <code className="proof-popover__value mono">{value}</code>
          <div className="proof-popover__actions">
            <button className="proof-popover__copy" type="button" onClick={copy}>{copyLabel}</button>
            {openUrl && (
              <a className="proof-popover__open" href={openUrl} target="_blank" rel="noreferrer">Open</a>
            )}
            {copyStatus && <span className="proof-popover__status" role="status">{copyStatus}</span>}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
