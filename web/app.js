const forecastData = window.forecastData || { meta: {}, teams: [], upcomingFixtures: [], sampleTables: [] };
const forecastHistory = window.forecastHistory || { snapshots: [] };
const forecastMeta = forecastData.meta || {};
const teams = forecastData.teams || [];
const standings = forecastData.standings || [];
const results = forecastData.results || [];
const upcomingFixtures = forecastData.upcomingFixtures || [];
const sampleTables = forecastData.sampleTables || [];

const state = {
    sortKey: "rank",
    sortDirection: "asc",
    historyIndex: 0,
    resultsRound: 0
};

const metricConfigs = [
    { key: "title", label: "Szansa na tytuł" },
    { key: "top4", label: "Szansa na Top 4" },
    { key: "relegation", label: "Ryzyko spadku" }
];

const chartColors = ["#3d195b", "#e94091", "#00a3ff", "#00a878", "#f2a900", "#6a37a8"];
const teamColors = {
    "Arsenal": "#db0007",
    "Aston Villa": "#95bfe5",
    "Bournemouth": "#da291c",
    "Brentford": "#e30613",
    "Brighton": "#0057b8",
    "Chelsea": "#034694",
    "Coventry City": "#77bfe8",
    "Crystal Palace": "#1b458f",
    "Everton": "#003399",
    "Fulham": "#111111",
    "Hull": "#f5a623",
    "Ipswich": "#0057b8",
    "Leeds": "#ffcd00",
    "Liverpool": "#c8102e",
    "Man City": "#6cabdd",
    "Man United": "#da291c",
    "Newcastle": "#241f20",
    "Nott'm Forest": "#dd0000",
    "Sunderland": "#eb172b",
    "Tottenham": "#132257"
};

const tableBody = document.querySelector("#table-body");
const standingsBody = document.querySelector("#standings-body");
const standingsNote = document.querySelector("#standings-note");
const resultsBody = document.querySelector("#results-body");
const resultsSelect = document.querySelector("#results-select");
const resultsTitle = document.querySelector("#results-title");
const upcomingBody = document.querySelector("#upcoming-body");
const historySelect = document.querySelector("#history-select");
const historyBody = document.querySelector("#history-body");
const historyTitle = document.querySelector("#history-title");
const chartsBody = document.querySelector("#charts-body");
const randomSimulationButton = document.querySelector("#random-simulation-button");
const randomSimulationModal = document.querySelector("#random-simulation-modal");
const randomSimulationTitle = document.querySelector("#random-simulation-title");
const randomSimulationBody = document.querySelector("#random-simulation-body");
const hideRandomSimulationButton = document.querySelector("#hide-random-simulation");

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#039;"
    }[character]));
}

function formatNumber(value) {
    return Number(value || 0).toFixed(1);
}

function formatLambda(value) {
    return Number(value || 0).toFixed(2);
}

function formatInteger(value) {
    return Number(value || 0).toLocaleString("pl-PL");
}

function formatPercent(value) {
    return `${Number(value || 0).toFixed(1)}%`;
}

function buildTimelineSnapshots() {
    const snapshotMap = new Map((forecastHistory.snapshots || []).map(snapshot => [snapshot.id, snapshot]));

    if (teams.length) {
        snapshotMap.set(forecastMeta.snapshotId, {
            id: forecastMeta.snapshotId,
            label: forecastMeta.snapshotLabel,
            playedRounds: forecastMeta.playedRounds || 0,
            playedMatches: forecastMeta.playedMatches || 0,
            simulations: forecastMeta.simulations || 0,
            teams
        });
    }

    return [...snapshotMap.values()].sort((first, second) => {
        const firstMatches = Number(first.playedMatches || 0);
        const secondMatches = Number(second.playedMatches || 0);
        if (firstMatches !== secondMatches) {
            return firstMatches - secondMatches;
        }
        return Number(first.playedRounds || 0) - Number(second.playedRounds || 0);
    });
}

const historySnapshots = buildTimelineSnapshots();
state.historyIndex = Math.max(historySnapshots.length - 1, 0);
state.resultsRound = results.length ? Math.max(...results.map(match => Number(match.round))) : 0;

function sortTeams(rows) {
    return [...rows].sort((first, second) => {
        const firstValue = first[state.sortKey];
        const secondValue = second[state.sortKey];
        const direction = state.sortDirection === "asc" ? 1 : -1;

        if (typeof firstValue === "string") {
            return firstValue.localeCompare(secondValue, "pl") * direction;
        }

        return (firstValue - secondValue) * direction;
    });
}

