import type { Player, Match, ConfirmedRound, GenerateInput, RoundDraft, CourtQuality } from './types.js';

/** Match-quality penalty weights. Rest fairness is NOT mixed into this score. */
export const WEIGHTS = Object.freeze({
  skillGrouping: 30,
  teamBalance: 30,
  partnerDiversity: 20,
  opponentDiversity: 15,
  mixedDoubles: 5,
});
export const IMBALANCE_WARNING_THRESHOLD = 2;

function random(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(items: T[], rng: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
const pairKey = (a: string, b: string): string => a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;

type PairHistory = Map<string, { count: number; lastRound: number }>;
function relationships(history: ConfirmedRound[]): { partners: PairHistory; opponents: PairHistory } {
  const partners: PairHistory = new Map();
  const opponents: PairHistory = new Map();
  function increment(map: PairHistory, a: string, b: string, roundIndex: number) {
    const key = pairKey(a, b);
    const prev = map.get(key);
    map.set(key, { count: (prev?.count ?? 0) + 1, lastRound: roundIndex });
  }
  history.forEach((round, index) => round.matches.forEach(match => {
    increment(partners, ...match.teamA, index);
    increment(partners, ...match.teamB, index);
    for (const a of match.teamA) for (const b of match.teamB) increment(opponents, a, b, index);
  }));
  return { partners, opponents };
}
function repeatPenalty(records: PairHistory, a: string, b: string, lastIndex: number): number {
  const entry = records.get(pairKey(a, b));
  if (!entry) return 0;
  const immediate = entry.lastRound === lastIndex ? 1.5 : 0;
  return Math.min(1, (entry.count + immediate) / 3);
}

/** Fractions are evaluated ONLY for rounds where a player was eligible. */
export function restStatistics(playerId: string, history: ConfirmedRound[]) {
  let eligible = 0, rests = 0, plays = 0;
  for (const round of history) {
    if (!round.eligibleIds.includes(playerId)) continue;
    eligible++;
    if (round.restingIds.includes(playerId)) rests++;
    else if (round.matches.some(m => [...m.teamA, ...m.teamB].includes(playerId))) plays++;
  }
  const last = history.at(-1);
  return {
    eligible, rests, plays,
    restedLastRound: !!last?.eligibleIds.includes(playerId) && !!last?.restingIds.includes(playerId),
  };
}

/**
 * Rest selection has a lexicographic priority:
 *   1. Fewest consecutive rests (when mathematically avoidable).
 *   2. Lower projected eligible-round rest fraction goes first.
 *   3. Stable seeded tie-breaks for variety across regenerations.
 * This prevents the match-quality optimiser from sacrificing fair rest rotation.
 */
export function selectRestingPlayers(
  players: Player[], restSlots: number, history: ConfirmedRound[], seed = 1,
): string[] {
  if (!Number.isInteger(restSlots) || restSlots < 0 || restSlots > players.length) {
    throw new Error('Invalid number of rest slots');
  }
  const rng = random(seed);
  const sorted = players.map(player => {
    const stats = restStatistics(player.id, history);
    return {
      id: player.id,
      consecutive: stats.restedLastRound ? 1 : 0,
      projectedRestFraction: (stats.rests + 1) / (stats.eligible + 1),
      // Ties and very similar rest rates should rotate, without overriding important differences.
      tie: rng(),
    };
  }).sort((a, b) => a.consecutive - b.consecutive ||
    a.projectedRestFraction - b.projectedRestFraction || a.tie - b.tie);
  return sorted.slice(0, restSlots).map(x => x.id);
}

function validate(players: Player[], courts: number, history: ConfirmedRound[]): void {
  if (!Number.isInteger(courts) || courts < 0) throw new Error('availableCourts must be a non-negative integer');
  const ids = new Set<string>();
  for (const player of players) {
    if (!player.id || ids.has(player.id)) throw new Error('Player IDs must be nonempty and unique');
    if (!Number.isFinite(player.rating) || player.rating < 1 || player.rating > 10 || player.rating * 2 !== Math.round(player.rating * 2))
      throw new Error(`Invalid rating for ${player.id}: ratings must be 1–10 in 0.5 steps`);
    if (!['M', 'F'].includes(player.gender)) throw new Error(`Invalid gender for ${player.id}`);
    ids.add(player.id);
  }
  for (const round of history) {
    const eligible = new Set(round.eligibleIds);
    if (eligible.size !== round.eligibleIds.length) throw new Error('Duplicate eligible player in historical round');
    const assigned = [...round.restingIds, ...round.matches.flatMap(m => [...m.teamA, ...m.teamB])];
    if (new Set(assigned).size !== assigned.length) throw new Error('Duplicate assignment in historical round');
    if (assigned.some(id => !eligible.has(id))) throw new Error('Historical assignments must have been eligible');
    if (round.matches.some(m => m.teamA.length !== 2 || m.teamB.length !== 2)) throw new Error('Invalid historical team size');
  }
}

type Evaluation = { score: number; quality: CourtQuality[] };
function scoreMatches(matches: Match[], byId: Map<string, Player>, history: ConfirmedRound[]): Evaluation {
  const rel = relationships(history);
  const lastIndex = history.length - 1;
  const qualities: CourtQuality[] = [];
  let score = 0;
  for (const match of matches) {
    const ids = [...match.teamA, ...match.teamB];
    const players = ids.map(id => {
      const p = byId.get(id);
      if (!p) throw new Error(`Unknown player ${id}`);
      return p;
    });
    const ratings = players.map(p => p.rating);
    const spread = Math.max(...ratings) - Math.min(...ratings);
    const difference = Math.abs(ratings[0]! + ratings[1]! - ratings[2]! - ratings[3]!);
    const genders = players.map(p => p.gender);
    const males = genders.filter(g => g === 'M').length;
    const females = genders.filter(g => g === 'F').length;
    const feasibleMixed = Math.min(2, males, females);
    const mixed = Number(genders[0] !== genders[1]) +
      Number(genders[2] !== genders[3]);
    const partnerPenalty = (
      repeatPenalty(rel.partners, ...match.teamA, lastIndex) +
      repeatPenalty(rel.partners, ...match.teamB, lastIndex)
    ) / 2;
    let opponents = 0;
    for (const a of match.teamA) for (const b of match.teamB) {
      opponents += repeatPenalty(rel.opponents, a, b, lastIndex);
    }
    const opponentPenalty = opponents / 4;
    // Five weighted components, each individually normalised to 0–1.
    score += WEIGHTS.skillGrouping * spread / 9 +
      WEIGHTS.teamBalance * difference / 18 +
      WEIGHTS.partnerDiversity * partnerPenalty +
      WEIGHTS.opponentDiversity * opponentPenalty +
      WEIGHTS.mixedDoubles * (feasibleMixed - mixed) / 2;
    qualities.push({
      court: match.court, ratingSpread: spread, teamRatingDifference: difference,
      mixedTeams: mixed, feasibleMixedTeams: feasibleMixed,
      partnerRepeatPenalty: partnerPenalty, opponentRepeatPenalty: opponentPenalty,
      warning: difference >= IMBALANCE_WARNING_THRESHOLD,
    });
  }
  return { score: matches.length ? score / matches.length : 0, quality: qualities };
}

function bestPairing(ids: string[], court: number, byId: Map<string, Player>, history: ConfirmedRound[]): Match {
  const variants: [number, number, number, number][] = [
    [0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2],
  ];
  let best: Match | undefined;
  let bestScore = Infinity;
  for (const [a, b, c, d] of variants) {
    const match: Match = { court, teamA: [ids[a]!, ids[b]!], teamB: [ids[c]!, ids[d]!] };
    const result = scoreMatches([match], byId, history).score;
    if (result < bestScore) { bestScore = result; best = match; }
  }
  return best!;
}

function buildMatches(ids: string[], byId: Map<string, Player>, history: ConfirmedRound[]): Match[] {
  const matches: Match[] = [];
  for (let i = 0; i < ids.length; i += 4) {
    matches.push(bestPairing(ids.slice(i, i + 4), i / 4 + 1, byId, history));
  }
  return matches;
}

function makeStartingOrder(ids: string[], byId: Map<string, Player>, rng: () => number): string[] {
  // Skill grouping is the default. Shuffling ties prevents permanent fixed courts.
  const decorated = ids.map(id => ({ id, jitter: rng() }));
  decorated.sort((a, b) => byId.get(b.id)!.rating - byId.get(a.id)!.rating || a.jitter - b.jitter);
  return decorated.map(x => x.id);
}

/** Generate a draft only. It never mutates players or confirmed history. */
export function generateRound(input: GenerateInput): RoundDraft {
  const { players, availableCourts, history } = input;
  validate(players, availableCourts, history);
  const activeCourts = Math.min(availableCourts, Math.floor(players.length / 4));
  const playingCount = activeCourts * 4;
  const restSlots = players.length - playingCount;
  const unusedCourts = availableCourts - activeCourts;
  const notices: string[] = [];
  if (activeCourts === 0) notices.push('Not enough available players or courts for a doubles match.');
  else if (unusedCourts > 0) notices.push(`${unusedCourts} court(s) unused because there are not enough players.`);
  const byId = new Map(players.map(p => [p.id, p]));
  const rng = random(input.seed ?? 1);
  const attempts = Math.max(1, Math.min(50, Math.trunc(input.attempts ?? 8)));
  const iterations = Math.max(0, Math.min(15000, Math.trunc(input.iterations ?? 1200)));
  if (!playingCount) return {
    matches: [], restingIds: players.map(p => p.id), activeCourts, unusedCourts,
    qualityScore: 0, courtQuality: [], notices,
  };

  // Rest fairness is decided first, independently of quality scoring.
  const restingIds = selectRestingPlayers(players, restSlots, history, input.seed ?? 1);
  const resting = new Set(restingIds);
  const playing = players.map(p => p.id).filter(id => !resting.has(id));
  let bestMatches: Match[] = [];
  let bestEvaluation: Evaluation = { score: Infinity, quality: [] };
  for (let attempt = 0; attempt < attempts; attempt++) {
    let order = makeStartingOrder(playing, byId, rng);
    // Perturb some starts to escape skill-sorted local minima.
    if (attempt > 0) {
      for (let i = 0; i < Math.min(playingCount, attempt * 2); i++) {
        const a = Math.floor(rng() * playingCount);
        const b = Math.floor(rng() * playingCount);
        [order[a], order[b]] = [order[b]!, order[a]!];
      }
    }
    let matches = buildMatches(order, byId, history);
    let evaluation = scoreMatches(matches, byId, history);
    if (evaluation.score < bestEvaluation.score) {
      bestEvaluation = evaluation; bestMatches = matches;
    }
    for (let iter = 0; iter < iterations; iter++) {
      // Swap two players, possibly across courts. All affected teams get re-optimised.
      const a = Math.floor(rng() * playingCount);
      const b = Math.floor(rng() * playingCount);
      if (a === b) continue;
      const trial = [...order];
      [trial[a], trial[b]] = [trial[b]!, trial[a]!];
      const trialMatches = buildMatches(trial, byId, history);
      const trialEvaluation = scoreMatches(trialMatches, byId, history);
      // Occasionally accept a worse solution early to escape local minima.
      const temperature = Math.max(0.02, 1.5 * (1 - iter / Math.max(1, iterations)));
      if (trialEvaluation.score < evaluation.score || rng() < Math.exp((evaluation.score - trialEvaluation.score) / temperature)) {
        order = trial; matches = trialMatches; evaluation = trialEvaluation;
      }
      if (evaluation.score < bestEvaluation.score) {
        bestMatches = matches; bestEvaluation = evaluation;
      }
    }
  }
  return {
    matches: bestMatches, restingIds, activeCourts, unusedCourts,
    qualityScore: Number(bestEvaluation.score.toFixed(4)),
    courtQuality: bestEvaluation.quality, notices,
  };
}

/** Confirmation should happen in the session manager, NOT within generateRound. */
export function confirmDraft(number: number, draft: RoundDraft, eligiblePlayers: Player[]): ConfirmedRound {
  if (draft.activeCourts === 0) throw new Error('Cannot confirm a round without a playable doubles court');
  const eligibleIds = eligiblePlayers.map(p => p.id);
  const eligible = new Set(eligibleIds);
  const assigned = [...draft.restingIds, ...draft.matches.flatMap(m => [...m.teamA, ...m.teamB])];
  if (assigned.length !== eligible.size || new Set(assigned).size !== assigned.length || assigned.some(id => !eligible.has(id))) {
    throw new Error('Draft must assign every eligible player exactly once');
  }
  if (draft.matches.length !== draft.activeCourts || draft.matches.some(m => m.teamA.length !== 2 || m.teamB.length !== 2)) {
    throw new Error('Invalid court assignments');
  }
  return {
    number, eligibleIds: [...eligibleIds], restingIds: [...draft.restingIds],
    matches: draft.matches.map(m => ({court: m.court, teamA: [...m.teamA] as [string,string], teamB: [...m.teamB] as [string,string]})),
  };
}

/** Swap also supports replacing a playing player with a resting player. */
export function swapInDraft(draft: RoundDraft, firstId: string, secondId: string, players: Player[], history: ConfirmedRound[]): RoundDraft {
  if (firstId === secondId) return draft;
  const cloned: RoundDraft = {
    ...draft, restingIds: [...draft.restingIds],
    matches: draft.matches.map(m => ({ court: m.court, teamA: [...m.teamA] as [string,string], teamB: [...m.teamB] as [string,string] })),
  };
  const all = [...cloned.restingIds, ...cloned.matches.flatMap(m => [...m.teamA, ...m.teamB])];
  if (!all.includes(firstId) || !all.includes(secondId)) throw new Error('Players must already be assigned to this draft');
  const remap = (id: string) => id === firstId ? secondId : id === secondId ? firstId : id;
  cloned.restingIds = cloned.restingIds.map(remap);
  cloned.matches = cloned.matches.map(m => ({court:m.court, teamA:m.teamA.map(remap) as [string,string], teamB:m.teamB.map(remap) as [string,string]}));
  const evaluated = scoreMatches(cloned.matches, new Map(players.map(p => [p.id,p])), history);
  cloned.qualityScore = Number(evaluated.score.toFixed(4));
  cloned.courtQuality = evaluated.quality;
  return cloned;
}

/** Re-evaluate an edited draft against the rounds preceding it. */
export function evaluateDraft(draft: RoundDraft, players: Player[], history: ConfirmedRound[]): RoundDraft {
  const evaluated = scoreMatches(draft.matches, new Map(players.map(p => [p.id, p])), history);
  return { ...draft, qualityScore: Number(evaluated.score.toFixed(4)), courtQuality: evaluated.quality };
}
