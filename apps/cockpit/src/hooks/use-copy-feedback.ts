import { useEffect, useRef, useState } from "react";

/**
 * Clipboard copy with timed feedback, safe against stale timeouts and unmount.
 *
 * Both `ProofIndicator` and `ProofPopover` expose a copy button that writes a
 * canonical identifier to the clipboard and shows a short "Copied" confirmation.
 * The logic — `useState` for the status, `useRef` for the timeout, `useEffect`
 * to clear it on unmount, and the async `copy` function that resets any pending
 * timeout before scheduling a new one — was duplicated between them. A fix in
 * one would not propagate to the other, so it lives here.
 *
 * The status message strips a leading "Copy " from the label so "Copy SHA"
 * reads "Copied SHA" and the bare default "Copy" reads "Copied" with no
 * trailing space.
 */
export function useCopyFeedback(value: string, copyLabel: string) {
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      if (!mountedRef.current) return;
      const suffix = copyLabel === "Copy" ? "" : ` ${copyLabel.replace(/^Copy\s+/, "")}`;
      setCopyStatus(`Copied${suffix}`);
    } catch {
      if (!mountedRef.current) return;
      setCopyStatus("Copy failed");
    }
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopyStatus(null), 2000);
  };

  return { copyStatus, copy };
}