function createLogo(team) {
    return `
        <span class="crest" aria-hidden="true">
            <img src="assets/logos/${escapeHtml(team.slug)}.svg" alt="" onerror="this.classList.add('is-missing')">
        </span>
    `;
}

function renderPercent(team, key, simulations, label) {
    const detail = `${label}: ${formatInteger(team[`${key}Count`])} z ${formatInteger(simulations)} symulacji`;
    return `
        <button class="percent-detail" type="button" title="${escapeHtml(detail)}" aria-label="${escapeHtml(detail)}">
            ${formatPercent(team[key])}
        </button>
    `;
}

function renderMeta() {
    const lead = document.querySelector("#forecast-lead");
    const playedMatches = document.querySelector("#played-matches");
    const matchProgressFill = document.querySelector("#match-progress-fill");
    const matchProgressCaption = document.querySelector("#match-progress-caption");
    const played = Number(forecastMeta.playedMatches || 0);
    const total = Number(forecastMeta.totalMatches || 380);
    const progress = total > 0 ? Math.max(0, Math.min(100, (played / total) * 100)) : 0;

    lead.textContent = `Prognoza tabeli po ${forecastMeta.simulations || "?"} symulacjach sezonu, oparta na oczekiwanych golach i rozkładach wyników.`;
    playedMatches.textContent = `${formatInteger(played)}/${formatInteger(total)}`;
    matchProgressFill.style.width = `${progress}%`;
    matchProgressCaption.textContent = `${formatInteger(played)} z ${formatInteger(total)} meczów Premier League zostało uwzględnionych jako fakty.`;
}

function renderTable() {
    if (!teams.length) {
        tableBody.innerHTML = `<tr><td colspan="9">Brak danych prognozy. Uruchom generator Monte Carlo.</td></tr>`;
        return;
    }

    const rows = sortTeams(teams);
    tableBody.innerHTML = rows.map(team => `
        <tr class="${team.rank >= 18 ? "relegation-row" : ""}">
            <td class="rank-cell">${team.rank}</td>
            <td class="team-cell">
                <div class="team-entry">
                    ${createLogo(team)}
                    <span class="team-name">
                        <strong>${escapeHtml(team.team)}</strong>
                    </span>
                </div>
            </td>
            <td class="xpts-cell"><strong>${formatNumber(team.xPts)}</strong></td>
            <td>${formatNumber(team.xGF)}</td>
            <td>${formatNumber(team.xGA)}</td>
            <td class="${team.xGD >= 0 ? "positive" : "negative"}">${formatNumber(team.xGD)}</td>
            <td class="title-prob">${renderPercent(team, "title", forecastMeta.simulations, "Tytuł")}</td>
            <td>${renderPercent(team, "top4", forecastMeta.simulations, "Top 4")}</td>
            <td class="relegation-prob">${renderPercent(team, "relegation", forecastMeta.simulations, "Spadek")}</td>
        </tr>
    `).join("");
}

function renderRandomSimulation(sampleTable) {
    randomSimulationTitle.textContent = `Symulacja ${formatInteger(sampleTable.simulation)} z ${formatInteger(forecastMeta.simulations || sampleTables.length)}`;
    randomSimulationBody.innerHTML = sampleTable.teams.map(team => `
        <tr class="${team.rank >= 18 ? "relegation-row" : ""}">
            <td class="rank-cell">${team.rank}</td>
            <td class="team-cell">
                <div class="team-entry">
                    ${createLogo(team)}
                    <span class="team-name"><strong>${escapeHtml(team.team)}</strong></span>
                </div>
            </td>
            <td class="xpts-cell"><strong>${team.pts}</strong></td>
            <td>${team.gf}</td>
            <td>${team.ga}</td>
            <td class="${team.gd >= 0 ? "positive" : "negative"}">${team.gd}</td>
        </tr>
    `).join("");
    randomSimulationModal.hidden = false;
    document.body.classList.add("modal-open");
    hideRandomSimulationButton.focus();
}

function closeRandomSimulation() {
    randomSimulationModal.hidden = true;
    document.body.classList.remove("modal-open");
    randomSimulationButton.focus();
}

function renderRandomSampleTable() {
    if (!sampleTables.length) {
        return;
    }

    const sampleTable = sampleTables[Math.floor(Math.random() * sampleTables.length)];
    renderRandomSimulation(sampleTable);
}

