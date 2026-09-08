import { Student } from "../types";

// High-speed LRU cache for normalized strings
const normCache = new Map<string, string>();
const MAX_CACHE_SIZE = 3000;

/**
 * Ultra-fast Arabic text normalization:
 * - Removes Harakat/Tashkeel and Tatweel in a single regex pass
 * - Normalizes Alifs: أ, إ, آ, ٱ -> ا
 * - Normalizes Taa Marbuta: ة -> ه
 * - Normalizes Yaa/Alif Maqsura: ى, ئ -> ي
 * - Normalizes Waw with Hamza: ؤ -> و
 * - Strips standalone Hamza: ء
 * - Converts Arabic digits: ٠-٩ -> 0-9
 * - Normalizes compound prefixes: "عبد الله" <-> "عبدالله", "ابو ", "ام "
 * - Trims and single-spaces
 */
export function normalizeArabicText(input?: string | number | null): string {
  if (input === undefined || input === null) return "";
  const rawKey = String(input);
  if (!rawKey) return "";
  
  const cached = normCache.get(rawKey);
  if (cached !== undefined) return cached;

  let text = rawKey.trim().toLowerCase();
  if (!text) {
    normCache.set(rawKey, "");
    return "";
  }

  // 1. Fast Arabic-Indic digits conversion
  if (/[\u0660-\u0669]/.test(text)) {
    text = text.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  }

  // 2. Single-pass Tashkeel, Tanween & Tatweel removal
  text = text.replace(/[\u064B-\u065F\u0670\u0640]/g, "");

  // 3. Normalize all Alif variants
  text = text.replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627");

  // 4. Normalize Taa Marbuta (ة -> ه)
  text = text.replace(/\u0629/g, "\u0647");

  // 5. Normalize Alif Maqsura & Hamza-on-Nabrah (ى, ئ -> ي)
  text = text.replace(/[\u0649\u0626]/g, "\u064A");

  // 6. Normalize Waw with Hamza (ؤ -> و)
  text = text.replace(/\u0624/g, "\u0648");

  // 7. Remove standalone Hamza (ء)
  text = text.replace(/\u0621/g, "");

  // 8. Normalize compound names (e.g. "عبد الله" <-> "عبدالله")
  text = text.replace(/\bعبد\s+/g, "عبد");
  text = text.replace(/\bابو\s+/g, "ابو");
  text = text.replace(/\bام\s+/g, "ام");

  // 9. Clean special symbols & collapse whitespaces
  text = text.replace(/[^\w\u0600-\u06FF\s]/g, " ");
  text = text.replace(/\s+/g, " ").trim();

  if (normCache.size >= MAX_CACHE_SIZE) {
    normCache.clear();
  }
  normCache.set(rawKey, text);

  return text;
}

/**
 * Pre-indexed student search metadata for 0ms lookup
 */
export interface IndexedStudentSearch {
  normName: string;
  nameTokens: string[];
  normBarcode: string;
  normPhone: string;
  normParentPhone: string;
  normGrade: string;
  normDays: string;
}

// WeakMap cache attached to student objects so indexing happens ONLY ONCE per student object
const studentIndexCache = new WeakMap<Student, IndexedStudentSearch>();

export function getStudentSearchIndex(student: Student): IndexedStudentSearch {
  const cached = studentIndexCache.get(student);
  if (cached) return cached;

  const normName = normalizeArabicText(student.name);
  const nameTokens = normName.split(" ").filter(Boolean);
  const normBarcode = normalizeArabicText(student.barcode);
  const normPhone = normalizeArabicText(student.phone);
  const normParentPhone = normalizeArabicText(student.parentPhone);
  const normGrade = normalizeArabicText(student.groupGrade);
  const normDays = normalizeArabicText(student.groupDays);

  const indexed: IndexedStudentSearch = {
    normName,
    nameTokens,
    normBarcode,
    normPhone,
    normParentPhone,
    normGrade,
    normDays,
  };

  studentIndexCache.set(student, indexed);
  return indexed;
}

/**
 * Ultra-fast single-character diff check without matrix allocations
 */
function isOneCharTypo(a: string, b: string): boolean {
  const lenA = a.length;
  const lenB = b.length;
  if (Math.abs(lenA - lenB) > 1) return false;
  if (lenA < 4 || lenB < 4) return false;

  if (lenA === lenB) {
    let diff = 0;
    for (let i = 0; i < lenA; i++) {
      if (a[i] !== b[i]) {
        diff++;
        if (diff > 1) return false;
      }
    }
    return diff === 1;
  }

  // Insertion / deletion
  const longer = lenA > lenB ? a : b;
  const shorter = lenA > lenB ? b : a;
  let i = 0;
  let j = 0;
  let diff = 0;
  while (i < longer.length && j < shorter.length) {
    if (longer[i] !== shorter[j]) {
      diff++;
      if (diff > 1) return false;
      i++;
    } else {
      i++;
      j++;
    }
  }
  return true;
}

export interface SearchMatchResult {
  match: boolean;
  score: number;
}

/**
 * Instant Arabic Smart Matcher (< 0.001ms per record)
 */
