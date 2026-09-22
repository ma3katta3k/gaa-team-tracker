-- Inter-county player context. Entirely separate from club teams/matches/appearances
-- (migration 0001) — nothing here modifies or recalculates club statistics.
--
-- Players are linked by players.id only: inter-county involvement is attached to the
-- SAME player row used for club data, never a second/duplicate player record.

-- Reusable source citation, since one source URL (a results page, a match report)
-- typically backs many facts across many matches.
CREATE TABLE sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  description TEXT,
  retrieved_date TEXT
);

-- A recurring representative team identity (e.g. "Dublin" "Minor"), independent of season.
CREATE TABLE intercounty_teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  county TEXT NOT NULL,
  grade TEXT NOT NULL,
  UNIQUE (county, grade)
);

-- One specific year of an intercounty_team.
CREATE TABLE intercounty_seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  intercounty_team_id INTEGER NOT NULL REFERENCES intercounty_teams(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  UNIQUE (intercounty_team_id, season)
);

CREATE TABLE intercounty_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  intercounty_season_id INTEGER NOT NULL REFERENCES intercounty_seasons(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  opponent TEXT NOT NULL,
  competition TEXT NOT NULL,
  competition_stage TEXT,
  source_id INTEGER REFERENCES sources(id),
  UNIQUE (intercounty_season_id, date, opponent)
);

-- Panel membership is a separate fact from having actually played (see
-- player_intercounty_appearances below) — a player can be on a panel with zero
-- recorded appearances, mirroring the club-side team_players/appearances split.
CREATE TABLE player_intercounty_memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  intercounty_season_id INTEGER NOT NULL REFERENCES intercounty_seasons(id) ON DELETE CASCADE,
  source_id INTEGER REFERENCES sources(id),
  UNIQUE (player_id, intercounty_season_id)
);

-- One row per player per match actually played (start/substitute/played). Being on the
-- panel alone does not create a row here — same "panel is not proof of playing" rule
-- already enforced for club appearances.
CREATE TABLE player_intercounty_appearances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  intercounty_match_id INTEGER NOT NULL REFERENCES intercounty_matches(id) ON DELETE CASCADE,
  appearance_type TEXT NOT NULL CHECK (appearance_type IN ('start', 'substitute', 'played')),
  shirt_number INTEGER,
  position TEXT,
  goals INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  two_pointers INTEGER,
  source_id INTEGER REFERENCES sources(id),
  UNIQUE (player_id, intercounty_match_id)
);

CREATE INDEX idx_intercounty_seasons_team ON intercounty_seasons(intercounty_team_id);
CREATE INDEX idx_intercounty_matches_season ON intercounty_matches(intercounty_season_id);
CREATE INDEX idx_ic_memberships_player ON player_intercounty_memberships(player_id);
CREATE INDEX idx_ic_memberships_season ON player_intercounty_memberships(intercounty_season_id);
CREATE INDEX idx_ic_appearances_player ON player_intercounty_appearances(player_id);
CREATE INDEX idx_ic_appearances_match ON player_intercounty_appearances(intercounty_match_id);
