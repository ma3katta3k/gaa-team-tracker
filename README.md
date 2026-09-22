# GAA Team Tracker

A small, reusable player/match tracker for a GAA team. One Cloudflare Worker
serves the static frontend and the JSON API; Cloudflare D1 (SQLite) is the
database. Built for Naomh Mearnóg Minor A (2026) but the schema and UI are
generic — reuse it for any club, team, or season by editing one JSON file.

## Architecture

```
public/           Static frontend (plain HTML/CSS/JS, no framework, no build step)
src/worker.js      Cloudflare Worker: serves /api/* (D1-backed). Static files
                    in public/ are served automatically by Workers Assets and
                    never reach this code.
data/               Canonical seed dataset (initial-team.json)
migrations/         D1 schema migrations (plain SQL)
scripts/seed.js     Validates data/initial-team.json and upserts it into D1
```

One Worker project. No React/Vue. No separate backend service.

## Data model

- **teams** — `club_name` + `team_name` + `season` (natural key). A "team" is
  one club's squad for one season.
- **players** — reusable across teams and seasons. Matched by normalised name.
  `birth_year_status` is one of `confirmed` / `assumed` / `unknown` — never
  silently upgraded to `confirmed`.
- **team_players** — links a player to a team/season (roster).
- **matches** — belongs to a team. `report_status` is `full` / `partial` /
  `result_only`, reflecting how complete the source report was.
- **appearances** — one row per player who actually played in a match
  (`start`, `substitute`, or `played`). **A player named on a panel but not
  recorded in `appearances` is not counted as having played** — this is
  enforced structurally: the importer only creates an appearance row for
  entries listed under a match's `appearances` array.

Position is plain text (`GK`, `RCB`, `FB`, `LCB`, `RHB`, `CHB`, `LHB`, `MF`,
`RHF`, `CHF`, `LHF`, `RCF`, `FF`, `LCF`) — no separate positions table yet.

## Local setup

```bash
npm install
npx wrangler login          # first time only, opens a browser
```

### Create the D1 database (first time only)

```bash
npm run db:create           # prints a database_id
```

Copy the printed `database_id` into `wrangler.jsonc` under `d1_databases[0].database_id`.

### Apply migrations

```bash
npm run db:migrate:local    # local SQLite file under .wrangler/
npm run db:migrate:remote   # real Cloudflare D1
```

### Seed the database

`data/initial-team.json` is the single source of truth for players, team
roster, and match/appearance data. The seed script validates it, then
upserts (never duplicates) into D1.

```bash
npm run seed:local
npm run seed:remote
```

Both are safe to run repeatedly — rows are matched on natural keys
(team = club+name+season, player = normalised name, match = team+date+opponent,
appearance = match+player) and updated in place if the JSON changes. If any
record in the JSON is invalid, the whole import aborts with a list of every
problem found — nothing is partially imported and nothing is silently
skipped.

### Run the dev server

```bash
npm run dev
```

Open the printed `http://localhost:8787` URL. The frontend and API are both
served from this one Worker.

## Deploying

```bash
npm run deploy
```

This publishes the Worker (and its static assets) to your `*.workers.dev`
subdomain (or a configured custom domain/route). It does **not** touch the
database — run migrations/seed separately, as above.

## Deploying via GitHub

Cloudflare Workers Builds can deploy automatically on push once the repo is
connected in the Cloudflare dashboard:

1. Cloudflare dashboard → Workers & Pages → your Worker → **Settings → Builds**.
2. Connect the `gaa-team-tracker` GitHub repo, branch `main`.
3. Build command: (none needed — static files only). Deploy command: `npx wrangler deploy`.

Once connected, every push to `main` redeploys the Worker. Migrations and
seeding still need to be run manually (`npm run db:migrate:remote`,
`npm run seed:remote`) since they're one-off data operations, not part of
the build.

## API

| Endpoint | Description |
|---|---|
| `GET /api/health` | Confirms the Worker can reach D1 |
| `GET /api/teams` | List all teams |
| `GET /api/teams/:teamId/players` | Players rostered to a team |
| `GET /api/teams/:teamId/matches` | Matches played by a team |
| `GET /api/players/:playerId` | Player bio (name, birth year, status) |
| `GET /api/players/:playerId/appearances?season=2026` | A player's club match appearances, optionally filtered by season |
| `GET /api/matches/:matchId/appearances` | Full lineup for one club match (used by Pitch View) |
| `GET /api/players/:playerId/intercounty` | A player's inter-county panel memberships and match appearances (raw rows; the frontend groups/aggregates them) |

All responses are JSON. Unknown IDs return `404 {"error": "..."}`.

## The seed JSON format

```json
{
  "team": { "club": "Naomh Mearnóg", "name": "Minor A", "season": 2026 },
  "players": [
    { "name": "Rian Rogan", "birth_year": 2009, "birth_year_status": "confirmed" },
    { "name": "Dylan Collins", "birth_year": null, "birth_year_status": "unknown" }
  ],
  "matches": [
    {
      "date": "2026-02-28",
      "opponent": "Clontarf",
      "competition": "Minor Football League Division 2",
      "score": { "for": { "goals": 2, "points": 8 }, "against": { "goals": 1, "points": 10 } },
      "report_status": "full",
      "source": { "type": "club_report", "reference": "club match report" },
      "appearances": [
        {
          "player": "Rian Rogan",
          "appearance": "start",
          "shirt": 8,
          "position": "MF",
          "goals": 0,
          "points": 5,
          "frees": 3,
          "two_pointers": 0,
          "notes": null
        }
      ]
    }
  ]
}
```

Validation rules enforced by `scripts/seed.js`:

