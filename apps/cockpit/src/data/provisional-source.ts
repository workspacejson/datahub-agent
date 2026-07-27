/**
 * The only module permitted to contain invented values. It is deliberately
 * boring: downstream views receive the normalized model, never this fixture.
 */
export const provisionalSource = {
  source: "Joined",
  route: "impact",
  state: "partial",
  title: "<catalogued asset>",
  summary: "<evidence binding pending>",
  unresolvedItems: ["<unresolved item>"]
} as const;
