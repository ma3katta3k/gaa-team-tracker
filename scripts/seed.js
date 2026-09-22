#!/usr/bin/env node
// Validates and imports data/initial-team.json into D1.
// Safe to run repeatedly: rows are matched on natural keys and upserted,
// never duplicated. Any validation failure aborts before touching the DB.

import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_NAME = "gaa-team-tracker";
const DATA_PATH = path.join(__dirname, "..", "data", "initial-team.json");

const mode = process.argv.includes("--remote") ? "--remote" : "--local";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BIRTH_YEAR_STATUSES = ["confirmed", "assumed", "unknown"];
const APPEARANCE_TYPES = ["start", "substitute", "played"];
const REPORT_STATUSES = ["full", "partial", "result_only"];
const POSITIONS = [
  "GK", "RCB", "FB", "LCB", "RHB", "CHB", "LHB",
  "MF", "RHF", "CHF", "LHF", "RCF", "FF", "LCF",
];

function normalizeName(name) {
  return String(name).trim().toLowerCase().replace(/\s+/g, " ");
}

function isNonNegInt(v) {
  return Number.isInteger(v) && v >= 0;
}

// ---------------------------------------------------------------------------
// Load + validate
// ---------------------------------------------------------------------------

let raw;
try {
  raw = readFileSync(DATA_PATH, "utf-8");
} catch (err) {
  console.error(`Could not read ${DATA_PATH}: ${err.message}`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(raw);
} catch (err) {
  console.error(`Invalid JSON in ${DATA_PATH}: ${err.message}`);
  process.exit(1);
}

const errors = [];

if (!data.team || typeof data.team !== "object") {
  errors.push('Missing "team" object');
} else {
  if (!data.team.club || typeof data.team.club !== "string") errors.push("team.club must be a non-empty string");
  if (!data.team.name || typeof data.team.name !== "string") errors.push("team.name must be a non-empty string");
  if (!Number.isInteger(data.team.season)) errors.push("team.season must be an integer");
}

if (!Array.isArray(data.players)) errors.push('Missing "players" array');
const knownPlayerNames = new Set();
(data.players || []).forEach((p, i) => {
  const ctx = `players[${i}]`;
  if (!p.name || typeof p.name !== "string") {
    errors.push(`${ctx}: name is required`);
    return;
  }
  const norm = normalizeName(p.name);
  if (knownPlayerNames.has(norm)) errors.push(`${ctx}: duplicate player name "${p.name}" in seed file`);
  knownPlayerNames.add(norm);

  if (!BIRTH_YEAR_STATUSES.includes(p.birth_year_status)) {
    errors.push(`${ctx} (${p.name}): birth_year_status must be one of ${BIRTH_YEAR_STATUSES.join(", ")}`);
  }
  if (p.birth_year !== null && p.birth_year !== undefined) {
    if (!Number.isInteger(p.birth_year) || p.birth_year < 1900 || p.birth_year > 2100) {
      errors.push(`${ctx} (${p.name}): birth_year must be null or a plausible year`);
    }
  }
  if (p.birth_year_status === "confirmed" && (p.birth_year === null || p.birth_year === undefined)) {
    errors.push(`${ctx} (${p.name}): birth_year_status is "confirmed" but birth_year is null`);
  }
});

if (!Array.isArray(data.matches)) errors.push('Missing "matches" array');
const matchKeys = new Set();
(data.matches || []).forEach((m, i) => {
  const ctx = `matches[${i}] (${m.date ?? "?"} vs ${m.opponent ?? "?"})`;

  if (!m.date || !ISO_DATE_RE.test(m.date) || Number.isNaN(Date.parse(m.date))) {
    errors.push(`${ctx}: date must be a valid ISO date (YYYY-MM-DD)`);
  }
  if (!m.opponent || typeof m.opponent !== "string") errors.push(`${ctx}: opponent is required`);
  if (!m.competition || typeof m.competition !== "string") errors.push(`${ctx}: competition is required`);
  if (!REPORT_STATUSES.includes(m.report_status)) {
    errors.push(`${ctx}: report_status must be one of ${REPORT_STATUSES.join(", ")}`);
  }

  if (m.date && m.opponent) {
    const key = `${m.date}::${normalizeName(m.opponent)}`;
    if (matchKeys.has(key)) errors.push(`${ctx}: duplicate match (same date + opponent) in seed file`);
    matchKeys.add(key);
  }

  const score = m.score || {};
  const forScore = score.for || {};
  const againstScore = score.against || {};
  if (!isNonNegInt(forScore.goals)) errors.push(`${ctx}: score.for.goals must be a non-negative integer`);
  if (!isNonNegInt(forScore.points)) errors.push(`${ctx}: score.for.points must be a non-negative integer`);
  if (!isNonNegInt(againstScore.goals)) errors.push(`${ctx}: score.against.goals must be a non-negative integer`);
  if (!isNonNegInt(againstScore.points)) errors.push(`${ctx}: score.against.points must be a non-negative integer`);

  if (m.source && typeof m.source !== "object") errors.push(`${ctx}: source must be an object if present`);

  if (!Array.isArray(m.appearances)) {
    errors.push(`${ctx}: appearances must be an array (can be empty)`);
  } else {
    const appearancePlayers = new Set();
    m.appearances.forEach((a, j) => {
      const actx = `${ctx}.appearances[${j}]`;
      if (!a.player || typeof a.player !== "string") {
        errors.push(`${actx}: player is required`);
        return;
      }
      const pnorm = normalizeName(a.player);
      if (!knownPlayerNames.has(pnorm)) errors.push(`${actx}: player "${a.player}" is not listed in players[]`);
      if (appearancePlayers.has(pnorm)) errors.push(`${actx}: duplicate appearance for "${a.player}" in this match`);
      appearancePlayers.add(pnorm);

      if (!APPEARANCE_TYPES.includes(a.appearance)) {
        errors.push(`${actx}: appearance must be one of ${APPEARANCE_TYPES.join(", ")}`);
      }
      if (a.shirt !== null && a.shirt !== undefined) {
        if (!Number.isInteger(a.shirt) || a.shirt < 1 || a.shirt > 99) {
          errors.push(`${actx}: shirt must be null or an integer between 1 and 99`);
        }
      }
      if (a.position !== null && a.position !== undefined && !POSITIONS.includes(a.position)) {
        errors.push(`${actx}: position "${a.position}" is not a recognised position`);
      }
      if (!isNonNegInt(a.goals)) errors.push(`${actx}: goals must be a non-negative integer`);
      if (!isNonNegInt(a.points)) errors.push(`${actx}: points must be a non-negative integer`);
      if (a.frees !== null && a.frees !== undefined && !isNonNegInt(a.frees)) {
        errors.push(`${actx}: frees must be null or a non-negative integer`);
      }
      if (a.two_pointers !== null && a.two_pointers !== undefined && !isNonNegInt(a.two_pointers)) {
        errors.push(`${actx}: two_pointers must be null or a non-negative integer`);
      }
      if (a.notes !== null && a.notes !== undefined && typeof a.notes !== "string") {
        errors.push(`${actx}: notes must be null or a string`);
      }
    });
  }
});

if (errors.length > 0) {
  console.error(`\nSeed validation failed with ${errors.length} error(s). No changes were made.\n`);
  errors.forEach((e) => console.error(`  - ${e}`));
  console.error("");
  process.exit(1);
}

console.log(`Validation passed (${data.players.length} players, ${data.matches.length} matches).`);

// ---------------------------------------------------------------------------
// Wrangler helpers
// ---------------------------------------------------------------------------

function runWrangler(args) {
  const result = spawnSync("npx", ["wrangler", ...args], { encoding: "utf-8", maxBuffer: 1024 * 1024 * 32 });
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`wrangler ${args.join(" ")} failed (exit code ${result.status})`);
  }
  return result.stdout;
}

