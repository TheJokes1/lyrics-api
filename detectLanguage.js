// Node 16-friendly CommonJS
const { francAll, franc } = require('franc-min');  // small language-id model
const ISO6391 = require('iso-639-1');

/**
 * Normalize lyrics by removing brackets/section headers and trimming noise.
 */
function normalizeLyrics(input = '') {
  if (!input) return '';
  let text = input;

  // Remove common section headers like [Chorus], (Verse), etc.
  text = text.replace(/\[[^\]]+\]/g, ' ');
  text = text.replace(/\([^)]+\)/g, ' ');

  // Collapse repeated punctuation and whitespace
  text = text.replace(/[^\p{L}\p{N}\s'’-]+/gu, ' ');
  text = text.replace(/\s{2,}/g, ' ').trim();

  return text;
}

/**
 * Map a 3-letter ISO 639-3 code (franc) to ISO 639-1 for convenience.
 * Returns { iso1, iso3, languageName }
 */
function mapToIso(iso3) {
  if (!iso3 || typeof iso3 !== 'string') {
    return { iso1: null, iso3: null, languageName: null };
  }
  const iso1 = ISO6391.getCode(ISO6391.getName(iso3) || '') || null;
  // Some mappings where ISO6391.getCode(name) might fail—fallback directly by known pairs
  // (franc uses ISO 639-3 like 'nld' for Dutch, 'fra' for French, 'eng' for English)
  const directMap = {
    nld: 'nl',
    deu: 'de',
    eng: 'en',
    fra: 'fr',
    spa: 'es',
    ita: 'it',
    por: 'pt',
    rus: 'ru',
    tur: 'tr',
    pol: 'pl',
    swe: 'sv',
    fin: 'fi',
    dan: 'da',
    nor: 'no',
    aze: 'az',
    ron: 'ro',
    hun: 'hu',
    ces: 'cs',
    slk: 'sk',
    slv: 'sl',
    hrv: 'hr',
    srp: 'sr',
    bul: 'bg',
    ell: 'el',
    heb: 'he',
    arb: 'ar',
    hin: 'hi',
    ben: 'bn',
    jpn: 'ja',
    kor: 'ko',
    zho: 'zh',
    ind: 'id',
    msa: 'ms',
    vie: 'vi'
  };
  const iso1FromMap = directMap[iso3] || null;
  const name = ISO6391.getName(iso1FromMap || '') || null;

  return {
    iso1: iso1FromMap,
    iso3,
    languageName: name
  };
}

/**
 * Detect language of given lyrics text.
 * @param {string} rawText - Lyrics text
 * @param {object} [opts]
 * @param {number} [opts.minLength=20] - Minimum characters to attempt robust detection
 * @param {number} [opts.maxChars=2000] - Limit to reduce CPU on very long submissions
 * @param {number} [opts.confidenceFloor=0.2] - Minimum relative score fraction to accept
 * @returns {{
 *   iso1: string|null,
 *   iso3: string|null,
 *   languageName: string|null,
 *   score: number|null,
 *   candidates: Array<{ iso3: string, score: number }>,
 *   method: 'franc'|'heuristic'|'und',
 *   reason?: string
 * }}
 */
function detectLanguage(rawText, opts = {}) {
  const {
    minLength = 20,
    maxChars = 2000,
    confidenceFloor = 0.2
  } = opts;

  const text = normalizeLyrics(rawText).slice(0, maxChars);

  if (!text || text.length < 5) {
    return {
      iso1: null,
      iso3: null,
      languageName: null,
      score: null,
      candidates: [],
      method: 'und',
      reason: 'too-short-or-empty'
    };
  }

  // franc baseline detection for short texts is shaky—guard with minLength
  const tryFranc = text.length >= minLength;

  if (tryFranc) {
    // francAll returns top candidates with scores; higher is better
    const results = francAll(text, { minLength: 10 }).slice(0, 5); // top-5
    // results: [ [ 'eng', 1 ], [ 'nld', 0.8 ], ... ]
    if (results.length > 0 && results[0][0] !== 'und') {
      const top = results[0];
      const topScore = top[1] || 0;
      // compute relative gap confidence vs. second-best
      const secondScore = results[1]?.[1] ?? 0;
      const rel = topScore === 0 ? 0 : (topScore - secondScore) / topScore;

      // Basic acceptance rule: either top is strong on absolute score OR relatively better than #2
      const accept = topScore >= 0.6 || rel >= confidenceFloor;

      if (accept) {
        const candidates = results.map(([iso3, score]) => ({ iso3, score }));
        const mapped = mapToIso(top[0]);
        return {
          ...mapped,
          score: topScore,
          candidates,
          method: 'franc'
        };
      }
    }
  }

  // Heuristic fallback: quick signal for EN/NL/FR based on characteristic tokens/diacritics
  const lower = text.toLowerCase();

  const scoreHeu = {
    en: 0,
    nl: 0,
    fr: 0
  };

  // English: common stopwords
  [' the ', ' and ', ' you ', ' i ', ' we ', " i'm ", " don't ", " can't ", ' love ', ' baby ']
    .forEach(t => { if (lower.includes(t)) scoreHeu.en += 1; });

  // Dutch: 'de', 'het', 'ik', 'jij', 'niet', 'm'n', 'z'n', '’k', 'geen'
  [' de ', ' het ', ' ik ', ' jij ', ' niet ', " m'n ", " z'n ", " ’k ", ' geen ', ' want ']
    .forEach(t => { if (lower.includes(t)) scoreHeu.nl += 1; });

  // French: articles & diacritics
  [' le ', ' la ', ' les ', ' je ', ' tu ', ' nous ', ' vous ', " c'", ' pas ', ' pour ']
    .forEach(t => { if (lower.includes(t)) scoreHeu.fr += 1; });
  // Accented letters strongly suggest FR
  if (/[éèêàùçâîôû]/i.test(text)) scoreHeu.fr += 1;

  const sortedHeu = Object.entries(scoreHeu).sort((a, b) => b[1] - a[1]);
  const bestHeu = sortedHeu[0];
  if (bestHeu && bestHeu[1] >= 2) {
    const mapIso1To3 = { en: 'eng', nl: 'nld', fr: 'fra' };
    const iso1 = bestHeu[0];
    const iso3 = mapIso1To3[iso1];
    return {
      iso1,
      iso3,
      languageName: ISO6391.getName(iso1) || null,
      score: bestHeu[1],
      candidates: sortedHeu.map(([iso1, s]) => ({ iso3: mapIso1To3[iso1], score: s })),
      method: 'heuristic',
      reason: 'franc-low-confidence'
    };
  }

  return {
    iso1: null,
    iso3: null,
    languageName: null,
    score: null,
    candidates: [],
    method: 'und',
    reason: 'low-confidence'
  };
}

module.exports = {
  detectLanguage,
  normalizeLyrics
};
