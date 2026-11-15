const NOISE_BASENAMES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'cargo.lock',
  'gemfile.lock',
  'poetry.lock',
  'composer.lock',
  'go.sum'
]);

const NOISE_DIRS = new Set([
  'dist',
  'build',
  '.next',
  'out',
  'coverage',
  'vendor',
  'node_modules',
  '__snapshots__'
]);

const NOISE_SUFFIXES = ['.min.js', '.min.css', '.bundle.js', '.map', '.snap', '.lock'];

const EXT_LANGUAGE_MAP = new Map([
  ['ts', 'typescript'],
  ['tsx', 'tsx'],
  ['js', 'javascript'],
  ['mjs', 'javascript'],
  ['cjs', 'javascript'],
  ['jsx', 'jsx'],
  ['py', 'python'],
  ['java', 'java'],
  ['go', 'go'],
  ['rs', 'rust'],
  ['rb', 'ruby'],
  ['php', 'php'],
  ['cs', 'csharp'],
  ['cpp', 'cpp'],
  ['c', 'c'],
  ['swift', 'swift'],
  ['kt', 'kotlin'],
  ['scala', 'scala'],
  ['json', 'json'],
  ['yml', 'yaml'],
  ['yaml', 'yaml'],
  ['css', 'css'],
  ['scss', 'sass'],
  ['html', 'html'],
  ['xml', 'xml'],
  ['sql', 'sql'],
  ['sh', 'bash'],
  ['bash', 'bash'],
  ['ps1', 'powershell'],
  ['md', 'markdown'],
  ['graphql', 'graphql'],
  ['gql', 'graphql'],
  ['toml', 'toml']
]);

export function languageFromPath(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) return 'text';
  const base = filePath.split('/').pop() || '';
  if (base.toLowerCase() === 'dockerfile') return 'dockerfile';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return 'text';
  return EXT_LANGUAGE_MAP.get(base.slice(dot + 1).toLowerCase()) || 'text';
}

export function isNoisePath(filePath) {
  if (typeof filePath !== 'string' || !filePath) return false;
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  if (!segments.length) return false;
  const base = segments[segments.length - 1].toLowerCase();
  if (NOISE_BASENAMES.has(base)) return true;
  if (NOISE_SUFFIXES.some(suffix => base.endsWith(suffix))) return true;
  return segments.slice(0, -1).some(seg => NOISE_DIRS.has(seg.toLowerCase()));
}

function decodeGitQuotedString(quotedBody) {
  const bytes = [];
  for (let i = 0; i < quotedBody.length; i++) {
    const ch = quotedBody[i];
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'));
      continue;
    }
    if (i + 1 >= quotedBody.length) return null;
    const next = quotedBody[++i];
    if (next >= '0' && next <= '7') {
      let oct = next;
      if (i + 1 < quotedBody.length && quotedBody[i + 1] >= '0' && quotedBody[i + 1] <= '7') oct += quotedBody[++i];
      if (i + 1 < quotedBody.length && quotedBody[i + 1] >= '0' && quotedBody[i + 1] <= '7') oct += quotedBody[++i];
      bytes.push(parseInt(oct, 8) & 0xff);
    } else if (next === '\\') bytes.push(0x5c);
    else if (next === '"') bytes.push(0x22);
    else if (next === 't') bytes.push(0x09);
    else if (next === 'n') bytes.push(0x0a);
    else if (next === 'r') bytes.push(0x0d);
    else if (next === 'a') bytes.push(0x07);
    else if (next === 'b') bytes.push(0x08);
    else if (next === 'f') bytes.push(0x0c);
    else if (next === 'v') bytes.push(0x0b);
    else return null;
  }
  return Buffer.from(bytes).toString('utf8');
}