function runD1Json(sql) {
  const stdout = runWrangler(["d1", "execute", DB_NAME, mode, "--json", "--command", sql]);
  return JSON.parse(stdout);
}

function runD1File(filePath) {
  runWrangler(["d1", "execute", DB_NAME, mode, "--file", filePath]);
}

function sqlStr(v) {
  if (v === null || v === undefined) return "NULL";
  return `'${String(v).replace(/'/g, "''")}'`;
}

function sqlNum(v) {
  if (v === null || v === undefined) return "NULL";
  return String(Number(v));
}

// ---------------------------------------------------------------------------
// Fetch existing state to classify created vs. updated
// ---------------------------------------------------------------------------

console.log(`Reading existing ${mode.slice(2)} database state...`);

const existingTeamsResult = runD1Json("SELECT club_name, team_name, season FROM teams;");
const existingPlayersResult = runD1Json("SELECT normalized_name FROM players;");
const existingMatchesResult = runD1Json(
  `SELECT t.club_name, t.team_name, t.season, m.date, m.opponent
   FROM matches m JOIN teams t ON t.id = m.team_id;`
);
const existingAppearancesResult = runD1Json(
  `SELECT t.club_name, t.team_name, t.season, m.date, m.opponent, p.normalized_name AS player_normalized_name
   FROM appearances a
   JOIN matches m ON m.id = a.match_id
   JOIN teams t ON t.id = m.team_id
   JOIN players p ON p.id = a.player_id;`
);

