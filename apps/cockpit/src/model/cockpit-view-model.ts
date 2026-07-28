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
});

export const cockpitViewModelSchema = cockpitViewModelBaseSchema.superRefine((model, context) => {
  if (model.completeness === "complete-against-pinned-manifest" && model.read !== "ok") {
    context.addIssue({ code: "custom", path: ["completeness"], message: "Completeness requires a successful read." });
  }
  if (model.source === "unavailable" && model.read === "ok") {
    context.addIssue({ code: "custom", path: ["read"], message: "An unavailable source cannot report a successful read." });
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
