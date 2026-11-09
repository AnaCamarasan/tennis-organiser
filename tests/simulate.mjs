import { generateRound, confirmDraft, restStatistics } from '../dist/matchmaking.js';

const totalPlayers = Number(process.argv[2] ?? 19);
const courts = Number(process.argv[3] ?? 5);
const rounds = Number(process.argv[4] ?? 8);
if (!Number.isInteger(totalPlayers) || totalPlayers < 4 || totalPlayers > 100 || !Number.isInteger(courts) || courts < 1 || !Number.isInteger(rounds) || rounds < 1 || rounds > 100) {
  throw new Error('Usage: npm run simulate -- [players 4..100] [courts >=1] [rounds 1..100]');
}
const players=Array.from({length:totalPlayers},(_,i)=>({id:`p${i+1}`,name:`Player ${i+1}`,gender:i%2===0?'M':'F',rating:1+((i*7)%19)/2}));
const history=[];
const allDiffs=[];
const allSpreads=[];
let consecutiveRestCount=0;
for(let i=1;i<=rounds;i++) {
  const draft=generateRound({players,availableCourts:courts,history,seed:i,attempts:4,iterations:350});
  const prevRest=new Set(history.at(-1)?.restingIds ?? []);
  consecutiveRestCount += draft.restingIds.filter(id=>prevRest.has(id)).length;
  allDiffs.push(...draft.courtQuality.map(q=>q.teamRatingDifference));
  allSpreads.push(...draft.courtQuality.map(q=>q.ratingSpread));
  console.log(`Round ${i}: ${draft.activeCourts} courts, rests [${draft.restingIds.join(', ')}], average court team difference ${(draft.courtQuality.reduce((a,q)=>a+q.teamRatingDifference,0)/draft.courtQuality.length).toFixed(2)}, score ${draft.qualityScore}`);
  history.push(confirmDraft(i,draft,players));
}
const restCounts=players.map(p=>restStatistics(p.id,history).rests);
const mean=arr=>arr.reduce((a,b)=>a+b,0)/arr.length;
console.log('\nSESSION SUMMARY');
console.log(JSON.stringify({players:totalPlayers,courts,rounds,restRange:[Math.min(...restCounts),Math.max(...restCounts)],consecutiveRests:consecutiveRestCount,meanTeamRatingDifference:Number(mean(allDiffs).toFixed(2)),meanCourtSkillSpread:Number(mean(allSpreads).toFixed(2))},null,2));