const existingTeamKeys = new Set(
  existingTeamsResult[0].results.map((r) => `${r.club_name}::${r.team_name}::${r.season}`)
);
const existingPlayerKeys = new Set(existingPlayersResult[0].results.map((r) => r.normalized_name));
const existingMatchKeys = new Set(
  existingMatchesResult[0].results.map((r) => `${r.club_name}::${r.team_name}::${r.season}::${r.date}::${normalizeName(r.opponent)}`)
);
const existingAppearanceKeys = new Set(
  existingAppearancesResult[0].results.map(
    (r) => `${r.club_name}::${r.team_name}::${r.season}::${r.date}::${normalizeName(r.opponent)}::${r.player_normalized_name}`
  )
);

// ---------------------------------------------------------------------------
// Build upsert SQL
// ---------------------------------------------------------------------------

const teamKey = `${data.team.club}::${data.team.name}::${data.team.season}`;
const counts = {
  teams: { created: 0, updated: 0 },
  players: { created: 0, updated: 0 },
  matches: { created: 0, updated: 0 },
  appearances: { created: 0, updated: 0 },
};

const statements = [];

// Team
statements.push(`
INSERT INTO teams (club_name, team_name, season)
VALUES (${sqlStr(data.team.club)}, ${sqlStr(data.team.name)}, ${sqlNum(data.team.season)})
ON CONFLICT(club_name, team_name, season) DO UPDATE SET club_name = excluded.club_name;`);
counts.teams[existingTeamKeys.has(teamKey) ? "updated" : "created"]++;

const teamSubquery = `(SELECT id FROM teams WHERE club_name = ${sqlStr(data.team.club)} AND team_name = ${sqlStr(data.team.name)} AND season = ${sqlNum(data.team.season)})`;

// Players
for (const p of data.players) {
  const norm = normalizeName(p.name);
  statements.push(`
INSERT INTO players (name, normalized_name, birth_year, birth_year_status)
VALUES (${sqlStr(p.name)}, ${sqlStr(norm)}, ${sqlNum(p.birth_year)}, ${sqlStr(p.birth_year_status)})
ON CONFLICT(normalized_name) DO UPDATE SET
  name = excluded.name,
  birth_year = excluded.birth_year,
  birth_year_status = excluded.birth_year_status;`);
  counts.players[existingPlayerKeys.has(norm) ? "updated" : "created"]++;

  // Roster link (no separate created/updated tracking; not part of the requested summary)
  statements.push(`
INSERT OR IGNORE INTO team_players (team_id, player_id)
VALUES (${teamSubquery}, (SELECT id FROM players WHERE normalized_name = ${sqlStr(norm)}));`);
}

