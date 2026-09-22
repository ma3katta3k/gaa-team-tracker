-- Initial schema for gaa-team-tracker
-- Players are reusable across teams/seasons. Teams are club+team_name+season.
-- Uncertainty in birth years and match reports is preserved, never silently normalised.

CREATE TABLE teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_name TEXT NOT NULL,
  team_name TEXT NOT NULL,
  season INTEGER NOT NULL,
  UNIQUE (club_name, team_name, season)
);

CREATE TABLE players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  birth_year INTEGER,
  birth_year_status TEXT NOT NULL CHECK (birth_year_status IN ('confirmed', 'assumed', 'unknown'))
);

-- Links a player to a team/season. A player only "belongs" to a team if rostered here;
-- an appearances row is what proves they actually played.
CREATE TABLE team_players (
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, player_id)
);

CREATE TABLE matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  opponent TEXT NOT NULL,
  competition TEXT NOT NULL,
  goals_for INTEGER NOT NULL DEFAULT 0,
  points_for INTEGER NOT NULL DEFAULT 0,
  goals_against INTEGER NOT NULL DEFAULT 0,
  points_against INTEGER NOT NULL DEFAULT 0,
  source_reference TEXT,
  source_type TEXT,
  report_status TEXT NOT NULL CHECK (report_status IN ('full', 'partial', 'result_only')),
  UNIQUE (team_id, date, opponent)
);

-- A row here means the player actually appeared in this match (started, subbed on, or played).
-- Being named on a panel/squad list with no appearance row means they did not play.
CREATE TABLE appearances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  appearance_type TEXT NOT NULL CHECK (appearance_type IN ('start', 'substitute', 'played')),
  shirt_number INTEGER,
  position TEXT,
  goals INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  frees INTEGER,
  two_pointers INTEGER,
  notes TEXT,
  UNIQUE (match_id, player_id)
);

CREATE INDEX idx_team_players_player ON team_players(player_id);
CREATE INDEX idx_matches_team ON matches(team_id);
CREATE INDEX idx_appearances_match ON appearances(match_id);
CREATE INDEX idx_appearances_player ON appearances(player_id);
