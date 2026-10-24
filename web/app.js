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
    resultsRound: 0,
    teamCardSlug: "",
    teamCardPinned: false,
    teamCardTimer: 0
};

const metricConfigs = [
    { key: "title", label: "Szansa na tytuł", percent: true },
    { key: "top4", label: "Szansa na Top 4", percent: true },
    { key: "relegation", label: "Ryzyko spadku", percent: true, lowerIsBetter: true },
    { key: "xPts", label: "Prognozowane punkty (xPts)" },
    { key: "xGD", label: "Prognozowana różnica bramek (xGD)" },
    { key: "xGF", label: "Prognozowane gole strzelone (xGF)" },
    { key: "xGA", label: "Prognozowane gole stracone (xGA)", lowerIsBetter: true },
    { key: "rank", label: "Prognozowane miejsce w tabeli", lowerIsBetter: true }
];
const presetChartKeys = ["title", "top4", "relegation"];

const tips = {
    rank: ["Prognozowane miejsce", "Kolejność według xPts, przy równych xPts decyduje xGD, a potem xGF."],
    xPts: ["Oczekiwane punkty", "Średnia liczba punktów na koniec sezonu z 10 000 symulacji, razem z punktami już zdobytymi."],
    xGF: ["Oczekiwane gole strzelone", "Średnia liczba goli strzelonych w całym sezonie, razem z golami już strzelonymi."],
    xGA: ["Oczekiwane gole stracone", "Średnia liczba goli straconych w całym sezonie, razem z golami już straconymi."],
    xGD: ["Oczekiwana różnica bramek", "Średni bilans bramek na koniec sezonu, czyli xGF minus xGA."],
    title: ["Szansa na mistrzostwo", "W ilu procentach symulacji drużyna skończyła sezon na 1. miejscu."],
    top4: ["Szansa na Top 4", "W ilu procentach symulacji drużyna skończyła sezon na miejscach 1–4."],
    relegation: ["Ryzyko spadku", "W ilu procentach symulacji drużyna skończyła sezon na miejscach 18–20, czyli spadła z ligi."],
    position: ["Miejsce w tabeli", "Obecna pozycja po rozegranych meczach."],
    played: ["Mecze", "Liczba rozegranych meczów."],
    wins: ["Wygrane", "Liczba wygranych meczów, każda daje 3 punkty."],
    draws: ["Remisy", "Liczba zremisowanych meczów, każdy daje 1 punkt."],
    losses: ["Porażki", "Liczba przegranych meczów."],
    goalsFor: ["Gole strzelone", "Wszystkie gole strzelone w rozegranych meczach."],
    goalsAgainst: ["Gole stracone", "Wszystkie gole stracone w rozegranych meczach."],
    goalDiff: ["Różnica bramek", "Gole strzelone minus gole stracone. Rozstrzyga przy równej liczbie punktów."],
    points: ["Punkty", "3 za wygraną, 1 za remis, 0 za porażkę."],
    simPosition: ["Miejsce w tej symulacji", "Pozycja na koniec jednego wylosowanego sezonu."],
    simPoints: ["Punkty", "Punkty na koniec sezonu w tej jednej symulacji."],
    simGoalsFor: ["Gole strzelone", "Gole strzelone w całym sezonie w tej jednej symulacji."],
    simGoalsAgainst: ["Gole stracone", "Gole stracone w całym sezonie w tej jednej symulacji."],
    simGoalDiff: ["Różnica bramek", "Gole strzelone minus stracone w tej jednej symulacji."],
    cityPenalty: ["Bez możliwej kary punktowej", "Prognoza zakłada, że Manchester City zachowa wszystkie zdobyte punkty. Ewentualne odjęcie punktów za naruszenie przepisów finansowych Premier League nie jest uwzględnione."]
};
const teamTips = { "Man City": "cityPenalty" };

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
const resultsBody = document.querySelector("#results-body");
const resultsSelect = document.querySelector("#results-select");
const resultsTitle = document.querySelector("#results-title");
const upcomingBody = document.querySelector("#upcoming-body");
const historySelect = document.querySelector("#history-select");
const historyBody = document.querySelector("#history-body");
const historyTitle = document.querySelector("#history-title");
const chartsPanel = document.querySelector("[data-view='charts']");
const chartsBody = document.querySelector("#charts-body");
const customChartControls = document.querySelector("#custom-chart-controls");
const customChartView = document.querySelector("#custom-chart-view");
const customChartDownload = document.querySelector("#custom-chart-download");
const randomSimulationButton = document.querySelector("#random-simulation-button");
const randomSimulationModal = document.querySelector("#random-simulation-modal");
const randomSimulationTitle = document.querySelector("#random-simulation-title");
const randomSimulationBody = document.querySelector("#random-simulation-body");
const hideRandomSimulationButton = document.querySelector("#hide-random-simulation");
const tipBox = document.querySelector("#tip-box");
const teamCard = document.querySelector("#team-card");

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
state.customChart = {
    metric: "title",
    from: 0,
    to: state.historyIndex,
    teams: latestTeams().slice(0, 4).map(teamKey)
};
state.resultsRound = results.length ? Math.max(...results.map(match => Number(match.round))) : 0;

