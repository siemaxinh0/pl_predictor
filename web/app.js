const state = {
    sortKey: "rank",
    sortDirection: "asc",
    historyIndex: 0,
    resultsRounds: 2,
    upcomingRounds: 2,
    teamCardSlug: "",
    teamCardTimer: 0
};

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
    simGoalDiff: ["Różnica bramek", "Gole strzelone minus stracone w tej jednej symulacji."]
};
Object.entries(teamNotes).forEach(([key, note]) => {
    tips[`note:${key}`] = note;
});

function teamTip(team) {
    return teamNotes[teamKey(team)] ? escapeHtml(`note:${teamKey(team)}`) : "";
}

const tableBody = document.querySelector("#table-body");
const standingsBody = document.querySelector("#standings-body");
const resultsBody = document.querySelector("#results-body");
const resultsActions = document.querySelector("#results-actions");
const upcomingBody = document.querySelector("#upcoming-body");
const upcomingActions = document.querySelector("#upcoming-actions");
const historySelect = document.querySelector("#history-select");
const historyBody = document.querySelector("#history-body");
const historyTitle = document.querySelector("#history-title");
const chartsPanel = document.querySelector("[data-view='charts']");
const chartsBody = document.querySelector("#charts-body");
const customChartControls = document.querySelector("#custom-chart-controls");
const customChartView = document.querySelector("#custom-chart-view");
const customChartDownload = document.querySelector("#custom-chart-download");
const randomSimulationButton = document.querySelector("#random-simulation-button");
const tableDownload = document.querySelector("#table-download");
const randomSimulationModal = document.querySelector("#random-simulation-modal");
const randomSimulationTitle = document.querySelector("#random-simulation-title");
const randomSimulationBody = document.querySelector("#random-simulation-body");
const hideRandomSimulationButton = document.querySelector("#hide-random-simulation");
const tipBox = document.querySelector("#tip-box");
const teamCard = document.querySelector("#team-card");

state.historyIndex = Math.max(historySnapshots.length - 1, 0);
state.customChart = {
    metric: "title",
    from: 0,
    to: state.historyIndex,
    teams: latestTeams().slice(0, 4).map(teamKey)
};

function sortTeams(rows) {
    return [...rows].sort((first, second) => {
        const firstValue = first[state.sortKey];
        const secondValue = second[state.sortKey];
        const direction = state.sortDirection === "asc" ? 1 : -1;
        return (firstValue - secondValue) * direction;
    });
}

function teamNameLink(team, { showNote = true } = {}) {
    const tip = showNote ? teamTip(team) : "";
    return `
        <span class="team-name">
            <a class="team-link" href="${teamPageUrl(team.slug)}" data-team-slug="${escapeHtml(team.slug)}">
                <strong>${escapeHtml(team.team)}</strong>
            </a>
            ${tip ? `<sup class="team-note-mark" data-tip="${tip}" tabindex="0">*</sup>` : ""}
        </span>
    `;
}

const chanceSubjects = {
    title: { name: "Mistrzostwo", certain: "pewne", impossible: "niemożliwe", possible: "możliwe" },
    top4: { name: "Miejsce w Top 4", certain: "pewne", impossible: "niemożliwe", possible: "możliwe" },
    relegation: { name: "Spadek", certain: "pewny", impossible: "niemożliwy", possible: "możliwy" }
};

function chanceStatusText(team, key) {
    const status = chanceStatus(team, key);
    const subject = chanceSubjects[key];
    const value = Number(team[key] || 0);
    if (status) {
        return [`${subject.name} jest już matematycznie ${subject[status]}.`, "decided"];
    }
    if (value < 0.05) {
        return [`${subject.name} jest wciąż matematycznie ${subject.possible}.`, "open"];
    }
    return value >= 99.95 ? [`${subject.name} nie jest jeszcze matematycznie ${subject.certain}.`, "open"] : ["", ""];
}

