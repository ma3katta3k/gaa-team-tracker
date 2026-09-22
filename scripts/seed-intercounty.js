#!/usr/bin/env node
// Validates and (optionally) imports inter-county player data into D1.
//
// SAFETY MODEL
// - Defaults to dry-run: always prints a full player-matching report and a
//   summary of what WOULD be written, but never touches the database.
// - Writing at all requires --apply.
// - Every player row is classified MATCHED / UNRESOLVED / AMBIGUOUS. If any
//   row is UNRESOLVED or AMBIGUOUS, --apply refuses to write anything unless
//   --force is also passed. Even with --force, only MATCHED rows are ever
//   written — unresolved/ambiguous rows are always skipped, never guessed at.
// - This importer NEVER creates or merges players.id rows. A row with no
//   confident existing-player match simply does not get imported.
// - Defaults to --local. --remote must be passed explicitly.
//
// Usage:
//   node scripts/seed-intercounty.js --file=<path.json>                    (dry run)
//   node scripts/seed-intercounty.js --file=<path.json> --apply            (write matched rows; local)
//   node scripts/seed-intercounty.js --file=<path.json> --apply --remote   (write matched rows; remote)
//   node scripts/seed-intercounty.js --file=<path.json> --apply --force    (write matched rows even if some are un/ambiguous)

import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createD1Client, sqlStr, sqlNum } from "./lib/d1.js";
import { normalizeName, lastWord } from "./lib/normalize.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_NAME = "gaa-team-tracker";

const argv = process.argv.slice(2);
const fileArg = argv.find((a) => a.startsWith("--file="));
const mode = argv.includes("--remote") ? "--remote" : "--local";
const apply = argv.includes("--apply");
const force = argv.includes("--force");

if (!fileArg) {
  console.error("Usage: node scripts/seed-intercounty.js --file=<path-to-json> [--apply] [--force] [--local|--remote]");
  process.exit(1);
}
const DATA_PATH = path.resolve(process.cwd(), fileArg.slice("--file=".length));

const { runD1Json, runD1File } = createD1Client(DB_NAME, mode);

const APPEARANCE_TYPES = ["start", "substitute", "played"];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isNonNegInt(v) {
  return Number.isInteger(v) && v >= 0;
}

// ---------------------------------------------------------------------------
// Load + structural validation
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

if (!Array.isArray(data.players)) errors.push('Missing "players" array');

