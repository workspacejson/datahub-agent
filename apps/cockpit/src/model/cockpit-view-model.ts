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

export const cockpitViewModelSchema = z.object({
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

export type CockpitViewModel = z.infer<typeof cockpitViewModelSchema>;
export type CockpitRoute = z.infer<typeof cockpitRouteSchema>;
export type SourceMode = z.infer<typeof sourceModeSchema>;

export const sourceEventSchema = cockpitViewModelSchema.omit({ sourceMode: true });
export type SourceEvent = z.infer<typeof sourceEventSchema>;
