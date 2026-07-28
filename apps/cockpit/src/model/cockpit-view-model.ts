import { z } from "zod";

export const sourceSchema = z.enum(["DataHub", "workspace.json", "Joined", "unavailable"]);
export const readSchema = z.enum(["ok", "failed", "not-queried"]);
export const completenessSchema = z.enum(["complete-against-pinned-manifest", "not-established"]);
export const resolutionDispositionSchema = z.enum(["resolved", "partial", "mismatch", "unavailable"]);
export const mutationAcceptanceSchema = z.enum(["not-attempted", "accepted", "rejected"]);
export const intendedStateObservationSchema = z.enum(["not-attempted", "observed", "not-observed"]);
export const terminalWritebackDispositionSchema = z.enum(["not-applicable", "success", "accepted-not-observed", "failed"]);
export const sourceModeSchema = z.enum(["placeholder", "fixture", "live"]);
export const cockpitRouteSchema = z.enum(["impact", "change-plan", "receipts"]);
export const claimSourceSchema = z.enum(["DataHub", "workspace.json", "Joined"]);
export const sourceClaimSchema = z.object({ text: z.string().min(1), source: claimSourceSchema });
export const impactEdgeSchema = z.object({ label: z.string().min(1), state: z.enum(["resolved", "unresolved", "excluded"]), reason: z.string().min(1), source: sourceSchema });
export const planDeltaSchema = z.object({ kind: z.enum(["added", "removed", "reordered", "constrained", "uncertainty-changed"]), label: z.string().min(1), reason: z.string().min(1), source: claimSourceSchema });
export const cockpitStateNameSchema = z.enum([
  "loading", "unavailable", "partial", "contradictory", "error", "accepted-not-observed", "success",
]);

const cockpitViewModelBaseSchema = z.object({
  sourceMode: sourceModeSchema,
  route: cockpitRouteSchema,
  source: sourceSchema,
  read: readSchema,
  completeness: completenessSchema,
  resolutionDisposition: resolutionDispositionSchema,
  mutationAcceptance: mutationAcceptanceSchema,
  intendedStateObservation: intendedStateObservationSchema,
  terminalWritebackDisposition: terminalWritebackDispositionSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  unresolvedItems: z.array(z.string()),
  datasetIdentity: sourceClaimSchema,
  producerPath: sourceClaimSchema,
  repositoryEvidence: sourceClaimSchema,
  /**
   * Null when the catalog exposes no commit-pinned URL for the producing file.
   *
   * This was required, and requiring it was a mistake: `externalUrl` is dropped
   * at the official MCP boundary (`evaluation/mcp-field-coverage.md`), so an
   * MCP-honest read path cannot always produce one. A required URL leaves a
   * projection two options, and both are worse than admitting absence —
   * fabricate a link, or refuse to render an event that is otherwise sound.
   */
  immutableViewSourceUrl: z.string().url().nullable(),
  impactEdges: z.array(impactEdgeSchema),
  planDeltas: z.array(planDeltaSchema),
});

export const cockpitViewModelSchema = cockpitViewModelBaseSchema.superRefine((model, context) => {
  if (model.completeness === "complete-against-pinned-manifest" && model.read !== "ok") {
    context.addIssue({ code: "custom", path: ["completeness"], message: "Completeness requires a successful read." });
  }
  if (model.source === "unavailable" && model.read === "ok") {
    context.addIssue({ code: "custom", path: ["read"], message: "An unavailable source cannot report a successful read." });
  }
  if (model.read === "failed" && model.resolutionDisposition === "resolved") {
    context.addIssue({ code: "custom", path: ["resolutionDisposition"], message: "A failed read cannot resolve a source." });
  }
  if (model.resolutionDisposition === "resolved" && model.source === "unavailable") {
    context.addIssue({ code: "custom", path: ["source"], message: "An unavailable source cannot be resolved." });
  }
  if (model.terminalWritebackDisposition === "success" &&
      (model.mutationAcceptance !== "accepted" || model.intendedStateObservation !== "observed")) {
    context.addIssue({ code: "custom", path: ["terminalWritebackDisposition"], message: "Success requires accepted and observed intent." });
  }
  if (model.terminalWritebackDisposition === "accepted-not-observed" &&
      (model.mutationAcceptance !== "accepted" || model.intendedStateObservation !== "not-observed")) {
    context.addIssue({ code: "custom", path: ["terminalWritebackDisposition"], message: "Accepted-not-observed requires accepted but unobserved intent." });
  }
});

export type CockpitViewModel = z.infer<typeof cockpitViewModelSchema>;
export type CockpitRoute = z.infer<typeof cockpitRouteSchema>;
export type SourceMode = z.infer<typeof sourceModeSchema>;
export type CockpitStateName = z.infer<typeof cockpitStateNameSchema>;

export const sourceEventSchema = cockpitViewModelBaseSchema.omit({ sourceMode: true });
export type SourceEvent = z.infer<typeof sourceEventSchema>;
