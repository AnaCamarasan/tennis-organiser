export type Gender = 'M' | 'F';

export interface Player {
  id: string;
  name: string;
  gender: Gender;
  rating: number;
}

export interface Match {
  court: number;
  teamA: [string, string];
  teamB: [string, string];
}

/** Confirmed history is the source of truth. Correct a round by replacing it. */
export interface ConfirmedRound {
  number: number;
  /** All participants eligible for assignment when this round was confirmed. */
  eligibleIds: string[];
  matches: Match[];
  restingIds: string[];
}

export interface GenerateInput {
  /** Current attendees only. Players who have left are excluded. */
  players: Player[];
  availableCourts: number;
  history: ConfirmedRound[];
  /** Same seed + same input generates the same preview. Increment to regenerate. */
  seed?: number;
  /** Number of attempts to search different valid arrangements. */
  attempts?: number;
  /** Number of team/court mutations per attempt. */
  iterations?: number;
}

export interface CourtQuality {
  court: number;
  ratingSpread: number;
  teamRatingDifference: number;
  mixedTeams: number;
  feasibleMixedTeams: number;
  partnerRepeatPenalty: number;
  opponentRepeatPenalty: number;
  warning: boolean;
}

export interface RoundDraft {
  matches: Match[];
  restingIds: string[];
  activeCourts: number;
  unusedCourts: number;
  qualityScore: number;
  courtQuality: CourtQuality[];
  /** Non-blocking messages; cannot generate games with fewer than 4 players. */
  notices: string[];
}