(data.players || []).forEach((p, i) => {
  const ctx = `players[${i}]`;
  if (!p.name || typeof p.name !== "string") {
    errors.push(`${ctx}: name is required`);
    return;
  }
  const pctx = `${ctx} (${p.name})`;
  if (!p.county || typeof p.county !== "string") errors.push(`${pctx}: county is required`);
  if (!p.grade || typeof p.grade !== "string") errors.push(`${pctx}: grade is required`);
  if (!Number.isInteger(p.season)) errors.push(`${pctx}: season must be an integer`);
  if (p.club !== undefined && p.club !== null && typeof p.club !== "string") {
    errors.push(`${pctx}: club must be a string if present`);
  }

  if (p.membership !== undefined && p.membership !== null) {
    if (typeof p.membership !== "object") {
      errors.push(`${pctx}: membership must be an object if present`);
    } else {
      if (typeof p.membership.panel_member !== "boolean") {
        errors.push(`${pctx}: membership.panel_member must be true or false`);
      }
      if (p.membership.source_url !== undefined && p.membership.source_url !== null && typeof p.membership.source_url !== "string") {
        errors.push(`${pctx}: membership.source_url must be a string if present`);
      }
    }
  }

  const appearances = p.appearances || [];
  if (!Array.isArray(appearances)) {
    errors.push(`${pctx}: appearances must be an array if present`);
    return;
  }

  const seenMatches = new Set();
  appearances.forEach((a, j) => {
    const actx = `${pctx}.appearances[${j}]`;

    if (!a.date || !ISO_DATE_RE.test(a.date) || Number.isNaN(Date.parse(a.date))) {
      errors.push(`${actx}: date must be a valid ISO date (YYYY-MM-DD)`);
    }
    if (!a.opponent || typeof a.opponent !== "string") errors.push(`${actx}: opponent is required`);
    if (!a.competition || typeof a.competition !== "string") errors.push(`${actx}: competition is required`);
    if (a.competition_stage !== undefined && a.competition_stage !== null && typeof a.competition_stage !== "string") {
      errors.push(`${actx}: competition_stage must be a string if present`);
    }
    // appearance_type is never inferred from panel membership or anything else — must be explicit.
    if (!APPEARANCE_TYPES.includes(a.appearance_type)) {
      errors.push(`${actx}: appearance_type must be one of ${APPEARANCE_TYPES.join(", ")} (this importer never infers it)`);
    }
    if (a.shirt_number !== undefined && a.shirt_number !== null) {
      if (!Number.isInteger(a.shirt_number) || a.shirt_number < 1 || a.shirt_number > 99) {
        errors.push(`${actx}: shirt_number must be null or an integer between 1 and 99`);
      }
    }
    if (a.position !== undefined && a.position !== null && typeof a.position !== "string") {
      errors.push(`${actx}: position must be a string or null`);
    }
    // Goals/points must be explicitly supplied by the source, never defaulted/invented.
    if (!isNonNegInt(a.goals)) errors.push(`${actx}: goals must be an explicit non-negative integer (never inferred — use 0 only if the source states 0)`);
    if (!isNonNegInt(a.points)) errors.push(`${actx}: points must be an explicit non-negative integer (never inferred)`);
    if (a.two_pointers !== undefined && a.two_pointers !== null && !isNonNegInt(a.two_pointers)) {
      errors.push(`${actx}: two_pointers must be null or a non-negative integer`);
    }
    if (a.notes !== undefined && a.notes !== null && typeof a.notes !== "string") {
      errors.push(`${actx}: notes must be null or a string`);
    }
    if (a.match_source_url !== undefined && a.match_source_url !== null && typeof a.match_source_url !== "string") {
      errors.push(`${actx}: match_source_url must be a string if present`);
    }
    if (a.appearance_source_url !== undefined && a.appearance_source_url !== null && typeof a.appearance_source_url !== "string") {
      errors.push(`${actx}: appearance_source_url must be a string if present`);
    }

    if (a.date && a.opponent) {
      const key = `${a.date}::${normalizeName(a.opponent)}`;
      if (seenMatches.has(key)) errors.push(`${actx}: duplicate appearance for the same date+opponent for this player`);
      seenMatches.add(key);
    }
  });
});

if (errors.length > 0) {
  console.error(`\nInter-county import validation failed with ${errors.length} error(s). No changes were made.\n`);
  errors.forEach((e) => console.error(`  - ${e}`));
  console.error("");
  process.exit(1);
}

console.log(`Structural validation passed (${data.players.length} player row(s) in ${path.basename(DATA_PATH)}).`);

// ---------------------------------------------------------------------------
// Load existing players + their known club affiliations, for matching
// ---------------------------------------------------------------------------

console.log(`Reading existing ${mode.slice(2)} database state for player matching...`);

const existingPlayers = runD1Json("SELECT id, name, normalized_name FROM players;")[0].results;

const clubRows = runD1Json(
  `SELECT tp.player_id, t.club_name
   FROM team_players tp
   JOIN teams t ON t.id = tp.team_id;`
)[0].results;

const clubsByPlayerId = new Map();
for (const row of clubRows) {
  if (!clubsByPlayerId.has(row.player_id)) clubsByPlayerId.set(row.player_id, new Set());
  clubsByPlayerId.get(row.player_id).add(row.club_name);
}
function clubsFor(playerId) {
  return [...(clubsByPlayerId.get(playerId) || [])];
}

// ---------------------------------------------------------------------------
// Player matching
//
// players.normalized_name is UNIQUE in the schema, so an exact normalized-name
// lookup can only ever return 0 or 1 row. That single match is then checked
// against supplied club evidence (if any): a contradiction downgrades it to
// AMBIGUOUS rather than being trusted blindly. When there's no exact name
// match at all, players sharing the same surname are surfaced as candidates
// for human review (AMBIGUOUS if any exist, UNRESOLVED if none do) — never
// auto-picked, and never a reason to create a new player.
// ---------------------------------------------------------------------------

