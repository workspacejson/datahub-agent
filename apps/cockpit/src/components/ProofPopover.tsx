import { useCallback, useRef, useState } from "react";
import { Fingerprint } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";

import { Icon } from "./Icon";
import { IDENTIFIER_TYPE_LABEL } from "../model/identifier-types";
import type { IdentifierType } from "../model/identifier-types";
import { useCopyFeedback } from "../hooks/use-copy-feedback";
import { useCloseWhenTriggerLeavesViewport } from "../hooks/use-close-when-trigger-leaves-viewport";

export interface ProofPopoverProps {
  label: string;
  value: string;
  identifierType: IdentifierType;
  copyLabel?: string;
  openUrl?: string;
  icon?: LucideIcon;
  iconStrokeWidth?: number;
}

export function ProofPopover({
  label,
  value,
  identifierType,
  copyLabel = "Copy",
  openUrl,
  icon = Fingerprint,
  iconStrokeWidth = 1.5,
}: ProofPopoverProps) {
  const { copyStatus, copy } = useCopyFeedback(value, copyLabel);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useCloseWhenTriggerLeavesViewport(triggerRef, open, close);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button ref={triggerRef} className="proof-popover__trigger" type="button">
          <Icon icon={icon} strokeWidth={iconStrokeWidth} className="semantic-icon" />
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
