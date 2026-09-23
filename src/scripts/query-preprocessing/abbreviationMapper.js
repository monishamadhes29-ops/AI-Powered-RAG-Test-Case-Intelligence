/**
 * Abbreviation Mapper
 * Expands healthcare and domain-specific abbreviations
 */

import { abbreviationMap, testCasePrefixes } from './dictionaries.js';

/**
 * Abbreviation map entries are either a plain string, or an object
 * { default, alternates: [{ value, keywords }] } for abbreviations with
 * more than one meaning (e.g. "ip" -> inpatient vs internet protocol).
 */
function getDefaultExpansion(entry) {
  return typeof entry === 'string' ? entry : entry.default;
}

/**
 * Expand abbreviations in text
 * @param {string} text - Input text with abbreviations
 * @param {Object} customMap - Additional abbreviations
 * @returns {Object} - { expanded, mappings }
 */
export function expandAbbreviations(text, customMap = {}) {
  if (!text || typeof text !== 'string') {
    return { expanded: '', mappings: [] };
  }

  const allAbbreviations = { ...abbreviationMap, ...customMap };
  const mappings = [];
  let expanded = text.toLowerCase();

  // Sort by length (longest first) to handle overlapping abbreviations
  const sortedAbbrevs = Object.entries(allAbbreviations)
    .sort(([a], [b]) => b.length - a.length);

  for (const [abbrev, entry] of sortedAbbrevs) {
    const fullForm = getDefaultExpansion(entry);

    // Word boundary regex to match whole words only
    // Handles: "UHID", "uhid", "UHID_123", "uhid-patient"
    const regex = new RegExp(`\\b${abbrev}\\b`, 'gi');

    if (regex.test(expanded)) {
      mappings.push({
        abbreviation: abbrev,
        expansion: fullForm,
        position: expanded.search(regex)
      });

      expanded = expanded.replace(regex, fullForm);
    }
  }

  return { expanded, mappings };
}

/**
 * Expand abbreviations with context awareness
 * Abbreviations with an `alternates` list in abbreviationMap are resolved
 * by scanning a word-window around each match for that alternate's keywords;
 * the default expansion is used when no alternate's keywords are found.
 * @param {string} text - Input text
 * @param {Object} options - Expansion options
 * @param {Object} [options.customMap] - Additional abbreviations
 * @param {number} [options.contextWindow] - Characters of context scanned on each side of a match
 * @returns {Object} - { expanded, mappings, ambiguous }
 */
export function expandAbbreviationsContextual(text, options = {}) {
  const { customMap = {}, contextWindow = 40 } = options;

  if (!text || typeof text !== 'string') {
    return { expanded: '', mappings: [], ambiguous: [] };
  }

  const allAbbreviations = { ...abbreviationMap, ...customMap };
  const mappings = [];
  const ambiguous = [];
  let expanded = text.toLowerCase();

  const sortedAbbrevs = Object.entries(allAbbreviations)
    .sort(([a], [b]) => b.length - a.length);

  for (const [abbrev, entry] of sortedAbbrevs) {
    const defaultExpansion = getDefaultExpansion(entry);
    const alternates = typeof entry === 'object' ? entry.alternates || [] : [];
    const regex = new RegExp(`\\b${abbrev}\\b`, 'gi');

    expanded = expanded.replace(regex, (match, offset, full) => {
      let chosenExpansion = defaultExpansion;
      let matchedSignal = null;

      if (alternates.length > 0) {
        const windowStart = Math.max(0, offset - contextWindow);
        const windowEnd = Math.min(full.length, offset + match.length + contextWindow);
        const windowText = full.slice(windowStart, windowEnd);

        for (const alternate of alternates) {
          const signal = alternate.keywords.find(keyword =>
            new RegExp(`\\b${keyword}\\b`, 'i').test(windowText)
          );

          if (signal) {
            chosenExpansion = alternate.value;
            matchedSignal = signal;
            break;
          }
        }

        ambiguous.push({
          abbreviation: abbrev,
          possibleExpansions: [defaultExpansion, ...alternates.map(a => a.value)],
          chosenExpansion,
          matchedSignal
        });
      }

      mappings.push({
        abbreviation: abbrev,
        expansion: chosenExpansion,
        position: offset
      });

      return chosenExpansion;
    });
  }

  return { expanded, mappings, ambiguous };
}

/**
 * Expand only healthcare-specific abbreviations
 * @param {string} text - Input text
 * @returns {Object} - { expanded, mappings }
 */
