// Ordered by static text-node order in each HTML page. The generator binds each
// entry to a stable page key; these strings never touch patent evidence or API data.
export const staticEnglish = {
  thermal: [
    'PatentLens · Smart Device Thermal Management','← Earlier Experiments','PATENTLENS / THERMAL','Search ↗','SMART DEVICE THERMAL MANAGEMENT · PILOT',
    'Smart Device Thermal Patent Portfolio','Public source text sets the boundary. Technical relevance does not establish device application; potential use does not establish commercial implementation.','Reading frozen data…',
    '01 / DATASET','Scope and Data Readiness','Refresh','02 / PORTFOLIO','Technology Portfolio in This Sample',
    'These deterministic statistics cover this small EP sample only, not the global competitive landscape. Boundary, excluded and uncertain patents are omitted from in-scope technology distributions.',
    '03 / REVIEW','Patent Evidence and Human Review','Freeze Verified Gold',
    'Automated suggestions are provisional_reference only and appear alongside the source text. A boundary case has relevant thermal technology but lacks confirmed smart-device application in the available evidence.',
    'Industry Scope Filter','All 23 Patents','In Scope','Boundary Case','Out of Scope','Uncertain','Select Publication','Review Status','Provisional Reference','Verified Gold','Disputed','Insufficient Evidence',
    'Industry Scope','In Scope','Boundary Case','Out of Scope','Uncertain','Primary Technology Category','Secondary Technology Categories (comma-separated)','Potential Product Applications (comma-separated)',
    'Thermal technology is relevant','Evidence Section','Title','Abstract','Independent Claim','Description','Exact Excerpt from Frozen Source','Reviewer','Rationale',
    'verified_commercial_implementation remains unknown; this page has no independent product implementation evidence.','Save Review',
    '04 / API SETTINGS','xAI API Settings','Not configured','The Key is held only in this Node server’s memory. Enter it again after restart. Connection testing reads the model list and does not generate content.',
    'API Key','Show Key','Save in This Server Session','Test Connection','Clear Web Key','Not configured',
    '05 / BENCHMARK','A/B/C/D Engineering Readiness','Run Offline Mock',
    'A is the CPC/rules baseline; B uses a free-text prompt; C uses a fixed JSON Schema; D validates exact evidence from the same C output. All arms use the same frozen input hash. Mock does not establish model quality or incur fees.',
    'Model for Estimate','grok-4.3','grok-4.20-0309-non-reasoning','Estimate B/C Cost for the Frozen Five','This is an offline estimate only; no paid request is sent.',
    'Single Patent xAI Smoke Test','Choose one of the first five frozen patents · grok-4.3 · at most one C request per patent; D reuses the output. Results are engineering_smoke_test only; accuracy is not calculated.',
    'Select Patent','Check Access and Cost Only','Not run. Loading this page does not call the paid API.','Confirm Cost and Execute One Paid Request','Cancel',
    '06 / EXPORT','Experiment Records','Export JSON','Export Markdown',
    'Single Patent Smoke Tests have separate records; the full paid xAI comparison has not run. Without human Gold, validated accuracy is unavailable.',
    'Local research prototype · Public EPO EP publications · Earlier v0.3 data and reports remain separate.'
  ],
  v3: [
    'PatentLens · v0.3 Value Validation','← Portfolio Workbench','PatentLens / VALUE LAB 0.3','Smart Device Thermal Study ↗','Search Workbench ↗','CONTROLLED EXPERIMENT',
    'Validating the Incremental Value of LLMs','Ten fixed EPO patents. Freeze source input and human Gold first, then compare rules, free text, structured output and a Validator. Mock and real metrics stay separate.','Loading…',
    '01 / DATASET','Samples and Sources','Refresh','Legacy: Retrieve EPO Source','Freeze Initial Input',
    'The current frozen dataset has a parent version. Each record retains its source, retrieval time, missing fields, conflicts and SHA-256. Legacy inputs are never replaced in place.',
    '02 / DATA QUALITY','Data Readiness','Export Data Report JSON','Export Data Report Markdown',
    'Coverage is calculated from the frozen sample, not hard-coded. Missing reasons and cross-publication conflicts are listed per record; the model does not resolve conflicting sources.',
    '03 / HUMAN GOLD','Candidates and Human Reference','Refresh Rule Candidates','Freeze Verified Gold',
    'Candidates come from official classifications and deterministic rules for review only; they are not Gold. All ten require independent human confirmation. Choose uncertain when unresolved. Commercial implementation remains unknown. See the',
    '.','versioned taxonomy specification','Publication','Annotation Status','Provisional; not scored','Human Verified','Technology Domain','Technology Subdomain','Primary Function',
    'Potential Product Categories (comma-separated)','Citation Section','Title','Abstract','Independent Claim','Exact Source Excerpt','Annotator','Rationale',
    'Insufficient source or unclear boundary; mark uncertain','Save Gold','04 / EXPERIMENT','Four-arm Comparison',
    'A rules/CPC (no model call) → B free text → C JSON Schema → D validation of the same C output (no extra call). Real calls require frozen Gold and are not repeated by default.',
    'Dataset','Model','Method','B Free Text','C Structured; D Reuses Output','Publication','Maximum Output Tokens','Check Available Models (No Generation)','Estimate Cost',
    'Offline Four-arm Check (10 Patents, Free)','Single Mock (Free)','Authorize xAI Call (Paid)','Authorize Full B+C Group (Up to 20 Calls)',
    '05 / EVALUATION','Dashboard and Reports','Export Experiment JSON','Export Experiment Markdown',
    'Without frozen Gold, the accuracy denominator is zero. Mock does not count as real evaluation. Passing Schema does not prove semantic correctness; exact citation matching does not prove evidential support.',
    'Local exploratory tool. A ten-patent sample cannot establish commercial viability; budget reservation cannot cap a provider’s invoice.'
  ],
  pilot: [
    'PatentLens Pilot · Portfolio Analysis','Skip to Records','PatentLens Pilot','Enterprise Patent Portfolio · Local Validation','Registry','Portfolio','Evidence','Classification','Model Comparison','v0.3 Value Validation ↗','Original Search Workbench ↗',
    'PATENT PORTFOLIO / PILOT 0.2','Put sources, judgments and costs','on one workbench.','Facts come from publications; AI classifications need human review; statistics use explicit definitions.',
    '0','Registered Publications','Checking server model configuration…','01 / REGISTRY','Patent Registry','Import local CSV / JSON. Imported fields are marked unverified.',
    'Import File (CSV / JSON)','Import File','Required and Optional CSV Columns',
    'Required: publicationNumber. Optional: title, abstract, assignee, inventors, priorityDate, filingDate, publicationDate, jurisdiction, cpc, ipc, familyId, legalStatus, legalStatusCheckedAt, independentClaims, sourceUrl. Separate array items with semicolons. Legal status requires a verification date.',
    'Official EPO XML Publication Number','Retrieve and Register EPO Publication','Only fields returned by the source are registered; a local Clash Meta connection may be needed.',
    'Small Public Sample (Internet Required)','Take the first five EPO publications for each of five smart-device topics; deduplicate by publication number. Search terms are not human Gold.',
    'Collect Up to 25 EP Publications','0 Records','Select All for Comparison','02 / PORTFOLIO','Portfolio Overview','Statistics are computed; only human-verified classifications are counted.',
    'Technology Domain','All','Applicant','Jurisdiction','Filing Date From','Filing Date To','Apply Filters','0','Publications','0','Patent Families with Trusted IDs','0','Human-Verified Classifications','0','Pending / Unclassified',
    'Technology Domain · Verified','Filing Years','Applicants','Jurisdictions','Definitions and Missing Data','03 / SOURCE','Source Facts and Evidence',
    'Show source status field by field. Source excerpts come from text actually sent to the model.','Select a record from the registry.','04 / CLASSIFICATION LAB','AI Classification Lab',
    'The model processes semantic fields only. Mock does not call an API.','Model','Per-task Budget (USD)','Output Token Limit','Allow Repeated Paid Tests','Preflight Estimate','Mock Classification',
    'Classify with xAI','Check Model Access','Select a patent record to estimate. Token estimates may differ from provider usage; the budget blocks later requests but does not cap a provider bill.',
    'No classification result yet.','05 / BENCHMARK','Model Comparison','Run selected records serially. Accuracy is hidden without human Gold.','Batch Budget (USD)','Task Mode',
    'Mock (Free)','xAI API (Paid)','Estimate Selected Batch','Run Selected Comparison','Export Validation Report JSON','Select patents in the registry first. Real API calls require a server key.',
    'Local data live in project data/. Human review confirms technology classification only; it is not a legal or commercial implementation opinion.','Return to Original Workbench'
  ],
  search: [
    'Patent Test Tool','Skip to Research Workspace','Patent Test Tool','Search','01','Source Text','02','Results','03','Portfolio Analysis','API Not Configured','API Settings','01','Patent Search','Keywords, Query or Publication Number','⌕','Search Source',
    'EPO · Free / EP','Google Patents','SerpAPI · Requires Key','Local Sample · 4 Records','Search','Filter by Applicant, Country and Date','Applicant','Country / Region','All','US','CN','TW','KR','JP','EP','WO',
    'Publication Date · From','Publication Date · To','SerpAPI Search Key','Search does not require an LLM Key.','Sources and Connection','Reading connection settings…',
    'Source: European Patent Office · Linked Open EP Data (CC BY 4.0) / European Publication Server. For small, occasional experiments only.',
    'Search Results','Patent families have not been merged','Not searched','Enter keywords or a publication number to search.','Previous','Page 1','Next','Export Search Log','Open Source Search',
    '02','Source Text and Testing','Choose a search result or paste source text below','New Manual Input','View Original Patent','Reload Source Text','Publication Number','Title','Claims · Include in Test','All Claims',
    'Abstract','Include in Test','Description','Include in Test','0 characters · No test input','View Current Prompt','API Not Configured','Offline simulation is free; LLM tests are billed by the provider.',
    'Offline Simulation','Cancel','Run LLM Test','Export Experiment','03','Test Results','Extraction and Validation','Evidence Check','Raw Response',
    'Run a test to see results.','No citations yet.','No response yet.','UI Performance Test','Visual Style','Liquid Glass','Light Frost','Solid Surface','Reduce Motion',
    'Checking browser effect support…','Average Frame Interval','—','ms','P95 Frame Interval','—','ms','Long Tasks / ≥50ms','—','Page Errors During Test','—',
    'Test Current Mode · ~5 sec','Compare Three Modes · ~15 sec','Stop Test','Export Performance Record ↗','Local synthetic data test; no API call.',
    'Synthetic Test Scene · Not Real Search Results','120 synthetic cards and 60,000 characters. Frame intervals and long tasks do not measure GPU, power use or long-term stability. Keep the page foregrounded at the same window size.',
    'API Settings','×','Key is cleared on refresh; a test sends selected source text to the configured API.','Connection Route','Direct Browser-to-xAI','Local Backend','Model Preset','Grok Build 0.1',
    'Grok 4.3 · Reasoning Off','LawLens Preset · Grok 4.20','Custom','API Protocol','Responses · xAI / OpenAI Compatible','Chat Completions · Compatible Endpoint','Base URL','API Key','Show','Model ID',
    'Output Format','Strict JSON Schema','JSON Mode','Prompt Constraints Only','Output Token Limit','Token Parameter for Compatible APIs','max_tokens · Common Compatible Services',
    'max_completion_tokens · Newer OpenAI Chat','Reasoning Effort','Provider Default · Omit Reasoning Parameter','none · Reasoning Off (Grok 4.3)',
    'low · Limited Reasoning','medium · Moderate Reasoning','high · More Reasoning','Provider billing applies; reasoning may increase output usage.','·','Get xAI Key','Pricing',
    'Connection Diagnostics','Keyless Network Check','Not checked yet.','Clear Key','Check Connection / List Models','Apply Settings','Current Prompt','×','Viewing the prompt does not call an LLM.'
  ]
};

export const chineseOverrides = {
  thermal: {32:'范围内',33:'边界案例',34:'范围外',35:'待定',69:'单篇真实 xAI 工程试运行'},
  search: {1:'专利检索与测试工具',3:'专利检索与测试工具'}
};

export const staticAttributeEnglish = {
  thermal: ['Enter xAI API Key','Smoke Test Patent'],
  v3: ['Smartphone, Wearables, Other, Unknown','Copy from the frozen source on the right; leave blank if uncertain'],
  pilot: ['Page Navigation','EP3633495A1','Contains','EP / US'],
  search: ['Test Flow','Patent Search','e.g. "dynamic voltage" workload or US20240053809A1','e.g. Qualcomm','For online search only; separate from the LLM Key','Search Results',
    'Patent Source Text','Optional, e.g. US20240053809A1','Optional','Select Claims','Paste original claims, preserving numbering.','Original Claims',
    'Original Abstract','Original Abstract','Original description, preserving paragraph numbers.','Original Description','Experiment Results','Visual Style','Previous Test Metrics',
    'Synthetic Test Scene','Synthetic Document Scrolling Area','Close Settings','Paste the API Key created in xAI Console','Enter a model your account can use','Close Prompt']
};
