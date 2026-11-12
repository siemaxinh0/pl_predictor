const matchPage = document.querySelector("#match-page");
const matchId = Number(new URLSearchParams(location.search).get("id"));
const allMatches = [...results, ...remainingFixtures].sort((first, second) => Number(first.fixture) - Number(second.fixture));
const currentMatch = allMatches.find(match => Number(match.fixture) === matchId);

const scoreMaxGoals = 12;
const scoreGridSize = 6;
const scoreOutcomeColors = { home: "114, 215, 255", draw: "106, 55, 168", away: "233, 64, 145" };

function isPlayed(match) {
    return match.homeGoals !== undefined && match.homeGoals !== null;
}

function poissonPmf(lambda, maxGoals) {
    const values = [Math.exp(-lambda)];
    for (let goals = 1; goals <= maxGoals; goals += 1) {
        values.push(values[goals - 1] * lambda / goals);
    }
    return values;
}

// ten sam rachunek co poisson_result_probs w run_forecast.py: macierz do 12 goli znormalizowana do 1
function scoreSummary(match) {
    const home = poissonPmf(Number(match.lambdaHome), scoreMaxGoals);
    const away = poissonPmf(Number(match.lambdaAway), scoreMaxGoals);
    const scores = home.flatMap((homeShare, homeGoals) => away.map((awayShare, awayGoals) => ({ homeGoals, awayGoals, share: homeShare * awayShare })));
    const total = scores.reduce((sum, score) => sum + score.share, 0);
    scores.forEach(score => {
        score.share /= total;
    });
    const ranked = [...scores].sort((first, second) => second.share - first.share);
    const shareWhere = test => scores.reduce((sum, score) => (test(score) ? sum + score.share : sum), 0);
    // ostatni wiersz i kolumna siatki zbieraja wszystkie wyniki od scoreGridSize - 1 goli w gore
    const grid = Array.from({ length: scoreGridSize }, () => Array(scoreGridSize).fill(0));
    scores.forEach(({ homeGoals, awayGoals, share }) => {
        grid[Math.min(homeGoals, scoreGridSize - 1)][Math.min(awayGoals, scoreGridSize - 1)] += share;
    });
    return {
        grid,
        ranked,
        top: ranked.slice(0, 6),
        over: shareWhere(score => score.homeGoals + score.awayGoals >= 3),
        bothScore: shareWhere(score => score.homeGoals > 0 && score.awayGoals > 0),
        homeCleanSheet: shareWhere(score => score.awayGoals === 0),
        awayCleanSheet: shareWhere(score => score.homeGoals === 0),
        totals: Array.from({ length: 7 }, (_, goals) => shareWhere(score => (goals < 6 ? score.homeGoals + score.awayGoals === goals : score.homeGoals + score.awayGoals >= goals)))
    };
}

function scoreShareText(share) {
    return share * 100 >= 0.1 ? formatPercent(share * 100) : "<0.1%";
}

function scoreOutcome(homeGoals, awayGoals) {
    if (homeGoals === awayGoals) {
        return "draw";
    }
    return homeGoals > awayGoals ? "home" : "away";
}

function sameCell(score, homeGoals, awayGoals) {
    return Boolean(score) && Math.min(score.homeGoals, scoreGridSize - 1) === homeGoals && Math.min(score.awayGoals, scoreGridSize - 1) === awayGoals;
}

function actualScore(match) {
    return isPlayed(match) ? { homeGoals: Number(match.homeGoals), awayGoals: Number(match.awayGoals) } : null;
}

function scoreGridHtml(match, summary) {
    const max = Math.max(...summary.grid.flat());
    const actual = actualScore(match);
    const label = goals => (goals === scoreGridSize - 1 ? `${goals}+` : String(goals));
    const header = summary.grid.map((_, awayGoals) => `<span class="score-grid-label">${label(awayGoals)}</span>`).join("");
    const rows = summary.grid.map((row, homeGoals) => `
        <span class="score-grid-label">${label(homeGoals)}</span>
        ${row.map((share, awayGoals) => {
            const outcome = scoreOutcome(homeGoals, awayGoals);
            const strength = 0.06 + 0.84 * (share / max);
            const classes = [
                strength > 0.55 && outcome !== "home" ? "is-dark" : "",
                sameCell(summary.top[0], homeGoals, awayGoals) ? "is-best" : "",
                sameCell(actual, homeGoals, awayGoals) ? "is-actual" : ""
            ].join(" ");
            const tip = `${match.homeTeam} ${label(homeGoals)}-${label(awayGoals)} ${match.awayTeam}: ${scoreShareText(share)}`;
            return `<span class="score-cell ${classes}" style="background: rgba(${scoreOutcomeColors[outcome]}, ${strength.toFixed(2)})" title="${escapeHtml(tip)}">${scoreShareText(share)}</span>`;
        }).join("")}
    `).join("");

    return `
        <section class="score-card">
            <h3>Macierz wyników</h3>
            <div class="score-grid">
                <span class="score-grid-corner" title="${escapeHtml(`Wiersze: gole ${match.homeTeam}, kolumny: gole ${match.awayTeam}`)}">
                    <span class="score-corner-away">${createLogo({ slug: match.awaySlug })}</span>
                    <span class="score-corner-home">${createLogo({ slug: match.homeSlug })}</span>
                </span>
                ${header}
                ${rows}
            </div>
            <div class="dist-legend score-legend">
                <span class="is-home">Wygrana gospodarzy</span>
                <span class="is-draw">Remis</span>
                <span class="is-away">Wygrana gości</span>
                <span class="is-best">Najbardziej prawdopodobny wynik</span>
                ${actual ? `<span class="is-actual">Wynik meczu</span>` : ""}
            </div>
        </section>
    `;
}

