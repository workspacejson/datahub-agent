# HAC-231 step-2 probe — dbt unique ID → URN mapping reproducibility

Captured: 2026-07-29T04:05:43Z
Rule source: acryl-datahub 1.6.0.16 — `dbt_core.py:251-261`, `dbt_common.py:1136-1157`
Same pinned version that populated the catalog.

## Direction of evidence

The **rule** is transcribed from DataHub's ingestion source. The **inputs** are
read from the pinned dbt manifest. The catalog is the **comparison target only** —
no expected URN is read out of DataHub. Had the catalog been wrong, this probe
would have disagreed with it rather than agreed.

```
manifest:      /tmp/hac-152-live.5PoLx6/transfermarkt/dbt/target/manifest.json
dbt_version:   1.12.0 / duckdb
project:       transfermarkt_datasets
model nodes:   23
source nodes:  10
derived URNs:  33
catalog (dbt): 33

derived∩catalog: 33
derived only:    0
catalog only:    0


========================================================================
VERDICT: rule regenerates the catalog's URN set for this platform EXACTLY. Mapping is
         deterministic and mechanically reproducible from the manifest.

project:       transfermarkt_datasets
model nodes:   23
source nodes:  10
derived URNs:  33
catalog (duckdb): 33

derived∩catalog: 33
derived only:    0
catalog only:    0


========================================================================
VERDICT: rule regenerates the catalog's URN set for this platform EXACTLY. Mapping is
         deterministic and mechanically reproducible from the manifest.
```

## The rule

```
name     = manifest_node["name"]
         | manifest_node["identifier"]  if use_identifiers and present
         | manifest_node["alias"]       if alias is not None and resource_type != "test"
database = manifest_node["database"]    if include_database_name else None
schema   = manifest_node["schema"]

db_fqn   = [database, schema, name] filtered for truthiness, joined ".", '"' stripped
db_fqn   = db_fqn.lower()  if convert_urns_to_lowercase
urn      = urn:li:dataset:(urn:li:dataPlatform:<target_platform>,<db_fqn>,<env>)
```

23 materialised models + 10 sources = 33 nodes, matching the catalog's 33 dbt and
33 duckdb datasets exactly, in both directions, on both platforms.

## Verdict

**The kill switch does not fire on step 2.** The mapping is a documented,
deterministic rule over `manifest.json` fields, and it mechanically reproduces the
catalog's URN set from the pinned manifest. The expected set for HAC-231 can be
derived independently — it does not need to be read out of DataHub, and must not be.

## Caveat — one branch of the rule is unexercised

`convert_urns_to_lowercase` defaults to **`True`** in config
(`dbt_common.py:557`), while the `DBTNode` dataclass default is `False`
(`dbt_common.py:1129`). This probe ran with `False` and matched exactly — but
**every database, schema and name component in this corpus is already lowercase**
(0 components with uppercase, 0 containing quotes), so the flag is a no-op here
and the probe did not discriminate between the two settings.

What this means:

* For **this corpus**, the mapping is reproducible and the ambiguity is harmless.
* The lowercase branch and the quote-stripping branch are **not proven** by this
  run. Anyone porting this derivation to a mixed-case corpus, or to a
  case-sensitive platform such as BigQuery, must re-establish which setting is in
  effect. Do not read this probe as having settled that.

## The fallback that must not be taken

If a future corpus makes the official mapping non-reproducible, the tempting
shortcut is to read the URNs out of DataHub and match them by name. **That is not
an acceptable fallback.** It makes the expected set derived from the same catalog
it is supposed to check, so the gate becomes self-confirming: if the catalog is
wrong, the expectation is wrong in the same way and the comparison passes anyway.

The honest fallback is a corpus-specific mapping, documented as corpus-specific,
with the limitation stated in the manifest's own governance section — never a
manifest that quietly agrees with itself.