function probabilityBlock(label, value, className, extraClass = "") {
    const boundedValue = Math.max(0, Math.min(100, Number(value || 0)));
    return `
        <div class="probability ${className} ${extraClass}" style="--probability: ${boundedValue}%">
            <span>${label}</span>
            <strong>${formatPercent(boundedValue)}</strong>
            <i aria-hidden="true"></i>
        </div>
    `;
}

function renderUpcomingFixtures() {
    const upcomingRound = document.querySelector("#upcoming-round");
    upcomingRound.textContent = forecastMeta.nextRound ? `Kolejka ${forecastMeta.nextRound}` : "Brak nadchodzących spotkań";

    if (!upcomingFixtures.length) {
        upcomingBody.innerHTML = `<p class="empty-state">Brak nierozgranych meczów w terminarzu.</p>`;
        return;
    }

    upcomingBody.innerHTML = upcomingFixtures.map(fixture => `
        <article class="fixture-card">
            <div class="fixture-teams">
                <div class="fixture-team">
                    ${createLogo({ slug: fixture.homeSlug })}
                    <strong>${escapeHtml(fixture.homeTeam)}</strong>
                </div>
                <span class="versus">vs</span>
                <div class="fixture-team is-away">
                    <strong>${escapeHtml(fixture.awayTeam)}</strong>
                    ${createLogo({ slug: fixture.awaySlug })}
                </div>
            </div>
            <div class="fixture-lambdas">
                <span>xG ${formatLambda(fixture.lambdaHome)}</span>
                <span>xG ${formatLambda(fixture.lambdaAway)}</span>
            </div>
            <div class="probability-grid">
                ${probabilityBlock("1", fixture.homeWin, "home-win")}
                ${probabilityBlock("X", fixture.draw, "draw")}
                ${probabilityBlock("2", fixture.awayWin, "away-win")}
            </div>
        </article>
    `).join("");
}

function renderStandings() {
    if (!standings.length) {
        standingsBody.innerHTML = `<tr><td colspan="10">Brak rozegranych meczów w tym sezonie.</td></tr>`;
        return;
    }

    standingsNote.textContent = `Stan po ${formatInteger(forecastMeta.playedMatches || 0)} rozegranych meczach, sortowanie po punktach, różnicy bramek i golach zdobytych.`;

    standingsBody.innerHTML = standings.map(team => `
        <tr class="${team.rank >= 18 ? "relegation-row" : ""}">
            <td class="rank-cell">${team.rank}</td>
            <td class="team-cell">
                <div class="team-entry">
                    ${createLogo(team)}
                    <span class="team-name"><strong>${escapeHtml(team.team)}</strong></span>
                </div>
            </td>
            <td>${team.played}</td>
            <td>${team.wins}</td>
            <td>${team.draws}</td>
            <td>${team.losses}</td>
            <td>${team.gf}</td>
            <td>${team.ga}</td>
            <td class="${team.gd >= 0 ? "positive" : "negative"}">${team.gd > 0 ? `+${team.gd}` : team.gd}</td>
            <td class="xpts-cell"><strong>${team.pts}</strong></td>
        </tr>
    `).join("");
}

function resultRounds() {
    return [...new Set(results.map(match => Number(match.round)))].sort((first, second) => first - second);
}

function renderResultsControls() {
    const rounds = resultRounds();
    if (!rounds.length) {
        resultsSelect.innerHTML = `<option>Brak rozegranych kolejek</option>`;
        resultsSelect.disabled = true;
        return;
    }

    resultsSelect.disabled = false;
    resultsSelect.innerHTML = rounds.map(round => `<option value="${round}" ${round === state.resultsRound ? "selected" : ""}>Kolejka ${round}</option>`).join("");
}

function renderResults() {
    if (!results.length) {
        resultsTitle.textContent = "Brak rozegranych meczów";
        resultsBody.innerHTML = `<p class="empty-state">Żaden mecz sezonu nie ma jeszcze wyniku.</p>`;
        return;
    }

    resultsTitle.textContent = `Kolejka ${state.resultsRound}`;

    const roundMatches = results.filter(match => Number(match.round) === state.resultsRound);
    resultsBody.innerHTML = roundMatches.map(match => `
        <article class="fixture-card result-card">
            <div class="fixture-teams">
                <div class="fixture-team">
                    ${createLogo({ slug: match.homeSlug })}
                    <strong>${escapeHtml(match.homeTeam)}</strong>
                </div>
                <span class="result-score">${match.homeGoals}-${match.awayGoals}</span>
                <div class="fixture-team is-away">
                    <strong>${escapeHtml(match.awayTeam)}</strong>
                    ${createLogo({ slug: match.awaySlug })}
                </div>
            </div>
            <div class="fixture-lambdas">
                <span>xG ${formatLambda(match.lambdaHome)}</span>
                <span class="result-caption">Prognoza przed kolejką</span>
                <span>xG ${formatLambda(match.lambdaAway)}</span>
            </div>
            <div class="probability-grid">
                ${probabilityBlock("1", match.homeWin, "home-win", match.outcome === "home" ? "is-hit" : "")}
                ${probabilityBlock("X", match.draw, "draw", match.outcome === "draw" ? "is-hit" : "")}
                ${probabilityBlock("2", match.awayWin, "away-win", match.outcome === "away" ? "is-hit" : "")}
            </div>
        </article>
    `).join("");
}