function sortTeams(rows) {
    return [...rows].sort((first, second) => {
        const firstValue = first[state.sortKey];
        const secondValue = second[state.sortKey];
        const direction = state.sortDirection === "asc" ? 1 : -1;
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

function teamNameButton(team) {
    const tip = teamTips[teamKey(team)];
    return `
        <span class="team-name">
            <button class="team-link" type="button" data-team-slug="${escapeHtml(team.slug)}">
                <strong>${escapeHtml(team.team)}</strong>
            </button>
            ${tip ? `<sup class="team-note-mark" data-tip="${tip}" tabindex="0">*</sup>` : ""}
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
    const playedMatches = document.querySelector("#played-matches");
    const matchProgressFill = document.querySelector("#match-progress-fill");
    const played = Number(forecastMeta.playedMatches || 0);
    const total = Number(forecastMeta.totalMatches || 380);
    const progress = total > 0 ? Math.max(0, Math.min(100, (played / total) * 100)) : 0;

    playedMatches.textContent = `${formatInteger(played)}/${formatInteger(total)}`;
    matchProgressFill.style.width = `${progress}%`;}

function renderTable() {
    if (!teams.length) {
        tableBody.innerHTML = `<tr><td colspan="9">Brak danych prognozy. Uruchom generator Monte Carlo.</td></tr>`;
        return;
    }

    document.querySelectorAll("th button[data-sort]").forEach(button => {
        const header = button.parentElement;
        if (button.dataset.sort === state.sortKey) {
            header.setAttribute("aria-sort", state.sortDirection === "asc" ? "ascending" : "descending");
        } else {
            header.removeAttribute("aria-sort");
        }
    });

    const rows = sortTeams(teams);
    tableBody.innerHTML = rows.map(team => `
        <tr class="${team.rank >= 18 ? "relegation-row" : ""}">
            <td class="rank-cell">${team.rank}</td>
            <td class="team-cell">
                <div class="team-entry">
                    ${createLogo(team)}
                    ${teamNameButton(team)}
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

const formLabels = {
    win: { letter: "Z", label: "Zwycięstwo" },
    draw: { letter: "R", label: "Remis" },
    loss: { letter: "P", label: "Porażka" }
};

function matchesForTeam(slug) {
    return results.filter(match => match.homeSlug === slug || match.awaySlug === slug);
}

function matchOutcomeForTeam(match, slug) {
    const isHome = match.homeSlug === slug;
    return match.outcome === "draw" ? "draw" : (match.outcome === "home") === isHome ? "win" : "loss";
}

function nextFixtureForTeam(slug) {
    return upcomingFixtures.find(match => match.homeSlug === slug || match.awaySlug === slug);
}

function recentForm(slug, count = 5) {
    return results
        .filter(match => match.homeSlug === slug || match.awaySlug === slug)
        .slice(-count)
        .map(match => {
            const isHome = match.homeSlug === slug;
            const outcome = match.outcome === "draw" ? "draw" : (match.outcome === "home") === isHome ? "win" : "loss";
            const { letter, label } = formLabels[outcome];
            const detail = `Kolejka ${match.round}: ${match.homeTeam} ${match.homeGoals}-${match.awayGoals} ${match.awayTeam} (${label})`;
            return `<span class="form-badge is-${outcome}" title="${escapeHtml(detail)}">${letter}</span>`;
        })
        .join("");
}

function fixtureTeam(name, slug, isAway) {
    const position = standings.find(team => team.slug === slug)?.rank;
    const form = recentForm(slug);
    return `
        <div class="fixture-team ${isAway ? "is-away" : ""}">
            ${isAway ? "" : createLogo({ slug })}
            <div class="fixture-team-info">
                <div class="fixture-team-name">
                    <strong>${escapeHtml(name)}</strong>
                    ${position ? `<span class="team-position" title="Pozycja w tabeli">${position}.</span>` : ""}
                </div>
                ${form ? `<div class="team-form" aria-label="Ostatnie mecze">${form}</div>` : ""}
            </div>
            ${isAway ? createLogo({ slug }) : ""}
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
                ${fixtureTeam(fixture.homeTeam, fixture.homeSlug, false)}
                <span class="versus">vs</span>
                ${fixtureTeam(fixture.awayTeam, fixture.awaySlug, true)}
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

    standingsBody.innerHTML = standings.map(team => `
        <tr class="${team.rank >= 18 ? "relegation-row" : ""}">
            <td class="rank-cell">${team.rank}</td>
            <td class="team-cell">
                <div class="team-entry">
                    ${createLogo(team)}
                    ${teamNameButton(team)}
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
                    ${teamNameButton(team)}
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

function metricByKey(key) {
    return metricConfigs.find(metric => metric.key === key);
}

function formatMetric(metric, value) {
    if (metric.percent) {
        return formatPercent(value);
    }
    return metric.key === "rank" ? `${Math.round(value)}.` : formatNumber(value);
}

function axisLabel(snapshot) {
    return snapshot.label.replace(/^Po (\d+)\. kolejce$/, "$1. kolejka");
}

function chartTeam(team) {
    return { key: teamKey(team), name: team.team, slug: team.slug, color: teamColors[teamKey(team)] };
}

function latestTeams() {
    const latestSnapshot = historySnapshots[historySnapshots.length - 1];
    return latestSnapshot ? [...latestSnapshot.teams].sort((first, second) => Number(first.rank) - Number(second.rank)) : [];
}

function teamsForMetric(metricKey) {
    return latestTeams()
        .sort((first, second) => Number(second[metricKey] || 0) - Number(first[metricKey] || 0))
        .slice(0, 5)
        .map(chartTeam);
}

function chartScale(metric, values) {
    if (metric.key === "rank") {
        return { min: 1, max: Math.max(20, ...values), invert: true };
    }
    if (metric.percent) {
        const maxObserved = Math.max(1, ...values);
        return { min: 0, max: Math.min(100, Math.max(10, Math.ceil(maxObserved / 10) * 10)) };
    }
    const low = Math.min(...values);
    const high = Math.max(...values);
    const step = high - low > 20 ? 10 : 5;
    const min = Math.floor(low / step) * step;
    return { min, max: Math.max(Math.ceil(high / step) * step, min + step) };
}

function chartPoint(index, count, value, scale, width, height, margin) {
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const x = count === 1 ? margin.left + plotWidth / 2 : margin.left + (index * plotWidth) / (count - 1);
    const share = (value - scale.min) / (scale.max - scale.min);
    const y = margin.top + (scale.invert ? share : 1 - share) * plotHeight;
    return { x, y };
}

const chartViews = new Map();

function renderChartCard(id, metric, teams, snapshots) {
    if (!snapshots.length) {
        return `<article class="chart-card"><p class="empty-state">Brak danych do wykresu.</p></article>`;
    }
    if (!teams.length) {
        return `<article class="chart-card"><p class="empty-state">Wybierz co najmniej jedną drużynę.</p></article>`;
    }

    chartViews.set(id, { metric, teams, snapshots });
    const width = 720;
    const height = 300;
    const margin = { top: 28, right: 28, bottom: 48, left: 48 };
    const scale = chartScale(metric, teams.flatMap(team => snapshots.map(snapshot => valueForTeam(snapshot, team.key, metric.key))));

    const lines = teams.map((team, teamIndex) => {
        const color = team.color || chartColors[teamIndex % chartColors.length];
        const pointsData = snapshots.map((snapshot, snapshotIndex) => chartPoint(snapshotIndex, snapshots.length, valueForTeam(snapshot, team.key, metric.key), scale, width, height, margin));
        const points = pointsData.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
        const dots = pointsData.map((point, snapshotIndex) => `<circle class="chart-dot" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4" fill="${color}" data-team="${teamIndex}" data-snapshot="${snapshotIndex}"></circle>`).join("");
        const finalPoint = pointsData[pointsData.length - 1];
        const logo = `<image class="chart-logo" href="assets/logos/${escapeHtml(team.slug)}.svg" x="${(finalPoint.x - 14).toFixed(1)}" y="${(finalPoint.y - 14).toFixed(1)}" width="28" height="28"></image>`;
        return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"></polyline>${dots}${logo}`;
    }).join("");

    // przy calym sezonie podpisy kolejek by na siebie nachodzily, wiec zostaje co n-ty
    const labelStep = Math.ceil(snapshots.length / 10);
    const labels = snapshots.map((snapshot, snapshotIndex) => {
        if (snapshotIndex % labelStep !== 0) {
            return "";
        }
        const point = chartPoint(snapshotIndex, snapshots.length, scale.min, scale, width, height, margin);
        return `<text x="${point.x.toFixed(1)}" y="${height - 16}" text-anchor="middle">${escapeHtml(axisLabel(snapshot))}</text>`;
    }).join("");

    const legend = teams.map((team, teamIndex) => `
        <span><img src="assets/logos/${escapeHtml(team.slug)}.svg" alt=""><i style="background:${team.color || chartColors[teamIndex % chartColors.length]}"></i>${escapeHtml(team.name)}</span>
    `).join("");

    return `
        <article class="chart-card" data-chart="${id}">
            <div class="chart-card-header">
                <h3>${escapeHtml(metric.label)}</h3>
            </div>
            <div class="chart-scroll">
            <svg class="trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(metric.label)}">
                <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" class="chart-axis"></line>
                <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" class="chart-axis"></line>
                <line x1="${margin.left}" y1="${margin.top}" x2="${width - margin.right}" y2="${margin.top}" class="chart-grid"></line>
                <text x="${margin.left - 8}" y="${margin.top + 4}" text-anchor="end">${formatMetric(metric, scale.invert ? scale.min : scale.max)}</text>
                <text x="${margin.left - 8}" y="${height - margin.bottom + 4}" text-anchor="end">${formatMetric(metric, scale.invert ? scale.max : scale.min)}</text>
                ${labels}
                ${lines}
            </svg>
            </div>
            <div class="chart-legend">${legend}</div>
            <div class="chart-tooltip" hidden></div>
        </article>
    `;
}

function renderCharts() {
    chartsBody.innerHTML = presetChartKeys.map(key => renderChartCard(key, metricByKey(key), teamsForMetric(key), historySnapshots)).join("");
}

function renderCustomChartControls() {
    const { metric, from, to, teams } = state.customChart;
    const snapshotOptions = selected => historySnapshots.map((snapshot, index) => `<option value="${index}" ${index === selected ? "selected" : ""}>${escapeHtml(axisLabel(snapshot))}</option>`).join("");
    customChartControls.innerHTML = `
        <label class="custom-chart-metric">Statystyka
            <select class="history-select" data-custom="metric">
                ${metricConfigs.map(item => `<option value="${item.key}" ${item.key === metric ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
            </select>
        </label>
        <label>Od<select class="history-select" data-custom="from">${snapshotOptions(from)}</select></label>
        <label>Do<select class="history-select" data-custom="to">${snapshotOptions(to)}</select></label>
        <div class="team-picker" role="group" aria-label="Drużyny na wykresie">
            ${latestTeams().map(team => `
                <button class="team-chip" type="button" data-team-key="${escapeHtml(teamKey(team))}" aria-pressed="${teams.includes(teamKey(team))}">
                    <img src="assets/logos/${escapeHtml(team.slug)}.svg" alt="">${escapeHtml(team.team)}
                </button>
            `).join("")}
        </div>
    `;
}

function renderCustomChart() {
    const { metric, from, to, teams } = state.customChart;
    const snapshots = historySnapshots.slice(Math.min(from, to), Math.max(from, to) + 1);
    const selectedTeams = latestTeams().filter(team => teams.includes(teamKey(team))).map(chartTeam);
    customChartView.innerHTML = renderChartCard("custom", metricByKey(metric), selectedTeams, snapshots);
    customChartDownload.disabled = !selectedTeams.length;
}

const logoDataUrls = new Map();

function logoDataUrl(href) {
    if (!logoDataUrls.has(href)) {
        // wykres zapisany jako obrazek nie pobiera zewnetrznych plikow, wiec herby musza byc wklejone w srodek
        logoDataUrls.set(href, fetch(href)
            .then(response => response.ok ? response.text() : Promise.reject())
            .then(text => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`)
            .catch(() => null));
    }
    return logoDataUrls.get(href);
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = src;
    });
}

async function exportChartSvg(svg, view) {
    const clone = svg.cloneNode(true);
    const sources = [...svg.querySelectorAll("*")];
    const properties = ["fill", "stroke", "stroke-width", "stroke-dasharray", "font-family", "font-size", "font-weight"];
    [...clone.querySelectorAll("*")].forEach((element, index) => {
        const computed = getComputedStyle(sources[index]);
        element.setAttribute("style", properties.map(property => `${property}:${computed.getPropertyValue(property)}`).join(";"));
    });
    await Promise.all([...clone.querySelectorAll("image")].map(async image => {
        const dataUrl = await logoDataUrl(image.getAttribute("href"));
        dataUrl ? image.setAttribute("href", dataUrl) : image.remove();
    }));

    const width = 720;
    const padding = 24;
    const font = "font-family:'Trebuchet MS',sans-serif;font-weight:900";
    const measure = document.createElement("canvas").getContext("2d");
    measure.font = "900 14px 'Trebuchet MS', sans-serif";
    let x = padding;
    let y = 380;
    const legend = [];
    for (const [index, team] of view.teams.entries()) {
        const itemWidth = 44 + measure.measureText(team.name).width + 18;
        if (x + itemWidth > width - padding && x > padding) {
            x = padding;
            y += 30;
        }
        const logo = await logoDataUrl(`assets/logos/${team.slug}.svg`);
        legend.push(`
            ${logo ? `<image href="${logo}" x="${x}" y="${y - 15}" width="20" height="20"></image>` : ""}
            <circle cx="${x + 31}" cy="${y - 5}" r="5" fill="${team.color || chartColors[index % chartColors.length]}"></circle>
            <text x="${x + 42}" y="${y}" style="${font};font-size:14px;fill:#69758b">${escapeHtml(team.name)}</text>
        `);
        x += itemWidth;
    }

    const first = view.snapshots[0];
    const last = view.snapshots[view.snapshots.length - 1];
    const title = `${view.metric.label}: ${axisLabel(first)} – ${axisLabel(last)}`;
    const height = y + 28;
    const content = [...clone.childNodes].map(node => new XMLSerializer().serializeToString(node)).join("");
    return {
        width,
        height,
        markup: `
            <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
                <rect width="${width}" height="${height}" fill="#ffffff"></rect>
                <text x="${padding}" y="38" style="${font};font-size:20px;fill:#240030">${escapeHtml(title)}</text>
                <g transform="translate(0 52)">${content}</g>
                ${legend.join("")}
            </svg>
        `
    };
}

async function downloadCustomChart() {
    const view = chartViews.get("custom");
    const svg = customChartView.querySelector("svg");
    if (!view || !svg) {
        return;
    }

    const { width, height, markup } = await exportChartSvg(svg, view);
    const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`);
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext("2d");
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, width, height);
    canvas.toBlob(blob => {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `wykres-${view.metric.key}.png`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }, "image/png");
}

function matchForSnapshot(snapshot, team) {
    const teamMatches = results.filter(match => match.homeSlug === team.slug || match.awaySlug === team.slug);
    if (String(snapshot.id).startsWith("round-")) {
        return teamMatches.find(match => Number(match.round) === Number(snapshot.playedRounds));
    }
    return teamMatches[teamMatches.length - 1];
}

function chartChangeHtml(team, snapshot, metric) {
    const previous = historySnapshots[historySnapshots.indexOf(snapshot) - 1];
    if (!previous) {
        return "";
    }
    const change = Math.round((valueForTeam(snapshot, team.key, metric.key) - valueForTeam(previous, team.key, metric.key)) * 10) / 10;
    const isGood = metric.lowerIsBetter ? change < 0 : change > 0;
    const className = change === 0 ? "is-flat" : isGood ? "is-good" : "is-bad";
    if (metric.key === "rank") {
        const places = Math.abs(Math.round(change));
        return `<em class="chart-tooltip-change ${className}">(${change < 0 ? `▲${places}` : change > 0 ? `▼${places}` : "bez zmian"})</em>`;
    }
    const text = metric.percent ? formatPercent(change) : formatNumber(change);
    return `<em class="chart-tooltip-change ${className}">(${change > 0 ? "+" : ""}${text})</em>`;
}

function chartTooltipHtml(team, snapshot, metric) {
    const value = `<div class="chart-tooltip-value"><i style="background:${team.color || chartColors[0]}"></i>${escapeHtml(metric.label)}: <strong>${formatMetric(metric, valueForTeam(snapshot, team.key, metric.key))}${chartChangeHtml(team, snapshot, metric)}</strong></div>`;
    const teamRow = `<div class="chart-tooltip-team"><img src="assets/logos/${escapeHtml(team.slug)}.svg" alt="">${escapeHtml(team.name)}</div>`;
    if (!Number(snapshot.playedMatches)) {
        return `<div class="chart-tooltip-head"><span>${escapeHtml(snapshot.label)}</span></div>${teamRow}${value}`;
    }

    const match = matchForSnapshot(snapshot, team);
    if (!match) {
        return `<div class="chart-tooltip-head"><span>${escapeHtml(snapshot.label)}</span></div>${teamRow}<p class="chart-tooltip-empty">Brak meczu w tej kolejce</p>${value}`;
    }

    const isHome = match.homeSlug === team.slug;
    const goalsFor = isHome ? match.homeGoals : match.awayGoals;
    const goalsAgainst = isHome ? match.awayGoals : match.homeGoals;
    const [outcomeLabel, outcomeClass] = goalsFor > goalsAgainst ? ["Wygrana", "is-win"] : goalsFor === goalsAgainst ? ["Remis", "is-draw"] : ["Porażka", "is-loss"];
    return `
        <div class="chart-tooltip-head"><span>Kolejka ${match.round}</span><b class="chart-tooltip-outcome ${outcomeClass}">${outcomeLabel}</b></div>
        <div class="chart-tooltip-match">
            <span class="${isHome ? "is-team" : ""}"><img src="assets/logos/${escapeHtml(match.homeSlug)}.svg" alt="">${escapeHtml(match.homeTeam)}</span>
            <strong>${match.homeGoals}-${match.awayGoals}</strong>
            <span class="${isHome ? "" : "is-team"}">${escapeHtml(match.awayTeam)}<img src="assets/logos/${escapeHtml(match.awaySlug)}.svg" alt=""></span>
        </div>
        ${value}
    `;
}

function showChartTooltip(dot) {
    const card = dot.closest(".chart-card");
    const tooltip = card.querySelector(".chart-tooltip");
    const view = chartViews.get(card.dataset.chart);
    tooltip.innerHTML = chartTooltipHtml(view.teams[Number(dot.dataset.team)], view.snapshots[Number(dot.dataset.snapshot)], view.metric);
    tooltip.hidden = false;

    const cardRect = card.getBoundingClientRect();
    const dotRect = dot.getBoundingClientRect();
    const dotX = dotRect.left + dotRect.width / 2 - cardRect.left;
    const dotY = dotRect.top + dotRect.height / 2 - cardRect.top;
    const halfWidth = tooltip.offsetWidth / 2;
    // dymek nie moze wyjsc poza karte wykresu, strzalka i tak wskazuje kropke
    const left = Math.min(Math.max(dotX, halfWidth + 8), cardRect.width - halfWidth - 8);
    tooltip.classList.toggle("is-below", dotY - tooltip.offsetHeight - 16 < 0);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${dotY}px`;
    tooltip.style.setProperty("--arrow-x", `${dotX - left + halfWidth}px`);
}

function showTip(target) {
    const [title, text] = tips[target.dataset.tip];
    tipBox.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span>`;
    tipBox.hidden = false;

    // dymek jest przypiety do okna, bo tabele przewijaja sie w poziomie i obcinalyby go
    const targetRect = target.getBoundingClientRect();
    const targetX = targetRect.left + targetRect.width / 2;
    const halfWidth = tipBox.offsetWidth / 2;
    const left = Math.min(Math.max(targetX, halfWidth + 8), window.innerWidth - halfWidth - 8);
    tipBox.style.left = `${left}px`;
    tipBox.style.top = `${targetRect.bottom}px`;
    tipBox.style.setProperty("--arrow-x", `${targetX - left + halfWidth}px`);
}

function hideTip() {
    tipBox.hidden = true;
}

function teamCardMatchesHtml(slug) {
    const matches = matchesForTeam(slug).slice(-5).reverse();
    if (!matches.length) {
        return `<p class="team-card-empty">Brak rozegranych meczów.</p>`;
    }

    return matches.map(match => {
        const isHome = match.homeSlug === slug;
        const outcome = matchOutcomeForTeam(match, slug);
        const { letter, label } = formLabels[outcome];
        const opponent = isHome ? match.awayTeam : match.homeTeam;
        const opponentSlug = isHome ? match.awaySlug : match.homeSlug;
        const goalsFor = isHome ? match.homeGoals : match.awayGoals;
        const goalsAgainst = isHome ? match.awayGoals : match.homeGoals;
        return `
            <div class="team-card-match">
                <span class="form-badge is-${outcome}" title="${escapeHtml(label)}">${letter}</span>
                <strong>${goalsFor}-${goalsAgainst}</strong>
                <span class="team-card-opponent">${createLogo({ slug: opponentSlug })}${escapeHtml(opponent)}</span>
                <span class="team-card-meta">K${match.round} · ${isHome ? "dom" : "wyjazd"}</span>
            </div>
        `;
    }).join("");
}

function teamCardFixtureHtml(slug) {
    const fixture = nextFixtureForTeam(slug);
    if (!fixture) {
        return `<p class="team-card-empty">Brak meczu w najbliższej kolejce.</p>`;
    }

    const isHome = fixture.homeSlug === slug;
    const opponent = isHome ? fixture.awayTeam : fixture.homeTeam;
    const opponentSlug = isHome ? fixture.awaySlug : fixture.homeSlug;
    const win = isHome ? fixture.homeWin : fixture.awayWin;
    const loss = isHome ? fixture.awayWin : fixture.homeWin;
    return `
        <div class="team-card-next">
            <div class="team-card-opponent">${createLogo({ slug: opponentSlug })}<strong>${escapeHtml(opponent)}</strong></div>
            <span class="team-card-meta">Kolejka ${fixture.round} · ${isHome ? "u siebie" : "na wyjeździe"}</span>
        </div>
        <div class="probability-grid">
            ${probabilityBlock("W", win, "home-win")}
            ${probabilityBlock("R", fixture.draw, "draw")}
            ${probabilityBlock("P", loss, "away-win")}
        </div>
    `;
}

function teamCardHtml(slug) {
    const forecast = teams.find(team => team.slug === slug);
    const current = standings.find(team => team.slug === slug);
    const name = forecast?.team || current?.team || slug;
    const tip = forecast ? teamTips[teamKey(forecast)] : "";
    const facts = [
        current ? `${current.rank}. w tabeli` : "",
        forecast ? `${forecast.rank}. w prognozie` : "",
        current ? `${current.wins}-${current.draws}-${current.losses}` : "",
        current ? `${current.pts} pkt` : ""
    ].filter(Boolean);

    return `
        <div class="team-card-head">
            ${createLogo({ slug })}
            <div>
                <h3>${escapeHtml(name)}${tip ? `<sup class="team-note-mark" data-tip="${tip}">*</sup>` : ""}</h3>
                ${facts.length ? `<p>${facts.map(escapeHtml).join(" · ")}</p>` : ""}
            </div>
        </div>
        ${forecast ? `
            <div class="team-card-chances">
                <span>Tytuł <strong>${formatPercent(forecast.title)}</strong></span>
                <span>Top 4 <strong>${formatPercent(forecast.top4)}</strong></span>
                <span>Spadek <strong>${formatPercent(forecast.relegation)}</strong></span>
                <span>xPts <strong>${formatNumber(forecast.xPts)}</strong></span>
            </div>
        ` : ""}
        <section>
            <h4>Ostatnie mecze</h4>
            ${teamCardMatchesHtml(slug)}
        </section>
        <section>
            <h4>Następny mecz</h4>
            ${teamCardFixtureHtml(slug)}
        </section>
    `;
}

function placeTeamCard(anchor) {
    const rect = anchor.getBoundingClientRect();
    const pad = 8;
    const width = teamCard.offsetWidth;
    const height = teamCard.offsetHeight;
    const left = Math.min(Math.max(rect.left, pad), window.innerWidth - width - pad);
    const below = rect.bottom + 8;
    const top = below + height > window.innerHeight - pad
        ? Math.max(pad, rect.top - height - 8)
        : below;
    teamCard.style.left = `${Math.max(pad, left)}px`;
    teamCard.style.top = `${top}px`;
}

function openTeamCard(slug, anchor, pinned) {
    clearTimeout(state.teamCardTimer);
    if (pinned) {
        state.teamCardPinned = true;
    }
    if (state.teamCardSlug !== slug) {
        state.teamCardSlug = slug;
        teamCard.innerHTML = teamCardHtml(slug);
    }
    teamCard.hidden = false;
    placeTeamCard(anchor);
}

function closeTeamCard() {
    clearTimeout(state.teamCardTimer);
    state.teamCardSlug = "";
    state.teamCardPinned = false;
    teamCard.hidden = true;
}

function scheduleCloseTeamCard() {
    if (!state.teamCardPinned) {
        state.teamCardTimer = setTimeout(closeTeamCard, 160);
    }
}

function hideChartTooltips() {
    chartsPanel.querySelectorAll(".chart-tooltip").forEach(tooltip => {
        tooltip.hidden = true;
    });
}

document.querySelectorAll("th button").forEach(button => {
    button.addEventListener("click", () => {
        const sortKey = button.dataset.sort;
        if (state.sortKey === sortKey) {
            state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
        } else {
            state.sortKey = sortKey;
            state.sortDirection = "desc";
        }
        renderTable();
    });
});

document.querySelectorAll(".tab-button").forEach(button => {
    button.addEventListener("click", () => {
        const tab = button.dataset.tab;
        document.querySelectorAll(".tab-button").forEach(item => item.classList.toggle("is-active", item === button));
        document.querySelectorAll(".tab-view").forEach(view => view.classList.toggle("is-active", view.dataset.view === tab));
        closeTeamCard();
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

customChartControls.addEventListener("change", event => {
    const field = event.target.dataset.custom;
    if (field) {
        state.customChart[field] = field === "metric" ? event.target.value : Number(event.target.value);
        renderCustomChart();
    }
});

customChartDownload.addEventListener("click", downloadCustomChart);

customChartControls.addEventListener("click", event => {
    const chip = event.target.closest(".team-chip");
    if (!chip) {
        return;
    }
    const key = chip.dataset.teamKey;
    const teams = state.customChart.teams;
    state.customChart.teams = teams.includes(key) ? teams.filter(item => item !== key) : [...teams, key];
    chip.setAttribute("aria-pressed", String(!teams.includes(key)));
    renderCustomChart();
});

chartsPanel.addEventListener("pointerover", event => {
    const dot = event.target.closest(".chart-dot");
    if (dot) {
        showChartTooltip(dot);
    }
});

chartsPanel.addEventListener("pointerout", event => {
    // na ekranie dotykowym dymek zostaje po puszczeniu palca i znika dopiero po dotknieciu obok
    if (event.pointerType !== "touch" && event.target.closest(".chart-dot")) {
        hideChartTooltips();
    }
});

document.addEventListener("pointerdown", event => {
    if (!event.target.closest(".chart-dot")) {
        hideChartTooltips();
    }
    if (!event.target.closest("[data-tip]")) {
        hideTip();
    }
    if (!event.target.closest(".team-link, #team-card")) {
        closeTeamCard();
    }
});

document.addEventListener("pointerover", event => {
    const target = event.target.closest("[data-tip]");
    if (target) {
        showTip(target);
    }
    const link = event.target.closest(".team-link");
    if (event.pointerType !== "touch" && link) {
        openTeamCard(link.dataset.teamSlug, link, false);
    } else if (event.target.closest("#team-card")) {
        clearTimeout(state.teamCardTimer);
    }
});

document.addEventListener("pointerout", event => {
    const target = event.target.closest("[data-tip]");
    if (event.pointerType !== "touch" && target && !target.contains(event.relatedTarget)) {
        hideTip();
    }
    const fromTeam = event.target.closest(".team-link, #team-card");
    if (event.pointerType !== "touch" && fromTeam && !event.relatedTarget?.closest(".team-link, #team-card")) {
        scheduleCloseTeamCard();
    }
});

document.addEventListener("click", event => {
    const link = event.target.closest(".team-link");
    if (link) {
        openTeamCard(link.dataset.teamSlug, link, true);
    }
});

document.addEventListener("focusin", event => {
    const target = event.target.closest("[data-tip]");
    if (target) {
        showTip(target);
    } else {
        hideTip();
    }
});

document.addEventListener("scroll", () => {
    hideTip();
    closeTeamCard();
}, true);

document.addEventListener("keydown", event => {
    if (event.key !== "Escape") {
        return;
    }
    if (!teamCard.hidden) {
        closeTeamCard();
        return;
    }
    if (!randomSimulationModal.hidden) {
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
renderCustomChartControls();
renderCustomChart();
renderCharts();
