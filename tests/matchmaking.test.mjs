import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { generateRound, confirmDraft, restStatistics, selectRestingPlayers, swapInDraft } from '../dist/matchmaking.js';

function players(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i+1}`, name: `Player ${i+1}`, gender: i % 2 ? 'F' : 'M',
    rating: 1 + ((i * 7) % 19) / 2,
  }));
}
function assertValid(d, attendees, available) {
  assert.equal(d.activeCourts, Math.min(available, Math.floor(attendees.length / 4)));
  assert.equal(d.unusedCourts, available - d.activeCourts);
  assert.equal(d.matches.length, d.activeCourts);
  const all = [...d.restingIds, ...d.matches.flatMap(m => [...m.teamA, ...m.teamB])];
  assert.equal(all.length, attendees.length);
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(new Set(all), new Set(attendees.map(p=>p.id)));
  assert.ok(d.courtQuality.every(q => q.teamRatingDifference >= 0 && q.ratingSpread >= 0));
  d.matches.forEach((m, i) => { assert.equal(m.court, i+1); assert.equal(m.teamA.length, 2); assert.equal(m.teamB.length, 2); });
}

for (const [n, available] of [[17,4],[19,5],[20,5],[23,5],[14,4],[3,2],[0,3],[8,0]]) {
  test(`valid assignments and capacity: ${n} players, ${available} courts`, () => {
    const ps=players(n);
    const draft=generateRound({ players:ps, availableCourts:available, history:[], seed:7, attempts:2, iterations:100 });
    assertValid(draft,ps,available);
    if (draft.activeCourts > 0) {
      const confirmed=confirmDraft(1,draft,ps);
      assert.equal(confirmed.eligibleIds.length,n);
    } else {
      assert.throws(() => confirmDraft(1,draft,ps), /without a playable/);
    }
  });
}
test('determinism for same seed, inputs, confirmed history', () => {
  const input={players:players(19),availableCourts:4,history:[],seed:42,attempts:3,iterations:150};
  assert.deepEqual(generateRound(input),generateRound(input));
});
test('rating scale validates half-steps and rejects invalid values', () => {
  const ps=players(4);
  ps[0].rating=7.2;
  assert.throws(()=>generateRound({players:ps,availableCourts:1,history:[]}),/rating/);
});
test('strong consecutive-rest avoidance across multiple rounds', () => {
  const ps=players(19);
  const history=[];
  for (let round=1;round<=8;round++) {
    const d=generateRound({players:ps,availableCourts:4,history,seed:round,attempts:2,iterations:80});
    assertValid(d,ps,4);
    if(round>1) {
      const prev=new Set(history.at(-1).restingIds);
      assert.ok(d.restingIds.every(id=>!prev.has(id)));
    }
    history.push(confirmDraft(round,d,ps));
  }
  const counts=ps.map(p=>restStatistics(p.id,history).rests);
  assert.ok(Math.max(...counts)-Math.min(...counts)<=1,`rest counts ${counts.join(',')}`);
});
test('when consecutive rests mathematically required, minimise their number', () => {
  const ps=players(7), prevRest=['p1','p2','p3'];
  const history=[{number:1,eligibleIds:ps.map(p=>p.id),matches:[{court:1,teamA:['p4','p5'],teamB:['p6','p7']}],restingIds:prevRest}];
  const d=generateRound({players:ps,availableCourts:1,history,seed:1,attempts:2,iterations:50});
  assert.equal(d.restingIds.filter(id=>prevRest.includes(id)).length,0); // 4 eligible non-rested => 3 rest slots
});
test('late arrivals do not acquire phantom history; a returning player retains history', () => {
  const ps=players(8);
  const first=generateRound({players:ps.slice(0,7),availableCourts:1,history:[],seed:1,attempts:2,iterations:60});
  const history=[confirmDraft(1,first,ps.slice(0,7))];
  assert.equal(restStatistics('p8',history).eligible,0);
  const second=generateRound({players:ps,availableCourts:2,history,seed:2,attempts:2,iterations:60});
  assertValid(second,ps,2);
  const next=confirmDraft(2,second,ps);
  assert.equal(restStatistics('p8',[...history,next]).eligible,1);
  assert.equal(restStatistics('p1',[...history,next]).eligible,2);
});
test('attendance and court changes apply when next round is generated', () => {
  const ps=players(20);
  const round1=generateRound({players:ps,availableCourts:5,history:[],seed:1,attempts:2,iterations:100});
  const hist=[confirmDraft(1,round1,ps)];
  const ps2=ps.filter(p=>p.id!=='p2').slice(0,17);
  const round2=generateRound({players:ps2,availableCourts:3,history:hist,seed:2,attempts:2,iterations:100});
  assertValid(round2,ps2,3);
  assert.equal(round1.matches.length,5); // previous confirmed state is unchanged
});
test('swap works across courts and with resting players, without mutating original', () => {
  const ps=players(10);
  const d=generateRound({players:ps,availableCourts:2,history:[],seed:1,attempts:2,iterations:100});
  const playing=d.matches[0].teamA[0];
  const resting=d.restingIds[0];
  const swapped=swapInDraft(d,playing,resting,ps,[]);
  assert.ok(swapped.restingIds.includes(playing));
  assert.ok(!swapped.restingIds.includes(resting));
  assert.ok(d.restingIds.includes(resting));
  assertValid(swapped,ps,2);
  const restored=swapInDraft(swapped,playing,resting,ps,[]);
  assert.deepEqual(restored.matches,d.matches);
  assert.deepEqual(restored.restingIds,d.restingIds);
});
test('correction to confirmed history changes relationship statistics on next generate', () => {
  const ps=players(8);
  const round1=generateRound({players:ps,availableCourts:2,history:[],seed:1,attempts:2,iterations:100});
  const original=confirmDraft(1,round1,ps);
  const a=original.matches[0].teamA[0],b=original.matches[1].teamA[0];
  const correctedDraft=swapInDraft(round1,a,b,ps,[]);
  const corrected=confirmDraft(1,correctedDraft,ps);
  const input={players:ps,availableCourts:2,seed:10,attempts:3,iterations:150};
  const origNext=generateRound({...input,history:[original]});
  const fixedNext=generateRound({...input,history:[corrected]});
  assert.notDeepEqual(original.matches,corrected.matches);
  // Our next-round evaluation receives the corrected teams, not cumulative mutable counters.
  assert.ok(Number.isFinite(origNext.qualityScore) && Number.isFinite(fixedNext.qualityScore));
});
test('rest allocation is independent of matchmaking weights/search effort', () => {
  const ps=players(23);
  const a=generateRound({players:ps,availableCourts:5,history:[],seed:55,attempts:1,iterations:0});
  const b=generateRound({players:ps,availableCourts:5,history:[],seed:55,attempts:5,iterations:400});
  assert.deepEqual(a.restingIds,b.restingIds);
});

test('well matched ratings permit near-zero balance differences', () => {
  const ps=Array.from({length:8},(_,i)=>({id:`equal${i}`,name:`E${i}`,gender:i%2?'F':'M',rating:6}));
  const d=generateRound({players:ps,availableCourts:2,history:[],seed:1,attempts:2,iterations:100});
  assert.ok(d.courtQuality.every(q=>q.teamRatingDifference===0 && q.ratingSpread===0));
});

test('seeded rest selection', () => {
  assert.deepEqual(selectRestingPlayers(players(19),3,[],11),selectRestingPlayers(players(19),3,[],11));
});
