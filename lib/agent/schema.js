export const ACTIONS = Object.freeze(['STOP', 'CONTINUE', 'SCALE', 'REPLACE_CREATIVE', 'WATCH']);
export const CONFIDENCE = Object.freeze(['low', 'medium', 'high']);
export const ENTITY_TYPES = Object.freeze(['campaign', 'ad']);

// Limits enforced by the validator. The JSON Schema cannot carry them: the structured-output API rejects or ignores
// minimum, maximum, multipleOf, minLength and maxLength, so numeric and length bounds live in code.
export const LIMITS = Object.freeze({
  MAX_RECOMMENDATIONS: 20,
  MAX_REJECTED: 50,
  MAX_EVIDENCE: 6,
  MAX_CITED: 8,
  MAX_GAPS: 10,
  SUMMARY_CHARS: 600,
  RATIONALE_CHARS: 600,
  EVIDENCE_CHARS: 300,
  GAP_CHARS: 200,
  REVIEW_DAYS: [1, 14],
});

const string = { type: 'string' };
const list = items => ({ type: 'array', items });

// Every object: additionalProperties false and every property required. No recursion, no numeric or length bounds.
export const AGENT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'recommendations', 'data_gaps'],
  properties: {
    summary: string,
    recommendations: list({
      type: 'object',
      additionalProperties: false,
      required: ['entity_type', 'entity_id', 'action', 'confidence', 'rationale', 'evidence', 'cited_metrics', 'review_after_days'],
      properties: {
        entity_type: { type: 'string', enum: [...ENTITY_TYPES] },
        entity_id: string,
        action: { type: 'string', enum: [...ACTIONS] },
        confidence: { type: 'string', enum: [...CONFIDENCE] },
        rationale: string,
        evidence: list(string),
        cited_metrics: list({
          type: 'object',
          additionalProperties: false,
          required: ['path', 'value'],
          properties: { path: string, value: { type: 'number' } },
        }),
        review_after_days: { type: 'integer' },
      },
    }),
    data_gaps: list(string),
  },
});
