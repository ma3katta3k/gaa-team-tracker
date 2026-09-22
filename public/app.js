// GAA Team Tracker frontend. No frontend data is hard-coded — everything
// comes from /api/* backed by D1.

const state = {
  teams: [],
  currentTeam: null,
  players: [],
  selectedPlayerId: null,
  view: "player",
  matches: [],
  matchesTeamId: null,
  pitch: null, // { teamId, match, jerseys: [{ playerId, name, position, shirt, notes, stats }] }
};

const el = {
  teamLabel: document.getElementById("team-label"),
  seasonSelect: document.getElementById("season-select"),
  birthYearSelect: document.getElementById("birth-year-select"),
  searchInput: document.getElementById("search-input"),
  playerList: document.getElementById("player-list"),
  emptyMain: document.getElementById("empty-main"),
  playerView: document.getElementById("player-view"),
  playerName: document.getElementById("player-name"),
  playerBirthYear: document.getElementById("player-birth-year"),
  playerBirthStatus: document.getElementById("player-birth-status"),
  playerUsualPosition: document.getElementById("player-usual-position"),
  statGames: document.getElementById("stat-games"),
  statStarts: document.getElementById("stat-starts"),
  statGoals: document.getElementById("stat-goals"),
  statPoints: document.getElementById("stat-points"),
  statScoreValue: document.getElementById("stat-score-value"),
  positionsUsed: document.getElementById("positions-used"),
  matchesTbody: document.getElementById("matches-tbody"),
  matchesCards: document.getElementById("matches-cards"),
  birthYearField: document.getElementById("birth-year-field"),
  birthYearToggle: document.getElementById("birth-year-toggle"),
  viewTogglePlayer: document.getElementById("view-toggle-player"),
  viewTogglePitch: document.getElementById("view-toggle-pitch"),
  playerViewPanel: document.getElementById("player-view-panel"),
  pitchViewPanel: document.getElementById("pitch-view-panel"),
  pitchStatus: document.getElementById("pitch-status"),
  pitchContent: document.getElementById("pitch-content"),
  pitchMatchTitle: document.getElementById("pitch-match-title"),
  pitchMatchMeta: document.getElementById("pitch-match-meta"),
  pitchJerseys: document.getElementById("pitch-jerseys"),
  intercountySection: document.getElementById("intercounty-section"),
  intercountyGroups: document.getElementById("intercounty-groups"),
};

async function api(path) {
  const res = await fetch(path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

function scoreLine(goals, points) {
  return `${goals}-${String(points).padStart(2, "0")}`;
}

const APPEARANCE_LABELS = { start: "Start", substitute: "Sub", played: "Played" };

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  try {
    state.teams = await api("/api/teams");
  } catch (err) {
    el.teamLabel.textContent = "Failed to load teams";
    el.playerList.innerHTML = `<div class="empty-state">Could not reach the API: ${err.message}</div>`;
    return;
  }

  if (state.teams.length === 0) {
    el.teamLabel.textContent = "No teams found";
    el.playerList.innerHTML = `<div class="empty-state">No teams in the database yet. Run the seed script.</div>`;
    return;
  }

  populateSeasonSelect();
  await selectTeam(state.teams[0].id);

  el.seasonSelect.addEventListener("change", () => selectTeam(Number(el.seasonSelect.value)));
  el.birthYearSelect.addEventListener("change", renderPlayerList);
  el.searchInput.addEventListener("input", renderPlayerList);

  el.birthYearToggle.addEventListener("click", () => {
    const isOpen = el.birthYearField.classList.toggle("open");
    el.birthYearToggle.setAttribute("aria-expanded", String(isOpen));
  });

  el.viewTogglePlayer.addEventListener("click", () => setView("player"));
  el.viewTogglePitch.addEventListener("click", () => setView("pitch"));

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".pitch-jersey")) closeAllPopovers();
  });
}

// ---------------------------------------------------------------------------
// View toggle
// ---------------------------------------------------------------------------

function setView(view) {
  state.view = view;
  const isPitch = view === "pitch";

  el.playerViewPanel.classList.toggle("hidden", isPitch);
  el.pitchViewPanel.classList.toggle("hidden", !isPitch);

  el.viewTogglePlayer.classList.toggle("active", !isPitch);
  el.viewTogglePlayer.setAttribute("aria-selected", String(!isPitch));
  el.viewTogglePitch.classList.toggle("active", isPitch);
  el.viewTogglePitch.setAttribute("aria-selected", String(isPitch));

  if (isPitch) loadPitchView();
}