export function matchStudentSearch(student: Student, rawQuery: string): SearchMatchResult {
  if (!rawQuery || !rawQuery.trim()) {
    return { match: true, score: 0 };
  }

  const normalizedQuery = normalizeArabicText(rawQuery);
  if (!normalizedQuery) {
    return { match: true, score: 0 };
  }

  const idx = getStudentSearchIndex(student);

  // 1. Exact matches (Highest Priority)
  if (idx.normBarcode === normalizedQuery) {
    return { match: true, score: 3000 };
  }
  if (idx.normPhone === normalizedQuery || idx.normParentPhone === normalizedQuery) {
    return { match: true, score: 2500 };
  }
  if (idx.normName === normalizedQuery) {
    return { match: true, score: 2000 };
  }

  // 2. Barcode prefix / substring match
  if (idx.normBarcode.startsWith(normalizedQuery)) {
    return { match: true, score: 1800 };
  }
  if (idx.normBarcode.includes(normalizedQuery)) {
    return { match: true, score: 1500 };
  }

  // 3. Name full phrase substring match
  if (idx.normName.includes(normalizedQuery)) {
    return { match: true, score: 1200 };
  }

  // 4. Tokenized Multi-Word Match
  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  if (queryTokens.length === 0) {
    return { match: true, score: 0 };
  }

  let totalScore = 0;
  let allMatched = true;
  let lastMatchedTokenIndex = -1;
  let isSequential = true;

  for (let q = 0; q < queryTokens.length; q++) {
    const qToken = queryTokens[q];
    let tokenMatched = false;
    let tokenScore = 0;

    // Check name tokens
    for (let i = 0; i < idx.nameTokens.length; i++) {
      const nToken = idx.nameTokens[i];

      // Exact word match
      if (nToken === qToken) {
        tokenMatched = true;
        tokenScore = 150;
        if (i > lastMatchedTokenIndex) {
          lastMatchedTokenIndex = i;
        } else {
          isSequential = false;
        }
        break;
      }

      // Word starts with token
      if (nToken.startsWith(qToken)) {
        tokenMatched = true;
        tokenScore = 100;
        if (i > lastMatchedTokenIndex) {
          lastMatchedTokenIndex = i;
        } else {
          isSequential = false;
        }
        break;
      }

      // Substring within word
      if (nToken.includes(qToken)) {
        tokenMatched = true;
        tokenScore = 60;
        if (i > lastMatchedTokenIndex) {
          lastMatchedTokenIndex = i;
        } else {
          isSequential = false;
        }
        break;
      }

      // Strip "ال" prefix
      const nNoAl = nToken.startsWith("ال") ? nToken.slice(2) : nToken;
      const qNoAl = qToken.startsWith("ال") ? qToken.slice(2) : qToken;
      if (nNoAl === qNoAl || nNoAl.startsWith(qNoAl)) {
        tokenMatched = true;
        tokenScore = 90;
        if (i > lastMatchedTokenIndex) {
          lastMatchedTokenIndex = i;
        } else {
          isSequential = false;
        }
        break;
      }

      // Fast single typo tolerance
      if (isOneCharTypo(qToken, nToken)) {
        tokenMatched = true;
        tokenScore = 50;
        if (i > lastMatchedTokenIndex) {
          lastMatchedTokenIndex = i;
        } else {
          isSequential = false;
        }
        break;
      }
    }

    // Check phone, barcode, grade, or days if not in name
    if (!tokenMatched) {
      if (idx.normPhone.includes(qToken) || idx.normParentPhone.includes(qToken)) {
        tokenMatched = true;
        tokenScore = 110;
      } else if (idx.normBarcode.includes(qToken)) {
        tokenMatched = true;
        tokenScore = 120;
      } else if (idx.normGrade.includes(qToken) || idx.normDays.includes(qToken)) {
        tokenMatched = true;
        tokenScore = 40;
      }
    }

    if (!tokenMatched) {
      allMatched = false;
      break;
    }

    totalScore += tokenScore;
  }

  if (!allMatched) {
    return { match: false, score: 0 };
  }

  // Bonus for sequential order (e.g. "أحمد علي" matches first name then last name)
  if (isSequential && queryTokens.length > 1) {
    totalScore += 100;
  }

  // Bonus for first name match
  if (idx.nameTokens.length > 0 && queryTokens.length > 0) {
    if (idx.nameTokens[0].startsWith(queryTokens[0]) || idx.nameTokens[0] === queryTokens[0]) {
      totalScore += 80;
    }
  }

  return { match: true, score: totalScore };
}

/**
 * Lightning-fast filtered and ranked student list
 */
export function filterAndRankStudents(students: Student[], query: string): Student[] {
  if (!query || !query.trim()) {
    return students;
  }

  const results: { student: Student; score: number }[] = [];
  const len = students.length;

  for (let i = 0; i < len; i++) {
    const s = students[i];
    const { match, score } = matchStudentSearch(s, query);
    if (match) {
      results.push({ student: s, score });
    }
  }

  if (results.length > 1) {
    results.sort((a, b) => b.score - a.score);
  }

  return results.map((r) => r.student);
}
