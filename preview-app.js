(function () {
  "use strict";

  const SEP = "\u001f";

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function ownerSlug(owner) {
    return owner
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
  }

  function playerMap(players) {
    const m = new Map();
    for (const p of players) m.set(p.id, p);
    return m;
  }

  function buildStandings(franchises, players) {
    const pmap = playerMap(players);
    return franchises.map((f) => {
      const playersResolved = [];
      const missingPlayerIds = [];
      for (const id of f.playerIds) {
        const p = pmap.get(id);
        if (p) playersResolved.push(p);
        else missingPlayerIds.push(id);
      }
      const totalPoints = playersResolved.reduce((s, p) => s + p.seasonTotal, 0);
      return { ...f, totalPoints, playersResolved, missingPlayerIds };
    });
  }

  function ownerForPlayerId(franchises, playerId) {
    for (const f of franchises) {
      if (f.playerIds.includes(playerId)) return f.owner;
    }
    return null;
  }

  function matchColumnId(m) {
    return m.matchDate + SEP + m.matchLabel;
  }

  function parseMatchColumnId(id) {
    const i = id.indexOf(SEP);
    if (i === -1) return { date: id, label: "" };
    return { date: id.slice(0, i), label: id.slice(i + SEP.length) };
  }

  function matchColumnsFromPlayers(players) {
    const map = new Map();
    for (const p of players) {
      for (const m of p.byMatch) {
        const id = matchColumnId(m);
        if (!map.has(id)) map.set(id, { id, date: m.matchDate, label: m.matchLabel });
      }
    }
    return [...map.values()].sort(
      (a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label),
    );
  }

  function pointsInMatch(p, columnId) {
    const { date, label } = parseMatchColumnId(columnId);
    const row = p.byMatch.find((x) => x.matchDate === date && x.matchLabel === label);
    return row != null ? row.points : null;
  }

  function roleBadgeClass(role) {
    const b =
      "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ";
    if (role === "BAT") return b + "bg-sky-600/35 text-sky-200 ring-1 ring-sky-500/40";
    if (role === "BOWL") return b + "bg-rose-700/35 text-rose-100 ring-1 ring-rose-500/40";
    if (role === "AR") return b + "bg-emerald-700/35 text-emerald-100 ring-1 ring-emerald-500/40";
    return b + "bg-amber-600/35 text-amber-100 ring-1 ring-amber-500/40";
  }

  function natBadgeClass(nat) {
    const b =
      "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ";
    if (!nat) return b + "bg-slate-800 text-slate-500 ring-1 ring-slate-600/40";
    return nat === "IND"
      ? b + "bg-emerald-800/40 text-emerald-100 ring-1 ring-emerald-600/35"
      : b + "bg-violet-800/40 text-violet-100 ring-1 ring-violet-500/35";
  }

  function natLabel(nat) {
    if (nat === "IND") return "India";
    if (nat === "OVS") return "Overseas";
    return "\u2014";
  }

  var IPL_TEAM_CODES = [
    "CSK",
    "MI",
    "RCB",
    "KKR",
    "DC",
    "RR",
    "SRH",
    "PBKS",
    "LSG",
    "GT",
  ];

  function iplPillClass(teamCode) {
    var c = String(teamCode || "")
      .trim()
      .toUpperCase();
    var pill =
      "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ";
    var map = {
      CSK: "bg-[#ffcc00]/25 text-yellow-50 ring-[#ffcc00]/55",
      MI: "bg-[#004ba0]/45 text-blue-50 ring-blue-300/45",
      RCB: "bg-[#ec1c24]/40 text-red-50 ring-red-400/50",
      KKR: "bg-[#3a225d]/50 text-purple-100 ring-purple-400/45",
      DC: "bg-[#2563eb]/40 text-blue-50 ring-blue-300/45",
      RR: "bg-[#e8298c]/35 text-pink-50 ring-pink-400/45",
      SRH: "bg-[#ff822a]/35 text-orange-50 ring-orange-400/50",
      PBKS: "bg-[#dd1f2d]/40 text-red-50 ring-red-400/45",
      LSG: "bg-[#00bfff]/30 text-cyan-50 ring-cyan-400/50",
      GT: "bg-[#1c2157]/55 text-indigo-100 ring-indigo-400/45",
    };
    return pill + (map[c] || "bg-slate-700/60 text-slate-100 ring-slate-500/40");
  }

  function iplTeamPillHtml(code) {
    var c = String(code || "")
      .trim()
      .toUpperCase();
    return (
      "<span class='" +
      esc(iplPillClass(c)) +
      "' title='" +
      esc(c) +
      "'>" +
      esc(c) +
      "</span>"
    );
  }

  function ownerPillClass(owner) {
    var pill =
      "inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ";
    var map = {
      Darshil: "bg-sky-600/35 text-sky-50 ring-sky-400/45",
      Bhavya: "bg-fuchsia-700/35 text-fuchsia-50 ring-fuchsia-400/45",
      Prajin: "bg-teal-600/35 text-teal-50 ring-teal-400/45",
      Sanket: "bg-orange-600/35 text-orange-50 ring-orange-400/45",
      Hersh: "bg-lime-700/40 text-lime-50 ring-lime-400/45",
      Jash: "bg-indigo-600/40 text-indigo-50 ring-indigo-400/45",
      Karan: "bg-rose-600/40 text-rose-50 ring-rose-400/45",
    };
    return pill + (map[owner] || "bg-slate-700/60 text-slate-100 ring-slate-500/40");
  }

  function ownerBadgeHtml(owner) {
    return "<span class='" + esc(ownerPillClass(owner)) + "'>" + esc(owner) + "</span>";
  }

  var PRED_LS_KEY = "ipl-fantasy-prediction-actuals-v1";
  var PRED_EVENT = "ipl-pred-actuals";

  function loadStoredActuals() {
    try {
      var raw = localStorage.getItem(PRED_LS_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function saveStoredActuals(actuals) {
    try {
      localStorage.setItem(PRED_LS_KEY, JSON.stringify(actuals));
    } catch (e) {}
  }

  function mergeActuals(base, overrides) {
    if (!overrides) {
      return {
        winner: base.winner,
        runnerUp: base.runnerUp,
        orangeCap: base.orangeCap,
        purpleCap: base.purpleCap,
      };
    }
    return {
      winner: overrides.winner !== undefined ? overrides.winner : base.winner,
      runnerUp: overrides.runnerUp !== undefined ? overrides.runnerUp : base.runnerUp,
      orangeCap: overrides.orangeCap !== undefined ? overrides.orangeCap : base.orangeCap,
      purpleCap: overrides.purpleCap !== undefined ? overrides.purpleCap : base.purpleCap,
    };
  }

  function getMergedActuals() {
    var pred = LEAGUE && LEAGUE.predictions;
    if (!pred) return null;
    return mergeActuals(pred.actuals, loadStoredActuals());
  }

  function normTeamEq(a, b) {
    return (
      String(a || "")
        .trim()
        .toUpperCase() ===
      String(b || "")
        .trim()
        .toUpperCase()
    );
  }

  function normNameKey(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function normNameEq(a, b) {
    return normNameKey(a) === normNameKey(b);
  }

  function countCorrectPicks(pick, actuals) {
    var n = 0;
    if (actuals.winner && normTeamEq(pick.winner, actuals.winner)) n++;
    if (actuals.runnerUp && normTeamEq(pick.runnerUp, actuals.runnerUp)) n++;
    if (actuals.orangeCap && normNameEq(pick.orangeCap, actuals.orangeCap)) n++;
    if (actuals.purpleCap && normNameEq(pick.purpleCap, actuals.purpleCap)) n++;
    return n;
  }

  function predictionScore(pick, actuals, ppc) {
    if (!pick) return 0;
    return countCorrectPicks(pick, actuals) * ppc;
  }

  function pickForOwner(pred, owner) {
    for (var i = 0; i < pred.picks.length; i++) {
      if (pred.picks[i].owner === owner) return pred.picks[i];
    }
    return null;
  }

  function notifyPred() {
    try {
      window.dispatchEvent(new CustomEvent(PRED_EVENT));
    } catch (e) {}
  }

  function statusPillHtml(resolved, correct) {
    var base =
      "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ";
    if (!resolved) {
      return (
        "<span class='" +
        base +
        "bg-slate-800 text-slate-500 ring-slate-600/60'>Pending</span>"
      );
    }
    if (correct) {
      return (
        "<span class='" +
        base +
        "bg-emerald-900/50 text-emerald-200 ring-emerald-600/50'>Match</span>"
      );
    }
    return (
      "<span class='" +
      base +
      "bg-slate-800 text-slate-500 ring-slate-600/60'>Miss</span>"
    );
  }

  function parseHash() {
    const raw = (location.hash || "#/").replace(/^#/, "") || "/";
    const parts = raw.split("/").filter(Boolean);
    if (parts.length === 0) return { name: "home" };
    if (parts[0] === "teams" && parts[1]) return { name: "team", slug: parts[1] };
    if (parts[0] === "teams") return { name: "teams" };
    if (parts[0] === "players") return { name: "players" };
    if (parts[0] === "matches") return { name: "matches" };
    if (parts[0] === "leaderboard") return { name: "leaderboard" };
    if (parts[0] === "franchises") return { name: "franchises" };
    if (parts[0] === "predictions") return { name: "predictions" };
    if (parts[0] === "auction") return { name: "auction" };
    if (parts[0] === "rules") return { name: "rules" };
    return { name: "home" };
  }

  const NAV = [
    { href: "#/", label: "Home", end: true },
    { href: "#/leaderboard", label: "Leaderboard" },
    { href: "#/franchises", label: "Franchises" },
    { href: "#/teams", label: "Teams" },
    { href: "#/matches", label: "Match Center" },
    { href: "#/predictions", label: "Predictions" },
    { href: "#/players", label: "Players" },
    { href: "#/auction", label: "Auction" },
    { href: "#/rules", label: "Rules" },
  ];

  let LEAGUE;
  let matchFranchiseFilter = "all";
  let playersSort = "points";
  let franchisesOwner = "";

  function seedDemoPreview() {
    const demo = {
      matchDate: "2026-03-21",
      matchLabel: "Sample: Match 1 (preview only)",
    };
    const picks = [
      ["virat-kohli", 62.5],
      ["rohit-sharma", 41],
      ["rashid-khan", 55],
      ["jasprit-bumrah", 38],
      ["rishabh-pant", 71],
    ];
    for (const [id, pts] of picks) {
      const p = LEAGUE.players.find((x) => x.id === id);
      if (p) {
        p.byMatch = [{ ...demo, points: pts }];
        p.seasonTotal = pts;
      }
    }
  }

  function navLinkClass(href) {
    const here = location.hash || "#/";
    const active =
      href === "#/"
        ? here === "#/" || here === ""
        : here.startsWith(href.split("?")[0]);
    return (
      "block rounded-lg px-2 py-2 text-xs font-medium transition-colors sm:rounded-xl sm:px-3 md:text-sm " +
      (active
        ? "bg-emerald-600/30 text-amber-200"
        : "text-slate-300 hover:bg-slate-800 hover:text-white")
    );
  }

  function renderNav() {
    const top = document.getElementById("nav-top");
    const bottom = document.getElementById("nav-bottom");
    const ulHtml =
      "<ul class='flex flex-wrap items-center justify-end gap-1 md:gap-2'>" +
      NAV.map(
        (n) =>
          "<li><a href='" +
          esc(n.href) +
          "' class='" +
          navLinkClass(n.href) +
          "'>" +
          esc(n.label) +
          "</a></li>",
      ).join("") +
      "</ul>";
    top.innerHTML = ulHtml;
    bottom.innerHTML =
      "<nav class='px-1' aria-label='Main mobile'>" +
      "<ul class='flex items-center justify-around gap-0'>" +
      NAV.map(
        (n) =>
          "<li class='min-w-0 flex-1'><a href='" +
          esc(n.href) +
          "' class='" +
          navLinkClass(n.href) +
          " text-center truncate'>" +
          esc(n.label) +
          "</a></li>",
      ).join("") +
      "</ul></nav>";
  }

  function renderHome(view) {
    const sorted = [...buildStandings(LEAGUE.franchises, LEAGUE.players)].sort(
      (a, b) => b.totalPoints - a.totalPoints,
    );
    const m = LEAGUE.meta;
    view.innerHTML =
      "<div class='space-y-8'>" +
      "<section class='rounded-2xl border border-slate-800 bg-slate-900/50 p-5'>" +
      "<h2 class='text-lg font-semibold text-white'>" +
      esc(m.seasonLabel) +
      "</h2>" +
      "<p class='mt-2 text-sm leading-relaxed text-slate-400'>" +
      esc(m.pointsUpdateNote) +
      "</p>" +
      (m.lastPointsUpdate
        ? "<p class='mt-2 text-xs text-slate-500'>Last points update: " +
          esc(m.lastPointsUpdate) +
          "</p>"
        : "") +
      "<div class='mt-4 flex flex-wrap gap-2'>" +
      "<a href='" +
      esc(m.cricbuzzBaseUrl) +
      "' target='_blank' rel='noreferrer' class='inline-flex rounded-xl bg-slate-800 px-4 py-2 text-sm font-medium text-amber-200 hover:bg-slate-700'>Open Cricbuzz</a>" +
      "<button type='button' id='btn-refresh-preview' class='rounded-xl border border-slate-600 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800'>Refresh view</button>" +
      "<a href='#/leaderboard' class='rounded-xl bg-emerald-800/40 px-4 py-2 text-sm font-medium text-emerald-100 ring-1 ring-emerald-600/40 hover:bg-emerald-800/60'>Full leaderboard</a>" +
      "<a href='#/predictions' class='rounded-xl border border-slate-600 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800'>Predictions</a>" +
      "</div>" +
      "<p class='mt-3 text-xs text-amber-200/70'>Preview injects sample points for a few stars so Match Center is not empty.</p>" +
      "</section>" +
      "<section><h2 class='mb-3 text-lg font-semibold text-white'>Top franchises</h2>" +
      "<p class='mb-3 text-sm text-slate-500'>Fantasy points only; prediction bonus is on the leaderboard.</p>" +
      "<div class='overflow-x-auto rounded-2xl border border-slate-800'><table class='w-full min-w-[280px] text-left text-sm'>" +
      "<thead class='bg-slate-900/80 text-xs uppercase tracking-wide text-slate-500'><tr><th class='px-4 py-3 font-medium'>#</th><th class='px-4 py-3 font-medium'>Team</th><th class='px-4 py-3 font-medium text-right'>Fantasy pts</th></tr></thead><tbody class='divide-y divide-slate-800'>" +
      sorted
        .slice(0, 3)
        .map(
          (row, i) =>
            "<tr class='bg-slate-950/40'><td class='px-4 py-3 text-slate-500'>" +
            (i + 1) +
            "</td><td class='px-4 py-3'><a href='#/teams/" +
            esc(ownerSlug(row.owner)) +
            "' class='font-medium text-white hover:text-amber-200'>" +
            esc(row.teamName) +
            "</a><div class='mt-1'>" +
            ownerBadgeHtml(row.owner) +
            "</div></td><td class='px-4 py-3 text-right font-semibold tabular-nums text-white'>" +
            row.totalPoints.toFixed(1) +
            "</td></tr>",
        )
        .join("") +
      "</tbody></table></div></section></div>";
    document.getElementById("btn-refresh-preview").onclick = function () {
      render();
    };
  }

  function renderTeams(view) {
    const sorted = [...buildStandings(LEAGUE.franchises, LEAGUE.players)].sort(
      (a, b) => b.totalPoints - a.totalPoints,
    );
    view.innerHTML =
      "<div class='space-y-4'><p class='text-sm text-slate-400'>Tap a franchise for the full squad.</p>" +
      "<ul class='grid gap-3 sm:grid-cols-2'>" +
      sorted
        .map(
          (f) =>
            "<li><a href='#/teams/" +
            esc(ownerSlug(f.owner)) +
            "' class='block rounded-2xl border border-slate-800 bg-slate-900/40 p-4 hover:border-emerald-800/80 hover:bg-slate-900/70'>" +
            "<h2 class='text-lg font-semibold text-white'>" +
            esc(f.teamName) +
            "</h2>" +
            "<div class='mt-2'>" +
            ownerBadgeHtml(f.owner) +
            "</div>" +
            "<p class='mt-3 text-2xl font-bold tabular-nums text-emerald-300'>" +
            f.totalPoints.toFixed(1) +
            " <span class='text-sm font-normal text-slate-500'>pts</span></p>" +
            "<p class='mt-1 text-xs text-slate-500'>" +
            f.playersResolved.length +
            " players</p></a></li>",
        )
        .join("") +
      "</ul></div>";
  }

  function renderTeam(view, slug) {
    const standings = buildStandings(LEAGUE.franchises, LEAGUE.players);
    const row = standings.find((s) => ownerSlug(s.owner) === slug);
    if (!row) {
      view.innerHTML =
        "<div class='rounded-2xl border border-slate-800 p-6 text-center text-slate-400'><p>Team not found.</p><a href='#/teams' class='mt-3 inline-block text-amber-400 hover:underline'>Back</a></div>";
      return;
    }
    view.innerHTML =
      "<div class='space-y-6'><a href='#/teams' class='text-sm font-medium text-amber-400'>&larr; All teams</a>" +
      "<div><h2 class='text-2xl font-bold text-white'>" +
      esc(row.teamName) +
      "</h2><div class='mt-2'>" +
      ownerBadgeHtml(row.owner) +
      "</div>" +
      "<p class='mt-3 text-3xl font-bold tabular-nums text-emerald-300'>" +
      row.totalPoints.toFixed(1) +
      " <span class='text-lg font-normal text-slate-500'>season pts</span></p></div>" +
      (row.missingPlayerIds.length
        ? "<div class='rounded-xl border border-amber-900/50 bg-amber-950/20 p-4 text-sm text-amber-100/90'>Missing IDs: " +
          esc(row.missingPlayerIds.join(", ")) +
          "</div>"
        : "") +
      "<section><h3 class='mb-3 text-sm font-semibold uppercase text-slate-500'>Squad</h3><ul class='space-y-3'>" +
      row.playersResolved
        .map(
          (p) =>
            "<li class='rounded-2xl border border-slate-800 bg-slate-900/40 p-4'>" +
            "<div class='flex flex-wrap justify-between gap-2'><div><p class='font-semibold text-white'>" +
            esc(p.name) +
            "</p><p class='mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500'>" +
            iplTeamPillHtml(p.iplTeam) +
            "<span>" +
            esc(p.role) +
            "</span></p></div>" +
            "<p class='text-lg font-bold tabular-nums text-emerald-300'>" +
            p.seasonTotal.toFixed(1) +
            "</p></div>" +
            (p.byMatch.length
              ? "<details class='mt-2'><summary class='cursor-pointer text-xs font-medium text-amber-400'>Match breakdown</summary><ul class='mt-2 space-y-1 rounded-xl bg-slate-950/60 p-3 text-xs'>" +
                p.byMatch
                  .map(
                    (m) =>
                      "<li class='flex justify-between gap-2 border-b border-slate-800/80 py-1'><span class='text-slate-400'>" +
                      esc(m.matchDate) +
                      " &mdash; " +
                      esc(m.matchLabel) +
                      "</span><span class='font-semibold text-emerald-300'>+" +
                      m.points +
                      "</span></li>",
                  )
                  .join("") +
                "</ul></details>"
              : "<p class='mt-2 text-xs text-slate-600'>No match rows yet</p>") +
            "</li>",
        )
        .join("") +
      "</ul></section></div>";
  }

  function renderPlayers(view) {
    const list = LEAGUE.players.map((p) => {
      const owner = ownerForPlayerId(LEAGUE.franchises, p.id);
      const inUnsold = LEAGUE.auction.unsoldPlayerIds.includes(p.id);
      let status;
      if (owner) status = { text: owner, href: "#/teams/" + ownerSlug(owner) };
      else if (inUnsold) status = { text: "Unsold pool", href: null };
      else status = { text: "\u2014", href: null };
      return { p, status };
    });
    list.sort((a, b) => {
      if (playersSort === "points") return b.p.seasonTotal - a.p.seasonTotal;
      return a.p.name.localeCompare(b.p.name);
    });
    view.innerHTML =
      "<div class='space-y-4'><div class='flex flex-wrap items-center justify-between gap-3'>" +
      "<p class='text-sm text-slate-400'>All players in the embedded roster.</p>" +
      "<label class='flex items-center gap-2 text-sm text-slate-300'><span class='text-slate-500'>Sort</span>" +
      "<select id='players-sort' class='rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white'>" +
      "<option value='points'" +
      (playersSort === "points" ? " selected" : "") +
      ">Points</option>" +
      "<option value='name'" +
      (playersSort === "name" ? " selected" : "") +
      ">Name</option></select></label></div>" +
      "<div class='overflow-x-auto rounded-2xl border border-slate-800'><table class='w-full min-w-[320px] text-left text-sm'>" +
      "<thead class='bg-slate-900/80 text-xs uppercase text-slate-500'><tr><th class='px-3 py-3'>Player</th><th class='px-3 py-3'>IPL</th><th class='px-3 py-3'>Franchise</th><th class='px-3 py-3 text-right'>Pts</th></tr></thead><tbody class='divide-y divide-slate-800'>" +
      list
        .map(
          ({ p, status }) =>
            "<tr class='bg-slate-950/40'><td class='px-3 py-3'><span class='font-medium text-white'>" +
            esc(p.name) +
            "</span><p class='text-xs text-slate-500'>" +
            esc(p.role) +
            " &middot; " +
            esc(p.id) +
            "</p></td><td class='px-3 py-3'>" +
            iplTeamPillHtml(p.iplTeam) +
            "</td><td class='px-3 py-3'>" +
            (status.href
              ? "<a href='" +
                esc(status.href) +
                "' class='inline-flex flex-wrap items-center gap-2 hover:opacity-90'>" +
                ownerBadgeHtml(status.text) +
                "</a>"
              : "<span class='text-slate-400'>" + esc(status.text) + "</span>") +
            "</td><td class='px-3 py-3 text-right font-semibold tabular-nums'>" +
            p.seasonTotal.toFixed(1) +
            "</td></tr>",
        )
        .join("") +
      "</tbody></table></div></div>";
    document.getElementById("players-sort").onchange = function (e) {
      playersSort = e.target.value;
      render();
    };
  }

  function columnSum(players, colId) {
    let s = 0;
    for (const p of players) {
      const pts = pointsInMatch(p, colId);
      if (pts != null) s += pts;
    }
    return s;
  }

  function renderMatches(view) {
    const columns = matchColumnsFromPlayers(LEAGUE.players);
    const standings = buildStandings(LEAGUE.franchises, LEAGUE.players);
    const filtered =
      matchFranchiseFilter === "all"
        ? standings
        : standings.filter((s) => s.owner === matchFranchiseFilter);

    function tableForStanding(s) {
      if (columns.length === 0) {
        return "<p class='text-sm text-slate-500'>No match columns (add byMatch in data).</p>";
      }
      let franchiseMatchTotal = 0;
      for (const p of s.playersResolved) {
        for (const c of columns) {
          const pts = pointsInMatch(p, c.id);
          if (pts != null) franchiseMatchTotal += pts;
        }
      }
      const headCols = columns
        .map(
          (c) =>
            "<th class='min-w-[5.5rem] px-2 py-3 text-right text-[10px] font-semibold uppercase leading-tight text-slate-400'>" +
            "<span class='block text-slate-500'>" +
            esc(c.date) +
            "</span><span class='line-clamp-2 font-normal normal-case text-slate-300'>" +
            esc(c.label) +
            "</span></th>",
        )
        .join("");
      const bodyRows = s.playersResolved
        .map((p) => {
          let rowT = 0;
          const cells = columns
            .map((c) => {
              const pts = pointsInMatch(p, c.id);
              if (pts != null) rowT += pts;
              return (
                "<td class='px-2 py-2.5 text-right tabular-nums text-slate-200'>" +
                (pts != null ? pts.toFixed(1) : "\u2014") +
                "</td>"
              );
            })
            .join("");
          return (
            "<tr class='bg-slate-950/30'><td class='sticky left-0 z-[1] bg-slate-950/90 px-3 py-2.5 font-medium text-white md:bg-slate-950/95'>" +
            esc(p.name) +
            "</td><td class='px-2 py-2.5'><span class='" +
            roleBadgeClass(p.role) +
            "'>" +
            esc(p.role) +
            "</span></td><td class='px-2 py-2.5'>" +
            iplTeamPillHtml(p.iplTeam) +
            "</td><td class='px-2 py-2.5'>" +
            "<span class='" +
            natBadgeClass(p.nationality) +
            "'>" +
            esc(p.nationality || "\u2014") +
            "</span></td>" +
            cells +
            "<td class='px-3 py-2.5 text-right tabular-nums font-medium text-emerald-300/90'>" +
            rowT.toFixed(1) +
            "</td></tr>"
          );
        })
        .join("");
      const sumCells = columns
        .map(
          (c) =>
            "<td class='px-2 py-3 text-right tabular-nums text-slate-200'>" +
            columnSum(s.playersResolved, c.id).toFixed(1) +
            "</td>",
        )
        .join("");
      return (
        "<div class='overflow-x-auto rounded-2xl border border-slate-800'><table class='w-full min-w-[640px] border-collapse text-left text-xs md:text-sm'>" +
        "<thead><tr class='border-b border-slate-800 bg-slate-900/90'>" +
        "<th class='sticky left-0 z-[1] bg-slate-900/95 px-3 py-3 text-[10px] font-semibold uppercase text-slate-500'>Player</th>" +
        "<th class='px-2 py-3 text-[10px] font-semibold uppercase text-slate-500'>Role</th>" +
        "<th class='px-2 py-3 text-[10px] font-semibold uppercase text-slate-500'>IPL</th>" +
        "<th class='px-2 py-3 text-[10px] font-semibold uppercase text-slate-500'>Type</th>" +
        headCols +
        "<th class='px-3 py-3 text-right text-[10px] font-semibold uppercase text-amber-400/90'>Total</th></tr></thead><tbody class='divide-y divide-slate-800'>" +
        bodyRows +
        "<tr class='bg-slate-900/50 font-semibold'><td colspan='4' class='sticky left-0 bg-slate-900/95 px-3 py-3 text-slate-300'>Franchise match total</td>" +
        sumCells +
        "<td class='px-3 py-3 text-right tabular-nums text-amber-200'>" +
        franchiseMatchTotal.toFixed(1) +
        "</td></tr></tbody></table></div>"
      );
    }

    const opts =
      "<option value='all'" +
      (matchFranchiseFilter === "all" ? " selected" : "") +
      ">All franchises</option>" +
      LEAGUE.franchises
        .map(
          (f) =>
            "<option value='" +
            esc(f.owner) +
            "'" +
            (matchFranchiseFilter === f.owner ? " selected" : "") +
            ">" +
            esc(f.teamName + " (" + f.owner + ")") +
            "</option>",
        )
        .join("");

    view.innerHTML =
      "<div class='space-y-6'><div class='flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between'>" +
      "<div><h2 class='text-lg font-semibold text-white'>Match Center</h2>" +
      "<p class='mt-1 text-sm text-slate-400'>Match-by-match matrix per franchise. Scroll horizontally on small screens.</p></div>" +
      "<label class='flex flex-col gap-1 text-sm text-slate-300'><span class='text-xs font-medium uppercase text-slate-500'>Franchise</span>" +
      "<select id='match-fr-filter' class='min-w-[12rem] rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-white'>" +
      opts +
      "</select></label></div>" +
      filtered
        .map(
          (s) =>
            "<section class='space-y-3'><div class='flex flex-wrap items-center justify-between gap-2'>" +
            "<div class='flex flex-wrap items-center gap-2'>" +
            "<h3 class='text-base font-semibold text-white'>" +
            esc(s.teamName) +
            "</h3>" +
            ownerBadgeHtml(s.owner) +
            "</div>" +
            "<span class='rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1 text-xs text-slate-300'>Season total: " +
            s.totalPoints.toFixed(1) +
            " pts</span></div>" +
            tableForStanding(s) +
            "</section>",
        )
        .join("") +
      "<p class='text-xs text-slate-600'>Totals sum only embedded match columns. Keep seasonTotal in sync with byMatch in the real app.</p></div>";

    document.getElementById("match-fr-filter").onchange = function (e) {
      matchFranchiseFilter = e.target.value;
      render();
    };
  }

  function renderAuction(view) {
    const pmap = playerMap(LEAGUE.players);
    const unsold = LEAGUE.auction.unsoldPlayerIds.map((id) => pmap.get(id)).filter(Boolean);
    unsold.sort((a, b) => a.name.localeCompare(b.name));
    const sales = [...LEAGUE.auction.sales].sort(
      (a, b) => new Date(b.soldAt) - new Date(a.soldAt),
    );
    view.innerHTML =
      "<div class='space-y-10'><section><h2 class='text-lg font-semibold text-white'>Unsold pool</h2>" +
      (unsold.length === 0
        ? "<p class='mt-4 text-sm text-slate-500'>No unsold players.</p>"
        : "<ul class='mt-4 space-y-2'>" +
          unsold
            .map(
              (p) =>
                "<li class='flex justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3'><div><p class='font-medium text-white'>" +
                esc(p.name) +
                "</p><p class='mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500'>" +
                iplTeamPillHtml(p.iplTeam) +
                "<span>" +
                esc(p.role) +
                "</span></p></div><span class='text-xs font-medium uppercase text-amber-400/80'>Open</span></li>",
            )
            .join("") +
          "</ul>") +
      "</section><section><h2 class='text-lg font-semibold text-white'>Auction history</h2>" +
      (sales.length === 0
        ? "<p class='mt-4 text-sm text-slate-500'>No sales recorded.</p>"
        : "<ul class='mt-4 space-y-2'>" +
          sales
            .map(
              (s) =>
                "<li class='rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3 text-sm'><p class='font-medium text-white'>" +
                esc((pmap.get(s.playerId) || {}).name || s.playerId) +
                "</p><p class='mt-2 flex flex-wrap items-center gap-2 text-slate-400'>Sold to " +
                ownerBadgeHtml(s.soldToOwner) +
                " for <span class='text-amber-200'>" +
                s.amountCr +
                " Cr</span> &middot; " +
                esc(s.soldAt) +
                "</p></li>",
            )
            .join("") +
          "</ul>") +
      "</section></div>";
  }

  function renderLeaderboard(view) {
    var pred = LEAGUE.predictions;
    var actuals = pred ? getMergedActuals() : null;
    var standings = buildStandings(LEAGUE.franchises, LEAGUE.players);
    var rows = standings.map(function (s) {
      var fantasy = s.totalPoints;
      var pick = pred ? pickForOwner(pred, s.owner) : null;
      var predPts =
        pred && actuals
          ? predictionScore(pick, actuals, pred.pointsPerCorrect)
          : 0;
      return { standing: s, fantasy: fantasy, predPts: predPts, total: fantasy + predPts };
    });
    rows.sort(function (a, b) {
      return b.total - a.total;
    });
    var note =
      pred && actuals
        ? "Combined fantasy plus prediction bonus (" +
          pred.pointsPerCorrect +
          " pts per correct pick when results are set). Local browser can store draft <code class='text-amber-200/80'>actuals</code>; publish them in <code class='text-amber-200/80'>predictions.json</code> for everyone."
        : "Fantasy points only (embed <code class='text-amber-200/80'>predictions</code> in the league bundle for prediction scoring).";
    view.innerHTML =
      "<div class='space-y-6'><div><h2 class='text-xl font-bold text-white'>Leaderboard</h2><p class='mt-1 text-sm text-slate-400'>" +
      note +
      "</p></div>" +
      "<div class='overflow-x-auto rounded-2xl border border-slate-800'><table class='w-full min-w-[320px] text-left text-sm'>" +
      "<thead class='bg-slate-900/80 text-xs uppercase tracking-wide text-slate-500'><tr>" +
      "<th class='px-3 py-3 font-medium'>#</th>" +
      "<th class='px-3 py-3 font-medium'>Franchise</th>" +
      "<th class='px-3 py-3 text-right font-medium'>Fantasy</th>" +
      (pred
        ? "<th class='px-3 py-3 text-right font-medium'>Predictions</th><th class='px-3 py-3 text-right font-medium text-amber-400/90'>Total</th>"
        : "<th class='px-3 py-3 text-right font-medium text-amber-400/90'>Total</th>") +
      "</tr></thead><tbody class='divide-y divide-slate-800'>" +
      rows
        .map(function (r, i) {
          var slug = ownerSlug(r.standing.owner);
          return (
            "<tr class='bg-slate-950/40'><td class='px-3 py-3 text-slate-500'>" +
            (i + 1) +
            "</td><td class='px-3 py-3'><a href='#/teams/" +
            esc(slug) +
            "' class='font-medium text-white hover:text-amber-200'>" +
            esc(r.standing.teamName) +
            "</a><div class='mt-1'>" +
            ownerBadgeHtml(r.standing.owner) +
            "</div></td><td class='px-3 py-3 text-right tabular-nums text-slate-300'>" +
            r.fantasy.toFixed(1) +
            "</td>" +
            (pred
              ? "<td class='px-3 py-3 text-right tabular-nums text-slate-300'>" +
                r.predPts.toFixed(0) +
                "</td><td class='px-3 py-3 text-right font-semibold tabular-nums text-amber-200'>" +
                r.total.toFixed(1) +
                "</td>"
              : "<td class='px-3 py-3 text-right font-semibold tabular-nums text-amber-200'>" +
                r.total.toFixed(1) +
                "</td>") +
            "</tr>"
          );
        })
        .join("") +
      "</tbody></table></div></div>";
  }

  function renderFranchises(view) {
    var standings = buildStandings(LEAGUE.franchises, LEAGUE.players).sort(function (a, b) {
      return b.totalPoints - a.totalPoints;
    });
    if (!standings.length) {
      view.innerHTML = "<p class='text-slate-400'>No franchises.</p>";
      return;
    }
    var selOwner = franchisesOwner || standings[0].owner;
    var selected = standings.find(function (s) {
      return s.owner === selOwner;
    });
    if (!selected) selected = standings[0];
    var opts = standings
      .map(function (s) {
        return (
          "<option value='" +
          esc(s.owner) +
          "'" +
          (s.owner === selected.owner ? " selected" : "") +
          ">" +
          esc(s.teamName + " (" + s.owner + ")") +
          "</option>"
        );
      })
      .join("");
    var slug = ownerSlug(selected.owner);
    var body = [...selected.playersResolved]
      .sort(function (a, b) {
        return b.seasonTotal - a.seasonTotal;
      })
      .map(function (p) {
        return (
          "<tr class='bg-slate-950/40'><td class='px-3 py-3 font-medium text-white'>" +
          esc(p.name) +
          "</td><td class='px-3 py-3'>" +
          iplTeamPillHtml(p.iplTeam) +
          "</td><td class='px-3 py-3'><span class='" +
          roleBadgeClass(p.role) +
          "'>" +
          esc(p.role) +
          "</span></td><td class='px-3 py-3'><span class='" +
          natBadgeClass(p.nationality) +
          "'>" +
          esc(natLabel(p.nationality)) +
          "</span></td><td class='px-3 py-3 text-right font-semibold tabular-nums text-emerald-300/90'>" +
          p.seasonTotal.toFixed(1) +
          "</td></tr>"
        );
      })
      .join("");
    view.innerHTML =
      "<div class='space-y-6'><div><h2 class='text-xl font-bold text-white'>Franchises</h2>" +
      "<p class='mt-1 text-sm text-slate-400'>Roster by owner: player, IPL side, role, nationality, season points.</p></div>" +
      "<label class='flex flex-col gap-1 text-sm text-slate-300'><span class='text-xs font-medium uppercase tracking-wide text-slate-500'>Franchise</span>" +
      "<select id='franchises-owner' class='max-w-md rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-white'>" +
      opts +
      "</select></label>" +
      "<div class='space-y-3'><div class='flex flex-wrap items-center gap-2'>" +
      "<h3 class='text-lg font-semibold text-white'>" +
      esc(selected.teamName) +
      "</h3>" +
      ownerBadgeHtml(selected.owner) +
      "<span class='text-sm text-slate-500'>" +
      selected.totalPoints.toFixed(1) +
      " season pts</span>" +
      "<a href='#/teams/" +
      esc(slug) +
      "' class='ml-auto text-sm font-medium text-amber-400 hover:text-amber-300'>Open squad details \u2192</a></div>" +
      "<div class='overflow-x-auto rounded-2xl border border-slate-800'><table class='w-full min-w-[360px] text-left text-sm'>" +
      "<thead class='bg-slate-900/80 text-xs uppercase tracking-wide text-slate-500'><tr>" +
      "<th class='px-3 py-3 font-medium'>Player</th>" +
      "<th class='px-3 py-3 font-medium'>IPL team</th>" +
      "<th class='px-3 py-3 font-medium'>Role</th>" +
      "<th class='px-3 py-3 font-medium'>Nationality</th>" +
      "<th class='px-3 py-3 text-right font-medium'>Points</th></tr></thead><tbody class='divide-y divide-slate-800'>" +
      body +
      "</tbody></table></div></div></div>";
    document.getElementById("franchises-owner").onchange = function (e) {
      franchisesOwner = e.target.value;
      render();
    };
  }

  function readPredForm() {
    function val(id) {
      var el = document.getElementById(id);
      if (!el) return null;
      var v = el.value;
      return v ? v : null;
    }
    return {
      winner: val("pred-winner"),
      runnerUp: val("pred-runner"),
      orangeCap: val("pred-orange"),
      purpleCap: val("pred-purple"),
    };
  }

  function renderPredictions(view) {
    var pred = LEAGUE.predictions;
    if (!pred) {
      view.innerHTML =
        "<div class='rounded-2xl border border-slate-800 p-6 text-slate-400'><p>No predictions data in this preview bundle. Run <code class='text-amber-200/80'>scripts/merge-ui-preview.ps1</code> after adding predictions.json.</p></div>";
      return;
    }
    var actuals = getMergedActuals();
    var pts = pred.pointsPerCorrect;
    var playerNames = [];
    var nameSet = {};
    for (var pi = 0; pi < LEAGUE.players.length; pi++) {
      var nm = LEAGUE.players[pi].name;
      if (!nameSet[nm]) {
        nameSet[nm] = true;
        playerNames.push(nm);
      }
    }
    playerNames.sort(function (a, b) {
      return a.localeCompare(b);
    });
    function optPending(sel, cur) {
      return (
        "<option value=''" +
        (!cur ? " selected" : "") +
        ">Pending</option>"
      );
    }
    function teamOpts(cur) {
      return (
        optPending(null, cur) +
        IPL_TEAM_CODES.map(function (t) {
          return (
            "<option value='" +
            esc(t) +
            "'" +
            (cur === t ? " selected" : "") +
            ">" +
            esc(t) +
            "</option>"
          );
        }).join("")
      );
    }
    function nameOpts(cur) {
      return (
        optPending(null, cur) +
        playerNames
          .map(function (n) {
            return (
              "<option value='" +
              esc(n) +
              "'" +
              (cur === n ? " selected" : "") +
              ">" +
              esc(n) +
              "</option>"
            );
          })
          .join("")
      );
    }
    var selClass =
      "rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white min-w-[8rem]";
    var selWide = selClass + " min-w-[12rem]";
    var cat = function (label, actual, count, isTeam) {
      var disp = actual
        ? isTeam
          ? iplTeamPillHtml(actual)
          : "<span class='text-white'>" + esc(actual) + "</span>"
        : "Pending";
      return (
        "<div class='rounded-2xl border border-slate-800 bg-slate-900/50 p-4'>" +
        "<p class='text-xs font-semibold uppercase tracking-wide text-slate-500'>" +
        esc(label) +
        "</p>" +
        "<p class='mt-2 flex flex-wrap items-center gap-2 text-lg font-semibold text-white'>" +
        disp +
        "</p>" +
        "<p class='mt-2 text-xs text-slate-500'>" +
        count +
        " correct · " +
        pts +
        " pts each</p></div>"
      );
    };
    var cw = actuals.winner
      ? pred.picks.filter(function (p) {
          return normTeamEq(p.winner, actuals.winner);
        }).length
      : 0;
    var cr = actuals.runnerUp
      ? pred.picks.filter(function (p) {
          return normTeamEq(p.runnerUp, actuals.runnerUp);
        }).length
      : 0;
    var co = actuals.orangeCap
      ? pred.picks.filter(function (p) {
          return normNameEq(p.orangeCap, actuals.orangeCap);
        }).length
      : 0;
    var cp = actuals.purpleCap
      ? pred.picks.filter(function (p) {
          return normNameEq(p.purpleCap, actuals.purpleCap);
        }).length
      : 0;
    var tableRows = pred.picks
      .map(function (pick) {
        var nCorrect = countCorrectPicks(pick, actuals);
        var wRes = !!actuals.winner;
        var wOk = wRes && normTeamEq(pick.winner, actuals.winner);
        var rRes = !!actuals.runnerUp;
        var rOk = rRes && normTeamEq(pick.runnerUp, actuals.runnerUp);
        var oRes = !!actuals.orangeCap;
        var oOk = oRes && normNameEq(pick.orangeCap, actuals.orangeCap);
        var pRes = !!actuals.purpleCap;
        var pOk = pRes && normNameEq(pick.purpleCap, actuals.purpleCap);
        return (
          "<tr class='bg-slate-950/30'><td class='px-3 py-3 align-top'>" +
          ownerBadgeHtml(pick.owner) +
          "</td><td class='px-3 py-3 align-top'><div class='flex flex-wrap items-center gap-2'>" +
          iplTeamPillHtml(pick.winner) +
          statusPillHtml(wRes, wOk) +
          "</div></td><td class='px-3 py-3 align-top'><div class='flex flex-wrap items-center gap-2'>" +
          iplTeamPillHtml(pick.runnerUp) +
          statusPillHtml(rRes, rOk) +
          "</div></td><td class='px-3 py-3 align-top'><div class='flex flex-wrap items-center gap-2'>" +
          "<span class='text-slate-100'>" +
          esc(pick.orangeCap) +
          "</span>" +
          statusPillHtml(oRes, oOk) +
          "</div></td><td class='px-3 py-3 align-top'><div class='flex flex-wrap items-center gap-2'>" +
          "<span class='text-slate-100'>" +
          esc(pick.purpleCap) +
          "</span>" +
          statusPillHtml(pRes, pOk) +
          "</div></td><td class='px-3 py-3 text-right align-top text-lg font-bold tabular-nums text-amber-200'>" +
          nCorrect +
          "</td></tr>"
        );
      })
      .join("");
    view.innerHTML =
      "<div class='space-y-8'><div><h2 class='text-xl font-bold uppercase tracking-wide text-white'>Predictions</h2>" +
      "<p class='mt-2 text-sm text-slate-400'>Each correct prediction wins <strong class='text-amber-200/90'>" +
      pts +
      " pts</strong>. Bonus flows into the leaderboard. Picks live in <code class='text-amber-200/80'>predictions.json</code>. Season results can be saved in this browser or pasted into <code class='text-amber-200/80'>actuals</code> for everyone.</p></div>" +
      "<section class='rounded-2xl border border-slate-800 bg-slate-900/40 p-5'>" +
      "<h3 class='text-xs font-semibold uppercase tracking-widest text-slate-500'>Season results (moderator)</h3>" +
      "<div class='mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>" +
      "<label class='flex flex-col gap-1 text-xs text-slate-400'>Winner<select id='pred-winner' class='" +
      selClass +
      "'>" +
      teamOpts(actuals.winner) +
      "</select></label>" +
      "<label class='flex flex-col gap-1 text-xs text-slate-400'>Runner-up<select id='pred-runner' class='" +
      selClass +
      "'>" +
      teamOpts(actuals.runnerUp) +
      "</select></label>" +
      "<label class='flex flex-col gap-1 text-xs text-slate-400'>Orange Cap<select id='pred-orange' class='" +
      selWide +
      "'>" +
      nameOpts(actuals.orangeCap) +
      "</select></label>" +
      "<label class='flex flex-col gap-1 text-xs text-slate-400'>Purple Cap<select id='pred-purple' class='" +
      selWide +
      "'>" +
      nameOpts(actuals.purpleCap) +
      "</select></label></div>" +
      "<div class='mt-4 flex flex-wrap gap-2'>" +
      "<button type='button' id='pred-copy' class='rounded-xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800'>Copy actuals JSON</button>" +
      "<button type='button' id='pred-reset' class='rounded-xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800'>Reset to file defaults</button></div></section>" +
      "<div class='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>" +
      cat("Winner", actuals.winner, cw, true) +
      cat("Runner-up", actuals.runnerUp, cr, true) +
      cat("Orange Cap", actuals.orangeCap, co, false) +
      cat("Purple Cap", actuals.purpleCap, cp, false) +
      "</div>" +
      "<div class='overflow-x-auto rounded-2xl border border-slate-800'><table class='w-full min-w-[720px] text-left text-sm'>" +
      "<thead class='border-b border-slate-800 bg-slate-900/90 text-xs uppercase tracking-wide text-slate-500'><tr>" +
      "<th class='px-3 py-3 font-medium'>Franchise</th>" +
      "<th class='px-3 py-3 font-medium'>Winner pick</th>" +
      "<th class='px-3 py-3 font-medium'>Runner-up pick</th>" +
      "<th class='px-3 py-3 font-medium'>Orange Cap pick</th>" +
      "<th class='px-3 py-3 font-medium'>Purple Cap pick</th>" +
      "<th class='px-3 py-3 text-right font-medium'>Correct</th></tr></thead><tbody class='divide-y divide-slate-800'>" +
      tableRows +
      "</tbody></table></div></div>";

    function persistFromForm() {
      var next = readPredForm();
      saveStoredActuals(next);
      notifyPred();
      render();
    }

    ["pred-winner", "pred-runner", "pred-orange", "pred-purple"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.onchange = persistFromForm;
    });
    document.getElementById("pred-copy").onclick = function () {
      var json = JSON.stringify({ actuals: readPredForm() }, null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json).catch(function () {
          window.prompt("Copy:", json);
        });
      } else {
        window.prompt("Copy:", json);
      }
    };
    document.getElementById("pred-reset").onclick = function () {
      saveStoredActuals(pred.actuals);
      notifyPred();
      render();
    };
  }

  function renderRules(view) {
    const r = LEAGUE.rules;
    const comp = r.teamComposition;
    const sc = r.scoring;
    view.innerHTML =
      "<div class='space-y-10 pb-4'><section><h2 class='text-lg font-semibold text-white'>" +
      esc(comp.title) +
      "</h2><ul class='mt-4 list-disc space-y-2 pl-5 text-sm text-slate-300'>" +
      comp.bullets.map((b) => "<li>" + esc(b) + "</li>").join("") +
      "</ul></section><section><h2 class='text-lg font-semibold text-white'>" +
      esc(sc.title) +
      "</h2><div class='mt-4 space-y-6'>" +
      sc.sections
        .map(
          (sec) =>
            "<div><h3 class='text-sm font-semibold uppercase text-amber-400/90'>" +
            esc(sec.heading) +
            "</h3><div class='mt-2 overflow-x-auto rounded-xl border border-slate-800'><table class='w-full min-w-[280px] text-left text-sm'>" +
            "<thead class='bg-slate-900/80 text-xs text-slate-500'><tr><th class='px-3 py-2 font-medium'>Action</th><th class='px-3 py-2 font-medium'>Points</th></tr></thead><tbody class='divide-y divide-slate-800'>" +
            sec.rows
              .map(
                (row) =>
                  "<tr class='bg-slate-950/40'><td class='px-3 py-2 text-slate-300'>" +
                  esc(row.action) +
                  "</td><td class='px-3 py-2 tabular-nums text-emerald-300/90'>" +
                  esc(row.points) +
                  "</td></tr>",
              )
              .join("") +
            "</tbody></table></div></div>",
        )
        .join("") +
      "</div><p class='mt-6 text-sm leading-relaxed text-slate-400'>" +
      esc(sc.footer) +
      "</p></section></div>";
  }

  function render() {
    renderNav();
    const view = document.getElementById("view");
    const route = parseHash();
    if (route.name === "home") renderHome(view);
    else if (route.name === "leaderboard") renderLeaderboard(view);
    else if (route.name === "franchises") renderFranchises(view);
    else if (route.name === "teams") renderTeams(view);
    else if (route.name === "team") renderTeam(view, route.slug);
    else if (route.name === "players") renderPlayers(view);
    else if (route.name === "matches") renderMatches(view);
    else if (route.name === "predictions") renderPredictions(view);
    else if (route.name === "auction") renderAuction(view);
    else if (route.name === "rules") renderRules(view);
    else renderHome(view);
  }

  function init() {
    const el = document.getElementById("league-json");
    if (!el) {
      document.getElementById("view").innerHTML =
        "<p class='text-red-300'>Missing embedded league JSON.</p>";
      return;
    }
    try {
      LEAGUE = JSON.parse(el.textContent);
    } catch (e) {
      document.getElementById("view").innerHTML =
        "<p class='text-red-300'>Invalid embedded JSON.</p>";
      return;
    }
    seedDemoPreview();
    window.addEventListener("hashchange", render);
    window.addEventListener(PRED_EVENT, render);
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