function populateSeasonSelect() {
  el.seasonSelect.innerHTML = "";
  for (const team of state.teams) {
    const opt = document.createElement("option");
    opt.value = team.id;
    opt.textContent = `${team.season} — ${team.team_name}`;
    el.seasonSelect.appendChild(opt);
  }
}

async function selectTeam(teamId) {
  state.currentTeam = state.teams.find((t) => t.id === teamId);
  el.seasonSelect.value = teamId;
  el.teamLabel.textContent = `${state.currentTeam.club_name} — ${state.currentTeam.team_name} (${state.currentTeam.season})`;

  el.playerList.innerHTML = `<div class="empty-state">Loading players...</div>`;
  try {
    state.players = await api(`/api/teams/${teamId}/players`);
  } catch (err) {
    el.playerList.innerHTML = `<div class="empty-state">Failed to load players: ${err.message}</div>`;
    return;
  }

  populateBirthYearSelect();
  renderPlayerList();

  state.selectedPlayerId = null;
  el.playerView.classList.add("hidden");
  el.emptyMain.classList.remove("hidden");

  state.pitch = null;
  if (state.view === "pitch") loadPitchView();
}

function populateBirthYearSelect() {
  const years = [...new Set(state.players.map((p) => p.birth_year).filter((y) => y !== null))].sort();
  el.birthYearSelect.innerHTML = '<option value="">All</option>';
  for (const y of years) {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    el.birthYearSelect.appendChild(opt);
  }
}

// ---------------------------------------------------------------------------
// Player list (sidebar)
// ---------------------------------------------------------------------------

