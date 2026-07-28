import type { CockpitViewModel } from "../model/cockpit-view-model";
import { SourceTag } from "./SourceTag";
export function ChangePlanView({ model }: { model: CockpitViewModel }) { return <section aria-label="Plan comparison"><div className="comparison"><p><b>DataHub-only</b> catalogue and lineage context.</p><p><b>Joined</b> repository evidence after safe resolution.</p></div><h2>Changed plan</h2><ul>{model.planDeltas.map((delta) => <li key={`${delta.kind}-${delta.label}`}><b>{delta.kind}</b>: {delta.label} — {delta.reason} <SourceTag source={delta.source} /></li>)}</ul></section>; }
