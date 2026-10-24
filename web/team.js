const teamPage = document.querySelector("#team-page");
const clubSlug = new URLSearchParams(location.search).get("club");
const club = teams.find(team => team.slug === clubSlug);

const historyMetricKeys = ["rank", "xPts", "title", "top4", "relegation"];

function teamSide(match, slug) {
    const isHome = match.homeSlug === slug;
    return {
        isHome,
        opponent: isHome ? match.awayTeam : match.homeTeam,
        opponentSlug: isHome ? match.awaySlug : match.homeSlug,
        win: Number(isHome ? match.homeWin : match.awayWin),
        draw: Number(match.draw),
        loss: Number(isHome ? match.awayWin : match.homeWin),
        xgFor: Number(isHome ? match.lambdaHome : match.lambdaAway),
        xgAgainst: Number(isHome ? match.lambdaAway : match.lambdaHome),
        goalsFor: isHome ? match.homeGoals : match.awayGoals,
        goalsAgainst: isHome ? match.awayGoals : match.homeGoals
    };
}

function expectedPoints(side) {
    return (3 * side.win + side.draw) / 100;
}

function modelPick(side) {
    if (side.win >= side.draw && side.win >= side.loss) {
        return "win";
    }
    return side.draw >= side.loss ? "draw" : "loss";
}

function countsTotal(counts) {
    return counts.reduce((sum, count) => sum + count, 0);
}

function countsMean(counts) {
    return counts.reduce((sum, count, index) => sum + count * index, 0) / countsTotal(counts);
}

function countsQuantile(counts, share) {
    const target = countsTotal(counts) * share;
    let running = 0;
    for (let index = 0; index < counts.length; index += 1) {
        running += counts[index];
        if (running >= target) {
            return index;
        }
    }
    return counts.length - 1;
}

function shareText(count, total) {
    const share = (count / total) * 100;
    return `${share >= 10 || share === 0 ? share.toFixed(0) : share.toFixed(1)}%`;
}

function opponentLink(slug, name) {
    return `<a class="team-opponent" href="${teamPageUrl(slug)}">${createLogo({ slug })}<span>${escapeHtml(name)}</span></a>`;
}

function fact(label, value, detail = "") {
    return `
        <div class="team-fact">
            <span>${label}</span>
            <strong>${value}</strong>
            ${detail ? `<small>${detail}</small>` : ""}
        </div>
    `;
}

function recordText(matches, slug) {
    const counts = { win: 0, draw: 0, loss: 0 };
    matches.forEach(match => {
        counts[matchOutcomeForTeam(match, slug)] += 1;
    });
    return { text: `${counts.win}-${counts.draw}-${counts.loss}`, points: counts.win * 3 + counts.draw };
}

function teamHeroHtml(team) {
    const current = standings.find(row => row.slug === team.slug);
    const counts = teamDetails[team.slug]?.positionCounts || [];
    const note = teamNotes[teamKey(team)];
    const form = matchesForTeam(team.slug).slice(-5).map(match => {
        const outcome = matchOutcomeForTeam(match, team.slug);
        return `<span class="form-badge is-${outcome}" title="${escapeHtml(formLabels[outcome].label)}">${formLabels[outcome].letter}</span>`;
    }).join("");
    const facts = current ? [
        `${current.rank}. miejsce w tabeli`,
        `${current.pts} pkt po ${current.played} meczach`,
        `bilans ${current.wins}-${current.draws}-${current.losses}`,
        `bramki ${current.gf}:${current.ga}`
    ] : [];

    return `
        <section class="team-hero">
            <div class="team-hero-main">
                ${createLogo(team)}
                <div class="team-hero-copy">
                    <h1>${escapeHtml(team.team)}</h1>
                    ${facts.length ? `<p>${facts.join(" · ")}</p>` : ""}
                    ${form ? `<div class="team-form" aria-label="Ostatnie mecze">${form}</div>` : ""}
                </div>
            </div>
            <div class="team-facts">
                ${fact("Prognozowane miejsce", `${team.rank}.`)}
                ${counts.length ? fact("Średnie miejsce", formatNumber(countsMean(counts) + 1), "w 10 000 symulacji") : ""}
                ${fact("Prognozowane punkty", formatNumber(team.xPts), "xPts na koniec sezonu")}
                ${fact("Prognozowane bramki", `${formatNumber(team.xGF)}:${formatNumber(team.xGA)}`, `różnica ${team.xGD > 0 ? "+" : ""}${formatNumber(team.xGD)}`)}
            </div>
            <div class="probability-grid team-chances">
                ${probabilityBlock("Mistrzostwo", team.title, "home-win")}
                ${probabilityBlock("Top 4", team.top4, "draw")}
                ${probabilityBlock("Spadek", team.relegation, "away-win")}
            </div>
            ${note ? `<p class="team-hero-note"><span class="team-note-mark">*</span> <strong>${escapeHtml(note[0])}.</strong> ${escapeHtml(note[1])}</p>` : ""}
        </section>
    `;
}

