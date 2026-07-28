import type { CockpitViewModel } from "../model/cockpit-view-model";
export function SourceTag({ source }: { source: CockpitViewModel["datasetIdentity"]["source"] }) { return <span className="source-tag">{source}</span>; }