export function expandHealthcareAbbreviations(text) {
  const healthcareAbbrevs = {
    "uhid": "unique health id",
    "mrn": "medical record number",
    "op": "outpatient",
    "ip": "inpatient",
    "otp": "one time password",
    "er": "emergency room",
    "icu": "intensive care unit",
    "bp": "blood pressure",
    "hr": "heart rate",
    "rx": "prescription",
    "dx": "diagnosis",
    "dob": "date of birth",
    "emr": "electronic medical record",
    "ehr": "electronic health record"
  };

  return expandAbbreviations(text, healthcareAbbrevs);
}

/**
 * Reverse operation: convert full forms back to abbreviations
 * Useful for displaying compact results
 * @param {string} text - Text with full forms
 * @returns {Object} - { abbreviated, mappings }
 */
export function abbreviateText(text) {
  if (!text) return { abbreviated: text, mappings: [] };

  const mappings = [];
  let abbreviated = text.toLowerCase();

  // Reverse the abbreviation map (uses the default expansion for ambiguous entries)
  const reverseMap = Object.entries(abbreviationMap).reduce((acc, [abbrev, entry]) => {
    acc[getDefaultExpansion(entry)] = abbrev;
    return acc;
  }, {});

  // Sort by length (longest first)
  const sortedReverse = Object.entries(reverseMap)
    .sort(([a], [b]) => b.length - a.length);

  for (const [fullForm, abbrev] of sortedReverse) {
    const regex = new RegExp(`\\b${fullForm}\\b`, 'gi');
    
    if (regex.test(abbreviated)) {
      mappings.push({
        fullForm,
        abbreviation: abbrev
      });
      
      abbreviated = abbreviated.replace(regex, abbrev.toUpperCase());
    }
  }

  return { abbreviated, mappings };
}

/**
 * Get all possible abbreviations in text without expanding
 * Useful for analysis
 * @param {string} text - Input text
 * @returns {Array} - List of found abbreviations
 */
export function findAbbreviations(text) {
  if (!text) return [];

  const found = [];
  const lowerText = text.toLowerCase();

  Object.entries(abbreviationMap).forEach(([abbrev, entry]) => {
    const fullForm = getDefaultExpansion(entry);
    const alternates = typeof entry === 'object' ? entry.alternates : undefined;
    const regex = new RegExp(`\\b${abbrev}\\b`, 'gi');
    let match;

    while ((match = regex.exec(lowerText)) !== null) {
      found.push({
        abbreviation: abbrev,
        expansion: fullForm,
        ...(alternates ? { alternates: alternates.map(a => a.value) } : {}),
        position: match.index,
        original: match[0]
      });
    }
  });

  return found.sort((a, b) => a.position - b.position);
}

/**
 * Batch expand abbreviations for multiple texts
 * @param {string[]} texts - Array of texts
 * @param {Object} customMap - Custom abbreviations
 * @returns {Array} - Array of expansion results
 */
export function batchExpandAbbreviations(texts, customMap = {}) {
  if (!Array.isArray(texts)) {
    return [];
  }

  return texts.map(text => expandAbbreviations(text, customMap));
}

/**
 * Smart expansion: only expand if context suggests healthcare domain
 * @param {string} text - Input text
 * @returns {Object} - { expanded, mappings, confidence }
 */
export function smartExpand(text) {
  if (!text) {
    return { expanded: '', mappings: [], confidence: 0 };
  }

  // Healthcare context indicators
  const healthcareKeywords = [
    'patient', 'doctor', 'hospital', 'medical', 'diagnosis',
    'prescription', 'treatment', 'appointment', 'admission',
    'discharge', 'pharmacy', 'lab', 'test', 'registration'
  ];

  const lowerText = text.toLowerCase();
  const contextMatches = healthcareKeywords.filter(keyword => 
    lowerText.includes(keyword)
  ).length;

  const confidence = Math.min(contextMatches / 3, 1.0); // 3+ keywords = 100% confidence

  // Only expand if confidence is high enough
  if (confidence >= 0.3) {
    const result = expandAbbreviationsContextual(text);
    return { ...result, confidence };
  }

  return {
    expanded: text,
    mappings: [],
    confidence,
    reason: 'Low healthcare context confidence'
  };
}

export default {
  expandAbbreviations,
  expandAbbreviationsContextual,
  expandHealthcareAbbreviations,
  abbreviateText,
  findAbbreviations,
  batchExpandAbbreviations,
  smartExpand
};
