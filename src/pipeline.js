const REQUIRED_ROOT_FIELDS = [
  "recordId",
  "bibliographic",
  "family",
  "technology",
  "claimAnalysis",
  "intelligence",
  "review"
];

function issue(type, path, message, severity = "error") {
  return { type, path, message, severity };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateShape(output) {
  const errors = [];

  if (!isObject(output)) {
    return [issue("SCHEMA_INVALID_ROOT", "$", "Structured output must be an object")];
  }

  for (const field of REQUIRED_ROOT_FIELDS) {
    if (!(field in output)) {
      errors.push(issue("SCHEMA_MISSING_FIELD", `$.${field}`, `Missing required field: ${field}`));
    }
  }

  if (typeof output.recordId !== "string" || output.recordId.length === 0) {
    errors.push(issue("SCHEMA_INVALID_FIELD", "$.recordId", "recordId must be a non-empty string"));
  }

  if (!isObject(output.claimAnalysis)) {
    errors.push(issue("SCHEMA_INVALID_FIELD", "$.claimAnalysis", "claimAnalysis must be an object"));
  } else {
    if (!Array.isArray(output.claimAnalysis.elements)) {
      errors.push(issue("SCHEMA_INVALID_FIELD", "$.claimAnalysis.elements", "elements must be an array"));
    }
    if (!Array.isArray(output.claimAnalysis.technicalFeatures)) {
      errors.push(issue("SCHEMA_INVALID_FIELD", "$.claimAnalysis.technicalFeatures", "technicalFeatures must be an array"));
    }
    const confidence = output.claimAnalysis.confidence;
    if (typeof confidence !== "number" || confidence < 0 || confidence > 1) {
      errors.push(issue("CONFIDENCE_OUT_OF_RANGE", "$.claimAnalysis.confidence", "confidence must be between 0 and 1"));
    }
  }

  if (!isObject(output.intelligence)) {
    errors.push(issue("SCHEMA_INVALID_FIELD", "$.intelligence", "intelligence must be an object"));
  } else if (!Array.isArray(output.intelligence.evidence)) {
    errors.push(issue("SCHEMA_INVALID_FIELD", "$.intelligence.evidence", "evidence must be an array"));
  }

  if (!isObject(output.review) || typeof output.review.status !== "string") {
    errors.push(issue("SCHEMA_INVALID_FIELD", "$.review.status", "review.status must be a string"));
  }

  return errors;
}

export function checkEvidence(rawText, output) {
  const errors = [];
  const evidence = output?.intelligence?.evidence;
  const elements = output?.claimAnalysis?.elements;

  if (!Array.isArray(evidence) || !Array.isArray(elements)) {
    return errors;
  }

  const evidenceById = new Map();
  for (const [index, item] of evidence.entries()) {
    const path = `$.intelligence.evidence[${index}]`;
    if (!isObject(item) || typeof item.evidenceId !== "string") {
      errors.push(issue("EVIDENCE_INVALID", path, "Evidence must have an evidenceId"));
      continue;
    }
    if (evidenceById.has(item.evidenceId)) {
      errors.push(issue("EVIDENCE_DUPLICATE_ID", `${path}.evidenceId`, `Duplicate evidence ID: ${item.evidenceId}`));
    }
    evidenceById.set(item.evidenceId, item);
    if (typeof item.originalText !== "string" || item.originalText.length === 0) {
      errors.push(issue("EVIDENCE_EMPTY_TEXT", `${path}.originalText`, "Evidence must include originalText"));
    } else if (!rawText.includes(item.originalText)) {
      errors.push(issue("EVIDENCE_NOT_GROUNDED", `${path}.originalText`, "Evidence text does not occur in raw patent text"));
    }
  }

  for (const [index, element] of elements.entries()) {
    const path = `$.claimAnalysis.elements[${index}]`;
    if (!isObject(element) || typeof element.elementId !== "string") {
      errors.push(issue("CLAIM_ELEMENT_INVALID", path, "Claim element must have an elementId"));
      continue;
    }
    if (!Array.isArray(element.evidenceIds) || element.evidenceIds.length === 0) {
      errors.push(issue("CLAIM_ELEMENT_UNSUPPORTED", `${path}.evidenceIds`, "Every claim element needs at least one evidence ID"));
      continue;
    }
    for (const evidenceId of element.evidenceIds) {
      if (!evidenceById.has(evidenceId)) {
        errors.push(issue("EVIDENCE_REFERENCE_MISSING", `${path}.evidenceIds`, `Unknown evidence ID: ${evidenceId}`));
      }
    }
  }

  return errors;
}

export function runPipeline({ rawPatent, structuredOutput }) {
  const shapeErrors = validateShape(structuredOutput);
  // Keep checking independent layers even when one layer already failed.
  // A review report is more useful when it shows all repairable problems in one run.
  const groundingErrors = checkEvidence(rawPatent.text, structuredOutput);
  const errors = [...shapeErrors, ...groundingErrors];

  return {
    recordId: structuredOutput?.recordId ?? null,
    status: errors.length === 0 ? "awaiting_human_review" : "needs_revision",
    errors,
    metrics: {
      schemaErrorCount: shapeErrors.length,
      groundingErrorCount: groundingErrors.length,
      totalErrorCount: errors.length
    }
  };
}

export function formatReport(result) {
  const lines = [
    `Record: ${result.recordId ?? "unknown"}`,
    `Status: ${result.status}`,
    `Schema errors: ${result.metrics.schemaErrorCount}`,
    `Grounding errors: ${result.metrics.groundingErrorCount}`,
    `Total errors: ${result.metrics.totalErrorCount}`
  ];
  for (const error of result.errors) {
    lines.push(`- [${error.type}] ${error.path}: ${error.message}`);
  }
  return lines.join("\n");
}
