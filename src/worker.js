// Cloudflare Worker: serves the /api/* JSON API backed by D1.
// Static files in /public are served automatically by Workers Assets
// and never reach this fetch handler.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function notFound(message = "Not found") {
  return json({ error: message }, 404);
}

async function health(env) {
  try {
    const row = await env.DB.prepare("SELECT 1 AS ok").first();
    return json({ status: "ok", db: row?.ok === 1 ? "connected" : "unknown" });
  } catch (err) {
    return json({ status: "error", db: "unreachable", message: err.message }, 500);
  }
}

async function listTeams(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, club_name, team_name, season FROM teams ORDER BY season DESC, club_name ASC, team_name ASC"
  ).all();
  return json(results);
}

async function teamPlayers(env, teamId) {
  const team = await env.DB.prepare("SELECT id FROM teams WHERE id = ?").bind(teamId).first();
  if (!team) return notFound("Team not found");

  const { results } = await env.DB.prepare(
    `SELECT p.id, p.name, p.birth_year, p.birth_year_status
     FROM players p
     JOIN team_players tp ON tp.player_id = p.id
     WHERE tp.team_id = ?
     ORDER BY p.name ASC`
  ).bind(teamId).all();
  return json(results);
}

async function teamMatches(env, teamId) {
  const team = await env.DB.prepare("SELECT id FROM teams WHERE id = ?").bind(teamId).first();
  if (!team) return notFound("Team not found");

  const { results } = await env.DB.prepare(
    `SELECT id, date, opponent, competition, goals_for, points_for, goals_against, points_against,
            source_reference, source_type, report_status
     FROM matches
     WHERE team_id = ?
     ORDER BY date ASC`
  ).bind(teamId).all();
  return json(results);
}

async function playerDetail(env, playerId) {
  const player = await env.DB.prepare(
    "SELECT id, name, birth_year, birth_year_status FROM players WHERE id = ?"
  ).bind(playerId).first();
  if (!player) return notFound("Player not found");
  return json(player);
}

async function playerAppearances(env, playerId, season) {
  const player = await env.DB.prepare("SELECT id FROM players WHERE id = ?").bind(playerId).first();
  if (!player) return notFound("Player not found");

  let query = `SELECT a.id, a.match_id, a.appearance_type, a.shirt_number, a.position,
                      a.goals, a.points, a.frees, a.two_pointers, a.notes,
                      m.date, m.opponent, m.competition, m.report_status,
                      m.team_id, t.season
               FROM appearances a
               JOIN matches m ON m.id = a.match_id
               JOIN teams t ON t.id = m.team_id
               WHERE a.player_id = ?`;
  const binds = [playerId];
  if (season) {
    query += " AND t.season = ?";
    binds.push(season);
  }
  query += " ORDER BY m.date DESC";

  const { results } = await env.DB.prepare(query).bind(...binds).all();
  return json(results);
}

async function matchAppearances(env, matchId) {
  const match = await env.DB.prepare(
    `SELECT id, team_id, date, opponent, competition, goals_for, points_for,
            goals_against, points_against, source_reference, source_type, report_status
     FROM matches WHERE id = ?`
  ).bind(matchId).first();
  if (!match) return notFound("Match not found");

  const { results } = await env.DB.prepare(
    `SELECT a.id, a.player_id, p.name AS player_name, a.appearance_type, a.shirt_number,
            a.position, a.goals, a.points, a.frees, a.two_pointers, a.notes
     FROM appearances a
     JOIN players p ON p.id = a.player_id
     WHERE a.match_id = ?
     ORDER BY a.shirt_number ASC`
  ).bind(matchId).all();

  return json({ match, appearances: results });
}

async function playerIntercounty(env, playerId) {
  const player = await env.DB.prepare("SELECT id FROM players WHERE id = ?").bind(playerId).first();
  if (!player) return notFound("Player not found");

  const memberships = await env.DB.prepare(
    `SELECT m.id, t.county, t.grade, s.season,
            src.url AS source_url, src.description AS source_description
     FROM player_intercounty_memberships m
     JOIN intercounty_seasons s ON s.id = m.intercounty_season_id
     JOIN intercounty_teams t ON t.id = s.intercounty_team_id
     LEFT JOIN sources src ON src.id = m.source_id
     WHERE m.player_id = ?
     ORDER BY s.season DESC, t.county ASC, t.grade ASC`
  ).bind(playerId).all();

  const appearances = await env.DB.prepare(
    `SELECT a.id, t.county, t.grade, s.season,
            im.competition, im.competition_stage, im.date, im.opponent,
            a.appearance_type, a.shirt_number, a.position, a.goals, a.points, a.two_pointers, a.notes,
            src.url AS source_url, src.description AS source_description
     FROM player_intercounty_appearances a
     JOIN intercounty_matches im ON im.id = a.intercounty_match_id
     JOIN intercounty_seasons s ON s.id = im.intercounty_season_id
     JOIN intercounty_teams t ON t.id = s.intercounty_team_id
     LEFT JOIN sources src ON src.id = a.source_id
     WHERE a.player_id = ?
     ORDER BY im.date DESC`
  ).bind(playerId).all();

  return json({ memberships: memberships.results, appearances: appearances.results });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    if (method !== "GET") {
      return json({ error: "Method not allowed" }, 405);
    }

    try {
      if (pathname === "/api/health") return await health(env);
      if (pathname === "/api/teams") return await listTeams(env);

      let m;
      if ((m = pathname.match(/^\/api\/teams\/(\d+)\/players$/))) {
        return await teamPlayers(env, m[1]);
      }
      if ((m = pathname.match(/^\/api\/teams\/(\d+)\/matches$/))) {
        return await teamMatches(env, m[1]);
      }
      if ((m = pathname.match(/^\/api\/matches\/(\d+)\/appearances$/))) {
        return await matchAppearances(env, m[1]);
      }
      if ((m = pathname.match(/^\/api\/players\/(\d+)\/appearances$/))) {
        return await playerAppearances(env, m[1], url.searchParams.get("season"));
      }
      if ((m = pathname.match(/^\/api\/players\/(\d+)\/intercounty$/))) {
        return await playerIntercounty(env, m[1]);
      }
      if ((m = pathname.match(/^\/api\/players\/(\d+)$/))) {
        return await playerDetail(env, m[1]);
      }

      if (pathname.startsWith("/api/")) return notFound("Unknown API route");

      return notFound();
    } catch (err) {
      return json({ error: "Internal server error", message: err.message }, 500);
    }
  },
};
