import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Users, LayoutGrid, History, Plus, Search, Trash2, Pencil, ArrowLeftRight, Undo2, Shuffle, Check, ChevronRight, AlertTriangle, X, Download, Upload, RotateCcw, LogOut, UserPlus, ArrowLeft, LockKeyhole, Trophy, Info } from 'lucide-react';
import { confirmDraft, evaluateDraft, generateRound, swapInDraft } from './logic/matchmaking';
import type { Player, RoundDraft, ConfirmedRound, Match } from './logic/types';
import { readData, writeData, type AppData, type Session } from './storage/db';

type View = 'players' | 'session' | 'history';
const EMPTY: AppData = { players: [], session: null };
const id = () => crypto.randomUUID();
const copy = <T,>(x: T): T => structuredClone(x);
const surname = (p: Player) => p.name.toLocaleLowerCase();
const score = (match: Match, byId: Map<string, Player>, team: 'A' | 'B') => (team === 'A' ? match.teamA : match.teamB).reduce((n, id) => n + (byId.get(id)?.rating ?? 0), 0);
const format = (n: number) => Number.isInteger(n) ? `${n}` : n.toFixed(1);
const samplePlayers: Array<[string, 'M'|'F', number]> = [
  ['Alex Morgan','M',9],['Emma Wilson','F',8.5],['James Lee','M',8],['Sarah Carter','F',7.5],
  ['Chris Evans','M',7.5],['Olivia Brown','F',7],['Daniel White','M',7],['Mia Taylor','F',6.5],
  ['Noah Harris','M',6.5],['Grace Clark','F',6],['Ben Green','M',6],['Lily Scott','F',5.5],
  ['Oliver Hall','M',5.5],['Sophie King','F',5],['Thomas Young','M',5],['Amelia Wright','F',4.5],
  ['Harry Adams','M',4.5],['Ella Turner','F',4],['Jack Baker','M',3.5],['Ruby Cooper','F',3.5],
];

function RatingTag({ rating }: { rating: number }) { return <span className="rating">{format(rating)}</span>; }
function PlayerChip({ player, onClick, selected, disabled }: { player: Player; onClick: () => void; selected: boolean; disabled?: boolean }) {
  return <button type="button" disabled={disabled} className={`player-chip ${selected ? 'selected' : ''}`} onClick={onClick} aria-pressed={selected}>
    <span className="player-chip-name">{player.name}<small>{player.gender === 'M' ? 'Men' : 'Women'}</small></span>
    <RatingTag rating={player.rating} />
  </button>;
}
function CourtCard({ match, allPlayers, selected, onSelect, disabled, showWarning = true }: { match: Match; allPlayers: Player[]; selected?: string|null; onSelect?: (id:string)=>void; disabled?: boolean; showWarning?:boolean }) {
  const byId = new Map(allPlayers.map(p => [p.id,p]));
  const a = score(match, byId, 'A'); const b = score(match, byId, 'B');
  const diff = Math.abs(a-b);
  return <article className="court-card">
    <div className="court-head"><div><span className="court-dot"/>Court {match.court}</div>{showWarning && diff>=2 ? <span className="warning-pill"><AlertTriangle size={13}/> {format(diff)} gap</span> : <span className="subtle tiny">{diff === 0 ? 'Perfect balance' : `${format(diff)} rating gap`}</span>}</div>
    {(['A','B'] as const).map((team, ti) => <div className="team-row" key={team}>
      <div className="team-line"><span>TEAM {team}</span><b>{format(ti === 0 ? a : b)} <span className="small-light">pts</span></b></div>
      <div className="chip-pair">{(team === 'A' ? match.teamA : match.teamB).map(pid => {
        const p = byId.get(pid); return p ? <PlayerChip key={pid} player={p} selected={selected===pid} disabled={disabled || !onSelect} onClick={() => onSelect?.(pid)}/> : <div key={pid}>Unknown player</div>;
      })}</div>
    </div>)}
  </article>;
}