function distBar(share, label = "") {
    const height = `${(share * 100).toFixed(1)}%`;
    return `
        <span class="dist-track">
            <span class="dist-bar" style="height: ${height}"></span>
            ${label ? `<span class="dist-value" style="bottom: calc(${height} + 3px)">${label}</span>` : ""}
        </span>
    `;
}

function positionZone(position) {
    if (position === 1) {
        return "is-title";
    }
    if (position <= 4) {
        return "is-top4";
    }
    return position >= 18 ? "is-relegation" : "";
}

function positionsHtml(team) {
    const counts = teamDetails[team.slug]?.positionCounts;
    if (!counts) {
        return "";
    }
    const total = countsTotal(counts);
    const maxCount = Math.max(...counts);
    const likely = counts.indexOf(maxCount);
    const current = standings.find(row => row.slug === team.slug);
    const higher = current ? counts.slice(0, current.rank - 1).reduce((sum, count) => sum + count, 0) : 0;
    const columns = counts.map((count, index) => {
        const position = index + 1;
        const label = shareText(count, total);
        return `
            <div class="dist-col ${positionZone(position)} ${current?.rank === position ? "is-current" : ""}" title="${position}. miejsce: ${label} symulacji">
                ${distBar(count / maxCount, count / total >= 0.005 ? label : "")}
                <span class="dist-label">${position}</span>
            </div>
        `;
    }).join("");

    return `
        <section class="team-panel">
            <div class="team-panel-header">
                <h2>Na którym miejscu skończy sezon</h2>
                <p>Jak często drużyna kończyła na każdym miejscu w 10 000 symulacji sezonu.</p>
            </div>
            <div class="team-facts">
                ${fact("Najczęściej", `${likely + 1}. miejsce`, `${shareText(maxCount, total)} symulacji`)}
                ${fact("8 na 10 symulacji", `${countsQuantile(counts, 0.1) + 1}.–${countsQuantile(counts, 0.9) + 1}. miejsce`)}
                ${current ? fact(`Wyżej niż obecne ${current.rank}. miejsce`, shareText(higher, total)) : ""}
                ${fact("Środek tabeli (5.–17.)", shareText(counts.slice(4, 17).reduce((sum, count) => sum + count, 0), total))}
            </div>
            <div class="dist-scroll">
                <div class="dist-chart">${columns}</div>
            </div>
            <div class="dist-legend">
                <span class="is-title">Mistrzostwo</span>
                <span class="is-top4">Top 4</span>
                <span class="is-relegation">Spadek</span>
                ${current ? `<span class="is-current">Obecne miejsce</span>` : ""}
            </div>
        </section>
    `;
}

function pointsHtml(team) {
    const details = teamDetails[team.slug];
    if (!details) {
        return "";
    }
    const counts = details.pointsCounts;
    const total = countsTotal(counts);
    const maxCount = Math.max(...counts);
    const low = countsQuantile(counts, 0.1);
    const median = countsQuantile(counts, 0.5);
    const high = countsQuantile(counts, 0.9);
    const above40 = counts.reduce((sum, count, index) => sum + (details.pointsMin + index >= 40 ? count : 0), 0);
    const labelStep = counts.length > 40 ? 10 : 5;
    const columns = counts.map((count, index) => {
        const points = details.pointsMin + index;
        const className = index === median ? "is-median" : index >= low && index <= high ? "is-range" : "";
        return `
            <div class="dist-col ${className}" title="${points} pkt: ${shareText(count, total)} symulacji">
                ${distBar(count / maxCount)}
                <span class="dist-label">${points % labelStep === 0 ? points : ""}</span>
            </div>
        `;
    }).join("");

    return `
        <section class="team-panel">
            <div class="team-panel-header">
                <h2>Ile punktów zdobędzie</h2>
                <p>Rozkład liczby punktów na koniec sezonu, razem z punktami już zdobytymi.</p>
            </div>
            <div class="team-facts">
                ${fact("Mediana", `${details.pointsMin + median} pkt`, "połowa symulacji kończy wyżej")}
                ${fact("8 na 10 symulacji", `${details.pointsMin + low}–${details.pointsMin + high} pkt`)}
                ${fact("Najlepszy i najgorszy scenariusz", `${details.pointsMin}–${details.pointsMin + counts.length - 1} pkt`)}
                ${fact("40 pkt lub więcej", shareText(above40, total), "zwykle wystarcza do utrzymania")}
            </div>
            <div class="dist-scroll">
                <div class="dist-chart dist-points">${columns}</div>
            </div>
            <div class="dist-legend">
                <span class="is-median">Mediana</span>
                <span class="is-range">8 na 10 symulacji</span>
            </div>
        </section>
    `;
}

