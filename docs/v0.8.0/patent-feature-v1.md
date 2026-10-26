# Patent Feature Schema v1 / 专利技术特征模式

`schemaVersion: patent-feature-v1` is separate from the thermal industry taxonomy and its human annotation store. The current extraction target is **Independent Claim 1** in the Smart Device Thermal Management frozen dataset. All outputs are candidates, not Verified Gold or legal conclusions.

## Structure

| Field | Meaning |
| --- | --- |
| `identity` | Publication number, frozen document hash, EPO source URL, claim number `1`, source language. |
| `technicalSubject` | Claim subject type: Product, Material / Composition, Apparatus, System, Method, Other / Unknown; exact Claim 1 span. |
| `elements[]` | Stable element ID, name, type, exact original span, evidence, confidence status. |
| `limitations[]` | Material, composition ratio, numeric range, structural, functional, process or other constraint; linked element, original text, bounds, endpoint inclusion, unit, ratio reference basis, numeric status. |
| `relationships[]` | Explicit element endpoints and relation type: contains, connected_to, positioned_between, thermally_coupled_to, controls, other. Exact quote is required; semantic support remains `not_assessed`. |
| `descriptionFindings[]` | Technical problem, proposed solution, described effect, application context. Every item cites description and has `claimLimitation: false`. |
| `unresolvedSpans[]` | Source text or numeric encoding that the rule extractor cannot reliably interpret, with a reason. |

Each evidence object carries `section`, `sourceSpan`, `sourceUrl`, `documentHash`, and `locator`. The validator separately reports schema shape, strict source match, numeric integrity, element references, semantic assessment status and Claim 1 coverage. An exact substring is **not** proof that a technical relationship or effect is correct. `reviewed` is a single reviewer revision, not Gold.

## EP4476289B1 read-only expressibility check

The rules identify the non-silicone resin, phase-change material, plasticizer, elastomeric agent and particulate filler. They preserve the 25–50 percent ratio **by weight of the non-silicone resin**, filler particle size `<25 µm`, thermal impedance `<0.5 °C * cm2/W`, and melting point 40–80 °C as separate constraints. `melt viscosity of less than 105 Pa*s` is kept verbatim and its numeric bound remains null: the frozen source may have lost exponent/superscript formatting. The parser does not infer `10⁵` or treat the material's phase change as a vapor chamber. Description statements are separately typed and never promoted to Claim 1 limitations.

Rule coverage only counts recognized fragments within each split Claim 1 segment. It does not certify full legal claim construction. The unresolved numeric span is listed even when its containing segment has other recognized features. More complex syntax, synonyms, implicit relationships, dependent claims and cross-document correspondence need additional extraction and human validation.

## Execution, review and safety

`POST /api/patent-features/extract` runs deterministic rules or an offline mock. The LLM adapter interface exists, but paid feature extraction is disabled; there is no route to a live provider. `create` stores the original machine result once in ignored `data/patent-features-v1/state.json`. Human JSON edits append immutable revisions with reviewer, status and time; they cannot change the frozen identity, origin mode, source evidence, or prior machine output. A revision that fails validation is rejected. Existing Taxonomy v2 annotation records and Smoke Test history are untouched.

The page is `/patent-features`. It displays the source, structure, diagnostics and revision history in Chinese or English; source text remains original. Exports include candidate data and explicit non-Gold status. This stage has no technical comparison, infringement analysis, FTO opinion or patent value score.
