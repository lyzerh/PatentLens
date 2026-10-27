# Patent Feature Repository v1 / 专利技术特征库

This research prototype runs on local patent snapshots. `/patent-repository` connects free rules extraction, structured retrieval, the existing feature viewer and the existing two-patent comparison engine. It does not perform semantic search, legal analysis, or paid model calls. / 本地研究原型使用免费规则提取，不执行语义检索、法律分析或付费模型请求。

## Data structure / 数据结构

The ignored local repository store is `data/patent-feature-repository-v1/state.json`. Each indexed record binds `publicationNumber`, `documentHash`, `sourceUrl`, `documentVersion`, and `sourceDatasetId` to `extractionRecordId`, `featureSchemaVersion`, `extractorVersion`, `extractionMethod`, `runConfigHash`, timestamps, validation and extraction status, a complete Patent Feature Schema v1 candidate, and its validation result. `featureStoreRecordId` connects an initial extraction to the existing feature record and its human revision history. The repository service reads the frozen source independently and rejects changed document hashes or URLs. Review status, current revision ID, available revisions, and reviewer provenance are resolved from the original feature store; a later versioned rules snapshot has no human review history.

Research collections use a separate ignored store, `data/patent-research-collections-v1/state.json`. They hold a title, description, optional notes, source dataset ID, selected publications, and pinned feature record/revision references. They do not edit source documents or feature candidates.

## Batch workflow / 批量流程

Select one or more documents, run the free preview, inspect source/Claim 1 availability and existing-record counts, then explicitly click Run Batch. The preview never writes records or contacts a model. The batch processes documents individually and reports `extracted`, `partially_extracted`, `unparseable`, `source_unavailable`, `validation_failed`, or `skipped_existing`. A validation pass is not a completeness or semantic accuracy measure. Missing Claim 1 remains unparseable. A rerun with identical document hash, schema version, extractor version, and configuration skips the indexed result. A later extractor version can add a parallel snapshot without replacing an older machine output or human revision. If a batch stops, rerun the same selection; completed indexed items are skipped.

The first local run over the 23 frozen EP samples found 23 source references, 22 available Claim 1 texts, 1 extracted, 7 partially extracted, and 15 unparseable; 8 were indexed. These figures describe rule coverage on this small research sample, not accuracy or industry prevalence. The per-document report and actual feature records remain private.

## Retrieval semantics / 检索语义

Free-text search performs case-insensitive substring matching against technical subject and extracted element/limitation/relation text. Its result label is **Text Candidate Match**. Structured filters read the corresponding Patent Feature Schema v1 fields: publication number from document identity, technical subject from `technicalSubject`, element name/type from `elements`, limitation type and values from `limitations`, relation type from `relationships`, extraction status from repository identity, review status from feature revisions, and dataset from source identity. They can be combined. **Verified Field Match** means the field meets the query; it does not mean a human verified the technical interpretation. Unresolved values are excluded from definite numeric results with diagnostics. No AI confidence is shown.

Numeric `upper_lt` respects strict upper bounds; `overlap` and `within` compare explicit intervals and open/closed endpoints. Unit strings must match; no automatic conversion is performed. Composition ratios require an identical reference basis. Unknown, ambiguous, or source-mismatched values cannot become definite numeric hits. In particular, source `105 Pa*s` is not silently rewritten as `10^5 Pa·s`. Evidence retains section, source URL, source span, document hash, and publication number; exact source presence and technical semantic support are separate questions. The current validator does not independently establish semantic support.

## Comparison and versioning / 比较与版本

Search results can select distinct A/B extraction records. The comparison page receives their record IDs and current revision IDs, checks document/schema/revision identity, and uses the existing deterministic comparison service. A changed revision causes a conflict instead of silent substitution. Candidate matches and undetermined alignments must not be described as technical equivalence, infringement, freedom to operate, validity, or commercial value. The feature viewer accepts a pinned repository record; versioned standalone snapshots are read-only. Original machine outputs and human revisions remain in their separate feature store.

## Collections / 研究集合

Create or edit a collection, add search hits, remove publications, then export JSON or Markdown. A collection is a research grouping. It is **not** a Patent Family, verified enterprise ownership portfolio, or legal rights register. The selected IDs and revisions document exactly what was grouped; exports do not confer ownership.

## Use and limitations / 使用与局限

The workflow supports technical candidate screening, IP research notes, and preliminary comparison. Rules recognize only patterns already implemented by the extractor. Many real claims remain unparseable or partially extracted; absent data must not be invented. Search is local, lexical/structured, and limited to indexed records. There is no multiuser authorization or production database. Local JSON storage and locks support this single-user prototype; a future shared deployment needs transactional storage and access controls. Before using a future real LLM extractor, retain the same source/hash/schema boundaries, require separate explicit paid authorization and budget controls, preserve raw output and token/cost audit, run deterministic validators, and keep model output distinct from human review.
