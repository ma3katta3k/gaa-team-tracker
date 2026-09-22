-- Adds a notes column to player_intercounty_appearances, mirroring the
-- club appearances table's existing notes column. Purely additive: does not
-- modify any existing row, table, or other column.
ALTER TABLE player_intercounty_appearances ADD COLUMN notes TEXT;
