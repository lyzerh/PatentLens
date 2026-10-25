# Public test fixtures

- `raw-patent.json`, `epo-document.xml`, `google-description-legal-events.html`, and `mock-llm-output.*.json` are **synthetic/mock** regression fixtures. They are not genuine patent documents, model responses, or verified Gold.
- `patent-seeds.json` is a four-record **real-publication seed index** for the search demo. It contains publication metadata, source links, short claim excerpts, and original research notes; it contains no complete patent specification or private experiment response. Treat it as source material, not a labeled evaluation set. Consult each linked publication and its applicable terms before reusing excerpts elsewhere.
- The 23-document thermal input and all three real xAI smoke responses are local-only under ignored `data/`; they are not fixtures in this directory.