function renderPercent(team, key, simulations) {
    const status = chanceStatus(team, key);
    const count = `${formatInteger(team[`${key}Count`])} z ${formatInteger(simulations)} symulacji`;
    const [statusText, tone] = chanceStatusText(team, key);
    return `
        <button class="percent-detail ${status ? "is-certain" : ""}" type="button" data-tip="chance" data-tip-title="${escapeHtml(tips[key][0])}" data-tip-text="${escapeHtml(count)}" data-tip-status="${escapeHtml(statusText)}" data-tip-tone="${tone}" aria-label="${escapeHtml(`${tips[key][0]}: ${count}. ${statusText}`)}">
            ${formatChance(team, key)}
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
    matchProgressFill.style.width = `${progress}%`;

    const updated = forecastUpdatedText();
    document.querySelector("#table-meta").innerHTML = [
        forecastMeta.simulations ? `<span><strong>${formatInteger(forecastMeta.simulations)}</strong> symulacji</span>` : "",
        updated ? `<span>Aktualizacja: <strong>${updated}</strong></span>` : ""
    ].filter(Boolean).join("");
}

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
                    ${teamNameLink(team)}
                </div>
            </td>
            <td class="xpts-cell"><strong>${formatNumber(team.xPts)}</strong></td>
            <td>${formatNumber(team.xGF)}</td>
            <td>${formatNumber(team.xGA)}</td>
            <td class="${team.xGD >= 0 ? "positive" : "negative"}">${formatNumber(team.xGD)}</td>
            <td class="title-prob">${renderPercent(team, "title", forecastMeta.simulations)}</td>
            <td>${renderPercent(team, "top4", forecastMeta.simulations)}</td>
            <td class="relegation-prob">${renderPercent(team, "relegation", forecastMeta.simulations)}</td>
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

function nextFixtureForTeam(slug) {
    return remainingFixtures.find(match => match.homeSlug === slug || match.awaySlug === slug);
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

function fixtureTeamLink(name, slug) {
    return `<a class="team-link" href="${teamPageUrl(slug)}" data-team-slug="${escapeHtml(slug)}"><strong>${escapeHtml(name)}</strong></a>`;
}

function fixtureTeam(name, slug, isAway) {
    const position = standings.find(team => team.slug === slug)?.rank;
    const form = recentForm(slug);
    return `
        <div class="fixture-team ${isAway ? "is-away" : ""}">
            ${isAway ? "" : createLogo({ slug })}
            <div class="fixture-team-info">
                <div class="fixture-team-name">
                    ${fixtureTeamLink(name, slug)}
                    ${position ? `<span class="team-position" title="Pozycja w tabeli">${position}.</span>` : ""}
                </div>
                ${form ? `<div class="team-form" aria-label="Ostatnie mecze">${form}</div>` : ""}
            </div>
            ${isAway ? createLogo({ slug }) : ""}
        </div>
    `;
}

function renderUpcomingFixtures() {
    const rounds = [...new Set(remainingFixtures.map(fixture => Number(fixture.round)))];
    if (!rounds.length) {
        upcomingBody.innerHTML = `<p class="empty-state">Brak nierozgranych meczów w terminarzu.</p>`;
        upcomingActions.innerHTML = "";
        return;
    }

    upcomingBody.innerHTML = rounds.slice(0, state.upcomingRounds).map(round => `
        <section class="upcoming-round">
            <h2>Kolejka ${round}</h2>
            <div class="fixtures-grid">
                ${remainingFixtures.filter(fixture => Number(fixture.round) === round).map(fixtureCard).join("")}
            </div>
        </section>
    `).join("");

    upcomingActions.innerHTML = state.upcomingRounds < rounds.length ? `<button class="action-button" type="button" data-upcoming="more">Pokaż kolejne kolejki</button>` : "";
}

function fixtureCard(fixture) {
    return `
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
    `;
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
                    ${teamNameLink(team, { showNote: false })}
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

function renderResults() {
    const rounds = [...new Set(results.map(match => Number(match.round)))].sort((first, second) => second - first);
    if (!rounds.length) {
        resultsBody.innerHTML = `<p class="empty-state">Żaden mecz sezonu nie ma jeszcze wyniku.</p>`;
        resultsActions.innerHTML = "";
        return;
    }

    resultsBody.innerHTML = rounds.slice(0, state.resultsRounds).map(round => `
        <section class="upcoming-round">
            <h2>Kolejka ${round}</h2>
            <div class="fixtures-grid">
                ${results.filter(match => Number(match.round) === round).map(resultCard).join("")}
            </div>
        </section>
    `).join("");

    resultsActions.innerHTML = state.resultsRounds < rounds.length ? `<button class="action-button" type="button" data-results="more">Pokaż wcześniejsze kolejki</button>` : "";
}

function resultCard(match) {
    return `
        <article class="fixture-card result-card">
            <div class="fixture-teams">
                <div class="fixture-team">
                    ${createLogo({ slug: match.homeSlug })}
                    ${fixtureTeamLink(match.homeTeam, match.homeSlug)}
                </div>
                <span class="result-score">${match.homeGoals}-${match.awayGoals}</span>
                <div class="fixture-team is-away">
                    ${fixtureTeamLink(match.awayTeam, match.awaySlug)}
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
    `;
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
                    ${teamNameLink(team)}
                </div>
            </td>
            <td class="xpts-cell"><strong>${formatNumber(team.xPts)}</strong></td>
            <td>${formatNumber(team.xGF)}</td>
            <td>${formatNumber(team.xGA)}</td>
            <td class="${team.xGD >= 0 ? "positive" : "negative"}">${formatNumber(team.xGD)}</td>
            <td class="title-prob">${renderPercent(team, "title", snapshot.simulations)}</td>
            <td>${renderPercent(team, "top4", snapshot.simulations)}</td>
            <td class="relegation-prob">${renderPercent(team, "relegation", snapshot.simulations)}</td>
        </tr>
    `).join("");
}