function matchPlayer(row) {
  const normSupplied = normalizeName(row.name);
  const exact = existingPlayers.find((p) => p.normalized_name === normSupplied);

  if (exact) {
    const knownClubs = clubsFor(exact.id);
    if (row.club) {
      const clubMatches = knownClubs.some((c) => normalizeName(c) === normalizeName(row.club));
      if (knownClubs.length > 0 && !clubMatches) {
        return {
          status: "AMBIGUOUS",
          candidate: exact,
          reason: `Name matches "${exact.name}" (player_id ${exact.id}), but supplied club "${row.club}" does not match their known club(s) on file (${knownClubs.join(", ")}). Confirm this is the same person before importing.`,
        };
      }
    }
    const reason = row.club
      ? knownClubs.length
        ? `Exact normalized-name match; supplied club "${row.club}" matches known club history.`
        : `Exact normalized-name match; no club history on file to cross-check (supplied club "${row.club}" not contradicted).`
      : `Exact normalized-name match; no club supplied to cross-check.`;
    return { status: "MATCHED", candidate: exact, reason };
  }

  const suppliedSurname = lastWord(normSupplied);
  const surnameCandidates = existingPlayers.filter((p) => lastWord(p.normalized_name) === suppliedSurname);

  if (surnameCandidates.length === 0) {
    return { status: "UNRESOLVED", candidate: null, reason: "No existing player found with a matching name or surname." };
  }
  return {
    status: "AMBIGUOUS",
    candidate: null,
    reason: `No exact name match. ${surnameCandidates.length} existing player(s) share the surname "${suppliedSurname}": ${surnameCandidates
      .map((c) => `"${c.name}" (id ${c.id})`)
      .join(", ")}. Needs human review — not auto-linked.`,
  };
}

const matchResults = data.players.map((row) => ({ row, match: matchPlayer(row) }));

// ---------------------------------------------------------------------------
// Existing inter-county state, for created/reused counts in the report
// ---------------------------------------------------------------------------

const existingSourceUrls = new Set(runD1Json("SELECT url FROM sources;")[0].results.map((r) => r.url));

const existingMemberships = new Set(
  runD1Json(
    `SELECT p.normalized_name, t.county, t.grade, s.season
     FROM player_intercounty_memberships m
     JOIN players p ON p.id = m.player_id
     JOIN intercounty_seasons s ON s.id = m.intercounty_season_id
     JOIN intercounty_teams t ON t.id = s.intercounty_team_id;`
  )[0].results.map((r) => `${r.normalized_name}::${r.county}::${r.grade}::${r.season}`)
);

const existingMatches = new Set(
  runD1Json(
    `SELECT t.county, t.grade, s.season, im.date, im.opponent
     FROM intercounty_matches im
     JOIN intercounty_seasons s ON s.id = im.intercounty_season_id
     JOIN intercounty_teams t ON t.id = s.intercounty_team_id;`
  )[0].results.map((r) => `${r.county}::${r.grade}::${r.season}::${r.date}::${normalizeName(r.opponent)}`)
);

const existingAppearances = new Set(
  runD1Json(
    `SELECT p.normalized_name, t.county, t.grade, s.season, im.date, im.opponent
     FROM player_intercounty_appearances a
     JOIN players p ON p.id = a.player_id
     JOIN intercounty_matches im ON im.id = a.intercounty_match_id
     JOIN intercounty_seasons s ON s.id = im.intercounty_season_id
     JOIN intercounty_teams t ON t.id = s.intercounty_team_id;`
  )[0].results.map((r) => `${r.normalized_name}::${r.county}::${r.grade}::${r.season}::${r.date}::${normalizeName(r.opponent)}`)
);

// ---------------------------------------------------------------------------
// Dry-run report
// ---------------------------------------------------------------------------

console.log("\n=== Inter-county import — player matching report ===\n");

for (const { row, match } of matchResults) {
  console.log(`- ${row.name}`);
  console.log(`    normalized name:  ${normalizeName(row.name)}`);
  console.log(`    supplied club:    ${row.club || "(none supplied)"}`);
  console.log(`    status:           ${match.status}`);
  console.log(`    matched player:   ${match.candidate ? `${match.candidate.name} (player_id ${match.candidate.id})` : "—"}`);
  console.log(`    existing club:    ${match.candidate ? clubsFor(match.candidate.id).join(", ") || "(none on file)" : "—"}`);
  console.log(`    reason:           ${match.reason}`);
  console.log("");
}

const matched = matchResults.filter((r) => r.match.status === "MATCHED");
const unresolved = matchResults.filter((r) => r.match.status === "UNRESOLVED");
const ambiguous = matchResults.filter((r) => r.match.status === "AMBIGUOUS");

