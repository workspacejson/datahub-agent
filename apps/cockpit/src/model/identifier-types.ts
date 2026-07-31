import type { z } from "zod";
import type { identifierTypeSchema } from "./cockpit-view-model";

export type IdentifierType = z.infer<typeof identifierTypeSchema>;

export const IDENTIFIER_TYPE_LABEL: Record<IdentifierType, string> = {
  "git-commit-sha": "Git commit",
  "event-digest": "Event digest",
  "set-digest": "Set digest",
  "manifest-digest": "Manifest digest",
  "dataset-urn": "Dataset URN",
  "evidence-path": "Evidence location",
  "patch-digest": "Generated artifact digest",
};