function renderHistoryControls() {
    if (!historySnapshots.length) {
        historySelect.innerHTML = `<option>Brak zapisanych snapshotów</option>`;
        historySelect.disabled = true;
        return;
    }

    const snapshotByRound = new Map(historySnapshots.map((snapshot, index) => [Number(snapshot.playedRounds || 0), { snapshot, index }]));
    historySelect.disabled = false;
    historySelect.innerHTML = Array.from({ length: 39 }, (_item, round) => {
        const found = snapshotByRound.get(round);
        const label = round === 0 ? "Przed sezonem" : `Po ${round}. kolejce`;
        const value = found ? found.index : "";
        return `<option value="${value}" ${found ? "" : "disabled"} ${found?.index === state.historyIndex ? "selected" : ""}>${label}${found ? "" : " - niedostępne"}</option>`;
    }).join("");
}

function renderHistoryTable() {
    const snapshot = historySnapshots[state.historyIndex];
    if (!snapshot) {
        historyTitle.textContent = "Brak historii prognoz";
        historyBody.innerHTML = `<tr><td colspan="9">Brak zapisanych snapshotów.</td></tr>`;
        return;
    }

    historyTitle.textContent = snapshot.label;
    historyBody.innerHTML = snapshot.teams.map(team => `
        <tr class="${team.rank >= 18 ? "relegation-row" : ""}">
            <td class="rank-cell">${team.rank}</td>
            <td class="team-cell">
                <div class="team-entry">
                    ${createLogo(team)}
                    <span class="team-name"><strong>${escapeHtml(team.team)}</strong></span>
                </div>
            </td>
            <td class="xpts-cell"><strong>${formatNumber(team.xPts)}</strong></td>
            <td>${formatNumber(team.xGF)}</td>
            <td>${formatNumber(team.xGA)}</td>
            <td class="${team.xGD >= 0 ? "positive" : "negative"}">${formatNumber(team.xGD)}</td>
            <td class="title-prob">${renderPercent(team, "title", snapshot.simulations, "Tytuł")}</td>
            <td>${renderPercent(team, "top4", snapshot.simulations, "Top 4")}</td>
            <td class="relegation-prob">${renderPercent(team, "relegation", snapshot.simulations, "Spadek")}</td>
        </tr>
    `).join("");
}

function renderHistory() {
    renderHistoryControls();
    renderHistoryTable();
}

function teamKey(team) {
    return team.teamKey || team.team;
}

function valueForTeam(snapshot, wantedTeamKey, metricKey) {
    const team = snapshot.teams.find(item => teamKey(item) === wantedTeamKey);
    return Number(team?.[metricKey] || 0);
}

function teamsForMetric(metricKey) {
    const latestSnapshot = historySnapshots[historySnapshots.length - 1];
    if (!latestSnapshot) {
        return [];
    }

    const rankedTeams = [...latestSnapshot.teams]
        .sort((first, second) => Number(second[metricKey] || 0) - Number(first[metricKey] || 0))
        .slice(0, 5);

    return rankedTeams.map(team => ({
        key: teamKey(team),
        name: team.team,
        slug: team.slug,
        color: teamColors[teamKey(team)]
    }));
}

function chartPoint(snapshotIndex, value, maxValue, width, height, margin) {
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const x = historySnapshots.length === 1
        ? margin.left + plotWidth / 2
        : margin.left + (snapshotIndex * plotWidth) / (historySnapshots.length - 1);
    const y = margin.top + ((maxValue - value) / maxValue) * plotHeight;
    return { x, y };
}