export default function App() {
  const [data, setData] = useState<AppData>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [view, setView] = useState<View>('players');
  const [search, setSearch] = useState('');
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [playerModal, setPlayerModal] = useState(false);
  const [name, setName] = useState(''); const [gender, setGender] = useState<'M'|'F'>('M'); const [rating, setRating] = useState('5');
  const [selected, setSelected] = useState<string|null>(null);
  const [undoStack, setUndoStack] = useState<RoundDraft[]>([]);
  const [message, setMessage] = useState('');
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [showEnd, setShowEnd] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const [historyEditWarning, setHistoryEditWarning] = useState(false);
  const [attendeeSearch, setAttendeeSearch] = useState('');
  const fileInput = useRef<HTMLInputElement|null>(null);
  useEffect(() => { readData().then(v => { setData(v); setLoaded(true); if (v.session) setView('session'); }).catch(e => { setStorageError(`Local storage failed: ${String(e)}`); setLoaded(true); }); }, []);
  useEffect(() => { if (loaded) writeData(data).catch(e => setStorageError(`Could not save: ${String(e)}`)); }, [data, loaded]);
  const s = data.session;
  const players = data.players;
  const playerById = new Map(players.map(p => [p.id, p]));
  const attendees = s?.attendeeIds.map(pid => playerById.get(pid)).filter((p): p is Player => !!p) ?? [];
  const draftPlayers = s?.draftMode === 'correction' && s.correctionIndex !== null ? (s.rounds[s.correctionIndex]?.eligibleIds.map(pid=>playerById.get(pid)).filter((p):p is Player=>!!p) ?? []) : attendees;
  const historyBeforeDraft = s?.draftMode==='correction' && s.correctionIndex !== null ? s.rounds.slice(0,s.correctionIndex) : (s?.rounds ?? []);
  const toast = (str: string) => { setMessage(str); };
  const updateSession = (fn:(session:Session)=>Session) => setData(old => old.session ? {...old,session:fn(old.session)} : old);
  const resetDraftUI = () => { setSelected(null); setUndoStack([]); setPendingConfirm(false); };
  function editPlayer(p?:Player) {setEditingPlayer(p ?? null);setName(p?.name??'');setGender(p?.gender??'M');setRating(String(p?.rating??5));setPlayerModal(true);}
  function submitPlayer(e:FormEvent) {
    e.preventDefault(); const parsed = Number(rating); const trimmed=name.trim();
    if (!trimmed || !Number.isFinite(parsed) || parsed <1 ||parsed>10 || parsed*2!==Math.round(parsed*2)) {toast('Enter a name and a rating from 1–10 in 0.5 steps.');return;}
    const p:Player={id:editingPlayer?.id??id(), name:trimmed, gender:editingPlayer && s ? editingPlayer.gender : gender, rating:editingPlayer && s ? editingPlayer.rating : parsed};
    setData(old=>({...old,players: editingPlayer ? old.players.map(x=>x.id===p.id?p:x) : [...old.players,p]}));
    setPlayerModal(false);toast(editingPlayer?'Player updated.':'Player added.');
  }
  function deletePlayer(p:Player) {
    if(s && (s.attendeeIds.includes(p.id)||s.rounds.some(r=>r.eligibleIds.includes(p.id)) || s.draft?.matches.some(m=>[...m.teamA,...m.teamB].includes(p.id)) || s.draft?.restingIds.includes(p.id))) {toast('Remove this player from the session first. Players with session history cannot be deleted until the session ends.');return;}
    if (!window.confirm(`Delete ${p.name} from the player directory?`)) return;
    setData(old=>({...old,players:old.players.filter(x=>x.id!==p.id)}));
  }
  function toggleAttendee(pid:string) {
    updateSession(old=>({...old,attendeeIds:old.attendeeIds.includes(pid)?old.attendeeIds.filter(x=>x!==pid):[...old.attendeeIds,pid]}));
  }
  function startSession() {
    const next:Session={id:id(),startedAt:new Date().toISOString(),attendeeIds:players.map(p=>p.id),courts:Math.max(1,Math.ceil(players.length/4)),rounds:[],draft:null,draftMode:'new',correctionIndex:null,nextSeed:1};
    setData(old=>({...old,session:next}));setView('session');resetDraftUI();toast('Session created. Select attendees and courts, then generate a round.');
  }
  function generate() {
    if (!s) return;
    if (s.draftMode==='correction') { toast('Save or cancel the round correction first.');return; }
    try {
      const preview=generateRound({players:attendees,availableCourts:s.courts,history:s.rounds,seed:s.nextSeed,attempts:8,iterations:500});
      updateSession(old=>({...old,draft:preview,draftMode:'new',correctionIndex:null,nextSeed:old.nextSeed+1}));
      resetDraftUI();setView('session');
      if(preview.activeCourts===0) toast('Not enough players or courts for a doubles match.');
    } catch(e) { toast(`Could not generate: ${String(e)}`); }
  }
  function regenerate() {if (s?.draft && undoStack.length && !window.confirm('Discard manual swaps and generate a new round?')) return; generate();}
  function selectSwap(pid:string) {
    if (!s?.draft) return;
    if(!selected){setSelected(pid);return;}
    if(selected===pid){setSelected(null);return;}
    try {
      const updated=swapInDraft(s.draft,selected,pid,draftPlayers,historyBeforeDraft);
      setUndoStack(old=>[...old.slice(-19),copy(s.draft!)]);
      updateSession(old=>({...old,draft:updated}));setSelected(null);
    } catch(e) {toast(`Swap failed: ${String(e)}`);setSelected(null);}
  }
  function undo() {
    if (!s?.draft || !undoStack.length) return;
    const last=undoStack[undoStack.length-1]!;
    updateSession(old=>({...old,draft:last}));setUndoStack(old=>old.slice(0,-1));setSelected(null);
  }
  function saveRound() {
    if (!s?.draft?.matches.length) return;
    try {
      if(s.draftMode==='correction' && s.correctionIndex!==null) {
        const original=s.rounds[s.correctionIndex]!;
        const replacement=confirmDraft(original.number,s.draft,draftPlayers);
        updateSession(old=>({...old,rounds:old.rounds.map((r,i)=>i===old.correctionIndex?replacement:r),draft:null,draftMode:'new',correctionIndex:null}));
        toast('Round correction saved. Future match statistics use the corrected history.');
      } else {
        const confirmed=confirmDraft(s.rounds.length+1,s.draft,draftPlayers);
        updateSession(old=>({...old,rounds:[...old.rounds,confirmed],draft:null,draftMode:'new',correctionIndex:null}));
        toast(`Round ${confirmed.number} confirmed.`);
      }
      resetDraftUI();setView('session');
    } catch(e) {toast(`Cannot confirm: ${String(e)}`);}
  }
  function editConfirmed(index:number) {
    if (!s) return;
    if(s.draft && !window.confirm('Discard the current draft to correct a previous round?')) return;
    const r=s.rounds[index]; if(!r) return;
    const raw:RoundDraft={matches:copy(r.matches),restingIds:[...r.restingIds],activeCourts:r.matches.length,unusedCourts:0,qualityScore:0,courtQuality:[],notices:[]};
    const originalPlayers=r.eligibleIds.map(pid=>playerById.get(pid)).filter((p):p is Player=>!!p);
    const draft=evaluateDraft(raw,originalPlayers,s.rounds.slice(0,index));
    updateSession(old=>({...old,draft,draftMode:'correction',correctionIndex:index}));resetDraftUI();setView('session');
    if(index<s.rounds.length-1)setHistoryEditWarning(true);
  }
  function cancelDraft() {updateSession(old=>({...old,draft:null,draftMode:'new',correctionIndex:null}));resetDraftUI();}
  function exportBackup() {
    const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),data},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='tennis-organiser-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function importBackup(file:File) {
    try {
      const parsed=JSON.parse(await file.text());const incoming=parsed?.data as AppData;
      if(!Array.isArray(incoming?.players) || !incoming.players.every(p=>p && typeof p.id==='string' && typeof p.name==='string' && ['M','F'].includes(p.gender) && typeof p.rating==='number' && p.rating>=1 && p.rating<=10 && p.rating*2===Math.round(p.rating*2)) || (incoming.session!==null && (typeof incoming.session!=='object' || !Array.isArray(incoming.session?.rounds) || !Array.isArray(incoming.session?.attendeeIds)))) throw new Error('Invalid backup format');
      if(!window.confirm('Replace the entire local player directory and session with this backup?')) return;
      setData(incoming);resetDraftUI();setView(incoming.session?'session':'players');toast('Backup restored.');
    } catch(e){toast(`Import failed: ${String(e)}`);} finally {if(fileInput.current)fileInput.current.value='';}
  }
  function loadDemo() {if(players.length && !window.confirm('Add 20 sample players to your existing directory?'))return;setData(old=>({...old,players:[...old.players,...samplePlayers.map(([name,gender,rating])=>({id:id(),name,gender,rating}))]}));setShowDemo(false);toast('20 sample players added. You can delete them after testing.');}
  function endSession() {setData(old=>({...old,session:null}));setShowEnd(false);setView('players');resetDraftUI();toast('Session ended. Your player directory is saved.');}
  if(!loaded)return <div className="loading-screen">Loading your tennis organiser…</div>;
  return <div className="app-shell">
    <header className="topbar"><div className="brandmark"><span className="logo-ball"><span/></span><div><div className="brand">baseline<span className="brand-dot">.</span></div><div className="brand-sub">TENNIS SESSION ORGANISER</div></div></div><span className="topbar-caption">DOUBLES PRACTICE</span></header>
    <div className="content-wrap">
      <aside className="sidebar"><div className="side-title">WORKSPACE</div>
        {([{key:'players',label:'Players',icon:Users},{key:'session',label:'Session',icon:LayoutGrid},{key:'history',label:'History',icon:History}] as const).map(item=><button key={item.key} className={`side-link ${view===item.key?'active':''}`} onClick={()=>setView(item.key)}><item.icon size={18}/>{item.label}{item.key==='session'&&s?<span className="side-count">{s.rounds.length}</span>:null}</button>)}
        <div className="side-divider"/><div className="side-title">DATA</div>
        <button className="side-link" onClick={exportBackup}><Download size={18}/>Export backup</button><button className="side-link" onClick={()=>fileInput.current?.click()}><Upload size={18}/>Import backup</button>
        <div className="sidebar-foot"><span className="status-dot"/> All data saved on this device</div>
      </aside>
      <main className="main">
        {storageError&&<div className="alert error"><AlertTriangle size={17}/>{storageError}</div>}
        {message&&<div className="toast-message"><Info size={16}/><span>{message}</span><button aria-label="Dismiss" onClick={()=>setMessage('')}><X size={16}/></button></div>}
        {view==='players'&&<>
          <div className="page-heading"><div><div className="eyebrow">YOUR ROSTER</div><h1>Player directory</h1><p>Manage the people in your practice group and their skill ratings.</p></div><button className="button primary" onClick={()=>editPlayer()}><Plus size={18}/>Add player</button></div>
          <div className="stat-row"><div className="stat-card"><span>TOTAL PLAYERS</span><b>{players.length}</b></div><div className="stat-card"><span>MEN</span><b>{players.filter(p=>p.gender==='M').length}</b></div><div className="stat-card"><span>WOMEN</span><b>{players.filter(p=>p.gender==='F').length}</b></div></div>
          <div className="panel"><div className="panel-bar"><div><h2>All players</h2><span className="subtle">Rated from 1.0 to 10.0</span></div><div className="search-wrap"><Search size={17}/><input aria-label="Search players" placeholder="Search players…" value={search} onChange={e=>setSearch(e.target.value)}/></div></div>
            {players.length===0?<div className="empty-state"><Users size={30}/><h3>Build your player directory</h3><p>Add your regulars once, then select them at each session.</p><button className="button primary" onClick={()=>editPlayer()}><Plus size={17}/>Add first player</button><button className="text-button" onClick={()=>setShowDemo(true)}>Or load sample players to test the app</button></div>:
            <div className="player-list">{[...players].filter(p=>surname(p).includes(search.toLowerCase())).sort((a,b)=>b.rating-a.rating || a.name.localeCompare(b.name)).map(p=><div className="player-list-row" key={p.id}><div className="avatar">{p.name.split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase()}</div><div className="player-meta"><strong>{p.name}</strong><small>{p.gender==='M'?'Men':'Women'}</small></div><RatingTag rating={p.rating}/><button className="icon-button" title={`Edit ${p.name}`} onClick={()=>editPlayer(p)}><Pencil size={17}/></button><button className="icon-button danger" title={`Delete ${p.name}`} onClick={()=>deletePlayer(p)}><Trash2 size={17}/></button></div>)}{!players.some(p=>surname(p).includes(search.toLowerCase()))&&<div className="empty-mini">No players match your search.</div>}</div>}
          </div>
          <div className="bottom-actions">{players.length>0&&<button className="button subtle-button" onClick={()=>setShowDemo(true)}>Add sample players</button>}{!s&&<button className="button primary" disabled={players.length===0} onClick={startSession}>Create session <ChevronRight size={18}/></button>}{s&&<button className="button primary" onClick={()=>setView('session')}>Go to session <ChevronRight size={18}/></button>}</div>
        </>}
        {view==='session'&&(!s?<div className="intro-session"><div className="eyebrow">SESSION MANAGEMENT</div><h1>Ready to hit?</h1><p>Create a session, select attendees and generate balanced doubles rounds. Your directory stays saved between sessions.</p><div className="intro-art"><div className="court-outline"><span className="court-net"/><span className="court-service-left"/><span className="court-service-right"/></div></div><button disabled={!players.length} className="button primary large" onClick={startSession}><Plus size={18}/>Create new session</button>{!players.length&&<p className="tiny">Add some players first.</p>}</div>:<>
          <div className="page-heading"><div><div className="eyebrow">LIVE PRACTICE <span className="live-dot"/></div><h1>{s.draftMode==='correction' ? `Correct Round ${s.rounds[s.correctionIndex!]?.number}` : `Session · Round ${s.rounds.length+(s.draft?1:0) || 1}`}</h1><p>Manage your courts, players and 30-minute rotations.</p></div><button className="button subtle-button desktop-only" onClick={()=>setShowEnd(true)}><LogOut size={16}/>End session</button></div>
          <div className="stat-row"><div className="stat-card"><span>ATTENDING</span><b>{attendees.length}</b></div><div className="stat-card"><span>COURTS AVAILABLE</span><b>{s.courts}</b></div><div className="stat-card"><span>ROUNDS PLAYED</span><b>{s.rounds.length}</b></div></div>
          <div className="session-layout"><div className="session-primary">
          {s.draft ? <>
            <div className="section-heading"><div><span className="eyebrow">{s.draftMode==='correction'?'EDITING CONFIRMED ROUND':'ROUND PREVIEW'}</span><h2>{s.draftMode==='correction'?`Round ${s.rounds[s.correctionIndex!]?.number} correction`:`Round ${s.rounds.length+1} · Draft`}</h2><p>Tap one player, then another to swap them — including players who are resting.</p></div><span className="draft-badge">{s.draftMode==='correction'?'CORRECTION':'DRAFT'}</span></div>
            {selected&&<div className="selection-bar"><ArrowLeftRight size={17}/>Choose another player to swap with <button onClick={()=>setSelected(null)}>Cancel</button></div>}
            {s.draft.notices.map(n=><div className="alert" key={n}><Info size={16}/>{n}</div>)}
            <div className="court-grid">{s.draft.matches.map(m=><CourtCard key={m.court} match={m} allPlayers={players} selected={selected} onSelect={selectSwap}/>)}</div>
            <div className="rest-panel"><div className="rest-title"><span><RotateCcw size={17}/>Resting this round</span><span className="subtle tiny">{s.draft.restingIds.length} players</span></div><div className="rest-chips">{s.draft.restingIds.length ? s.draft.restingIds.map(pid=>playerById.get(pid) ? <PlayerChip key={pid} player={playerById.get(pid)!} selected={selected===pid} onClick={()=>selectSwap(pid)}/> : null):<span className="subtle">No one resting</span>}</div></div>
            <div className="draft-action-bar"><button className="button subtle-button" disabled={!undoStack.length} onClick={undo}><Undo2 size={17}/>Undo</button>{s.draftMode==='new'&&<button className="button subtle-button" onClick={regenerate}><Shuffle size={17}/>Regenerate</button>}<button className="button subtle-button" onClick={cancelDraft}>Cancel</button><button className="button primary" disabled={!s.draft.matches.length} onClick={()=>setPendingConfirm(true)}><Check size={17}/>{s.draftMode==='correction'?'Save correction':'Confirm round'}</button></div>
          </> : <>
            {s.rounds.length ? <><div className="section-heading"><div><div className="eyebrow">LAST CONFIRMED ROUND</div><h2>Round {s.rounds.length}</h2><p>Assignments are saved. Adjust attendance or courts before generating the next round.</p></div><span className="confirmed-badge"><Check size={14}/>CONFIRMED</span></div><div className="court-grid">{s.rounds.at(-1)!.matches.map(m=><CourtCard key={m.court} match={m} allPlayers={players}/>)}</div><div className="rest-panel"><div className="rest-title"><span><RotateCcw size={17}/>Rested last round</span></div><div className="rest-labels">{s.rounds.at(-1)!.restingIds.map(pid=><span key={pid}>{playerById.get(pid)?.name??'Unknown'}</span>)}{!s.rounds.at(-1)!.restingIds.length&&<span>None</span>}</div></div><div className="draft-action-bar"><button className="button subtle-button" onClick={()=>editConfirmed(s.rounds.length-1)}><Pencil size={17}/>Correct round</button><button className="button primary" onClick={generate}><Shuffle size={17}/>Generate round {s.rounds.length+1}</button></div></>:
            <div className="getting-started"><div className="intro-art small-art"><div className="court-outline"><span className="court-net"/><span className="court-service-left"/><span className="court-service-right"/></div></div><h2>Let's set up your first round</h2><p>Choose the attendees on the right and set the number of available courts. The algorithm will handle teams and resting players.</p><button className="button primary large" onClick={generate} disabled={attendees.length<4 || s.courts<1}><Shuffle size={18}/>Generate round 1</button>{attendees.length<4&&<span className="tiny subtle">At least four attendees required.</span>}</div>}
          </>}
          </div><aside className="session-side">
            <div className="panel side-panel"><div className="side-panel-head"><h3>Session settings</h3><span className="subtle tiny">Next round</span></div><div className="field-label">AVAILABLE COURTS</div><div className="stepper"><button aria-label="Remove a court" onClick={()=>updateSession(old=>({...old,courts:Math.max(0,old.courts-1)}))}>−</button><strong>{s.courts}</strong><button aria-label="Add a court" onClick={()=>updateSession(old=>({...old,courts:Math.min(30,old.courts+1)}))}>+</button></div><p className="tiny subtle">Changes affect newly generated rounds, not the current assignments.</p></div>
            <div className="panel side-panel"><div className="side-panel-head"><h3>Attendees <span className="tiny subtle">({attendees.length})</span></h3><span className="tiny subtle">Next round</span></div><div className="search-wrap full"><Search size={16}/><input placeholder="Find players…" aria-label="Find attendees" value={attendeeSearch} onChange={e=>setAttendeeSearch(e.target.value)}/></div><div className="attendee-list">{[...players].sort((a,b)=>a.name.localeCompare(b.name)).filter(p=>surname(p).includes(attendeeSearch.toLowerCase())).map(p=><label className="attendee-item" key={p.id}><input type="checkbox" checked={s.attendeeIds.includes(p.id)} onChange={()=>toggleAttendee(p.id)}/><span className="attendee-name">{p.name}</span><RatingTag rating={p.rating}/></label>)}</div><button className="text-button add-from-session" onClick={()=>editPlayer()}><UserPlus size={16}/>Add a new player</button></div>
            {s.rounds.length>0&&<button className="button subtle-button full" onClick={()=>setView('history')}><History size={16}/>View all round history <ChevronRight size={15}/></button>}
            <button className="text-button mobile-end" onClick={()=>setShowEnd(true)}><LogOut size={16}/>End session</button>
          </aside></div>
        </>)}
        {view==='history'&&<><div className="page-heading"><div><div className="eyebrow">SESSION RECORD</div><h1>Round history</h1><p>Review all confirmed matches and correct past assignments if necessary.</p></div></div>
          {!s||!s.rounds.length?<div className="empty-state panel"><History size={31}/><h3>No confirmed rounds yet</h3><p>Confirm your first round to see the history here.</p><button className="button primary" onClick={()=>setView('session')}>Go to session</button></div>:<div className="history-list">{[...s.rounds].reverse().map((round,i)=>{const index=s.rounds.length-1-i;return <section className="panel history-round" key={round.number}><div className="history-head"><div><div className="eyebrow">CONFIRMED</div><h2>Round {round.number}</h2><span className="subtle small">{round.matches.length} courts · {round.restingIds.length} resting</span></div><button className="button subtle-button" onClick={()=>editConfirmed(index)}><Pencil size={16}/>Correct</button></div><div className="court-grid">{round.matches.map(m=><CourtCard key={m.court} match={m} allPlayers={players}/>)}</div><div className="history-rest"><strong>Resting: </strong>{round.restingIds.map(pid=>playerById.get(pid)?.name??'Unknown').join(', ')||'None'}</div></section>})}</div>}
        </>}
      </main>
    </div>
    <nav className="mobile-nav" aria-label="Main navigation">{([{key:'players',label:'Players',icon:Users},{key:'session',label:'Session',icon:LayoutGrid},{key:'history',label:'History',icon:History}] as const).map(item=><button key={item.key} className={view===item.key?'active':''} onClick={()=>setView(item.key)}><item.icon size={21}/><span>{item.label}</span></button>)}</nav>
    <input type="file" accept="application/json" ref={fileInput} hidden onChange={e=>e.target.files?.[0]&&importBackup(e.target.files[0])}/>
    {playerModal&&<div className="modal-scrim" onMouseDown={e=>{if(e.target===e.currentTarget)setPlayerModal(false)}}><form className="modal" onSubmit={submitPlayer}><div className="modal-head"><h2>{editingPlayer?'Edit player':'Add new player'}</h2><button type="button" className="icon-button" onClick={()=>setPlayerModal(false)}><X size={20}/></button></div><p className="subtle">Ratings are relative to your group. 10 is the strongest.</p><label className="form-label">PLAYER NAME<input autoFocus required maxLength={70} value={name} placeholder="e.g. Alex Morgan" onChange={e=>setName(e.target.value)}/></label><div className="field-grid"><div><div className="form-label">GENDER</div><div className="gender-toggle"><button disabled={!!s && !!editingPlayer} type="button" className={gender==='M'?'active':''} onClick={()=>setGender('M')}>Male</button><button disabled={!!s && !!editingPlayer} type="button" className={gender==='F'?'active':''} onClick={()=>setGender('F')}>Female</button></div></div><label className="form-label">SKILL RATING<select disabled={!!s && !!editingPlayer} value={rating} onChange={e=>setRating(e.target.value)}>{Array.from({length:19},(_,i)=>1+i*.5).map(n=><option key={n} value={n}>{format(n)}</option>)}</select></label></div><div className="modal-actions"><button type="button" className="button subtle-button" onClick={()=>setPlayerModal(false)}>Cancel</button><button className="button primary" type="submit"><Check size={17}/>{editingPlayer?'Save changes':'Add player'}</button></div></form></div>}
    {pendingConfirm&&<div className="modal-scrim"><div className="modal small-modal"><div className="modal-head"><h2>{s?.draftMode==='correction'?'Save corrected round?':'Confirm this round?'}</h2><button className="icon-button" onClick={()=>setPendingConfirm(false)}><X size={20}/></button></div><p>The exact court assignments and resting players will be recorded in session history. You can correct this later.</p><div className="modal-actions"><button className="button subtle-button" onClick={()=>setPendingConfirm(false)}>Go back</button><button className="button primary" onClick={saveRound}><Check size={17}/>Yes, confirm</button></div></div></div>}
    {showEnd&&<div className="modal-scrim"><div className="modal small-modal"><div className="modal-head"><h2>End this session?</h2><button className="icon-button" onClick={()=>setShowEnd(false)}><X size={20}/></button></div><p>All current round history will be cleared. Your player directory stays saved.</p><div className="modal-actions"><button className="button subtle-button" onClick={()=>setShowEnd(false)}>Keep session</button><button className="button danger-button" onClick={endSession}>End session</button></div></div></div>}
    {showDemo&&<div className="modal-scrim"><div className="modal small-modal"><div className="modal-head"><h2>Load 20 sample players?</h2><button className="icon-button" onClick={()=>setShowDemo(false)}><X size={20}/></button></div><p>This adds test players with ratings ranging from 3.5 to 9.0. You can delete them after testing.</p><div className="modal-actions"><button className="button subtle-button" onClick={()=>setShowDemo(false)}>Cancel</button><button className="button primary" onClick={loadDemo}>Add sample players</button></div></div></div>}
    {historyEditWarning&&<div className="modal-scrim"><div className="modal small-modal"><div className="modal-head"><h2>Editing an earlier round</h2><button className="icon-button" onClick={()=>setHistoryEditWarning(false)}><X size={20}/></button></div><p>Changing this round updates future matchmaking history. Later rounds remain as originally played, even if this changes the optimality of their assignments.</p><div className="modal-actions"><button className="button primary" onClick={()=>setHistoryEditWarning(false)}>Understood</button></div></div></div>}
  </div>;
}
