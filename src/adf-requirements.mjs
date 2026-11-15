const headings = new Set([
  'acceptance criteria',
  'acceptance criterion',
  'requirements',
  'functional requirements',
  'spec requirements',
  'technical requirements',
  '요구사항',
  '기능 요구사항',
  '기능요구사항',
  '수용 기준',
  '수용기준',
  '요건',
  '要件',
  '受け入れ基準'
]);

const prdHeadings = new Set([
  'business rules',
  'security',
  'security requirements',
  'security constraints',
  'constraints',
  'validation rules',
  'user stories',
  'edge cases',
  'expected behavior',
  'definition of done',
  'dod',
  'invariants',
  'api contract',
  'permissions',
  '보안',
  '보안 요구사항',
  '비즈니스 규칙',
  '제약사항',
  '예외 케이스',
  '검증 규칙',
  'セキュリティ',
  'ビジネスルール',
  '制約事項'
]);

const narrativeSpecHeadings = new Set([
  'proposed behavior',
  'system behavior',
  'behavior',
  'feature specification',
  'specification',
  'api behavior',
  'error handling',
  'workflow',
  'deliverables',
  'scope',
  'implementation details'
]);

const narrativeExcludedHeadings = new Set([
  'background',
  'context',
  'history',
  'meeting notes',
  'overview',
  'problem',
  'problem statement',
  'motivation',
  'references'
]);

const MAX_HEURISTIC_ITEMS = 30;
const normativePattern = /\b(?:must|must not|shall|shall not|required to|should reject|should return|will reject|will return)\b|\bhttp\s+[1-5]\d\d\b/i;
const nonRequirementMetaPattern = /\b(?:will be discussed|tbd|to be determined|out of scope for now|for example|e\.g\.)\b/i;
const narrativeActionVerbPattern = /\b(?:returns?|rejects?|throws?|sends?|revokes?|creates?|updates?|deletes?|removes?|blocks?|validates?|verifies|logs?|emits?|encrypts?|hashes?|stores?|prevents?|limits?|expires?|redirects?|renders?|displays?|retries|queues?|cancels?|sustains?|maintains?|enforces?|persists?|redacts?|signs?|authenticates?|authorizes?)\b/i;
const narrativeConditionalPattern = /^(?:when|whenever|if|upon)\b/i;
const narrativeSystemSubjectPattern = /\b(?:the\s+(?:system|service|api|server|application|endpoint|worker|validator|handler|webhook|pipeline|module|limiter|router|middleware|client))\s+(?:returns?|rejects?|throws?|sends?|revokes?|creates?|updates?|deletes?|removes?|blocks?|validates?|verifies|logs?|emits?|encrypts?|hashes?|stores?|prevents?|limits?|expires?|redirects?|renders?|displays?|retries|queues?|cancels?|sustains?|maintains?|enforces?|persists?|redacts?|signs?|authenticates?|authorizes?)\b/i;