function historyChartsHtml(team) {
    const series = [chartTeam(team)];
    const cards = historyMetricKeys
        .map(metricByKey)
        .filter(metric => !metric.percent || historySnapshots.some(snapshot => valueForTeam(snapshot, series[0].key, metric.key) >= 0.1))
        .map(metric => renderChartCard(`team-${metric.key}`, metric, series, historySnapshots))
        .join("");

    return `
        <section class="team-panel">
            <div class="team-panel-header">
                <h2>Jak zmieniała się prognoza</h2>
                <p>Prognoza po każdej kolejce. Najedź na punkt, żeby zobaczyć mecz z tej kolejki.</p>
            </div>
            <div class="charts-grid team-charts">${cards}</div>
        </section>
    `;
}

function playedHtml(team) {
    const matches = matchesForTeam(team.slug);
    if (!matches.length) {
        return `
            <section class="team-panel">
                <div class="team-panel-header"><h2>Rozegrane mecze</h2></div>
                <p class="empty-state">Brak rozegranych meczów.</p>
            </section>
        `;
    }

    const sides = matches.map(match => ({ match, side: teamSide(match, team.slug), outcome: matchOutcomeForTeam(match, team.slug) }));
    const home = recordText(matches.filter(match => match.homeSlug === team.slug), team.slug);
    const away = recordText(matches.filter(match => match.awaySlug === team.slug), team.slug);
    const goalsFor = sides.reduce((sum, item) => sum + item.side.goalsFor, 0);
    const goalsAgainst = sides.reduce((sum, item) => sum + item.side.goalsAgainst, 0);
    const xgFor = sides.reduce((sum, item) => sum + item.side.xgFor, 0);
    const xgAgainst = sides.reduce((sum, item) => sum + item.side.xgAgainst, 0);
    const hits = sides.filter(item => modelPick(item.side) === item.outcome).length;
    const surprise = sides.reduce((lowest, item) => (item.side[item.outcome] < lowest.side[lowest.outcome] ? item : lowest));
    const rows = [...sides].reverse().map(({ match, side, outcome }) => {
        const pick = modelPick(side);
        return `
            <tr>
                <td>${match.round}</td>
                <td class="team-match-cell">${opponentLink(side.opponentSlug, side.opponent)}</td>
                <td>${side.isHome ? "dom" : "wyjazd"}</td>
                <td><span class="team-score is-${outcome}">${side.goalsFor}-${side.goalsAgainst}</span></td>
                ${["win", "draw", "loss"].map(key => `<td class="${key === outcome ? "team-odds-hit" : ""}">${formatPercent(side[key])}</td>`).join("")}
                <td>${formatLambda(side.xgFor)} - ${formatLambda(side.xgAgainst)}</td>
                <td><span class="team-pick ${pick === outcome ? "is-hit" : "is-miss"}" title="Model najbardziej spodziewał się: ${formLabels[pick].label.toLowerCase()}">${pick === outcome ? "✓" : "✗"}</span></td>
            </tr>
        `;
    }).join("");

    return `
        <section class="team-panel">
            <div class="team-panel-header">
                <h2>Rozegrane mecze</h2>
                <p>Wyniki razem z szansami, jakie model dawał przed meczem.</p>
            </div>
            <div class="team-facts">
                ${fact("U siebie", home.text, `${home.points} pkt`)}
                ${fact("Na wyjeździe", away.text, `${away.points} pkt`)}
                ${fact("Gole strzelone", goalsFor, `model spodziewał się ${formatNumber(xgFor)}`)}
                ${fact("Gole stracone", goalsAgainst, `model spodziewał się ${formatNumber(xgAgainst)}`)}
                ${fact("Trafione typy modelu", `${hits} z ${sides.length}`, "najbardziej prawdopodobny wynik meczu")}
                ${fact("Największa niespodzianka", `${escapeHtml(surprise.match.homeTeam)} ${surprise.match.homeGoals}-${surprise.match.awayGoals} ${escapeHtml(surprise.match.awayTeam)}`, `model dawał ${formatPercent(surprise.side[surprise.outcome])} na taki wynik`)}
            </div>
            <div class="table-wrap team-table-wrap">
                <table class="team-table">
                    <thead>
                        <tr>
                            <th>Kolejka</th>
                            <th class="team-match-col">Rywal</th>
                            <th>Gdzie</th>
                            <th>Wynik</th>
                            <th>Wygrana</th>
                            <th>Remis</th>
                            <th>Porażka</th>
                            <th>Prognoza goli</th>
                            <th>Typ modelu</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </section>
    `;
}

