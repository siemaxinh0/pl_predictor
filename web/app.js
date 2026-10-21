const forecastData = window.forecastData || { meta: {}, teams: [], upcomingFixtures: [], sampleTables: [] };
const forecastHistory = window.forecastHistory || { snapshots: [] };
const oddsData = window.oddsData || { meta: {}, odds: [] };
const forecastMeta = forecastData.meta || {};
const teams = forecastData.teams || [];
const standings = forecastData.standings || [];
const results = forecastData.results || [];
const upcomingFixtures = forecastData.upcomingFixtures || [];
const sampleTables = forecastData.sampleTables || [];
const oddsRows = oddsData.odds || [];
const oddsBookmakers = (oddsData.meta || {}).bookmakers || [...new Set(oddsRows.map(row => row.bookmaker))];

const outcomeKeys = ["home", "draw", "away"];
const outcomeLabels = { home: "1", draw: "X", away: "2" };

const state = {
    sortKey: "rank",
    sortDirection: "asc",
    historyIndex: 0,
    resultsRound: 0,
    bookmaker: oddsBookmakers[0] || ""
};

const metricConfigs = [
    { key: "title", countKey: "titleCount", label: "Szansa na tytuł", shortLabel: "Tytuł" },
    { key: "top4", countKey: "top4Count", label: "Szansa na Top 4", shortLabel: "Top 4" },
    { key: "relegation", countKey: "relegationCount", label: "Ryzyko spadku", shortLabel: "Spadek" }
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
    "Manchester City": "#6cabdd",
    "Man United": "#da291c",
    "Manchester United": "#da291c",
    "Newcastle": "#241f20",
    "Nott'm Forest": "#dd0000",
    "Nottingham Forest": "#dd0000",
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
const bookmakerSelect = document.querySelector("#bookmaker-select");
const bookmakerScoreboard = document.querySelector("#bookmaker-scoreboard");
const bookmakerBody = document.querySelector("#bookmaker-body");
const bookmakerTableWrap = document.querySelector("#bookmaker-table-wrap");
const bookmakerTitle = document.querySelector("#bookmaker-title");
const bookmakerBrand = document.querySelector("#bookmaker-brand");
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

function snapshotIdFromMeta(meta) {
    const playedMatches = Number(meta.playedMatches || 0);
    const playedRounds = Number(meta.playedRounds || 0);

    if (playedMatches === 0) {
        return "round-0";
    }

    if (playedRounds > 0) {
        return `round-${playedRounds}`;
    }

    return `current-${playedMatches}`;
}

function snapshotLabelFromMeta(meta) {
    const playedMatches = Number(meta.playedMatches || 0);
    const playedRounds = Number(meta.playedRounds || 0);

    if (playedMatches === 0) {
        return "Przed sezonem";
    }

    if (playedRounds > 0) {
        return `Po ${playedRounds}. kolejce`;
    }

    return `Aktualnie: ${playedMatches}/${meta.totalMatches || 380} meczów`;
}

function currentSnapshot() {
    return {
        id: snapshotIdFromMeta(forecastMeta),
        label: snapshotLabelFromMeta(forecastMeta),
        playedRounds: forecastMeta.playedRounds || 0,
        playedMatches: forecastMeta.playedMatches || 0,
        simulations: forecastMeta.simulations || 0,
        generatedAtUTC: forecastMeta.generatedAtUTC,
        teams: teams.map(team => ({
            rank: team.rank,
            teamKey: team.teamKey || team.team,
            team: team.team,
            slug: team.slug,
            initials: team.initials,
            xPts: team.xPts,
            xGF: team.xGF,
            xGA: team.xGA,
            xGD: team.xGD,
            title: team.title,
            top4: team.top4,
            relegation: team.relegation,
            titleCount: team.titleCount,
            top4Count: team.top4Count,
            relegationCount: team.relegationCount
        }))
    };
}

function buildTimelineSnapshots() {
    const snapshotMap = new Map();
    (forecastHistory.snapshots || []).forEach(snapshot => {
        if (snapshot && snapshot.id) {
            snapshotMap.set(snapshot.id, snapshot);
        }
    });

    if (teams.length) {
        const snapshot = currentSnapshot();
        snapshotMap.set(snapshot.id, snapshot);
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

function colorForTeam(team) {
    return teamColors[team.teamKey] || teamColors[team.key] || teamColors[team.team] || teamColors[team.name] || chartColors[0];
}

function renderPercentButton(percent, count, total, label) {
    const detail = `${label}: ${formatInteger(count)} z ${formatInteger(total)} symulacji`;
    return `
        <button class="percent-detail" type="button" title="${escapeHtml(detail)}" data-detail="${escapeHtml(detail)}" aria-label="${escapeHtml(detail)}">
            ${formatPercent(percent)}
        </button>
    `;
}

function renderCurrentPercent(team, percentKey, countKey, label) {
    const count = team[countKey] ?? Math.round((Number(team[percentKey] || 0) / 100) * Number(forecastMeta.simulations || 0));
    return renderPercentButton(team[percentKey], count, forecastMeta.simulations || 0, label);
}

function renderSnapshotPercent(team, snapshot, percentKey, countKey, label) {
    const count = team[countKey] ?? Math.round((Number(team[percentKey] || 0) / 100) * Number(snapshot.simulations || 0));
    return renderPercentButton(team[percentKey], count, snapshot.simulations || 0, label);
}

function renderMeta() {
    const lead = document.querySelector("#forecast-lead");
    const playedMatches = document.querySelector("#played-matches");
    const matchProgressFill = document.querySelector("#match-progress-fill");
    const matchProgressCaption = document.querySelector("#match-progress-caption");
    const played = Number(forecastMeta.playedMatches || 0);
    const total = Number(forecastMeta.totalMatches || 380);
    const progress = total > 0 ? Math.max(0, Math.min(100, (played / total) * 100)) : 0;

    if (lead) {
        lead.textContent = `Prognoza tabeli po ${forecastMeta.simulations || "?"} symulacjach sezonu, oparta na oczekiwanych golach i rozkładach wyników.`;
    }

    if (playedMatches) {
        playedMatches.textContent = `${formatInteger(played)}/${formatInteger(total)}`;
    }

    if (matchProgressFill) {
        matchProgressFill.style.width = `${progress}%`;
    }

    if (matchProgressCaption) {
        matchProgressCaption.textContent = `${formatInteger(played)} z ${formatInteger(total)} meczów Premier League zostało uwzględnionych jako fakty.`;
    }
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
            <td class="title-prob">${renderCurrentPercent(team, "title", "titleCount", "Tytuł")}</td>
            <td>${renderCurrentPercent(team, "top4", "top4Count", "Top 4")}</td>
            <td class="relegation-prob">${renderCurrentPercent(team, "relegation", "relegationCount", "Spadek")}</td>
        </tr>
    `).join("");
}

function showProbabilityDetail(detail) {
    return detail;
}

function handleProbabilityEvent(event) {
    const button = event.target.closest(".percent-detail");
    if (button) {
        showProbabilityDetail(button.dataset.detail);
    }
}

function renderRandomSimulation(sampleTable) {
    if (!randomSimulationModal || !randomSimulationBody || !randomSimulationTitle) {
        return;
    }

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
    hideRandomSimulationButton?.focus();
}

function closeRandomSimulation() {
    if (!randomSimulationModal) {
        return;
    }

    randomSimulationModal.hidden = true;
    document.body.classList.remove("modal-open");
    randomSimulationButton?.focus();
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

const oddsFields = { home: "oddsHome", draw: "oddsDraw", away: "oddsAway" };
const probFields = { home: "probHome", draw: "probDraw", away: "probAway" };

function bookmakerSlug(bookmaker) {
    return String(bookmaker || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "_default";
}

const bookmakerLabels = {
    betclic: "Betclic",
    bet365: "Bet365"
};

function formatBookmakerName(bookmaker) {
    const slug = bookmakerSlug(bookmaker);
    return bookmakerLabels[slug] || String(bookmaker || "Bukmacher");
}

function createBookmakerLogo(bookmaker, className = "") {
    const slug = bookmakerSlug(bookmaker);
    const label = formatBookmakerName(bookmaker);
    return `
        <span class="bookmaker-logo ${className}" aria-hidden="true">
            <img
                src="assets/logos/bookmakers/${escapeHtml(slug)}.svg"
                alt=""
                data-fallback="assets/logos/bookmakers/_default.svg"
                onerror="if (!this.dataset.fallbackUsed) { this.dataset.fallbackUsed = '1'; this.src = this.dataset.fallback; } else { this.classList.add('is-missing'); }"
            >
            <span class="sr-only">${escapeHtml(label)}</span>
        </span>
    `;
}

function renderBookmakerBrand(bookmaker) {
    if (!bookmakerBrand) {
        return;
    }
    bookmakerBrand.innerHTML = bookmaker
        ? createBookmakerLogo(bookmaker, "bookmaker-logo-large")
        : "";
}

function formatSigned(value) {
    const number = Number(value || 0);
    if (Math.abs(number) < 0.05) {
        return "0.0";
    }
    return `${number > 0 ? "+" : "-"}${Math.abs(number).toFixed(1)}`;
}

function formatBrier(value) {
    return Number(value || 0).toFixed(3);
}

function formatSignedBrier(value) {
    const number = Number(value || 0);
    if (Math.abs(number) < 0.0005) {
        return "0.000";
    }
    return `${number > 0 ? "+" : "-"}${Math.abs(number).toFixed(3)}`;
}

function averageOf(values) {
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function oddsForFixture(fixture, bookmaker = state.bookmaker) {
    if (!bookmaker) {
        return null;
    }
    return oddsRows.find(row => Number(row.fixture) === Number(fixture) && row.bookmaker === bookmaker) || null;
}

function modelProbabilities(match) {
    return { home: match.homeWin, draw: match.draw, away: match.awayWin };
}

function bookmakerProbabilities(odds) {
    return { home: odds.probHome, draw: odds.probDraw, away: odds.probAway };
}

// Brier: suma kwadratow roznic miedzy typem a rzeczywistoscia. Nizej znaczy lepiej.
// To regula wlasciwa, wiec nie da sie jej oszukac zawyzaniem pewnosci.
function brierScore(probabilities, outcome) {
    return outcomeKeys.reduce((total, key) => {
        const probability = Number(probabilities[key] || 0) / 100;
        const actual = key === outcome ? 1 : 0;
        return total + (probability - actual) ** 2;
    }, 0);
}

function closerToTruth(modelProbs, bookProbs, outcome) {
    const modelValue = Number(modelProbs[outcome] || 0);
    const bookValue = Number(bookProbs[outcome] || 0);
    const difference = modelValue - bookValue;
    if (Math.abs(difference) < 0.05) {
        return "tie";
    }
    return difference > 0 ? "model" : "book";
}

function renderOddsBlock(odds, modelProbs) {
    if (!odds) {
        return `<p class="odds-missing">Brak zebranych kursów dla tego meczu.</p>`;
    }

    const bookProbs = bookmakerProbabilities(odds);
    const cells = outcomeKeys.map(key => {
        const delta = Number(modelProbs[key] || 0) - Number(bookProbs[key] || 0);
        return `
            <div class="odds-cell">
                <span>${outcomeLabels[key]}</span>
                <b>${formatLambda(odds[oddsFields[key]])}</b>
                <strong>${formatPercent(bookProbs[key])}</strong>
                <em class="${delta >= 0 ? "positive" : "negative"}">${formatSigned(delta)}</em>
            </div>
        `;
    }).join("");

    return `
        <div class="odds-block">
            <div class="odds-head">
                ${createBookmakerLogo(odds.bookmaker, "bookmaker-logo-inline")}
                <span class="odds-head-meta">marża ${formatPercent(odds.margin)}</span>
            </div>
            <div class="odds-grid">${cells}</div>
            <p class="odds-legend">Kurs, szansa bez marży i różnica: model minus bukmacher.</p>
        </div>
    `;
}

function renderVerdict(match, odds) {
    if (!odds) {
        return "";
    }

    const modelValue = Number(modelProbabilities(match)[match.outcome] || 0);
    const bookValue = Number(bookmakerProbabilities(odds)[match.outcome] || 0);
    const difference = modelValue - bookValue;
    const isDraw = Math.abs(difference) < 0.05;
    const winnerClass = isDraw ? "is-tie" : (difference > 0 ? "is-model" : "is-book");
    const winnerLabel = isDraw ? "Remis" : (difference > 0 ? "Model" : "Bukmacher");

    return `
        <div class="verdict ${winnerClass}">
            <span>Bliżej prawdy</span>
            <strong>${winnerLabel}</strong>
            <em>Na wynik ${outcomeLabels[match.outcome]}: model ${formatPercent(modelValue)}, bukmacher ${formatPercent(bookValue)}</em>
        </div>
    `;
}

function comparisonMatches(bookmaker) {
    return results.reduce((rows, match) => {
        const odds = oddsForFixture(match.fixture, bookmaker);
        if (!odds) {
            return rows;
        }

        const modelProbs = modelProbabilities(match);
        const bookProbs = bookmakerProbabilities(odds);
        rows.push({
            round: Number(match.round),
            modelBrier: brierScore(modelProbs, match.outcome),
            bookBrier: brierScore(bookProbs, match.outcome),
            closer: closerToTruth(modelProbs, bookProbs, match.outcome)
        });
        return rows;
    }, []);
}

function comparisonByRound(rows) {
    const grouped = new Map();
    rows.forEach(row => {
        if (!grouped.has(row.round)) {
            grouped.set(row.round, []);
        }
        grouped.get(row.round).push(row);
    });

    return [...grouped.entries()]
        .sort((first, second) => first[0] - second[0])
        .map(([round, items]) => {
            const modelBrier = averageOf(items.map(item => item.modelBrier));
            const bookBrier = averageOf(items.map(item => item.bookBrier));
            return {
                round,
                matches: items.length,
                modelBrier,
                bookBrier,
                difference: bookBrier - modelBrier,
                modelCloser: items.filter(item => item.closer === "model").length,
                bookCloser: items.filter(item => item.closer === "book").length
            };
        });
}

function roundsAwaitingResults(bookmaker) {
    const playedFixtures = new Set(results.map(match => Number(match.fixture)));
    const rounds = oddsRows
        .filter(row => row.bookmaker === bookmaker && !playedFixtures.has(Number(row.fixture)))
        .map(row => Number(row.round))
        .filter(round => Number.isFinite(round));
    return [...new Set(rounds)].sort((first, second) => first - second);
}

function scoreboardCard(label, value, caption, extraClass = "") {
    return `
        <article class="scoreboard-card ${extraClass}">
            <span>${escapeHtml(label)}</span>
            <strong>${value}</strong>
            <em>${escapeHtml(caption)}</em>
        </article>
    `;
}

function renderBookmakerControls() {
    if (!bookmakerSelect) {
        return;
    }

    if (!oddsBookmakers.length) {
        bookmakerSelect.innerHTML = `<option>Brak zebranych kursów</option>`;
        bookmakerSelect.disabled = true;
        renderBookmakerBrand("");
        return;
    }

    bookmakerSelect.disabled = oddsBookmakers.length === 1;
    bookmakerSelect.innerHTML = oddsBookmakers
        .map(bookmaker => `<option value="${escapeHtml(bookmaker)}" ${bookmaker === state.bookmaker ? "selected" : ""}>${escapeHtml(formatBookmakerName(bookmaker))}</option>`)
        .join("");
    renderBookmakerBrand(state.bookmaker);
}

function renderBookmakerComparison() {
    if (!bookmakerBody || !bookmakerScoreboard) {
        return;
    }

    if (bookmakerTitle) {
        bookmakerTitle.textContent = state.bookmaker
            ? `Model kontra ${formatBookmakerName(state.bookmaker)}`
            : "Porównanie z bukmacherem";
    }

    const rows = comparisonMatches(state.bookmaker);
    const rounds = comparisonByRound(rows);

    if (!rounds.length) {
        const waiting = roundsAwaitingResults(state.bookmaker);
        const waitingNote = waiting.length
            ? `Kursy czekają już na ${waiting.length === 1 ? "kolejkę" : "kolejki"}: ${waiting.join(", ")}.`
            : "Najpierw uruchom agenta kursów, żeby zebrać kursy na nadchodzące mecze.";

        bookmakerScoreboard.innerHTML = "";
        if (bookmakerTableWrap) {
            bookmakerTableWrap.hidden = true;
        }
        bookmakerBody.innerHTML = "";
        bookmakerScoreboard.innerHTML = `
            <p class="empty-state empty-state-wide">
                Nie ma jeszcze rozegranej kolejki z zebranymi kursami. Agent zapisuje kursy tylko dla meczów
                nierozegranych, więc porównanie pojawi się po pierwszej kolejce rozegranej od momentu włączenia
                zbierania. ${escapeHtml(waitingNote)}
            </p>
        `;
        return;
    }

    if (bookmakerTableWrap) {
        bookmakerTableWrap.hidden = false;
    }

    const modelBrier = averageOf(rows.map(row => row.modelBrier));
    const bookBrier = averageOf(rows.map(row => row.bookBrier));
    const modelRoundWins = rounds.filter(round => round.difference > 0).length;
    const bookRoundWins = rounds.filter(round => round.difference < 0).length;
    const modelCloser = rows.filter(row => row.closer === "model").length;
    const bookCloser = rows.filter(row => row.closer === "book").length;
    const leaderLabel = modelBrier === bookBrier
        ? "Remis"
        : (modelBrier < bookBrier ? "Model" : "Bukmacher");
    const leaderClass = modelBrier === bookBrier
        ? "is-tie"
        : (modelBrier < bookBrier ? "is-model" : "is-book");

    bookmakerScoreboard.innerHTML = [
        scoreboardCard("Mecze porównane", formatInteger(rows.length), `Kolejki: ${rounds.map(round => round.round).join(", ")}`),
        scoreboardCard("Brier modelu", formatBrier(modelBrier), `Bliżej w meczach: ${modelCloser}/${rows.length}`, modelBrier <= bookBrier ? "is-better" : ""),
        scoreboardCard("Brier bukmachera", formatBrier(bookBrier), `Bliżej w meczach: ${bookCloser}/${rows.length}`, bookBrier < modelBrier ? "is-better" : ""),
        scoreboardCard("Prowadzi", leaderLabel, `Wygrane kolejki: ${modelRoundWins} - ${bookRoundWins}`, leaderClass)
    ].join("");

    bookmakerBody.innerHTML = rounds.map(round => {
        const isDraw = Math.abs(round.difference) < 0.0005;
        const winnerLabel = isDraw ? "Remis" : (round.difference > 0 ? "Model" : "Bukmacher");
        const winnerClass = isDraw ? "is-tie" : (round.difference > 0 ? "is-model" : "is-book");
        return `
            <tr>
                <td class="bookmaker-logo-cell">${createBookmakerLogo(state.bookmaker, "bookmaker-logo-table")}</td>
                <td class="rank-cell">${round.round}</td>
                <td>${round.matches}</td>
                <td class="${round.difference > 0 ? "positive" : ""}">${formatBrier(round.modelBrier)}</td>
                <td class="${round.difference < 0 ? "positive" : ""}">${formatBrier(round.bookBrier)}</td>
                <td class="${round.difference >= 0 ? "positive" : "negative"}">${formatSignedBrier(round.difference)}</td>
                <td>${round.modelCloser} - ${round.bookCloser}</td>
                <td><span class="verdict-badge ${winnerClass}">${winnerLabel}</span></td>
            </tr>
        `;
    }).join("");
}

function renderUpcomingFixtures() {
    if (!upcomingBody) {
        return;
    }

    const upcomingRound = document.querySelector("#upcoming-round");
    if (upcomingRound) {
        upcomingRound.textContent = forecastMeta.nextRound ? `Kolejka ${forecastMeta.nextRound}` : "Brak nadchodzących spotkań";
    }

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
            ${renderOddsBlock(oddsForFixture(fixture.fixture), modelProbabilities(fixture))}
        </article>
    `).join("");
}

function renderStandings() {
    if (!standingsBody) {
        return;
    }

    if (!standings.length) {
        standingsBody.innerHTML = `<tr><td colspan="10">Brak rozegranych meczów w tym sezonie.</td></tr>`;
        return;
    }

    if (standingsNote) {
        standingsNote.textContent = `Stan po ${formatInteger(forecastMeta.playedMatches || 0)} rozegranych meczach, sortowanie po punktach, różnicy bramek i golach zdobytych.`;
    }

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
    if (!resultsSelect) {
        return;
    }

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
    if (!resultsBody) {
        return;
    }

    if (!results.length) {
        if (resultsTitle) {
            resultsTitle.textContent = "Brak rozegranych meczów";
        }
        resultsBody.innerHTML = `<p class="empty-state">Żaden mecz sezonu nie ma jeszcze wyniku.</p>`;
        return;
    }

    if (resultsTitle) {
        resultsTitle.textContent = `Kolejka ${state.resultsRound}`;
    }

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
            ${renderOddsBlock(oddsForFixture(match.fixture), modelProbabilities(match))}
            ${renderVerdict(match, oddsForFixture(match.fixture))}
        </article>
    `).join("");
}

function renderResultsTab() {
    renderResultsControls();
    renderResults();
}

function renderHistoryControls() {
    if (!historySelect) {
        return;
    }

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
    if (!historyBody || !historyTitle) {
        return;
    }

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
            <td class="title-prob">${renderSnapshotPercent(team, snapshot, "title", "titleCount", "Tytuł")}</td>
            <td>${renderSnapshotPercent(team, snapshot, "top4", "top4Count", "Top 4")}</td>
            <td class="relegation-prob">${renderSnapshotPercent(team, snapshot, "relegation", "relegationCount", "Spadek")}</td>
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
        color: colorForTeam(team)
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
    if (!chartsBody) {
        return;
    }

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

if (tableBody) {
    tableBody.addEventListener("mouseover", handleProbabilityEvent);
    tableBody.addEventListener("click", handleProbabilityEvent);
    tableBody.addEventListener("focusin", handleProbabilityEvent);
}

if (historyBody) {
    historyBody.addEventListener("mouseover", handleProbabilityEvent);
    historyBody.addEventListener("click", handleProbabilityEvent);
    historyBody.addEventListener("focusin", handleProbabilityEvent);
}

if (historySelect) {
    historySelect.addEventListener("change", () => {
        state.historyIndex = Number(historySelect.value || 0);
        renderHistory();
    });
}

if (resultsSelect) {
    resultsSelect.addEventListener("change", () => {
        state.resultsRound = Number(resultsSelect.value || 0);
        renderResults();
    });
}

if (bookmakerSelect) {
    bookmakerSelect.addEventListener("change", () => {
        state.bookmaker = bookmakerSelect.value || "";
        renderBookmakerComparison();
        renderResults();
        renderUpcomingFixtures();
    });
}

if (randomSimulationButton) {
    randomSimulationButton.disabled = !sampleTables.length;
    randomSimulationButton.addEventListener("click", renderRandomSampleTable);
}

if (hideRandomSimulationButton) {
    hideRandomSimulationButton.addEventListener("click", closeRandomSimulation);
}

document.querySelectorAll("[data-random-close]").forEach(element => {
    element.addEventListener("click", closeRandomSimulation);
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && randomSimulationModal && !randomSimulationModal.hidden) {
        closeRandomSimulation();
    }
});

renderMeta();
renderTable();
renderStandings();
renderUpcomingFixtures();
renderResultsTab();
renderBookmakerControls();
renderBookmakerComparison();
renderHistory();
renderCharts();