function renderPlayerList() {
  const search = el.searchInput.value.trim().toLowerCase();
  const birthYear = el.birthYearSelect.value;

  const filtered = state.players.filter((p) => {
    if (search && !p.name.toLowerCase().includes(search)) return false;
    if (birthYear && String(p.birth_year) !== birthYear) return false;
    return true;
  });

  if (filtered.length === 0) {
    el.playerList.innerHTML = `<div class="empty-state">No players match your filters.</div>`;
    return;
  }

  el.playerList.innerHTML = "";
  for (const p of filtered) {
    const row = document.createElement("div");
    row.className = "player-row" + (p.id === state.selectedPlayerId ? " active" : "");
    row.dataset.playerId = p.id;

    const name = document.createElement("span");
    name.className = "player-row-name";
    name.textContent = p.name;

    const year = document.createElement("span");
    year.className = "player-row-year";
    year.textContent = p.birth_year ? p.birth_year : "—";

    row.appendChild(name);
    row.appendChild(year);
    row.addEventListener("click", () => selectPlayer(p.id));
    el.playerList.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Player detail (main)
// ---------------------------------------------------------------------------

async function selectPlayer(playerId) {
  state.selectedPlayerId = playerId;
  renderPlayerList();

  el.emptyMain.classList.add("hidden");
  el.playerView.classList.remove("hidden");
  el.playerName.textContent = "Loading...";

  let player, appearances;
  try {
    [player, appearances] = await Promise.all([
      api(`/api/players/${playerId}`),
      api(`/api/players/${playerId}/appearances?season=${state.currentTeam.season}`),
    ]);
  } catch (err) {
    el.playerName.textContent = "Error";
    el.matchesTbody.innerHTML = `<tr><td colspan="9">Failed to load player: ${err.message}</td></tr>`;
    el.matchesCards.innerHTML = `<div class="empty-state">Failed to load player: ${err.message}</div>`;
    return;
  }

  renderPlayer(player, appearances);

  // Inter-county data is supplementary and fetched independently of the club
  // player/appearances call above, so a failure here never affects club rendering.
  try {
    const intercounty = await api(`/api/players/${playerId}/intercounty`);
    renderIntercounty(intercounty);
  } catch (err) {
    el.intercountySection.classList.add("hidden");
  }
}

function renderPlayer(player, appearances) {
  el.playerName.textContent = player.name;
  el.playerBirthYear.textContent = player.birth_year ? `Born ${player.birth_year}` : "Birth year unknown";

  el.playerBirthStatus.textContent = player.birth_year_status;
  el.playerBirthStatus.className = `badge badge-${player.birth_year_status}`;

  const positionCounts = {};
  for (const a of appearances) {
    if (a.position) positionCounts[a.position] = (positionCounts[a.position] || 0) + 1;
  }
  const usualPosition = Object.entries(positionCounts).sort((a, b) => b[1] - a[1])[0];
  el.playerUsualPosition.textContent = usualPosition ? usualPosition[0] : "—";

  const games = appearances.length;
  const starts = appearances.filter((a) => a.appearance_type === "start").length;
  const goals = appearances.reduce((sum, a) => sum + a.goals, 0);
  const points = appearances.reduce((sum, a) => sum + a.points, 0);
  const scoreValue = appearances.reduce((sum, a) => sum + a.goals * 3 + a.points, 0);

  el.statGames.textContent = games;
  el.statStarts.textContent = starts;
  el.statGoals.textContent = goals;
  el.statPoints.textContent = points;
  el.statScoreValue.textContent = scoreValue;

  el.positionsUsed.innerHTML = "";
  const sortedPositions = Object.entries(positionCounts).sort((a, b) => b[1] - a[1]);
  if (sortedPositions.length === 0) {
    el.positionsUsed.innerHTML = `<span class="empty-state">No position data recorded.</span>`;
  } else {
    for (const [position, count] of sortedPositions) {
      const chip = document.createElement("div");
      chip.className = "position-chip";
      chip.innerHTML = `<span>${position}</span><span class="count">${count}</span>`;
      el.positionsUsed.appendChild(chip);
    }
  }

  el.matchesTbody.innerHTML = "";
  el.matchesCards.innerHTML = "";

  if (appearances.length === 0) {
    el.matchesTbody.innerHTML = `<tr><td colspan="9">No match appearances recorded for this season.</td></tr>`;
    el.matchesCards.innerHTML = `<div class="empty-state">No match appearances recorded for this season.</div>`;
    return;
  }

  for (const a of appearances) {
    const appearanceLabel = APPEARANCE_LABELS[a.appearance_type] || a.appearance_type;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${a.date}</td>
      <td>${a.opponent}</td>
      <td>${a.competition}</td>
      <td>${appearanceLabel}</td>
      <td>${a.position || "—"}</td>
      <td>${a.goals}</td>
      <td>${a.points}</td>
      <td>${scoreLine(a.goals, a.points)}</td>
      <td class="notes">${a.notes || ""}</td>
    `;
    el.matchesTbody.appendChild(tr);

    const extras = [];
    if (a.frees !== null && a.frees !== undefined) extras.push(`Frees: ${a.frees}`);
    if (a.two_pointers !== null && a.two_pointers !== undefined) extras.push(`2-pointers: ${a.two_pointers}`);

    const card = document.createElement("div");
    card.className = "match-card";
    card.innerHTML = `
      <div class="match-card-top">
        <div class="match-card-opponent">${a.opponent}</div>
        <div class="match-card-date">${a.date}</div>
      </div>
      <div class="match-card-competition">${a.competition}</div>
      <div class="match-card-tags">
        <span class="tag">${appearanceLabel}${a.shirt_number ? ` #${a.shirt_number}` : ""}</span>
        <span class="tag tag-position">${a.position || "Position —"}</span>
      </div>
      <div class="match-card-stats">
        <div class="match-card-stat"><span class="label">Goals</span><span class="value">${a.goals}</span></div>
        <div class="match-card-stat"><span class="label">Points</span><span class="value">${a.points}</span></div>
        <div class="match-card-stat"><span class="label">Score</span><span class="value">${scoreLine(a.goals, a.points)}</span></div>
      </div>
      ${extras.length ? `<div class="match-card-extra">${extras.join(" · ")}</div>` : ""}
      ${a.notes ? `<div class="match-card-notes">${a.notes}</div>` : ""}
    `;
    el.matchesCards.appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// Inter-county section (separate data source; never touches club stats above)
// ---------------------------------------------------------------------------

function intercountyGroupKey(row) {
  return `${row.county}::${row.grade}::${row.season}`;
}

function renderIntercounty(data) {
  const { memberships, appearances } = data;

  if (memberships.length === 0 && appearances.length === 0) {
    el.intercountySection.classList.add("hidden");
    el.intercountyGroups.innerHTML = "";
    return;
  }

  // Group by county+grade+season, then within that by competition.
  const groups = new Map();
  const getGroup = (row) => {
    const key = intercountyGroupKey(row);
    if (!groups.has(key)) {
      groups.set(key, { county: row.county, grade: row.grade, season: row.season, membership: null, competitions: new Map() });
    }
    return groups.get(key);
  };

  for (const m of memberships) {
    getGroup(m).membership = m;
  }

  for (const a of appearances) {
    const group = getGroup(a);
    if (!group.competitions.has(a.competition)) {
      group.competitions.set(a.competition, []);
    }
    group.competitions.get(a.competition).push(a);
  }

  const sortedGroups = [...groups.values()].sort((a, b) => b.season - a.season || a.county.localeCompare(b.county));

  el.intercountyGroups.innerHTML = "";
  for (const group of sortedGroups) {
    el.intercountyGroups.appendChild(buildIntercountyGroupEl(group));
  }

  el.intercountySection.classList.remove("hidden");
}

function buildIntercountyGroupEl(group) {
  const wrap = document.createElement("div");
  wrap.className = "intercounty-group";

  const header = document.createElement("div");
  header.className = "intercounty-group-header";
  header.innerHTML = `<span>${group.county} ${group.grade} · ${group.season}</span>`;
  if (group.membership) {
    const badge = document.createElement("span");
    badge.className = "intercounty-panel-badge";
    badge.textContent = "On panel";
    header.appendChild(badge);

    if (group.membership.source_url) {
      const link = document.createElement("a");
      link.className = "intercounty-source-link";
      link.href = group.membership.source_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Panel source ↗";
      link.title = group.membership.source_description || group.membership.source_url;
      header.appendChild(link);
    }
  }
  wrap.appendChild(header);

  const allMatches = [...group.competitions.values()].flat();
  if (allMatches.length > 0) {
    const overallStarts = allMatches.filter((m) => m.appearance_type === "start").length;
    const overallGoals = allMatches.reduce((sum, m) => sum + m.goals, 0);
    const overallPoints = allMatches.reduce((sum, m) => sum + m.points, 0);

    const overall = document.createElement("div");
    overall.className = "intercounty-overall";
    overall.innerHTML = `
      <span class="intercounty-overall-label">Overall</span>
      <span>${allMatches.length} appearance${allMatches.length === 1 ? "" : "s"} · ${overallStarts} start${overallStarts === 1 ? "" : "s"} · <span class="score">${scoreLine(overallGoals, overallPoints)}</span></span>
    `;
    wrap.appendChild(overall);
  }

  const sortedCompetitions = [...group.competitions.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  if (sortedCompetitions.length === 0) {
    const note = document.createElement("div");
    note.className = "intercounty-competition-summary";
    note.textContent = "On panel, no recorded match appearances yet.";
    wrap.appendChild(note);
  }

  for (const [competition, matches] of sortedCompetitions) {
    wrap.appendChild(buildIntercountyCompetitionEl(competition, matches));
  }

  return wrap;
}

function buildIntercountyCompetitionEl(competition, matches) {
  const sorted = matches.slice().sort((a, b) => b.date.localeCompare(a.date));
  const starts = sorted.filter((m) => m.appearance_type === "start").length;
  const goals = sorted.reduce((sum, m) => sum + m.goals, 0);
  const points = sorted.reduce((sum, m) => sum + m.points, 0);

  const el2 = document.createElement("div");
  el2.className = "intercounty-competition";
  el2.innerHTML = `
    <div class="intercounty-competition-name">${competition}</div>
    <div class="intercounty-competition-summary">
      ${sorted.length} appearance${sorted.length === 1 ? "" : "s"} · ${starts} start${starts === 1 ? "" : "s"}
      &nbsp;·&nbsp;<span class="score">${scoreLine(goals, points)}</span>
    </div>
  `;

  for (const m of sorted) {
    el2.appendChild(buildIntercountyMatchRowEl(m));
  }

  return el2;
}

function buildIntercountyMatchRowEl(m) {
  const row = document.createElement("div");
  row.className = "intercounty-match-row";

  const extras = [];
  if (m.two_pointers !== null && m.two_pointers !== undefined) extras.push(`${m.two_pointers}×2pt`);
  if (m.shirt_number) extras.push(`#${m.shirt_number}`);
  if (m.position) extras.push(m.position);
  if (m.competition_stage) extras.push(m.competition_stage);

  row.innerHTML = `
    <span class="intercounty-match-date">${formatDayMonth(m.date)}</span>
    <span class="intercounty-match-opponent">${m.opponent}</span>
    <span class="intercounty-match-appearance">${APPEARANCE_LABELS[m.appearance_type] || m.appearance_type}</span>
    <span class="intercounty-match-score">${scoreLine(m.goals, m.points)}</span>
    ${extras.length ? `<span class="intercounty-match-extra">${extras.join(" · ")}</span>` : ""}
    ${m.notes ? `<span class="intercounty-match-notes">${m.notes}</span>` : ""}
  `;

  if (m.source_url) {
    const link = document.createElement("a");
    link.className = "intercounty-source-link";
    link.href = m.source_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Source ↗";
    link.title = m.source_description || m.source_url;
    row.appendChild(link);
  }

  return row;
}

// ---------------------------------------------------------------------------
// Pitch view
// ---------------------------------------------------------------------------

// Approximate on-pitch coordinates (% of pitch width/height) per position code.
// Forwards near the top (y small), defenders near the bottom (y large), GK at the very bottom.
const POSITION_COORDS = {
  GK: [{ x: 50, y: 95 }],
  RCB: [{ x: 75, y: 80 }],
  FB: [{ x: 50, y: 82 }],
  LCB: [{ x: 25, y: 80 }],
  RHB: [{ x: 80, y: 63 }],
  CHB: [{ x: 50, y: 63 }],
  LHB: [{ x: 20, y: 63 }],
  MF: [
    { x: 38, y: 46 },
    { x: 62, y: 46 },
  ],
  RHF: [{ x: 80, y: 30 }],
  CHF: [{ x: 50, y: 30 }],
  LHF: [{ x: 20, y: 30 }],
  RCF: [{ x: 75, y: 12 }],
  FF: [{ x: 50, y: 10 }],
  LCF: [{ x: 25, y: 12 }],
};

function isChampionship(competition) {
  return /championship/i.test(competition || "");
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Parses the "YYYY-MM-DD" string directly (not via `new Date`) so the
// displayed day can't shift due to local-timezone interpretation of UTC midnight.
function formatMatchDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${SHORT_MONTHS[m - 1]} ${y}`;
}

// Same parsing, no year — used where the year is already shown by a parent heading.
function formatDayMonth(iso) {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${SHORT_MONTHS[m - 1]}`;
}

// Short label for the jersey marker: last word of the name (surname for
// almost all real names), so the pitch layout stays compact and predictable.
function shortDisplayName(name) {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1];
}

// Latest championship match first, then most recent match overall as fallback candidates.
function pitchMatchCandidates(matches) {
  const byDateDesc = (a, b) => b.date.localeCompare(a.date);
  const championship = matches.filter((m) => isChampionship(m.competition)).sort(byDateDesc);
  const all = matches.slice().sort(byDateDesc);
  const seen = new Set();
  const ordered = [];
  for (const m of [...championship, ...all]) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      ordered.push(m);
    }
  }
  return ordered;
}