// What WOULD be written — matched rows only. Panel membership and match
// appearances are independent facts: a membership is only counted if the
// source explicitly asserts panel_member === true, and appearances are only
// ever taken from the row's own appearances[] array — never inferred from
// membership, and never invented when a field is absent from the source.
let membershipsNew = 0, membershipsExisting = 0;
let appearancesNew = 0, appearancesExisting = 0;
const matchKeysToWrite = new Map(); // key -> isNew

const sourceUrlsReferenced = new Set();

for (const { row } of matched) {
  if (row.membership && row.membership.panel_member === true) {
    const key = `${normalizeName(row.name)}::${row.county}::${row.grade}::${row.season}`;
    if (existingMemberships.has(key)) membershipsExisting++; else membershipsNew++;
    if (row.membership.source_url) sourceUrlsReferenced.add(row.membership.source_url);
  }
  for (const a of row.appearances || []) {
    const matchKey = `${row.county}::${row.grade}::${row.season}::${a.date}::${normalizeName(a.opponent)}`;
    if (!matchKeysToWrite.has(matchKey)) {
      matchKeysToWrite.set(matchKey, !existingMatches.has(matchKey));
    }
    const appearanceKey = `${normalizeName(row.name)}::${matchKey}`;
    if (existingAppearances.has(appearanceKey)) appearancesExisting++; else appearancesNew++;
    if (a.match_source_url) sourceUrlsReferenced.add(a.match_source_url);
    if (a.appearance_source_url) sourceUrlsReferenced.add(a.appearance_source_url);
  }
}

const matchesNew = [...matchKeysToWrite.values()].filter(Boolean).length;
const matchesExisting = matchKeysToWrite.size - matchesNew;
const sourcesNew = [...sourceUrlsReferenced].filter((u) => !existingSourceUrls.has(u)).length;
const sourcesReused = sourceUrlsReferenced.size - sourcesNew;

console.log("=== Summary ===");
console.log(`  Total players processed:      ${matchResults.length}`);
console.log(`  Matched:                      ${matched.length}`);
console.log(`  Unresolved:                   ${unresolved.length}`);
console.log(`  Ambiguous:                    ${ambiguous.length}`);
console.log(`  Memberships to write:         ${membershipsNew + membershipsExisting} (${membershipsNew} new, ${membershipsExisting} already exist)`);
console.log(`  Matches to write:              ${matchKeysToWrite.size} (${matchesNew} new, ${matchesExisting} already exist)`);
console.log(`  Appearances to write:         ${appearancesNew + appearancesExisting} (${appearancesNew} new, ${appearancesExisting} already exist)`);
console.log(`  Source records referenced:    ${sourceUrlsReferenced.size} (${sourcesNew} new, ${sourcesReused} reused)`);

if (unresolved.length > 0 || ambiguous.length > 0) {
  console.log(`\n${unresolved.length + ambiguous.length} row(s) need human review before they can be imported (see UNRESOLVED/AMBIGUOUS above). These rows will be skipped entirely even if the import proceeds.`);
}

if (!apply) {
  console.log("\nDry run only — no changes were made. Re-run with --apply to write the MATCHED rows above.");
  process.exit(0);
}