export function parseDiffHeaderPath(headerValue, allowedPrefixes = ['b/']) {
  if (typeof headerValue !== 'string') return null;
  const trimmed = headerValue.trim().replace(/^\.\//, '');
  if (!trimmed || trimmed === '/dev/null' || trimmed.startsWith('/dev/null\t')) return null;

  const stripPrefix = candidate => {
    const norm = candidate.replace(/\\/g, '/').replace(/^\.\//, '');
    for (const prefix of allowedPrefixes) {
      if (norm.startsWith(prefix) && norm.length > prefix.length) {
        return norm.slice(prefix.length);
      }
    }
    return norm;
  };

  if (trimmed.startsWith('"')) {
    const closingIdx = (() => {
      let escaped = false;
      for (let i = 1; i < trimmed.length; i++) {
        if (escaped) escaped = false;
        else if (trimmed[i] === '\\') escaped = true;
        else if (trimmed[i] === '"') return i;
      }
      return -1;
    })();
    if (closingIdx === -1) return null;
    const rest = trimmed.slice(closingIdx + 1);
    if (rest && !rest.startsWith('\t')) return null;
    const decoded = decodeGitQuotedString(trimmed.slice(1, closingIdx));
    return decoded ? stripPrefix(decoded) : null;
  }

  const withoutTimestamp = trimmed.split('\t')[0];
  return stripPrefix(withoutTimestamp);
}

function parseGitDiffTargetPath(diffGitLine) {
  const body = diffGitLine.slice('diff --git '.length).trim();
  if (!body) return null;
  if (body.endsWith('"')) {
    let escaped = false;
    let closeQuote = -1;
    let openQuote = -1;
    for (let i = 0; i < body.length; i++) {
      if (escaped) {
        escaped = false;
      } else if (body[i] === '\\') {
        escaped = true;
      } else if (body[i] === '"') {
        if (openQuote === -1) openQuote = i;
        else {
          closeQuote = i;
          if (i === body.length - 1) {
            const decoded = decodeGitQuotedString(body.slice(openQuote + 1, closeQuote));
            return decoded?.startsWith('b/') ? decoded.slice(2) : null;
          }
          openQuote = -1;
          closeQuote = -1;
        }
      }
    }
  }
  const bIndex = body.lastIndexOf(' b/');
  return bIndex !== -1 ? body.slice(bIndex + 3) : null;
}

export function changedLines(diff) {
  if (typeof diff !== 'string') throw new TypeError('Expected a unified diff string');
  const lines = [];
  let path = null;
  let newLine = null;
  let remainingOld = 0;
  let remainingNew = 0;
  let inConflict = false;

  for (const line of diff.split(/\r?\n/)) {
    if (newLine !== null && (remainingOld || remainingNew)) {
      if (line.startsWith('+') && remainingNew) {
        const text = line.slice(1);
        if (/^<{7}(?:\s|$)/.test(text)) {
          inConflict = true;
        } else if (/^>{7}(?:\s|$)/.test(text)) {
          inConflict = false;
        } else if (!inConflict) {
          lines.push({ path, line: newLine, text });
        }
        newLine++;
        remainingNew--;
      } else if (line.startsWith('-') && remainingOld) {
        const text = line.slice(1);
        if (/^<{7}(?:\s|$)/.test(text)) {
          inConflict = true;
        } else if (/^>{7}(?:\s|$)/.test(text)) {
          inConflict = false;
        }
        remainingOld--;
      } else if (line.startsWith(' ') && remainingOld && remainingNew) {
        const text = line.slice(1);
        if (/^<{7}(?:\s|$)/.test(text)) {
          inConflict = true;
        } else if (/^>{7}(?:\s|$)/.test(text)) {
          inConflict = false;
        }
        newLine++;
        remainingOld--;
        remainingNew--;
      } else if (!line.startsWith('\\ No newline at end of file')) {
        newLine = null;
      }
      if (!remainingOld && !remainingNew) {
        newLine = null;
      }
      continue;
    }
    if (line.startsWith('diff --git ')) {
      path = null;
      newLine = null;
      inConflict = false;
    } else if (line.startsWith('--- ')) {
      newLine = null;
    } else if (line.startsWith('+++ ')) {
      path = parseDiffHeaderPath(line.slice(4));
      newLine = null;
    } else if (line.startsWith('rename to ')) {
      path = parseDiffHeaderPath(line.slice('rename to '.length), ['b/', '']) || line.slice('rename to '.length).trim();
      newLine = null;
    } else if (line.startsWith('copy to ')) {
      path = parseDiffHeaderPath(line.slice('copy to '.length), ['b/', '']) || line.slice('copy to '.length).trim();
      newLine = null;
    } else if (line.startsWith('@@ ')) {
      const match = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      newLine = path && match ? Number(match[2]) : null;
      remainingOld = match ? Number(match[1] ?? 1) : 0;
      remainingNew = match ? Number(match[3] ?? 1) : 0;
    }
  }
  return lines;
}

export function removedLines(diff) {
  if (typeof diff !== 'string') throw new TypeError('Expected a unified diff string');
  const lines = [];
  let oldPath = null;
  let newPath = null;
  let oldLine = null;
  let remainingOld = 0;
  let remainingNew = 0;
  let inConflict = false;

  for (const line of diff.split(/\r?\n/)) {
    const activePath = oldPath || newPath;
    if (oldLine !== null && (remainingOld || remainingNew)) {
      if (line.startsWith('-') && remainingOld) {
        const text = line.slice(1);
        if (/^<{7}(?:\s|$)/.test(text)) {
          inConflict = true;
        } else if (/^>{7}(?:\s|$)/.test(text)) {
          inConflict = false;
        } else if (!inConflict) {
          lines.push({ path: activePath, line: oldLine, text, changeType: 'deleted' });
        }
        oldLine++;
        remainingOld--;
      } else if (line.startsWith('+') && remainingNew) {
        const text = line.slice(1);
        if (/^<{7}(?:\s|$)/.test(text)) {
          inConflict = true;
        } else if (/^>{7}(?:\s|$)/.test(text)) {
          inConflict = false;
        }
        remainingNew--;
      } else if (line.startsWith(' ') && remainingOld && remainingNew) {
        const text = line.slice(1);
        if (/^<{7}(?:\s|$)/.test(text)) {
          inConflict = true;
        } else if (/^>{7}(?:\s|$)/.test(text)) {
          inConflict = false;
        }
        oldLine++;
        remainingOld--;
        remainingNew--;
      } else if (!line.startsWith('\\ No newline at end of file')) {
        oldLine = null;
      }
      if (!remainingOld && !remainingNew) {
        oldLine = null;
      }
      continue;
    }
    if (line.startsWith('diff --git ')) {
      oldPath = null;
      newPath = null;
      oldLine = null;
      inConflict = false;
    } else if (line.startsWith('--- ')) {
      oldPath = parseDiffHeaderPath(line.slice(4), ['a/']);
      oldLine = null;
    } else if (line.startsWith('+++ ')) {
      newPath = parseDiffHeaderPath(line.slice(4), ['b/']);
      oldLine = null;
    } else if (line.startsWith('rename from ')) {
      oldPath = parseDiffHeaderPath(line.slice('rename from '.length), ['a/', '']) || line.slice('rename from '.length).trim();
      oldLine = null;
    } else if (line.startsWith('rename to ')) {
      newPath = parseDiffHeaderPath(line.slice('rename to '.length), ['b/', '']) || line.slice('rename to '.length).trim();
      oldLine = null;
    } else if (line.startsWith('copy from ')) {
      oldPath = parseDiffHeaderPath(line.slice('copy from '.length), ['a/', '']) || line.slice('copy from '.length).trim();
      oldLine = null;
    } else if (line.startsWith('copy to ')) {
      newPath = line.slice('copy to '.length).trim();
      oldLine = null;
    } else if (line.startsWith('@@ ')) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
      oldLine = activePath && match ? Number(match[1]) : null;
      remainingOld = match ? Number(match[2] ?? 1) : 0;
      remainingNew = match ? Number(match[3] ?? 1) : 0;
    }
  }
  return lines;
}

export function filterAndIndexDiff(diff) {
  if (typeof diff !== 'string') throw new TypeError('Expected a unified diff string');
  const rawLines = diff.split(/\r?\n/);
  const sections = [];
  let current = [];

  for (const line of rawLines) {
    if (line.startsWith('diff --git ') && current.length > 0) {
      sections.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) sections.push(current);

  const keptSections = [];
  const excludedSet = new Set();

  for (const section of sections) {
    let sectionPath = null;
    let fallbackOldPath = null;
    let inHunk = false;
    let remOld = 0;
    let remNew = 0;
    let isBinaryOrNonText = false;

    for (const line of section) {
      if (
        line.startsWith('Binary files ') ||
        line.startsWith('GIT binary patch') ||
        line.startsWith('index ') && line.includes('..') && line.endsWith(' 160000') // git submodule
      ) {
        isBinaryOrNonText = true;
        break;
      }
      if (inHunk && (remOld || remNew)) {
        if (line.startsWith('+') && remNew) remNew--;
        else if (line.startsWith('-') && remOld) remOld--;
        else if (line.startsWith(' ') && remOld && remNew) { remOld--; remNew--; }
        else if (!line.startsWith('\\ No newline at end of file')) inHunk = false;
        if (!remOld && !remNew) inHunk = false;
        continue;
      }
      if (line.startsWith('--- ')) {
        const parsedOld = parseDiffHeaderPath(line.slice(4), ['a/']);
        if (parsedOld) fallbackOldPath = parsedOld;
      } else if (line.startsWith('+++ ')) {
        const parsed = parseDiffHeaderPath(line.slice(4), ['b/']);
        if (parsed) {
          sectionPath = parsed;
          break;
        }
      } else if (line.startsWith('rename to ')) {
        sectionPath = line.slice('rename to '.length).trim();
      } else if (line.startsWith('copy to ')) {
        sectionPath = line.slice('copy to '.length).trim();
      } else if (line.startsWith('@@ ')) {
        const match = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
        if (match) {
          inHunk = true;
          remOld = Number(match[1] ?? 1);
          remNew = Number(match[2] ?? 1);
        }
      }
    }

    if (isBinaryOrNonText) {
      continue;
    }

    if (!sectionPath && fallbackOldPath) {
      sectionPath = fallbackOldPath;
    }
    if (!sectionPath && section[0]?.startsWith('diff --git ')) {
      sectionPath = parseGitDiffTargetPath(section[0]);
    }

    if (sectionPath && isNoisePath(sectionPath)) {
      excludedSet.add(sectionPath);
    } else {
      keptSections.push(section.join('\n'));
    }
  }

  const filteredDiff = keptSections.join('\n');
  const added = changedLines(filteredDiff);
  const removed = removedLines(filteredDiff);
  return {
    filteredDiff,
    lines: added,
    removedLines: removed,
    allChangedLines: [...added, ...removed],
    excludedFiles: [...excludedSet]
  };
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'must', 'shall', 'should', 'when', 'that', 'this', 'from', 'into',
  'have', 'has', 'had', 'will', 'each', 'only', 'user', 'users', 'system', 'application', 'service',
  'request', 'response', 'data', 'value', 'values', 'error', 'errors', 'status', 'code', 'all', 'any',
  'are', 'not', 'can', 'may', 'via', 'per', 'after', 'before', 'within', 'under', 'over', 'than'
]);

const LOW_PRIORITY_SEGMENTS = new Set([
  '__tests__', '__mocks__', '__fixtures__',
  'test', 'tests', 'spec', 'specs',
  'fixtures', 'mocks', 'examples', 'docs',
  'cypress', 'playwright'
]);
const LOW_PRIORITY_SUFFIXES = [
  '.test.', '.spec.', '.stories.', '.fixture.', '.mock.',
  '.md', '.txt', '.csv', '.svg'
];

export function isLowPriorityPath(filePath) {
  if (typeof filePath !== 'string' || !filePath) return false;
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  if (!segments.length) return false;
  if (segments.some(seg => LOW_PRIORITY_SEGMENTS.has(seg.toLowerCase()))) return true;
  const base = segments[segments.length - 1].toLowerCase();
  return LOW_PRIORITY_SUFFIXES.some(suf => base.includes(suf) || base.endsWith(suf));
}

const SYMBOL_DECL_REGEX = /\b(?:export\s+(?:async\s+)?(?:function|class|const|let|interface|type|enum|default)|public\s+(?:async\s+|static\s+)?[A-Za-z0-9_<>]+\s+[A-Za-z0-9_]+\s*\(|def\s+[A-Za-z_][A-Za-z0-9_]*\s*\(|func\s+(?:\([^)]+\)\s*)?[A-Za-z_][A-Za-z0-9_]*\s*\(|class\s+[A-Z][A-Za-z0-9_]*|function\s+[A-Za-z_][A-Za-z0-9_]*\s*\()/;

function extractRequirementKeywords(requirements) {
  const keywords = new Set();
  if (!Array.isArray(requirements)) return keywords;
  for (const req of requirements) {
    if (typeof req !== 'string') continue;
    const expanded = req.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
    const tokens = expanded.match(/[\p{L}\p{N}_]{2,}/gu) || [];
    for (const token of tokens) {
      if (!STOP_WORDS.has(token) && !/^\d+$/.test(token)) {
        keywords.add(token);
      }
    }
  }
  return keywords;
}

function scoreHunk(filePath, hunkLines, keywords) {
  let score = isLowPriorityPath(filePath || '') ? -30 : 40;
  const bodyLines = hunkLines.slice(1);
  const addedLines = bodyLines.filter(line => line.startsWith('+')).map(line => line.slice(1));
  const deletedLines = bodyLines.filter(line => line.startsWith('-')).map(line => line.slice(1));
  const modifiedLines = [...addedLines, ...deletedLines];

  if (modifiedLines.length === 0) {
    score -= 20;
  } else {
    score += addedLines.length > 0 ? 15 : 8;
    if (modifiedLines.some(line => SYMBOL_DECL_REGEX.test(line))) {
      score += 25;
    }
  }

  if (keywords.size > 0) {
    const haystack = `${filePath || ''}\n${modifiedLines.join('\n')}`
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase();
    let matchedCount = 0;
    for (const kw of keywords) {
      if (haystack.includes(kw)) {
        matchedCount++;
        if (matchedCount >= 8) break;
      }
    }
    score += matchedCount * 10;
  }

  return score;
}

export function budgetDiffByRelevance(filteredDiff, requirements = [], maxChars = 100000) {
  if (typeof filteredDiff !== 'string') throw new TypeError('Expected a unified diff string');
  let reqs = requirements;
  let limit = maxChars;
  if (requirements && typeof requirements === 'object' && !Array.isArray(requirements)) {
    limit = typeof requirements.maxChars === 'number' ? requirements.maxChars : maxChars;
    reqs = Array.isArray(requirements.requirements) ? requirements.requirements : (Array.isArray(requirements.keywords) ? requirements.keywords : []);
  }

  if (filteredDiff.length <= limit) {
    const added = changedLines(filteredDiff);
    const removed = removedLines(filteredDiff);
    return {
      budgetedDiff: filteredDiff,
      lines: added,
      removedLines: removed,
      allChangedLines: [...added, ...removed],
      omittedFiles: [],
      wasBudgeted: false
    };
  }

  const rawLines = filteredDiff.split(/\r?\n/);
  const rawSections = [];
  let current = [];
  for (const line of rawLines) {
    if (line.startsWith('diff --git ') && current.length > 0) {
      rawSections.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) rawSections.push(current);

  const keywords = extractRequirementKeywords(reqs);
  const parsedSections = [];
  const candidateHunks = [];

  rawSections.forEach((sectionLines, sectionIdx) => {
    let filePath = null;
    let fallbackOldPath = null;
    const headerLines = [];
    const hunks = [];
    let currentHunk = null;

    for (const line of sectionLines) {
      if (line.startsWith('@@ ')) {
        if (currentHunk) hunks.push(currentHunk);
        currentHunk = [line];
      } else if (currentHunk) {
        currentHunk.push(line);
      } else {
        headerLines.push(line);
        if (!fallbackOldPath && line.startsWith('--- ')) {
          fallbackOldPath = parseDiffHeaderPath(line.slice(4), ['a/']);
        } else if (!filePath && line.startsWith('+++ ')) {
          filePath = parseDiffHeaderPath(line.slice(4), ['b/']);
        }
      }
    }
    if (currentHunk) hunks.push(currentHunk);
    if (!filePath && fallbackOldPath) filePath = fallbackOldPath;
    if (!filePath && sectionLines[0]?.startsWith('diff --git ')) {
      filePath = parseGitDiffTargetPath(sectionLines[0]);
    }

    const headerText = headerLines.join('\n');
    const hunkObjects = hunks.map((hLines, hunkIdx) => {
      const text = hLines.join('\n');
      const score = scoreHunk(filePath, hLines, keywords);
      const item = { sectionIdx, hunkIdx, text, lines: hLines, score };
      candidateHunks.push(item);
      return item;
    });

    parsedSections.push({
      sectionIdx,
      filePath,
      headerText,
      hunks: hunkObjects
    });
  });

  candidateHunks.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.text.length !== b.text.length) return a.text.length - b.text.length;
    if (a.sectionIdx !== b.sectionIdx) return a.sectionIdx - b.sectionIdx;
    return a.hunkIdx - b.hunkIdx;
  });

  const selectedBySection = new Map();
  let usedChars = 0;

  for (const cand of candidateHunks) {
    const sec = parsedSections[cand.sectionIdx];
    const existingSet = selectedBySection.get(cand.sectionIdx);
    const additionalChars = existingSet
      ? 1 + cand.text.length
      : (selectedBySection.size > 0 ? 1 : 0) + sec.headerText.length + 1 + cand.text.length;

    if (usedChars + additionalChars <= limit) {
      if (!existingSet) {
        selectedBySection.set(cand.sectionIdx, new Set([cand.hunkIdx]));
      } else {
        existingSet.add(cand.hunkIdx);
      }
      usedChars += additionalChars;
    }
  }

  const rebuiltSections = [];
  const omittedSet = new Set();

  for (const sec of parsedSections) {
    const chosen = selectedBySection.get(sec.sectionIdx);
    if (!chosen || chosen.size === 0) {
      if (sec.filePath) omittedSet.add(sec.filePath);
      continue;
    }
    if (chosen.size < sec.hunks.length && sec.filePath) {
      omittedSet.add(sec.filePath);
    }
    const orderedHunks = sec.hunks
      .filter(h => chosen.has(h.hunkIdx))
      .sort((a, b) => a.hunkIdx - b.hunkIdx)
      .map(h => h.text);
    rebuiltSections.push(`${sec.headerText}\n${orderedHunks.join('\n')}`);
  }

  // Gracefully slices candidate hunks exceeding remaining budget so PRs maximize evidence within the limit.
  const remainingBudget = limit - usedChars;
  if (remainingBudget >= 60) {
    const unselectedCand = candidateHunks.find(cand => {
      const chosen = selectedBySection.get(cand.sectionIdx);
      return !chosen || !chosen.has(cand.hunkIdx);
    });

    if (unselectedCand) {
      const sec = parsedSections[unselectedCand.sectionIdx];
      const existingChosen = selectedBySection.get(unselectedCand.sectionIdx);
      const isNewSection = !existingChosen || existingChosen.size === 0;
      const header = sec.headerText || `diff --git a/${sec.filePath || 'file'} b/${sec.filePath || 'file'}`;
      const headerOverhead = isNewSection ? header.length + 2 : 1;
      const allowedHunkChars = Math.max(30, remainingBudget - headerOverhead);

      const hunkLines = sec.hunks[unselectedCand.hunkIdx]?.lines || sec.hunks[unselectedCand.hunkIdx]?.text?.split(/\r?\n/) || [];
      const headerMatch = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/.exec(hunkLines[0] || '');
      if (headerMatch) {
        const oldStart = Number(headerMatch[1]);
        const newStart = Number(headerMatch[3]);
        const suffix = headerMatch[5] || '';
        let accChars = 0;
        let slicedOld = 0;
        let slicedNew = 0;
        const slicedBody = [];
        for (const line of hunkLines.slice(1)) {
          if (accChars + line.length + 1 > allowedHunkChars) break;
          if (line.startsWith('-')) slicedOld++;
          else if (line.startsWith('+')) slicedNew++;
          else if (line.startsWith(' ')) { slicedOld++; slicedNew++; }
          slicedBody.push(line);
          accChars += line.length + 1;
        }
        if (slicedBody.length > 0) {
          const slicedHunk = `@@ -${oldStart},${slicedOld} +${newStart},${slicedNew} @@${suffix}\n${slicedBody.join('\n')}`;
          if (isNewSection) {
            rebuiltSections.push(`${header}\n${slicedHunk}`);
          } else {
            const secIdx = rebuiltSections.findIndex(s => s.startsWith(header));
            if (secIdx >= 0) {
              rebuiltSections[secIdx] = `${rebuiltSections[secIdx]}\n${slicedHunk}`;
            } else {
              rebuiltSections.push(`${header}\n${slicedHunk}`);
            }
          }
          if (sec.filePath) omittedSet.add(sec.filePath);
        }
      }
    }
  }

  const budgetedDiff = rebuiltSections.join('\n');
  const added = changedLines(budgetedDiff);
  const removed = removedLines(budgetedDiff);
  return {
    budgetedDiff,
    lines: added,
    removedLines: removed,
    allChangedLines: [...added, ...removed],
    omittedFiles: [...omittedSet],
    wasBudgeted: true
  };
}

export function verifyCitation(lines, citation) {
  if (!citation || typeof citation.path !== 'string' || !Number.isInteger(citation.line) ||
      typeof citation.text !== 'string' || citation.text.trim() === '') return false;
  return lines.some(line => line.path === citation.path && line.line === citation.line && line.text === citation.text);
}

export function annotateDiffForPrompt(diff) {
  if (typeof diff !== 'string' || !diff) return '';
  const out = [];
  let oldPath = null;
  let newPath = null;
  let oldLine = null;
  let newLine = null;
  let remainingOld = 0;
  let remainingNew = 0;

  for (const line of diff.split(/\r?\n/)) {
    if ((oldLine !== null || newLine !== null) && (remainingOld || remainingNew)) {
      if (line.startsWith('+') && remainingNew) {
        const ln = newLine !== null ? newLine++ : null;
        remainingNew--;
        out.push(ln !== null ? `+[L${ln}] ${line.slice(1)}` : line);
      } else if (line.startsWith('-') && remainingOld) {
        const ln = oldLine !== null ? oldLine++ : null;
        remainingOld--;
        out.push(ln !== null ? `-[L${ln}] ${line.slice(1)}` : line);
      } else if (line.startsWith(' ') && remainingOld && remainingNew) {
        const ln = newLine !== null ? newLine++ : oldLine;
        if (oldLine !== null) oldLine++;
        remainingOld--;
        remainingNew--;
        out.push(ln !== null ? ` [L${ln}] ${line.slice(1)}` : line);
      } else if (line.startsWith('\\ No newline at end of file')) {
        out.push(line);
      } else {
        oldLine = null;
        newLine = null;
        out.push(line);
      }
      if (!remainingOld && !remainingNew) {
        oldLine = null;
        newLine = null;
      }
      continue;
    }

    if (line.startsWith('diff --git ')) {
      oldPath = null;
      newPath = null;
      oldLine = null;
      newLine = null;
    } else if (line.startsWith('--- ')) {
      oldPath = parseDiffHeaderPath(line.slice(4), ['a/']);
      oldLine = null;
    } else if (line.startsWith('+++ ')) {
      newPath = parseDiffHeaderPath(line.slice(4), ['b/']);
      newLine = null;
    } else if (line.startsWith('@@ ')) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      const activePath = newPath || oldPath;
      oldLine = activePath && match ? Number(match[1]) : null;
      remainingOld = match ? Number(match[2] ?? 1) : 0;
      newLine = newPath && match ? Number(match[3]) : null;
      remainingNew = match ? Number(match[4] ?? 1) : 0;
    }
    out.push(line);
  }

  return out.join('\n');
}

function stripPromptLineTag(value) {
  return value.replace(/^(?:[+-]?\[L\d+\]\s?)/, '');
}

const CONFLICT_MARKER_REGEX = /^(?:<{7}|={7}|>{7})(?:\s|$)/;

function isPureCommentLine(text) {
  const t = text.trim();
  if (/^\/\//.test(t)) return true;
  if (/^#(?!include\b)/.test(t)) return true;
  if (/^\/\*.*\*\/$/.test(t)) return true;
  if (/^\*/.test(t)) return true;
  if (/^<!--.*-->$/.test(t)) return true;
  if (/^--(?!\w)/.test(t)) return true;
  return false;
}

export function resolveVerifiedCitation(lines, citation) {
  const lineNum = Number.isInteger(citation?.line)
    ? citation.line
    : (/^\d+$/.test(String(citation?.line ?? '').trim()) ? Number(citation.line) : null);

  if (!Array.isArray(lines) || !citation || typeof citation.path !== 'string' ||
      lineNum === null || typeof citation.text !== 'string' ||
      citation.text.trim() === '') {
    return null;
  }

  const cleanedText = stripPromptLineTag(citation.text).trim();
  if (
    !cleanedText ||
    CONFLICT_MARKER_REGEX.test(cleanedText) ||
    CONFLICT_MARKER_REGEX.test(citation.text.trim()) ||
    isPureCommentLine(cleanedText)
  ) {
    return null;
  }

  const rawPath = citation.path.trim();
  const strippedPath = rawPath.replace(/^[ab]\//, '');
  const pathMatches = entryPath => entryPath === rawPath || entryPath === strippedPath;
  const toCanonical = entry => (
    entry.changeType === 'deleted'
      ? { path: entry.path, line: entry.line, text: entry.text, changeType: 'deleted' }
      : { path: entry.path, line: entry.line, text: entry.text }
  );

  const exact = lines.find(
    entry => pathMatches(entry.path) && entry.line === lineNum && entry.text === citation.text
  );
  if (exact) return toCanonical(exact);

  const trimmedMatch = lines.find(
    entry => pathMatches(entry.path) && entry.line === lineNum && entry.text.trim() === cleanedText
  );
  return trimmedMatch ? toCanonical(trimmedMatch) : null;
}

export function enrichCitationContext(diff, citation, contextRadius = 2) {
  if (!citation || typeof citation.path !== 'string' || !Number.isInteger(citation.line) || typeof citation.text !== 'string') {
    return citation;
  }
  if (typeof diff !== 'string' || !diff.trim()) {
    return citation.changeType === 'deleted'
      ? { path: citation.path, line: citation.line, text: citation.text, changeType: 'deleted' }
      : { path: citation.path, line: citation.line, text: citation.text };
  }

  const radius = Math.max(0, Math.min(5, Number.isInteger(contextRadius) ? contextRadius : 2));
  let oldPath = null;
  let newPath = null;
  let oldLine = null;
  let newLine = null;
  let remainingOld = 0;
  let remainingNew = 0;
  let currentAddedHunkLines = [];
  let currentDeletedHunkLines = [];
  const addedHunksForPath = [];
  const deletedHunksForPath = [];

  const flushHunk = () => {
    const activePath = newPath || oldPath;
    if (activePath === citation.path) {
      if (currentAddedHunkLines.length > 0) addedHunksForPath.push(currentAddedHunkLines);
      if (currentDeletedHunkLines.length > 0) deletedHunksForPath.push(currentDeletedHunkLines);
    }
    currentAddedHunkLines = [];
    currentDeletedHunkLines = [];
  };

  for (const rawLine of diff.split(/\r?\n/)) {
    if ((newLine !== null || oldLine !== null) && (remainingOld || remainingNew)) {
      if (rawLine.startsWith('+') && remainingNew) {
        if (newLine !== null) {
          currentAddedHunkLines.push({ line: newLine++, text: rawLine.slice(1), isAdded: true });
        }
        remainingNew--;
      } else if (rawLine.startsWith('-') && remainingOld) {
        if (oldLine !== null) {
          currentDeletedHunkLines.push({ line: oldLine++, text: rawLine.slice(1), isDeleted: true });
        }
        remainingOld--;
      } else if (rawLine.startsWith(' ') && remainingOld && remainingNew) {
        if (newLine !== null) {
          currentAddedHunkLines.push({ line: newLine++, text: rawLine.slice(1), isAdded: false });
        }
        if (oldLine !== null) {
          currentDeletedHunkLines.push({ line: oldLine++, text: rawLine.slice(1), isDeleted: false });
        }
        remainingOld--;
        remainingNew--;
      } else if (!rawLine.startsWith('\\ No newline at end of file')) {
        flushHunk();
        newLine = null;
        oldLine = null;
      }
      if (!remainingOld && !remainingNew) {
        flushHunk();
        newLine = null;
        oldLine = null;
      }
      continue;
    }

    if (rawLine.startsWith('diff --git ')) {
      flushHunk();
      oldPath = null;
      newPath = null;
      oldLine = null;
      newLine = null;
    } else if (rawLine.startsWith('--- ')) {
      flushHunk();
      oldPath = parseDiffHeaderPath(rawLine.slice(4), ['a/']);
      oldLine = null;
    } else if (rawLine.startsWith('+++ ')) {
      flushHunk();
      newPath = parseDiffHeaderPath(rawLine.slice(4), ['b/']);
      newLine = null;
    } else if (rawLine.startsWith('@@ ')) {
      flushHunk();
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(rawLine);
      const activePath = newPath || oldPath;
      oldLine = activePath && match ? Number(match[1]) : null;
      remainingOld = match ? Number(match[2] ?? 1) : 0;
      newLine = newPath && match ? Number(match[3]) : null;
      remainingNew = match ? Number(match[4] ?? 1) : 0;
    }
  }
  flushHunk();

  if (citation.changeType !== 'deleted') {
    for (const hunk of addedHunksForPath) {
      const idx = hunk.findIndex(
        entry => entry.isAdded && entry.line === citation.line && entry.text === citation.text
      );
      if (idx !== -1) {
        const startIdx = Math.max(0, idx - radius);
        const endIdx = Math.min(hunk.length, idx + radius + 1);
        const slice = hunk.slice(startIdx, endIdx);
        return {
          path: citation.path,
          line: citation.line,
          text: citation.text,
          snippet: slice.map(item => item.text).join('\n'),
          highlightLine: idx - startIdx + 1,
          startLine: slice[0].line,
          endLine: slice[slice.length - 1].line
        };
      }
    }
  }

  for (const hunk of deletedHunksForPath) {
    const idx = hunk.findIndex(
      entry => entry.isDeleted && entry.line === citation.line && entry.text === citation.text
    );
    if (idx !== -1) {
      const startIdx = Math.max(0, idx - radius);
      const endIdx = Math.min(hunk.length, idx + radius + 1);
      const slice = hunk.slice(startIdx, endIdx);
      return {
        path: citation.path,
        line: citation.line,
        text: citation.text,
        changeType: 'deleted',
        snippet: slice.map(item => item.text).join('\n'),
        highlightLine: idx - startIdx + 1,
        startLine: slice[0].line,
        endLine: slice[slice.length - 1].line
      };
    }
  }

  return citation.changeType === 'deleted'
    ? { path: citation.path, line: citation.line, text: citation.text, changeType: 'deleted' }
    : { path: citation.path, line: citation.line, text: citation.text };
}