// Matches + appearances
for (const m of data.matches) {
  const matchKey = `${teamKey}::${m.date}::${normalizeName(m.opponent)}`;
  const source = m.source || {};

  statements.push(`
INSERT INTO matches (team_id, date, opponent, competition, goals_for, points_for, goals_against, points_against, source_reference, source_type, report_status)
VALUES (
  ${teamSubquery},
  ${sqlStr(m.date)}, ${sqlStr(m.opponent)}, ${sqlStr(m.competition)},
  ${sqlNum(m.score.for.goals)}, ${sqlNum(m.score.for.points)},
  ${sqlNum(m.score.against.goals)}, ${sqlNum(m.score.against.points)},
  ${sqlStr(source.reference)}, ${sqlStr(source.type)}, ${sqlStr(m.report_status)}
)
ON CONFLICT(team_id, date, opponent) DO UPDATE SET
  competition = excluded.competition,
  goals_for = excluded.goals_for,
  points_for = excluded.points_for,
  goals_against = excluded.goals_against,
  points_against = excluded.points_against,
  source_reference = excluded.source_reference,
  source_type = excluded.source_type,
  report_status = excluded.report_status;`);
  counts.matches[existingMatchKeys.has(matchKey) ? "updated" : "created"]++;

  const matchSubquery = `(SELECT id FROM matches WHERE team_id = ${teamSubquery} AND date = ${sqlStr(m.date)} AND opponent = ${sqlStr(m.opponent)})`;

  for (const a of m.appearances) {
    const pNorm = normalizeName(a.player);
    const appearanceKey = `${matchKey}::${pNorm}`;
    const playerSubquery = `(SELECT id FROM players WHERE normalized_name = ${sqlStr(pNorm)})`;

    statements.push(`
INSERT INTO appearances (match_id, player_id, appearance_type, shirt_number, position, goals, points, frees, two_pointers, notes)
VALUES (
  ${matchSubquery}, ${playerSubquery}, ${sqlStr(a.appearance)}, ${sqlNum(a.shirt)}, ${sqlStr(a.position)},
  ${sqlNum(a.goals)}, ${sqlNum(a.points)}, ${sqlNum(a.frees)}, ${sqlNum(a.two_pointers)}, ${sqlStr(a.notes)}
)
ON CONFLICT(match_id, player_id) DO UPDATE SET
  appearance_type = excluded.appearance_type,
  shirt_number = excluded.shirt_number,
  position = excluded.position,
  goals = excluded.goals,
  points = excluded.points,
  frees = excluded.frees,
  two_pointers = excluded.two_pointers,
  notes = excluded.notes;`);
    counts.appearances[existingAppearanceKeys.has(appearanceKey) ? "updated" : "created"]++;
  }
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

const tmpFile = path.join(__dirname, `.generated-seed-${mode.slice(2)}.sql`);
writeFileSync(tmpFile, statements.join("\n"));

console.log(`Applying seed to ${mode.slice(2)} database...`);
try {
  runD1File(tmpFile);
} finally {
  unlinkSync(tmpFile);
}

console.log("\nImport summary:");
console.log(`  Teams:        ${counts.teams.created} created, ${counts.teams.updated} updated`);
console.log(`  Players:      ${counts.players.created} created, ${counts.players.updated} updated`);
console.log(`  Matches:      ${counts.matches.created} created, ${counts.matches.updated} updated`);
console.log(`  Appearances:  ${counts.appearances.created} created, ${counts.appearances.updated} updated`);
console.log("\nDone.");