function scoreTopRow(score, max, isActual, rank = 0) {
    return `
        <div class="score-top-row ${isActual ? "is-actual" : ""}">
            <span class="score-pill is-${scoreOutcome(score.homeGoals, score.awayGoals)}">${score.homeGoals}-${score.awayGoals}</span>
            <span class="score-top-track"><i style="width: ${(score.share / max * 100).toFixed(1)}%"></i></span>
            <strong>${scoreShareText(score.share)}</strong>
            ${isActual ? `<small>wynik meczu${rank ? ` · ${rank}. najbardziej prawdopodobny` : ""}</small>` : ""}
        </div>
    `;
}

function scoreTopHtml(match, summary) {
    const max = summary.top[0].share;
    const actual = actualScore(match);
    const isActual = score => Boolean(actual) && score.homeGoals === actual.homeGoals && score.awayGoals === actual.awayGoals;
    const actualRank = actual ? summary.ranked.findIndex(isActual) + 1 : 0;
    return `
        <section class="score-card">
            <h3>Najbardziej prawdopodobne wyniki</h3>
            <div class="score-top">
                ${summary.top.map(score => scoreTopRow(score, max, isActual(score))).join("")}
                ${actualRank > summary.top.length ? scoreTopRow(summary.ranked[actualRank - 1], max, true, actualRank) : ""}
            </div>
        </section>
    `;
}

function scoreTotalsHtml(match, summary) {
    const max = Math.max(...summary.totals);
    const actual = actualScore(match);
    const actualTotal = actual ? Math.min(actual.homeGoals + actual.awayGoals, 6) : -1;
    const columns = summary.totals.map((share, goals) => `
        <div class="dist-col is-range ${goals === actualTotal ? "is-current" : ""}" title="${goals === 6 ? "6 i więcej" : goals} goli: ${scoreShareText(share)}">
            ${distBar(share / max, `${Math.round(share * 100)}%`)}
            <span class="dist-label">${goals === 6 ? "6+" : goals}</span>
        </div>
    `).join("");
    return `
        <section class="score-card">
            <h3>Liczba goli w meczu</h3>
            <div class="dist-chart score-goals-chart">${columns}</div>
            ${actual ? `<div class="dist-legend"><span class="is-current">Tyle padło</span></div>` : ""}
        </section>
    `;
}

function matchFactsHtml(match, summary) {
    const best = summary.top[0];
    const actual = actualScore(match);
    if (!actual) {
        return `
            ${fact("Najbardziej prawdopodobny wynik", `${best.homeGoals}-${best.awayGoals}`, `${scoreShareText(best.share)} szans`)}
            ${fact("Powyżej 2,5 gola", scoreShareText(summary.over))}
            ${fact("Obie drużyny strzelą", scoreShareText(summary.bothScore))}
            ${fact("Czyste konto", `${scoreShareText(summary.homeCleanSheet)} / ${scoreShareText(summary.awayCleanSheet)}`, `${escapeHtml(match.homeTeam)} / ${escapeHtml(match.awayTeam)}`)}
        `;
    }
    const actualShare = summary.ranked.find(score => score.homeGoals === actual.homeGoals && score.awayGoals === actual.awayGoals)?.share || 0;
    const goals = actual.homeGoals + actual.awayGoals;
    const bothScored = actual.homeGoals > 0 && actual.awayGoals > 0;
    return `
        ${fact("Model dawał temu wynikowi", scoreShareText(actualShare), `najbardziej prawdopodobny był ${best.homeGoals}-${best.awayGoals} (${scoreShareText(best.share)})`)}
        ${fact("Powyżej 2,5 gola", scoreShareText(summary.over), `w meczu padło goli: ${goals}`)}
        ${fact("Obie drużyny strzelą", scoreShareText(summary.bothScore), bothScored ? "w meczu: tak" : "w meczu: nie")}
        ${fact("Czyste konto", `${scoreShareText(summary.homeCleanSheet)} / ${scoreShareText(summary.awayCleanSheet)}`, `${escapeHtml(match.homeTeam)} / ${escapeHtml(match.awayTeam)}`)}
    `;
}

