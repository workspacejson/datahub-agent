import { useCallback, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";

import { useCloseWhenTriggerLeavesViewport } from "../hooks/use-close-when-trigger-leaves-viewport";

export interface TermDefinitionProps {
  /** The term as it reads in the sentence. Stays in the running text. */
  term: string;
  /** What the term means. One or two sentences, no markup. */
  definition: string;
}

/**
 * A term a reader may not know, with its definition one interaction away.
 *
 * Sibling of `ProofPopover`, not a reuse of it: that component carries a
 * *canonical identifier* — a typed, copyable value with an optional external
 * link — and its panel is built around `IDENTIFIER_TYPE_LABEL` and a copy
 * action. A definition has no canonical value to copy and no type to label, so
 * it borrows the primitive and the visual language rather than the props.
 *
 * This exists because the alternative was tried and measured. Until 2026-08-02
 * six definitions were inlined as parentheticals in running text and in eyebrow
 * labels. The endorsement pill alone went from 66 to 139 characters, and being
 * `flex: none` it could not shrink: the header overflowed at every viewport from
 * 1024 to 1512, pushing the dataset selector off screen and the next action
 * ~900px below the fold. A definition set in the chrome costs its width on every
 * render, to every reader, including the ones who already knew the word.
 *
 * The trigger keeps the term in its sentence, so the prose still reads for
 * someone who never opens it. That is the property the parentheticals lost: they
 * made the sentence longer for everyone in order to serve the reader who needed
 * one clause of it.
 */
export function TermDefinition({ term, definition }: TermDefinitionProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useCloseWhenTriggerLeavesViewport(triggerRef, open, close);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button ref={triggerRef} className="term-def__trigger" type="button" aria-label={`${term} — what this means`}>
          {term}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="term-def__panel"
          collisionPadding={8}
          align="start"
          sideOffset={4}
          aria-label={`${term} — definition`}
        >
          <Popover.Arrow className="term-def__arrow" />
          <span className="term-def__term">{term}</span>
          <p className="term-def__body">{definition}</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
