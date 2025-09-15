// src/matching.ts

export type Medium = 'online' | 'IRL'

export type UserDoc = {
  gender: 'male' | 'female' | 'other' | 'prefer_not_to_say' | null
  yearOfStudy: 1 | 2 | 3 | 4 | 5 | null
  major: string | null
  modules: string[]
  mediums: Medium[]
  description?: string
  matchOptIn: boolean
  blocked: number[]
  timezone?: string | null
}

// ---------- lightweight NLP helpers (no external deps) ----------
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const STOP = new Set([
  'the','a','an','and','or','to','for','with','of','in','on','at','is','are','am',
  'be','i','you','we','they','it','this','that'
])

const tokenize = (s: string) => norm(s).split(' ').filter(w => w && !STOP.has(w))

const tf = (tokens: string[]) => {
  const m = new Map<string, number>()
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1)
  return m
}

const cosine = (a: Map<string, number>, b: Map<string, number>) => {
  let dot = 0, na = 0, nb = 0
  for (const [, v] of a) na += v * v
  for (const [, v] of b) nb += v * v
  const keys = new Set([...a.keys(), ...b.keys()])
  for (const k of keys) dot += (a.get(k) ?? 0) * (b.get(k) ?? 0)
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

const jaccard = (A: string[] = [], B: string[] = []) => {
  const a = new Set(A.map(x => x.trim().toUpperCase()).filter(Boolean))
  const b = new Set(B.map(x => x.trim().toUpperCase()).filter(Boolean))
  const inter = [...a].filter(x => b.has(x)).length
  const uni = new Set([...a, ...b]).size
  return uni ? inter / uni : 0
}

// optional tiny keyword boost for common study patterns
const KEYWORDS = new Map<string, number>([
  ['pomodoro', 0.25],
  ['flashcards', 0.2],
  ['past', 0.15], // as in "past papers"
  ['papers', 0.15],
  ['whiteboard', 0.15],
  ['mcq', 0.15],
  ['proofs', 0.15],
  ['Feyman', 0.15], //as in Feyman learning method
  ['pair', 0.15], // as in pair programming
  ['programming', 0.15],
  ['drills', 0.15],
  ['quiz', 0.15],
  ['revision', 0.15],
  ['streak', 0.1],
  ['GPA', 0.2],
  ['goal', 0.15],
  ['exam', 0.2],
  ['A', 0.2],
  ['B+', 0.2],
  ['B', 0.2],
  ['C+', 0.2],
  ['C', 0.2],
  ['D+', 0.2],
  ['D', 0.2],
  ['F', 0.2],
  ['accountability', 0.2]
])

const keywordBoost = (tokensA: string[], tokensB: string[]) => {
  const tok = new Set([...tokensA, ...tokensB])
  let boost = 0
  for (const t of tok) boost += KEYWORDS.get(t) ?? 0
  return Math.min(boost, 0.8) // cap
}

// Helper function to extract initials from major name
// Examples: "Computer Science" -> "CS", "Information Systems" -> "IS"
export const getInitials = (major: string): string => {
  return major
    .trim()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase())
    .join('')
}

// Helper function to check if two majors match (exact or initials)
// Examples: "Computer Science" matches "CS", "IS" matches "Information Systems"
export const majorsMatch = (major1: string, major2: string): boolean => {
  const m1 = major1.trim().toLowerCase()
  const m2 = major2.trim().toLowerCase()
  
  // Exact match
  if (m1 === m2) return true
  
  // Check if one is initials of the other
  const initials1 = getInitials(major1).toLowerCase()
  const initials2 = getInitials(major2).toLowerCase()
  
  return initials1 === m2 || m1 === initials2 || initials1 === initials2
}

// ---------- main scoring ----------
export function scorePair(me: UserDoc, other: UserDoc): number {
  // 1) Structured similarity
  const modulesScore = jaccard(me.modules, other.modules) * 4.0
  const yearScore = me.yearOfStudy && other.yearOfStudy && me.yearOfStudy === other.yearOfStudy ? 1.0 : 0
  const majorScore =
    me.major && other.major && majorsMatch(me.major, other.major) ? 1.0 : 0
  const mediumsScore = jaccard(me.mediums as string[], other.mediums as string[]) * 1.5

  // keep gender neutral by default; set to small boost if you want later
  const genderScore = 0

  // 2) Description similarity (cosine TF + small keyword boost)
  const descA = tokenize(me.description ?? '')
  const descB = tokenize(other.description ?? '')
  const descCos = cosine(tf(descA), tf(descB)) // [0..1]
  const descScore = descCos * 3.5 + keywordBoost(descA, descB)

  return modulesScore + yearScore + majorScore + mediumsScore + genderScore + descScore
}
