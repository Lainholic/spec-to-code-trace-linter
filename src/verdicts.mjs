import { enrichCitationContext, resolveVerifiedCitation } from './diff-evidence.mjs';

const statuses = new Set(['EVIDENCE_FOUND', 'POTENTIAL_MISSING', 'INSUFFICIENT_CONTEXT', 'OUT_OF_SCOPE']);

const REQ_NON_DIFF_SCOPE_REGEX = /\b(?:latency|p50|p90|p95|p99|sla|slo|uptime|99\.9%|load\s*test|stress\s*test|benchmark|concurrent\s+users|throughput|rps|kubernetes|terraform|helm|vpc|cdn|dns|manual\s+process|human\s+approval|human\s+review|legal\s+sign-?off|runbook)\b/i;
const REQ_CODE_IMPLEMENTABLE_EXCLUSIONS = /\b(?:measure|measuring|monitor|monitoring|log|logging|emit|record|alert|calculate|track|tracking|counter|timer|healthcheck|health\s*check|probe|timeout|metric|metrics|gauge|histogram)\b/i;
const REASONING_STRICT_NON_CODE_REGEX = /\b(?:runtime\s+(?:check|latency|sla|load|performance|metric|behavior)|load\s+test|stress\s+test|infrastructure\s+provisioning|manual\s+operational|cannot\s+be\s+(?:verified|proven)\s+(?:from|in|by|statically)|verified\s+statically)\b/i;
const DIFF_OMISSION_EXCUSE_REGEX = /\b(?:this\s+(?:pr|pull\s+request|diff|commit)|modified\s+files|only\s+(?:touches|modifies|adds)|unrelated\s+to\s+the\s+changed|not\s+part\s+of\s+this\s+pr|outside\s+the\s+files)\b/i;
const FUNCTIONAL_CODE_INDICATORS = /\b(?:reject|return|throw|status\s*code|http\s*\d{3}|header|token|auth|authenticate|authorize|permission|signature|hmac|sha-?256|hash|validation|validate|parse|database|query|api|endpoint|route|handler|schema|payload|json|param|parameter)\b/i;

export function isEligibleOutOfScope(requirementText, reasoning) {
  const reqText = String(requirementText ?? '');
  const reasonText = String(reasoning ?? '');
  // Functional code requirements can NEVER be excused as OUT_OF_SCOPE
  if (FUNCTIONAL_CODE_INDICATORS.test(reqText) && !REQ_NON_DIFF_SCOPE_REGEX.test(reqText)) {
    return false;
  }
  if (DIFF_OMISSION_EXCUSE_REGEX.test(reasonText) && !REQ_NON_DIFF_SCOPE_REGEX.test(reqText)) {
    return false;
  }
  if (REQ_CODE_IMPLEMENTABLE_EXCLUSIONS.test(reqText) && !REASONING_STRICT_NON_CODE_REGEX.test(reasonText)) {
    return false;
  }
  return REQ_NON_DIFF_SCOPE_REGEX.test(reqText);
}

// A cited diff line establishes provenance, not semantic correctness.
export function validateVerdicts(requirements, candidates, changedLines, filteredDiff = null) {
  if (!Array.isArray(requirements) || !Array.isArray(candidates) || !Array.isArray(changedLines)) {
    throw new TypeError('Expected requirements, verdicts and changed lines as arrays');
  }
  const formatCitation = resolved => (
    typeof filteredDiff === 'string' && filteredDiff.trim()
      ? enrichCitationContext(filteredDiff, resolved)
      : resolved
  );

  return requirements.map((requirement, index) => {
    const targetId = String(index + 1);
    const matches = candidates.filter(item => String(item?.id ?? '').trim() === targetId);
    const candidate = matches.length === 1 ? matches[0] : null;
    const normStatus = typeof candidate?.status === 'string' ? candidate.status.trim().toUpperCase() : null;
    const hasValidBase = Boolean(
      candidate &&
      normStatus &&
      statuses.has(normStatus) &&
      typeof candidate.reasoning === 'string' &&
      candidate.reasoning.trim()
    );

    if (!hasValidBase) {
      return {
        id: String(index + 1),
        requirementText: requirement,
        status: 'INSUFFICIENT_CONTEXT',
        reasoning: 'The analysis was missing or could not be verified. Review this requirement manually.'
      };
    }

    if (normStatus === 'EVIDENCE_FOUND') {
      const verified = resolveVerifiedCitation(changedLines, candidate.citation);
      if (!verified) {
        return {
          id: String(index + 1),
          requirementText: requirement,
          status: 'POTENTIAL_MISSING',
          reasoning: 'The AI proposed a code location that could not be verified in the diff.'
        };
      }
      return {
        id: String(index + 1),
        requirementText: requirement,
        status: 'EVIDENCE_FOUND',
        reasoning: candidate.reasoning.trim(),
        citation: formatCitation(verified)
      };
    }

    if (normStatus === 'INSUFFICIENT_CONTEXT' && candidate.citation) {
      const verifiedDelegation = resolveVerifiedCitation(changedLines, candidate.citation);
      if (verifiedDelegation) {
        return {
          id: String(index + 1),
          requirementText: requirement,
          status: 'INSUFFICIENT_CONTEXT',
          reasoning: candidate.reasoning.trim(),
          citation: formatCitation(verifiedDelegation)
        };
      }
    }

    if (normStatus === 'OUT_OF_SCOPE' && !isEligibleOutOfScope(requirement, candidate.reasoning)) {
      return {
        id: String(index + 1),
        requirementText: requirement,
        status: 'POTENTIAL_MISSING',
        reasoning: candidate.reasoning.trim()
      };
    }

    return {
      id: String(index + 1),
      requirementText: requirement,
      status: normStatus,
      reasoning: candidate.reasoning.trim()
    };
  });
}

export function summarizeVerdicts(verdicts) {
  if (!Array.isArray(verdicts)) throw new TypeError('Expected verdicts array');
  let evidenceFound = 0;
  let potentialMissing = 0;
  let insufficientContext = 0;
  let outOfScope = 0;

  for (const v of verdicts) {
    if (v?.status === 'EVIDENCE_FOUND') evidenceFound++;
    else if (v?.status === 'POTENTIAL_MISSING') potentialMissing++;
    else if (v?.status === 'INSUFFICIENT_CONTEXT') insufficientContext++;
    else if (v?.status === 'OUT_OF_SCOPE') outOfScope++;
  }

  const total = verdicts.length;
  const inScopeTotal = Math.max(0, total - outOfScope);
  const coverageRatio = inScopeTotal > 0 ? Number((evidenceFound / inScopeTotal).toFixed(4)) : 0;

  return {
    total,
    evidenceFound,
    potentialMissing,
    insufficientContext,
    outOfScope,
    inScopeTotal,
    coverageRatio
  };
}