if ((unresolved.length > 0 || ambiguous.length > 0) && !force) {
  console.error(
    `\nRefusing to write: ${unresolved.length} unresolved and ${ambiguous.length} ambiguous row(s) exist. ` +
      `Resolve them in the source data, or re-run with --apply --force to import the ${matched.length} MATCHED row(s) and skip the rest. No changes were made.`
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Build + execute upsert SQL — MATCHED rows only
// ---------------------------------------------------------------------------

const statements = [];

function upsertSource(url) {
  if (!url) return "NULL";
  statements.push(`
INSERT INTO sources (url) VALUES (${sqlStr(url)})
ON CONFLICT(url) DO UPDATE SET url = excluded.url;`);
  return `(SELECT id FROM sources WHERE url = ${sqlStr(url)})`;
}

const teamSeasonSubqueryCache = new Map();
function teamSeasonSubquery(county, grade, season) {
  const key = `${county}::${grade}::${season}`;
  if (teamSeasonSubqueryCache.has(key)) return teamSeasonSubqueryCache.get(key);

  statements.push(`
INSERT INTO intercounty_teams (county, grade) VALUES (${sqlStr(county)}, ${sqlStr(grade)})
ON CONFLICT(county, grade) DO UPDATE SET county = excluded.county;`);
  const teamSubquery = `(SELECT id FROM intercounty_teams WHERE county = ${sqlStr(county)} AND grade = ${sqlStr(grade)})`;

  statements.push(`
INSERT INTO intercounty_seasons (intercounty_team_id, season) VALUES (${teamSubquery}, ${sqlNum(season)})
ON CONFLICT(intercounty_team_id, season) DO UPDATE SET season = excluded.season;`);
  const seasonSubquery = `(SELECT id FROM intercounty_seasons WHERE intercounty_team_id = ${teamSubquery} AND season = ${sqlNum(season)})`;

  teamSeasonSubqueryCache.set(key, seasonSubquery);
  return seasonSubquery;
}

for (const { row, match } of matched) {
  const playerId = match.candidate.id;
  const seasonSubquery = teamSeasonSubquery(row.county, row.grade, row.season);

  // Panel membership: only ever written if the source explicitly says so.
  if (row.membership && row.membership.panel_member === true) {
    const sourceSubquery = upsertSource(row.membership.source_url);
    statements.push(`
INSERT INTO player_intercounty_memberships (player_id, intercounty_season_id, source_id)
VALUES (${sqlNum(playerId)}, ${seasonSubquery}, ${sourceSubquery})
ON CONFLICT(player_id, intercounty_season_id) DO UPDATE SET source_id = excluded.source_id;`);
  }

  // Match appearances: only ever taken from this row's own appearances[] —
  // never inferred from membership, never invented from an absent field.
  for (const a of row.appearances || []) {
    const matchSourceSubquery = upsertSource(a.match_source_url);
    statements.push(`
INSERT INTO intercounty_matches (intercounty_season_id, date, opponent, competition, competition_stage, source_id)
VALUES (${seasonSubquery}, ${sqlStr(a.date)}, ${sqlStr(a.opponent)}, ${sqlStr(a.competition)}, ${sqlStr(a.competition_stage)}, ${matchSourceSubquery})
ON CONFLICT(intercounty_season_id, date, opponent) DO UPDATE SET
  competition = excluded.competition,
  competition_stage = excluded.competition_stage,
  source_id = excluded.source_id;`);
    const matchSubquery = `(SELECT id FROM intercounty_matches WHERE intercounty_season_id = ${seasonSubquery} AND date = ${sqlStr(a.date)} AND opponent = ${sqlStr(a.opponent)})`;

    const appearanceSourceSubquery = upsertSource(a.appearance_source_url);
    statements.push(`
INSERT INTO player_intercounty_appearances (player_id, intercounty_match_id, appearance_type, shirt_number, position, goals, points, two_pointers, notes, source_id)
VALUES (${sqlNum(playerId)}, ${matchSubquery}, ${sqlStr(a.appearance_type)}, ${sqlNum(a.shirt_number)}, ${sqlStr(a.position)}, ${sqlNum(a.goals)}, ${sqlNum(a.points)}, ${sqlNum(a.two_pointers)}, ${sqlStr(a.notes)}, ${appearanceSourceSubquery})
ON CONFLICT(player_id, intercounty_match_id) DO UPDATE SET
  appearance_type = excluded.appearance_type,
  shirt_number = excluded.shirt_number,
  position = excluded.position,
  goals = excluded.goals,
  points = excluded.points,
  two_pointers = excluded.two_pointers,
  notes = excluded.notes,
  source_id = excluded.source_id;`);
  }
}

const tmpFile = path.join(__dirname, `.generated-intercounty-${mode.slice(2)}.sql`);
writeFileSync(tmpFile, statements.join("\n"));

console.log(`\nApplying inter-county import to ${mode.slice(2)} database (${matched.length} matched player row(s))...`);
try {
  runD1File(tmpFile);
} finally {
  unlinkSync(tmpFile);
}

console.log("\nWrite complete.");
console.log(`  Memberships: ${membershipsNew} new, ${membershipsExisting} updated`);
console.log(`  Matches:     ${matchesNew} new, ${matchesExisting} updated`);
console.log(`  Appearances: ${appearancesNew} new, ${appearancesExisting} updated`);
console.log(`  Sources:     ${sourcesNew} new, ${sourcesReused} reused`);
if (unresolved.length > 0 || ambiguous.length > 0) {
  console.log(`  Skipped:     ${unresolved.length} unresolved, ${ambiguous.length} ambiguous (not imported)`);
}
console.log("\nDone.");