function opponentStrength(slug) {
    const xPtsBySlug = new Map(teams.map(team => [team.slug, Number(team.xPts)]));
    const opponents = remainingFixtures
        .filter(match => match.homeSlug === slug || match.awaySlug === slug)
        .map(match => xPtsBySlug.get(teamSide(match, slug).opponentSlug) || 0);
    return opponents.length ? opponents.reduce((sum, value) => sum + value, 0) / opponents.length : 0;
}

function difficultyText(rank) {
    const easyRank = teams.length + 1 - rank;
    if (rank <= teams.length / 2) {
        return rank === 1 ? "najtrudniejszy w lidze" : `${rank}. najtrudniejszy`;
    }
    return easyRank === 1 ? "najłatwiejszy w lidze" : `${easyRank}. najłatwiejszy`;
}

function scheduleHtml(team) {
    const fixtures = remainingFixtures.filter(match => match.homeSlug === team.slug || match.awaySlug === team.slug);
    if (!fixtures.length) {
        return `
            <section class="team-panel">
                <div class="team-panel-header"><h2>Pozostałe mecze</h2></div>
                <p class="empty-state">Sezon zakończony, brak meczów do rozegrania.</p>
            </section>
        `;
    }

    const sides = fixtures.map(match => ({ match, side: teamSide(match, team.slug) }));
    const totalPoints = sides.reduce((sum, item) => sum + expectedPoints(item.side), 0);
    const strength = opponentStrength(team.slug);
    const difficulty = teams
        .map(item => ({ slug: item.slug, strength: opponentStrength(item.slug) }))
        .sort((first, second) => second.strength - first.strength)
        .findIndex(item => item.slug === team.slug) + 1;
    const favourite = sides.filter(item => modelPick(item.side) === "win").length;
    const hardest = sides.reduce((lowest, item) => (expectedPoints(item.side) < expectedPoints(lowest.side) ? item : lowest));

    const rows = sides.map(({ match, side }) => {
        const points = expectedPoints(side);
        return `
            <tr>
                <td>${match.round}</td>
                <td class="team-match-cell">${opponentLink(side.opponentSlug, side.opponent)}</td>
                <td>${side.isHome ? "dom" : "wyjazd"}</td>
                ${["win", "draw", "loss"].map(key => `<td><span class="team-odds is-${key}" style="--probability: ${side[key]}%">${formatPercent(side[key])}</span></td>`).join("")}
                <td>${formatLambda(side.xgFor)} - ${formatLambda(side.xgAgainst)}</td>
                <td class="${points >= 2 ? "positive" : points < 1 ? "negative" : ""}">${formatLambda(points)}</td>
            </tr>
        `;
    }).join("");

    return `
        <section class="team-panel">
            <div class="team-panel-header">
                <h2>Pozostałe mecze</h2>
                <p>Cały terminarz do końca sezonu z szansami z perspektywy drużyny.</p>
            </div>
            <div class="team-facts">
                ${fact("Mecze do rozegrania", fixtures.length)}
                ${fact("Oczekiwane punkty", formatNumber(totalPoints), `${formatLambda(totalPoints / fixtures.length)} na mecz`)}
                ${fact("Trudność terminarza", difficultyText(difficulty), `średnio rywale mają ${formatNumber(strength)} xPts`)}
                ${fact("Faworyt w meczach", `${favourite} z ${fixtures.length}`, "wygrana jest najbardziej prawdopodobna")}
                ${fact("Najtrudniejszy mecz", `${escapeHtml(hardest.side.opponent)} (${hardest.side.isHome ? "dom" : "wyjazd"})`, `kolejka ${hardest.match.round}, ${formatPercent(hardest.side.win)} na wygraną`)}
            </div>
            <div class="table-wrap team-table-wrap">
                <table class="team-table">
                    <thead>
                        <tr>
                            <th>Kolejka</th>
                            <th class="team-match-col">Rywal</th>
                            <th>Gdzie</th>
                            <th>Wygrana</th>
                            <th>Remis</th>
                            <th>Porażka</th>
                            <th>Prognoza goli</th>
                            <th>Oczek. pkt</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </section>
    `;
}

function renderTeamPage() {
    if (!club) {
        teamPage.innerHTML = `<section class="team-panel"><p class="empty-state">Nie znaleziono klubu. Wróć do tabeli i kliknij nazwę drużyny.</p></section>`;
        return;
    }
    document.title = `${club.team} - Premier League Predictor`;
    teamPage.innerHTML = [
        teamHeroHtml(club),
        positionsHtml(club),
        pointsHtml(club),
        historyChartsHtml(club),
        playedHtml(club),
        scheduleHtml(club)
    ].join("");
}

bindChartTooltips(teamPage);

renderTeamPage();