async function loadPitchView() {
  const teamId = state.currentTeam.id;

  if (state.pitch && state.pitch.teamId === teamId) {
    renderPitch();
    return;
  }

  el.pitchContent.classList.add("hidden");
  el.pitchStatus.classList.remove("hidden");
  el.pitchStatus.textContent = "Loading pitch...";

  try {
    if (state.matchesTeamId !== teamId) {
      state.matches = await api(`/api/teams/${teamId}/matches`);
      state.matchesTeamId = teamId;
    }

    const candidates = pitchMatchCandidates(state.matches);
    let chosen = null;
    let starters = null;

    for (const candidate of candidates) {
      const data = await api(`/api/matches/${candidate.id}/appearances`);
      const candidateStarters = data.appearances.filter((a) => a.appearance_type === "start");
      if (candidateStarters.length > 0) {
        chosen = data.match;
        starters = candidateStarters;
        break;
      }
    }

    if (!chosen) {
      el.pitchStatus.textContent = "No match with a starting lineup was found for this team.";
      state.pitch = null;
      return;
    }

    const statsList = await Promise.all(
      starters.map((s) => api(`/api/players/${s.player_id}/appearances?season=${state.currentTeam.season}`))
    );

    const jerseys = starters.map((s, i) => {
      const seasonAppearances = statsList[i];
      return {
        playerId: s.player_id,
        name: s.player_name,
        position: s.position,
        shirt: s.shirt_number,
        notes: s.notes,
        stats: {
          games: seasonAppearances.length,
          starts: seasonAppearances.filter((a) => a.appearance_type === "start").length,
          goals: seasonAppearances.reduce((sum, a) => sum + a.goals, 0),
          points: seasonAppearances.reduce((sum, a) => sum + a.points, 0),
          scoreValue: seasonAppearances.reduce((sum, a) => sum + a.goals * 3 + a.points, 0),
        },
      };
    });

    state.pitch = { teamId, match: chosen, jerseys };
    renderPitch();
  } catch (err) {
    el.pitchStatus.textContent = `Failed to load pitch view: ${err.message}`;
    state.pitch = null;
  }
}

