// GAA Team Tracker frontend. No frontend data is hard-coded — everything
// comes from /api/* backed by D1.

const state = {
  teams: [],
  currentTeam: null,
  players: [],
  selectedPlayerId: null,
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

init();