function renderChartCard(config) {
    if (!historySnapshots.length) {
        return `<article class="chart-card"><p class="empty-state">Brak danych do wykresu.</p></article>`;
    }

    const width = 720;
    const height = 300;
    const margin = { top: 28, right: 28, bottom: 48, left: 48 };
    const selectedTeams = teamsForMetric(config.key);
    const maxObserved = Math.max(1, ...selectedTeams.flatMap(team => historySnapshots.map(snapshot => valueForTeam(snapshot, team.key, config.key))));
    const maxValue = Math.min(100, Math.max(10, Math.ceil(maxObserved / 10) * 10));

    const lines = selectedTeams.map((team, teamIndex) => {
        const color = team.color || chartColors[teamIndex % chartColors.length];
        const pointsData = historySnapshots.map((snapshot, snapshotIndex) => chartPoint(snapshotIndex, valueForTeam(snapshot, team.key, config.key), maxValue, width, height, margin));
        const points = historySnapshots.map((snapshot, snapshotIndex) => {
            const point = pointsData[snapshotIndex];
            return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
        }).join(" ");
        const dots = historySnapshots.map((snapshot, snapshotIndex) => {
            const point = pointsData[snapshotIndex];
            return `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4" fill="${color}"></circle>`;
        }).join("");
        const finalPoint = pointsData[pointsData.length - 1];
        const logo = `<image class="chart-logo" href="assets/logos/${escapeHtml(team.slug)}.svg" x="${(finalPoint.x - 14).toFixed(1)}" y="${(finalPoint.y - 14).toFixed(1)}" width="28" height="28"></image>`;
        return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"></polyline>${dots}${logo}`;
    }).join("");

    const labels = historySnapshots.map((snapshot, snapshotIndex) => {
        const point = chartPoint(snapshotIndex, 0, maxValue, width, height, margin);
        const label = snapshot.label.replace("Przed ", "0: ").replace("Po ", "");
        return `<text x="${point.x.toFixed(1)}" y="${height - 16}" text-anchor="middle">${escapeHtml(label)}</text>`;
    }).join("");

    const legend = selectedTeams.map((team, teamIndex) => `
        <span><img src="assets/logos/${escapeHtml(team.slug)}.svg" alt=""><i style="background:${team.color || chartColors[teamIndex % chartColors.length]}"></i>${escapeHtml(team.name)}</span>
    `).join("");

    return `
        <article class="chart-card">
            <div class="chart-card-header">
                <h3>${escapeHtml(config.label)}</h3>
                <span>0-${formatPercent(maxValue)}</span>
            </div>
            <svg class="trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(config.label)}">
                <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" class="chart-axis"></line>
                <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" class="chart-axis"></line>
                <line x1="${margin.left}" y1="${margin.top}" x2="${width - margin.right}" y2="${margin.top}" class="chart-grid"></line>
                <text x="12" y="${margin.top + 4}">${formatPercent(maxValue)}</text>
                <text x="24" y="${height - margin.bottom + 4}">0%</text>
                ${labels}
                ${lines}
            </svg>
            <div class="chart-legend">${legend}</div>
        </article>
    `;
}

function renderCharts() {
    chartsBody.innerHTML = metricConfigs.map(renderChartCard).join("");
}

document.querySelectorAll("th button").forEach(button => {
    button.addEventListener("click", () => {
        const sortKey = button.dataset.sort;
        if (state.sortKey === sortKey) {
            state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
        } else {
            state.sortKey = sortKey;
            state.sortDirection = sortKey === "team" ? "asc" : "desc";
        }
        renderTable();
    });
});

document.querySelectorAll(".tab-button").forEach(button => {
    button.addEventListener("click", () => {
        const tab = button.dataset.tab;
        document.querySelectorAll(".tab-button").forEach(item => item.classList.toggle("is-active", item === button));
        document.querySelectorAll(".tab-view").forEach(view => view.classList.toggle("is-active", view.dataset.view === tab));
    });
});

historySelect.addEventListener("change", () => {
    state.historyIndex = Number(historySelect.value || 0);
    renderHistory();
});

resultsSelect.addEventListener("change", () => {
    state.resultsRound = Number(resultsSelect.value || 0);
    renderResults();
});

randomSimulationButton.disabled = !sampleTables.length;
randomSimulationButton.addEventListener("click", renderRandomSampleTable);

hideRandomSimulationButton.addEventListener("click", closeRandomSimulation);

document.querySelectorAll("[data-random-close]").forEach(element => {
    element.addEventListener("click", closeRandomSimulation);
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !randomSimulationModal.hidden) {
        closeRandomSimulation();
    }
});

renderMeta();
renderTable();
renderStandings();
renderUpcomingFixtures();
renderResultsControls();
renderResults();
renderHistory();
renderCharts();