- `birth_year_status` ∈ `confirmed | assumed | unknown`; if `confirmed`, `birth_year` must be set.
- `report_status` ∈ `full | partial | result_only`.
- `appearance` ∈ `start | substitute | played`.
- Match dates must be valid ISO (`YYYY-MM-DD`).
- All goals/points/frees/two_pointers must be non-negative integers.
- `shirt` (if present) must be an integer 1–99.
- `position` (if present) must be one of the 14 recognised position codes.
- Every `appearances[].player` must exist in the top-level `players[]` list.
- No duplicate players, matches, or appearances within the file.

Any violation prints every error found and exits without touching the
database.

### Adding a player or match manually

Edit `data/initial-team.json` directly — add a player to `players[]`, or a
match (with its `appearances[]`) to `matches[]` — then re-run
`npm run seed:local` (and `seed:remote` once you're happy with it). Existing
records are matched by name/date/opponent and updated in place; nothing is
duplicated.

### Reusing this for another team or season

Nothing in the schema, API, or frontend is specific to one team. To track a
different club, team, or season:

1. Either edit `data/initial-team.json`'s `team` block and re-seed (if
   replacing the current dataset), or write a **new** JSON file with a
   different `team.club` / `team.name` / `team.season` and point
   `scripts/seed.js` at it (pass a path, or temporarily swap the file) —
   each unique `club + team name + season` combination becomes its own row
   in `teams`, and players are automatically shared/reused by name across
   any team they appear on.
2. Re-run the seed script. The frontend's season/team selector picks it up
   automatically — no code changes required.

## Inter-county player context

Separate from club data: a player profile can also show an "Inter-County"
section (county, grade, season, panel membership, and match-by-match
appearances/stats), sourced from six additional tables
(`migrations/0002_intercounty.sql`) that never modify or recalculate club
statistics. The section is hidden entirely for players with no inter-county
data.

### Schema

- `sources` — reusable `(url, description, retrieved_date)`, deduped by URL.
- `intercounty_teams` — `(county, grade)`, e.g. "Dublin" / "Minor".
- `intercounty_seasons` — one year of an `intercounty_teams` row.
- `intercounty_matches` — belongs to a season; `(date, opponent, competition, competition_stage, source_id)`.
- `player_intercounty_memberships` — panel membership is its own fact, independent of having played (same split as club `team_players` vs `appearances`).
- `player_intercounty_appearances` — one row per match actually played; never inferred from membership alone.

Membership and appearance rows reference `players.id` only — there is no
name field on either table, so this data can only ever attach to an
**existing** player, never create one.

### Importing inter-county data

`scripts/seed-intercounty.js` is a separate importer from the club
`scripts/seed.js`, because matching an inter-county player row to an
existing `players.id` is inherently uncertain in a way club seeding isn't.
It defaults to a dry-run and never guesses:

```bash
# Dry run — always safe, never writes, always prints the full match report
node scripts/seed-intercounty.js --file=path/to/data.json

# Write matched rows only (refuses if any row is unresolved/ambiguous)
node scripts/seed-intercounty.js --file=path/to/data.json --apply

# Write matched rows, explicitly skipping unresolved/ambiguous ones
node scripts/seed-intercounty.js --file=path/to/data.json --apply --force

# Target remote D1 (still defaults to --local otherwise)
node scripts/seed-intercounty.js --file=path/to/data.json --apply --remote
```

**Player matching** — never by name alone:

1. Normalize the supplied name and look it up against `players.normalized_name`
   (unique in the schema, so this can only ever return 0 or 1 row).
2. If found, and a `club` was supplied, cross-check it against that player's
   known clubs (via `team_players`/`teams`). A contradiction downgrades the
   row to **AMBIGUOUS** rather than trusting the name match blindly.
3. If not found, players sharing the same surname are surfaced as candidates
   for human review — **AMBIGUOUS** if any exist, **UNRESOLVED** if none do.
4. A clean single match with no contradicting evidence is **MATCHED**.

Only **MATCHED** rows are ever written. Unresolved/ambiguous rows are always
skipped — the importer never creates a new player and never merges two
players together.

**Provenance rules the importer enforces:** a membership row is written only
when the source explicitly states `panel_member: true`; an appearance is
written only when it's explicitly present in that player's `appearances[]`
(never inferred from membership, and never invented for a "team sheet but no
evidence they played" case); `goals`/`points`/`appearance_type` must be
explicit in the input — the importer rejects a row outright rather than
defaulting a missing value to 0 or guessing a type.

### Input format

```json
{
  "players": [
    {
      "name": "Example Player",
      "club": "Example Club",
      "county": "Dublin",
      "grade": "Minor",
      "season": 2026,
      "membership": { "panel_member": true, "source_url": "https://..." },
      "appearances": [
        {
          "date": "2026-03-24",
          "opponent": "Offaly",
          "competition": "Leinster Minor Football Championship",
          "competition_stage": "Group 2",
          "appearance_type": "start",
          "shirt_number": 15,
          "position": null,
          "goals": 1,
          "points": 1,
          "two_pointers": 0,
          "match_source_url": "https://...",
          "appearance_source_url": "https://..."
        }
      ]
    }
  ]
}
```

`club` and `membership` are optional; `appearances` may be omitted or empty
(panel-membership-only players). `match_source_url` and
`appearance_source_url` are independent — a match's basic facts (date,
opponent, competition) and one player's specific stat line in it can cite
different sources.

## What's deliberately not here (yet)

No auth, no admin/edit UI, no player-selection engine, no charts, no photos.
This is a read-only browser over clean, provenance-preserving data. See the
project brief for the full "do not build yet" list.