function matchSide(match, isAway) {
    const slug = isAway ? match.awaySlug : match.homeSlug;
    const name = isAway ? match.awayTeam : match.homeTeam;
    const lambda = isAway ? match.lambdaAway : match.lambdaHome;
    const position = standings.find(team => team.slug === slug)?.rank;
    const form = recentForm(slug);
    return `
        <div class="match-side ${isAway ? "is-away" : ""}">
            ${teamCrestLink(slug, "match-crest-link")}
            <a class="team-link match-team-link" href="${teamPageUrl(slug)}" data-team-slug="${escapeHtml(slug)}">${escapeHtml(name)}</a>
            <span class="match-team-meta">${position ? `${isPlayed(match) ? "obecnie " : ""}${position}. miejsce · ` : ""}${isAway ? "wyjazd" : "dom"}</span>
            ${form ? `<div class="team-form" aria-label="Ostatnie mecze">${form}</div>` : ""}
            <span class="match-xg" title="Oczekiwane gole według modelu"><strong>${formatLambda(lambda)}</strong> xG</span>
        </div>
    `;
}

function matchHeroHtml(match) {
    const played = isPlayed(match);
    return `
        <section class="team-hero match-hero">
            <p class="match-kicker">Kolejka ${match.round} · ${played ? "mecz rozegrany" : "przed meczem"}</p>
            <div class="match-teams">
                ${matchSide(match, false)}
                <div class="match-center">
                    ${played ? `<span class="match-score">${match.homeGoals}-${match.awayGoals}</span><small>wynik końcowy</small>` : `<span class="match-vs">vs</span>`}
                </div>
                ${matchSide(match, true)}
            </div>
            ${played ? `<p class="match-forecast-label">xG i szanse: prognoza przed kolejką</p>` : ""}
            <div class="probability-grid match-odds">
                ${probabilityBlock("1", match.homeWin, "home-win", match.outcome === "home" ? "is-hit" : "")}
                ${probabilityBlock("X", match.draw, "draw", match.outcome === "draw" ? "is-hit" : "")}
                ${probabilityBlock("2", match.awayWin, "away-win", match.outcome === "away" ? "is-hit" : "")}
            </div>
        </section>
    `;
}

function roundHint(roundMatches) {
    const playedCount = roundMatches.filter(isPlayed).length;
    if (playedCount === roundMatches.length) {
        return "Przy meczach widać wynik końcowy.";
    }
    if (playedCount === 0) {
        return "Przy meczach widać najbardziej prawdopodobny wynik według modelu.";
    }
    return "Przy rozegranych meczach widać wynik końcowy, przy pozostałych najbardziej prawdopodobny wynik według modelu.";
}

function roundMatchesHtml(match) {
    const roundMatches = allMatches.filter(item => Number(item.round) === Number(match.round));
    return `
        <section class="team-panel">
            <div class="table-toolbar panel-head"><h2>Kolejka ${match.round}</h2></div>
            <div class="round-matches">
                ${roundMatches.map(item => {
                    const score = isPlayed(item) ? actualScore(item) : scoreSummary(item).top[0];
                    return `
                        <a class="score-match ${item === match ? "is-active" : ""}" href="${matchPageUrl(item.fixture)}" ${item === match ? `aria-current="page"` : ""}>
                            <span class="score-match-teams">
                                <span class="score-match-team">${createLogo({ slug: item.homeSlug })}<span>${escapeHtml(item.homeTeam)}</span></span>
                                <span class="score-match-team">${createLogo({ slug: item.awaySlug })}<span>${escapeHtml(item.awayTeam)}</span></span>
                            </span>
                            <span class="score-pill is-${scoreOutcome(score.homeGoals, score.awayGoals)}" title="${isPlayed(item) ? "Wynik meczu" : "Najbardziej prawdopodobny wynik"}">${score.homeGoals}-${score.awayGoals}</span>
                        </a>
                    `;
                }).join("")}
            </div>
            <p class="dist-hint">${roundHint(roundMatches)}</p>
        </section>
    `;
}

function renderMatchPage() {
    if (!currentMatch) {
        matchPage.innerHTML = `<section class="team-panel"><p class="empty-state">Nie znaleziono meczu. Wróć do tabeli i wybierz mecz z nadchodzących meczów albo wyników.</p></section>`;
        return;
    }
    const summary = scoreSummary(currentMatch);
    document.title = `${currentMatch.homeTeam} - ${currentMatch.awayTeam} - Premier League Predictor`;
    matchPage.innerHTML = `
        ${matchHeroHtml(currentMatch)}
        <section class="team-panel">
            <div class="table-toolbar panel-head"><h2>Dokładne wyniki</h2></div>
            <div class="team-facts">${matchFactsHtml(currentMatch, summary)}</div>
            <div class="score-detail-grid">
                ${scoreGridHtml(currentMatch, summary)}
                <div class="score-side">
                    ${scoreTopHtml(currentMatch, summary)}
                    ${scoreTotalsHtml(currentMatch, summary)}
                </div>
            </div>
        </section>
        ${roundMatchesHtml(currentMatch)}
    `;
}

renderMatchPage();