const statusHeaders = new Set(['status', 'state', 'done', 'progress']);
const listTypes = new Set(['bulletList', 'orderedList', 'taskList']);
const introPattern = /\b(?:acceptance criteria|acceptance criterion|requirements|functional requirements|spec requirements|technical requirements)\b[^\n.!?]*:\s*$/i;
const idCellPattern = /^(?:#?\d+(?:\.\d+)*|[A-Za-z]{1,6}[-_]?\d+)$/;

function normalizeText(value) {
  return String(value ?? '')
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function textOf(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text') return typeof node.text === 'string' ? node.text : '';
  if (node.type === 'hardBreak') return '\n';
  return Array.isArray(node.content) ? node.content.map(textOf).join('') : '';
}

function pushUnique(result, seen, rawValue) {
  const normalized = normalizeText(rawValue);
  if (!normalized) return;
  const dedupeKey = normalized.replace(/\s+/g, ' ');
  if (seen.has(dedupeKey)) return;
  seen.add(dedupeKey);
  result.push(normalized);
}

function itemText(node) {
  return normalizeText(
    (node.content || [])
      .filter(child => !listTypes.has(child.type))
      .map(textOf)
      .join('\n')
  );
}

function collectList(node, result, seen, prefix = '') {
  for (const item of node.content || []) {
    if (!['listItem', 'taskItem'].includes(item.type)) continue;
    const text = itemText(item);
    const label = text ? (prefix ? `${prefix}: ${text}` : text) : prefix;
    const nestedLists = (item.content || []).filter(child => listTypes.has(child.type));
    if (nestedLists.length > 0) {
      const beforeCount = result.length;
      const nextPrefix = label.replace(/:\s*$/, '');
      for (const child of nestedLists) collectList(child, result, seen, nextPrefix);
      if (result.length === beforeCount && label) pushUnique(result, seen, label);
    } else if (label) {
      pushUnique(result, seen, label);
    }
  }
}

function cellText(cell) {
  if (!cell || typeof cell !== 'object') return '';
  const parts = [];
  for (const child of cell.content || []) {
    if (listTypes.has(child.type)) {
      const listItems = [];
      collectList(child, listItems, new Set());
      if (listItems.length) parts.push(listItems.join('; '));
    } else {
      const t = normalizeText(textOf(child));
      if (t) parts.push(t);
    }
  }
  return normalizeText(parts.join(' '));
}

function collectTable(node, result, seen) {
  const rows = (node.content || []).filter(child => child?.type === 'tableRow' && Array.isArray(child.content));
  if (!rows.length) return;

  const firstCells = rows[0].content;
  const hasHeaderRow = firstCells.length > 0 && firstCells.every(cell => cell?.type === 'tableHeader');
  const headers = hasHeaderRow ? firstCells.map(cell => normalizeText(cellText(cell))) : [];
  const dataRows = hasHeaderRow ? rows.slice(1) : rows;

  for (const row of dataRows) {
    const cells = (row.content || []).map(cell => cellText(cell));
    if (!cells.some(Boolean)) continue;

    if (hasHeaderRow && headers.length === cells.length) {
      const activeIndices = cells
        .map((val, idx) => ({ val, header: headers[idx] || '', idx }))
        .filter(entry => entry.val && !statusHeaders.has(entry.header.toLowerCase()));

      if (!activeIndices.length) continue;
      if (activeIndices.length === 1) {
        pushUnique(result, seen, activeIndices[0].val);
        continue;
      }

      const [first, second, ...rest] = activeIndices;
      if (idCellPattern.test(first.val)) {
        const tail = rest.map(entry => (entry.header ? `${entry.header}: ${entry.val}` : entry.val)).join(' — ');
        const formatted = `[${first.val}] ${second.val}${tail ? ` — ${tail}` : ''}`;
        pushUnique(result, seen, formatted);
      } else {
        const formatted = activeIndices
          .map(entry => (entry.header ? `${entry.header}: ${entry.val}` : entry.val))
          .join(' — ');
        pushUnique(result, seen, formatted);
      }
    } else {
      const nonEmpty = cells.filter(Boolean);
      if (nonEmpty.length === 1) {
        pushUnique(result, seen, nonEmpty[0]);
      } else if (nonEmpty.length === 2) {
        if (idCellPattern.test(nonEmpty[0])) pushUnique(result, seen, `[${nonEmpty[0]}] ${nonEmpty[1]}`);
        else pushUnique(result, seen, `${nonEmpty[0]}: ${nonEmpty[1]}`);
      } else {
        pushUnique(result, seen, nonEmpty.join(' — '));
      }
    }
  }
}

function collectPanel(node, result, seen) {
  const children = Array.isArray(node.content) ? node.content : [];
  const structuredChildren = children.filter(child => listTypes.has(child?.type) || child?.type === 'table');
  if (structuredChildren.length > 0) {
    for (const child of structuredChildren) {
      if (listTypes.has(child.type)) collectList(child, result, seen);
      else if (child.type === 'table') collectTable(child, result, seen);
    }
    return;
  }
  for (const child of children) {
    if (child?.type === 'paragraph') {
      pushUnique(result, seen, textOf(child));
    }
  }
}

function normalizeHeading(node) {
  return normalizeText(textOf(node)).replace(/\s+/g, ' ').replace(/:$/, '').toLowerCase();
}

function isNormativeStatement(rawValue) {
  const normalized = normalizeText(rawValue);
  if (normalized.length < 20 || normalized.length > 500) return false;
  if (nonRequirementMetaPattern.test(normalized)) return false;
  return normativePattern.test(normalized);
}

function extractExplicitRequirements(adf) {
  const result = [];
  const seen = new Set();
  let activeLevel = null;
  let paragraphIntroduction = false;

  for (const node of adf.content) {
    if (paragraphIntroduction) {
      if (listTypes.has(node?.type)) collectList(node, result, seen);
      else if (node?.type === 'table') collectTable(node, result, seen);
      paragraphIntroduction = false;
      continue;
    }

    if (node?.type === 'heading') {
      const level = node.attrs?.level;
      if (headings.has(normalizeHeading(node))) {
        activeLevel = typeof level === 'number' ? level : 1;
      } else if (activeLevel !== null && (typeof level !== 'number' || level <= activeLevel)) {
        activeLevel = null;
      }
    } else if (activeLevel !== null) {
      if (listTypes.has(node?.type)) {
        collectList(node, result, seen);
      } else if (node?.type === 'table') {
        collectTable(node, result, seen);
      } else if (node?.type === 'panel') {
        collectPanel(node, result, seen);
      } else if (node?.type === 'paragraph') {
        const text = normalizeText(textOf(node));
        if (text && introPattern.test(text)) {
          paragraphIntroduction = true;
        } else if (text && !nonRequirementMetaPattern.test(text) && text.length >= 10 && text.length <= 500) {
          if (!seen.has(text)) {
            seen.add(text);
            result.push(text);
          }
        }
      }
    } else if (node?.type === 'paragraph') {
      paragraphIntroduction = introPattern.test(normalizeText(textOf(node)));
    }
  }
  return result;
}

function splitNarrativeSentences(rawBlock) {
  const normalized = normalizeText(rawBlock);
  if (!normalized) return [];
  return normalized
    .split(/\n+|(?<=[.!])\s+(?=[A-Z0-9"\[])/)
    .map(part => part.trim())
    .filter(Boolean);
}

function isSubstantiveSpecClause(sentence) {
  if (sentence.length < 20 || sentence.length > 500) return false;
  if (sentence.endsWith('?') || nonRequirementMetaPattern.test(sentence)) return false;
  return true;
}

function isNarrativeBehavioralClause(sentence) {
  if (sentence.length < 24 || sentence.length > 500) return false;
  if (sentence.endsWith('?') || nonRequirementMetaPattern.test(sentence)) return false;
  if (narrativeConditionalPattern.test(sentence) && narrativeActionVerbPattern.test(sentence)) {
    return true;
  }
  if (narrativeSystemSubjectPattern.test(sentence)) {
    return true;
  }
  return false;
}

function extractUnstructuredPrdRequirements(adf) {
  const result = [];
  const seen = new Set();
  let activePrdLevel = null;
  let activeNarrativeLevel = null;
  let excludedLevel = null;
  let usedPrdSection = false;
  let usedNarrative = false;

  for (const node of adf.content) {
    if (result.length >= MAX_HEURISTIC_ITEMS) break;

    if (node?.type === 'heading') {
      const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 1;
      const headingName = normalizeHeading(node);
      if (prdHeadings.has(headingName)) {
        activePrdLevel = level;
        activeNarrativeLevel = null;
        excludedLevel = null;
      } else if (narrativeSpecHeadings.has(headingName)) {
        activeNarrativeLevel = level;
        activePrdLevel = null;
        excludedLevel = null;
      } else if (narrativeExcludedHeadings.has(headingName)) {
        excludedLevel = level;
        activePrdLevel = null;
        activeNarrativeLevel = null;
      } else {
        if (activePrdLevel !== null && level <= activePrdLevel) activePrdLevel = null;
        if (activeNarrativeLevel !== null && level <= activeNarrativeLevel) activeNarrativeLevel = null;
        if (excludedLevel !== null && level <= excludedLevel) excludedLevel = null;
      }
      continue;
    }

    if (activePrdLevel !== null) {
      const before = result.length;
      if (listTypes.has(node?.type)) collectList(node, result, seen);
      else if (node?.type === 'table') collectTable(node, result, seen);
      else if (node?.type === 'panel') collectPanel(node, result, seen);
      else if (node?.type === 'paragraph') {
        const text = normalizeText(textOf(node));
        if (text.length >= 15 && !nonRequirementMetaPattern.test(text)) {
          pushUnique(result, seen, text);
        }
      }
      if (result.length > before) usedPrdSection = true;
      continue;
    }

    if (activeNarrativeLevel !== null) {
      const candidates = [];
      if (listTypes.has(node?.type)) collectList(node, candidates, new Set());
      else if (node?.type === 'table') collectTable(node, candidates, new Set());
      else if (node?.type === 'panel') collectPanel(node, candidates, new Set());
      else if (node?.type === 'paragraph') candidates.push(textOf(node));

      for (const block of candidates) {
        for (const sentence of splitNarrativeSentences(block)) {
          if (isSubstantiveSpecClause(sentence)) {
            const before = result.length;
            pushUnique(result, seen, sentence);
            if (result.length > before) usedNarrative = true;
            if (result.length >= MAX_HEURISTIC_ITEMS) break;
          }
        }
        if (result.length >= MAX_HEURISTIC_ITEMS) break;
      }
      continue;
    }

    if (node?.type === 'taskList') {
      const taskCandidates = [];
      collectList(node, taskCandidates, new Set());
      for (const item of taskCandidates) {
        if (item.length >= 10 && !nonRequirementMetaPattern.test(item)) {
          pushUnique(result, seen, item);
        }
      }
      continue;
    }

    if (node?.type === 'table') {
      const tableCandidates = [];
      collectTable(node, tableCandidates, new Set());
      for (const item of tableCandidates) {
        if (isNormativeStatement(item)) pushUnique(result, seen, item);
      }
      continue;
    }

    const candidates = [];
    if (node?.type === 'panel') collectPanel(node, candidates, new Set());
    else if (listTypes.has(node?.type)) collectList(node, candidates, new Set());
    else if (node?.type === 'paragraph') candidates.push(textOf(node));

    for (const block of candidates) {
      const sentences = splitNarrativeSentences(block);
      if (sentences.length <= 1 && isNormativeStatement(block)) {
        pushUnique(result, seen, block);
        if (result.length >= MAX_HEURISTIC_ITEMS) break;
        continue;
      }
      for (const sentence of sentences) {
        if (isNormativeStatement(sentence)) {
          pushUnique(result, seen, sentence);
        } else if (excludedLevel === null && isNarrativeBehavioralClause(sentence)) {
          const before = result.length;
          pushUnique(result, seen, sentence);
          if (result.length > before) usedNarrative = true;
        }
        if (result.length >= MAX_HEURISTIC_ITEMS) break;
      }
      if (result.length >= MAX_HEURISTIC_ITEMS) break;
    }
  }

  const wasTruncated = result.length >= MAX_HEURISTIC_ITEMS;
  const bounded = result.slice(0, MAX_HEURISTIC_ITEMS);
  if (bounded.length === 0) {
    return { requirements: [], extractionMode: 'none', wasTruncated: false };
  }
  return {
    requirements: bounded,
    extractionMode: usedNarrative && !usedPrdSection ? 'narrative_prd' : 'heuristic_prd',
    wasTruncated
  };
}

// Tier-1 unifies explicit requirement and structured PRD sections; Tier-2 extracts normative RFC-2119 rules; Tier-3 extracts narrative behavioral clauses, capped at 30 items with truncation tracking.
export function extractRequirementsWithMeta(adf) {
  if (!adf || adf.type !== 'doc' || !Array.isArray(adf.content)) {
    throw new TypeError('Expected a Confluence ADF document');
  }
  const explicit = extractExplicitRequirements(adf);
  const unstructured = extractUnstructuredPrdRequirements(adf);

  if (explicit.length > 0) {
    const combined = [...explicit];
    const seen = new Set(explicit.map(e => e.trim().toLowerCase()));
    for (const req of unstructured.requirements) {
      const key = req.trim().toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(req);
      }
    }
    const wasTruncated = combined.length > MAX_HEURISTIC_ITEMS;
    const bounded = combined.slice(0, MAX_HEURISTIC_ITEMS);
    return {
      requirements: bounded,
      extractionMode: 'explicit',
      wasTruncated: wasTruncated || Boolean(unstructured.wasTruncated)
    };
  }
  return unstructured;
}

export function extractRequirements(adf) {
  return extractRequirementsWithMeta(adf).requirements;
}