function renderPitch() {
  const { match, jerseys } = state.pitch;

  el.pitchMatchTitle.textContent = isChampionship(match.competition) ? "Latest Championship XV" : "Latest Starting XV";
  el.pitchMatchMeta.textContent = `v ${match.opponent} · ${formatMatchDate(match.date)}`;

  el.pitchStatus.classList.add("hidden");
  el.pitchContent.classList.remove("hidden");
  el.pitchJerseys.innerHTML = "";

  const slotIndex = {};
  for (const jersey of jerseys) {
    const slots = POSITION_COORDS[jersey.position];
    let coords;
    if (slots) {
      const i = slotIndex[jersey.position] || 0;
      coords = slots[Math.min(i, slots.length - 1)];
      slotIndex[jersey.position] = i + 1;
    } else {
      coords = { x: 50, y: 50 };
    }
    el.pitchJerseys.appendChild(buildJerseyEl(jersey, coords));
  }
}

function buildJerseyEl(jersey, coords) {
  const wrap = document.createElement("div");
  wrap.className = "pitch-jersey";
  if (coords.x <= 25) wrap.classList.add("pitch-jersey--edge-left");
  if (coords.x >= 75) wrap.classList.add("pitch-jersey--edge-right");
  wrap.style.left = `${coords.x}%`;
  wrap.style.top = `${coords.y}%`;
  wrap.tabIndex = 0;
  wrap.setAttribute("role", "button");
  wrap.setAttribute("aria-label", `${jersey.name}, ${jersey.position || "position unknown"}`);

  const circle = document.createElement("div");
  circle.className = "jersey-circle";
  circle.textContent = jersey.shirt ?? "?";
  wrap.appendChild(circle);

  const nameLabel = document.createElement("div");
  nameLabel.className = "jersey-name-label";
  nameLabel.textContent = shortDisplayName(jersey.name);
  nameLabel.title = jersey.name;
  wrap.appendChild(nameLabel);

  const { stats } = jersey;
  const popover = document.createElement("div");
  popover.className = "jersey-popover";
  popover.innerHTML = `
    <div class="jersey-popover-name">${jersey.name}</div>
    <div class="jersey-popover-position">${jersey.position || "Position unknown"}</div>
    <div class="jersey-popover-stats">
      <div><span class="label">Games</span><span class="value">${stats.games}</span></div>
      <div><span class="label">Starts</span><span class="value">${stats.starts}</span></div>
      <div><span class="label">Goals</span><span class="value">${stats.goals}</span></div>
      <div><span class="label">Points</span><span class="value">${stats.points}</span></div>
      <div><span class="label">Score</span><span class="value">${stats.scoreValue}</span></div>
    </div>
    ${jersey.notes ? `<div class="jersey-popover-notes">${jersey.notes}</div>` : ""}
    <button type="button" class="jersey-popover-view-btn">View player &rarr;</button>
  `;
  wrap.appendChild(popover);

  popover.querySelector(".jersey-popover-view-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    goToPlayerFromPitch(jersey.playerId);
  });
  popover.addEventListener("click", (e) => e.stopPropagation());

  wrap.addEventListener("click", (e) => {
    e.stopPropagation();
    const hoverCapable = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (hoverCapable) {
      goToPlayerFromPitch(jersey.playerId);
    } else {
      // Idempotent by design: opening never depends on prior state, so a duplicate
      // click/touch event for the same tap can't accidentally re-close the popover.
      closeAllPopovers();
      popover.classList.add("open");
    }
  });

  wrap.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      wrap.click();
    }
  });

  return wrap;
}

function closeAllPopovers() {
  document.querySelectorAll(".jersey-popover.open").forEach((p) => p.classList.remove("open"));
}

function goToPlayerFromPitch(playerId) {
  closeAllPopovers();
  setView("player");
  selectPlayer(playerId);
}

init();