function renderHistory() {
    renderHistoryControls();
    renderHistoryTable();
}

function teamsForMetric(metricKey) {
    return latestTeams()
        .sort((first, second) => Number(second[metricKey] || 0) - Number(first[metricKey] || 0))
        .slice(0, 5)
        .map(chartTeam);
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

const tableExportZones = [
    { label: "Top 4", color: "#e2f5ff", border: "#72d7ff", test: rank => rank <= 4 },
    { label: "Spadek", color: "#fff0f4", border: "#e94091", test: rank => rank >= 18 }
];

async function tableCanvas(withCrests) {
    const width = 1080;
    const height = 1350;
    const pad = 48;
    const { canvas, context } = createExportCanvas(width, height, 2);
    const rows = [...teams].sort((first, second) => first.rank - second.rank);
    const crests = withCrests ? await Promise.all(rows.map(team => loadExportImage(`assets/logos/${team.slug}.svg`))) : [];
    context.font = `700 14px ${exportBodyFont}`;
    const notes = rows.filter(team => teamNotes[teamKey(team)]).map((team, index) => {
        const note = teamNotes[teamKey(team)];
        const lines = wrapText(context, note[1], width - 2 * pad - 72);
        return { team, mark: "*".repeat(index + 1), title: note[0], lines, height: 50 + lines.length * 20 + 12 };
    });
    const notesTop = height - 26 - notes.reduce((sum, note) => sum + note.height + 12, 0) + (notes.length ? 12 : 0);

    context.textBaseline = "alphabetic";
    context.fillStyle = "#240030";
    context.font = `700 46px ${exportDisplayFont}`;
    context.fillText("Przewidywana tabela", pad, 82);
    context.fillStyle = "#6a37a8";
    context.font = `700 19px ${exportBodyFont}`;
    context.fillText(exportMetaText(), pad, 116);
    drawExportBrand(context, width, pad, 70);

    const columns = [
        { label: "#", width: 40 },
        { label: "Drużyna", width: 312, align: "left" },
        { label: "xPts", width: 86 },
        { label: "xGF", width: 78 },
        { label: "xGA", width: 78 },
        { label: "xGD", width: 78 },
        { label: "Tytuł", width: 104, percent: "title", fill: "rgba(106, 55, 168, 0.28)" },
        { label: "Top 4", width: 104, percent: "top4", fill: "rgba(114, 215, 255, 0.6)" },
        { label: "Spadek", width: 104, percent: "relegation", fill: "rgba(233, 64, 145, 0.32)" }
    ];
    let columnX = pad;
    columns.forEach(column => {
        column.x = columnX;
        columnX += column.width;
    });

    const tableTop = 146;
    const headerHeight = 40;
    const rowHeight = Math.min(56, Math.floor((notesTop - 22 - tableTop - 8 - headerHeight) / rows.length));
    const tableHeight = headerHeight + rows.length * rowHeight;
    const tablePanel = new Path2D();
    tablePanel.roundRect(pad - 12, tableTop, width - 2 * pad + 24, tableHeight + 8, 12);
    context.fillStyle = "#ffffff";
    context.fill(tablePanel);
    context.save();
    context.clip(tablePanel);
    rows.forEach((team, index) => {
        const zone = tableExportZones.find(item => item.test(team.rank));
        if (zone) {
            context.fillStyle = zone.color;
            context.fillRect(pad - 12, tableTop + headerHeight + index * rowHeight, width - 2 * pad + 24, rowHeight);
        }
    });
    context.restore();
    context.strokeStyle = "#c9e2f4";
    context.lineWidth = 1;
    context.stroke(tablePanel);

    context.font = `700 13px ${exportBodyFont}`;
    context.fillStyle = "#69758b";
    columns.forEach(column => {
        context.textAlign = column.align || "center";
        const x = column.align === "left" ? column.x : column.x + column.width / 2;
        context.fillText(column.label.toUpperCase(), x, tableTop + 26);
    });

    rows.forEach((team, index) => {
        const top = tableTop + headerHeight + index * rowHeight;
        const middle = top + rowHeight / 2;
        context.fillStyle = "#e3eef7";
        context.fillRect(pad - 12, top, width - 2 * pad + 24, 1);

        context.textAlign = "center";
        context.fillStyle = "#240030";
        context.font = `700 17px ${exportDisplayFont}`;
        context.fillText(String(team.rank), columns[0].x + columns[0].width / 2, middle + 6);

        const teamColumn = columns[1];
        const crest = crests[index];
        if (crest) {
            drawContainedImage(context, crest, teamColumn.x, middle - 16, 32);
        }
        const nameX = teamColumn.x + 44;
        context.textAlign = "left";
        context.fillStyle = "#240030";
        const note = notes.find(item => item.team === team);
        fillFittedText(context, team.team, nameX, middle + 6, teamColumn.width - 64, 18, 700, exportBodyFont);
        if (note) {
            const nameWidth = context.measureText(team.team).width;
            context.fillStyle = "#e94091";
            context.font = `700 18px ${exportBodyFont}`;
            context.fillText(note.mark, nameX + nameWidth + 3, middle + 1);
        }

        context.textAlign = "center";
        context.fillStyle = "#3d195b";
        context.font = `700 18px ${exportDisplayFont}`;
        context.fillText(formatNumber(team.xPts), columns[2].x + columns[2].width / 2, middle + 6);
        context.fillStyle = "#240030";
        context.font = `700 15px ${exportBodyFont}`;
        context.fillText(formatNumber(team.xGF), columns[3].x + columns[3].width / 2, middle + 5);
        context.fillText(formatNumber(team.xGA), columns[4].x + columns[4].width / 2, middle + 5);
        context.fillStyle = team.xGD >= 0 ? "#00a878" : "#c43f5f";
        context.fillText(`${team.xGD > 0 ? "+" : ""}${formatNumber(team.xGD)}`, columns[5].x + columns[5].width / 2, middle + 5);

        columns.filter(column => column.percent).forEach(column => {
            const value = Math.max(0, Math.min(100, Number(team[column.percent] || 0)));
            const barX = column.x + 8;
            const barWidth = column.width - 16;
            context.beginPath();
            context.roundRect(barX, middle - 14, barWidth, 28, 6);
            context.fillStyle = "rgba(61, 25, 91, 0.05)";
            context.fill();
            const fillWidth = (barWidth * value) / 100;
            if (fillWidth >= 2) {
                context.beginPath();
                context.roundRect(barX, middle - 14, fillWidth, 28, Math.min(6, fillWidth / 2));
                context.fillStyle = column.fill;
                context.fill();
            }
            const isCertain = Boolean(chanceStatus(team, column.percent));
            context.fillStyle = value > 0 || isCertain ? "#240030" : "#9aa3b5";
            context.font = `${isCertain ? 700 : 400} 15px ${exportBodyFont}`;
            context.fillText(formatChance(team, column.percent), column.x + column.width / 2, middle + 5);
        });
    });

    const legendBaseline = 116;
    context.textAlign = "left";
    context.font = `700 15px ${exportBodyFont}`;
    const legendWidth = tableExportZones.reduce((sum, zone) => sum + 22 + context.measureText(zone.label).width, 0) + 28 * (tableExportZones.length - 1);
    let legendX = width - pad - legendWidth;
    tableExportZones.forEach(zone => {
        context.beginPath();
        context.roundRect(legendX, legendBaseline - 12, 14, 14, 3);
        context.fillStyle = zone.color;
        context.fill();
        context.strokeStyle = zone.border;
        context.stroke();
        context.fillStyle = "#69758b";
        context.fillText(zone.label, legendX + 22, legendBaseline);
        legendX += 22 + context.measureText(zone.label).width + 28;
    });

    let footerY = notesTop;
    notes.forEach(({ mark, title, lines, height: boxHeight }) => {
        context.beginPath();
        context.roundRect(pad - 12, footerY, width - 2 * pad + 24, boxHeight, 12);
        context.fillStyle = "#ffffff";
        context.fill();
        context.strokeStyle = "rgba(233, 64, 145, 0.35)";
        context.stroke();

        context.fillStyle = "#e94091";
        context.font = `700 30px ${exportDisplayFont}`;
        context.fillText(mark, pad + 6, footerY + 42);
        context.fillStyle = "#240030";
        context.font = `700 17px ${exportBodyFont}`;
        context.fillText(`${title}.`, pad + 48, footerY + 32);
        context.fillStyle = "#69758b";
        context.font = `700 14px ${exportBodyFont}`;
        lines.forEach((line, index) => context.fillText(line, pad + 48, footerY + 56 + index * 20));
        footerY += boxHeight + 12;
    });

    return canvas;
}

async function downloadTable() {
    tableDownload.disabled = true;
    try {
        await downloadCanvasPng(tableCanvas, `przewidywana-tabela-${forecastMeta.snapshotId || "teraz"}.png`);
    } finally {
        tableDownload.disabled = false;
    }
}

function showTip(target) {
    const { tipTitle, tipText, tipStatus, tipTone } = target.dataset;
    const [title, text] = tipTitle ? [tipTitle, tipText] : tips[target.dataset.tip];
    tipBox.innerHTML = `
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(text)}</span>
        ${tipStatus ? `<span class="tip-status is-${tipTone}">${escapeHtml(tipStatus)}</span>` : ""}
    `;
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

function teamCardNextHtml(slug) {
    const fixture = nextFixtureForTeam(slug);
    if (!fixture) {
        return "";
    }
    const isHome = fixture.homeSlug === slug;
    const opponent = isHome ? fixture.awayTeam : fixture.homeTeam;
    return `<p class="team-card-next">Następny mecz: <strong>${escapeHtml(opponent)}</strong> (${isHome ? "dom" : "wyjazd"})</p>`;
}

function teamCardHtml(slug) {
    const forecast = teams.find(team => team.slug === slug);
    const current = standings.find(team => team.slug === slug);
    const name = forecast?.team || current?.team || slug;
    const tip = forecast ? teamTip(forecast) : "";
    const form = recentForm(slug);

    return `
        <div class="team-card-head">
            ${createLogo({ slug })}
            <div>
                <h3>${escapeHtml(name)}${tip ? `<sup class="team-note-mark" data-tip="${tip}">*</sup>` : ""}</h3>
                ${current ? `<p>${current.rank}. miejsce · ${current.pts} pkt</p>` : ""}
            </div>
            ${form ? `<div class="team-form" aria-label="Ostatnie mecze">${form}</div>` : ""}
        </div>
        ${forecast ? `
            <div class="team-card-chances">
                ${[["Tytuł", "title"], ["Top 4", "top4"], ["Spadek", "relegation"]].map(([label, key]) => `
                    <span>${label} <strong class="${chanceStatus(forecast, key) ? "is-certain" : ""}">${formatChance(forecast, key)}</strong></span>
                `).join("")}
            </div>
        ` : ""}
        ${teamCardNextHtml(slug)}
        <a class="team-card-link" href="${teamPageUrl(slug)}">Pełne statystyki →</a>
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

function openTeamCard(slug, anchor) {
    clearTimeout(state.teamCardTimer);
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
    teamCard.hidden = true;
}

function scheduleCloseTeamCard() {
    clearTimeout(state.teamCardTimer);
    state.teamCardTimer = setTimeout(closeTeamCard, 160);
}

function scheduleOpenTeamCard(link) {
    clearTimeout(state.teamCardTimer);
    if (!teamCard.hidden && state.teamCardSlug === link.dataset.teamSlug) {
        return;
    }
    // przy przesuwaniu myszy przez tabele karta nie przebudowuje sie przy kazdej mijanej nazwie
    state.teamCardTimer = setTimeout(() => openTeamCard(link.dataset.teamSlug, link), teamCard.hidden ? 220 : 120);
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

upcomingActions.addEventListener("click", event => {
    if (!event.target.closest("[data-upcoming]")) {
        return;
    }
    state.upcomingRounds += 3;
    renderUpcomingFixtures();
});

historySelect.addEventListener("change", () => {
    state.historyIndex = Number(historySelect.value || 0);
    renderHistory();
});

resultsActions.addEventListener("click", event => {
    if (!event.target.closest("[data-results]")) {
        return;
    }
    state.resultsRounds += 3;
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
tableDownload.disabled = !teams.length;
tableDownload.addEventListener("click", downloadTable);

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

bindChartTooltips(chartsPanel);

document.addEventListener("pointerdown", event => {
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
        if (!link.contains(event.relatedTarget)) {
            scheduleOpenTeamCard(link);
        }
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

document.addEventListener("focusin", event => {
    const target = event.target.closest("[data-tip]");
    if (target) {
        showTip(target);
    } else {
        hideTip();
    }
});

document.addEventListener("scroll", event => {
    hideTip();
    if (!teamCard.contains(event.target)) {
        closeTeamCard();
    }
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
renderResults();
renderHistory();
renderCustomChartControls();
renderCustomChart();
renderCharts();
