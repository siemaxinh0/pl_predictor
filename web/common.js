const forecastData = window.forecastData || { meta: {}, teams: [], upcomingFixtures: [], sampleTables: [] };
const forecastHistory = window.forecastHistory || { snapshots: [] };
const forecastMeta = forecastData.meta || {};
const teams = forecastData.teams || [];
const standings = forecastData.standings || [];
const results = forecastData.results || [];
const upcomingFixtures = forecastData.upcomingFixtures || [];
const remainingFixtures = forecastData.remainingFixtures || [];
const teamDetails = forecastData.teamDetails || {};
const leagueDetails = forecastData.leagueDetails || null;
const sampleTables = forecastData.sampleTables || [];
const exampleTables = forecastData.exampleTables || null;

const metricConfigs = [
    { key: "title", label: "Szansa na tytuł", percent: true },
    { key: "top4", label: "Szansa na Top 4", percent: true },
    { key: "relegation", label: "Ryzyko spadku", percent: true, lowerIsBetter: true },
    { key: "xPts", label: "Prognozowane punkty (xPts)" },
    { key: "xGD", label: "Prognozowana różnica bramek (xGD)" },
    { key: "xGF", label: "Prognozowane gole strzelone (xGF)" },
    { key: "xGA", label: "Prognozowane gole stracone (xGA)", lowerIsBetter: true },
    { key: "rank", label: "Prognozowane miejsce w tabeli", lowerIsBetter: true, position: true },
    { key: "avgRank", label: "Średnie miejsce w symulacjach", lowerIsBetter: true, position: true, decimals: 2 }
];

const teamNotes = {
    "Man City": ["Bez możliwej kary punktowej", "Prognoza zakłada, że Manchester City zachowa wszystkie zdobyte punkty. Ewentualne odjęcie punktów za naruszenie przepisów finansowych Premier League nie jest uwzględnione."]
};

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

function chanceStatus(team, key) {
    const best = Number(team?.bestPossibleRank);
    const worst = Number(team?.worstPossibleRank);
    const lastPlace = teams.length || 20;
    const zone = { title: [1, 1], top4: [1, 4], relegation: [lastPlace - 2, lastPlace] }[key];
    if (!best || !worst || !zone) {
        return "";
    }
    if (best >= zone[0] && worst <= zone[1]) {
        return "certain";
    }
    return worst < zone[0] || best > zone[1] ? "impossible" : "";
}

function formatChance(team, key) {
    const status = chanceStatus(team, key);
    const value = Number(team?.[key] || 0);
    if (status) {
        return status === "certain" ? "100%" : "0%";
    }
    if (value < 0.05) {
        return "~0%";
    }
    return value >= 99.95 ? "~100%" : formatPercent(value);
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

function teamPageUrl(slug) {
    return `team.html?club=${encodeURIComponent(slug)}`;
}

function matchPageUrl(fixture) {
    return `match.html?id=${encodeURIComponent(fixture)}`;
}

function createLogo(team) {
    return `
        <span class="crest" aria-hidden="true">
            <img src="assets/logos/${escapeHtml(team.slug)}.svg" alt="" onerror="this.classList.add('is-missing')">
        </span>
    `;
}

// herb obok nazwy klubu prowadzi tam gdzie nazwa, ale jest pomijany przy tabulacji, zeby nie dublowac linku
function teamCrestLink(slug, className = "") {
    return `<a class="crest-link ${className}" href="${teamPageUrl(slug)}" data-team-slug="${escapeHtml(slug)}" tabindex="-1" aria-hidden="true">${createLogo({ slug })}</a>`;
}

function probabilityBlock(label, value, className, extraClass = "", text = "") {
    const boundedValue = Math.max(0, Math.min(100, Number(value || 0)));
    return `
        <div class="probability ${className} ${extraClass}" style="--probability: ${boundedValue}%">
            <span>${label}</span>
            <strong>${text || formatPercent(boundedValue)}</strong>
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
    if (metric.decimals) {
        return Number(value || 0).toFixed(metric.decimals);
    }
    return metric.key === "rank" ? `${Math.round(value)}.` : formatNumber(value);
}

function formatAxisValue(metric, value) {
    return metric.position ? `${Math.round(value)}.` : formatMetric(metric, value);
}

function axisLabel(snapshot) {
    if (String(snapshot.id).startsWith("current-")) {
        return "Teraz";
    }
    return snapshot.label.replace(/^Po (\d+)\. kolejce$/, "$1. kolejka");
}

function chartTeam(team) {
    return { key: teamKey(team), name: team.team, slug: team.slug, color: teamColors[teamKey(team)] };
}

function latestTeams() {
    const latestSnapshot = historySnapshots[historySnapshots.length - 1];
    return latestSnapshot ? [...latestSnapshot.teams].sort((first, second) => Number(first.rank) - Number(second.rank)) : [];
}

function chartScale(metric, values) {
    if (metric.position) {
        const lastPosition = Math.max(teams.length, ...values);
        return {
            min: Math.max(1, Math.floor(Math.min(...values)) - 1),
            max: Math.min(lastPosition, Math.ceil(Math.max(...values)) + 1),
            invert: true
        };
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
                <text x="${margin.left - 8}" y="${margin.top + 4}" text-anchor="end">${formatAxisValue(metric, scale.invert ? scale.min : scale.max)}</text>
                <text x="${margin.left - 8}" y="${height - margin.bottom + 4}" text-anchor="end">${formatAxisValue(metric, scale.invert ? scale.max : scale.min)}</text>
                ${labels}
                ${lines}
            </svg>
            </div>
            <div class="chart-legend">${legend}</div>
            <div class="chart-tooltip" hidden></div>
        </article>
    `;
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
    const precision = 10 ** (metric.decimals || 1);
    const change = Math.round((valueForTeam(snapshot, team.key, metric.key) - valueForTeam(previous, team.key, metric.key)) * precision) / precision;
    const isGood = metric.lowerIsBetter ? change < 0 : change > 0;
    const className = change === 0 ? "is-flat" : isGood ? "is-good" : "is-bad";
    if (metric.key === "rank") {
        const places = Math.abs(Math.round(change));
        return `<em class="chart-tooltip-change ${className}">(${change < 0 ? `▲${places}` : change > 0 ? `▼${places}` : "bez zmian"})</em>`;
    }
    const text = metric.percent ? formatPercent(change) : metric.decimals ? change.toFixed(metric.decimals) : formatNumber(change);
    return `<em class="chart-tooltip-change ${className}">(${change > 0 ? "+" : ""}${text})</em>`;
}

function chartTooltipHtml(team, snapshot, metric) {
    const snapshotTeam = snapshot.teams.find(item => teamKey(item) === team.key);
    const valueText = metric.percent && snapshotTeam ? formatChance(snapshotTeam, metric.key) : formatMetric(metric, valueForTeam(snapshot, team.key, metric.key));
    const value = `<div class="chart-tooltip-value"><i style="background:${team.color || chartColors[0]}"></i>${escapeHtml(metric.label)}: <strong>${valueText}${chartChangeHtml(team, snapshot, metric)}</strong></div>`;
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
        ${tooltipMatchHtml(match, team.slug)}
        ${value}
    `;
}

function tooltipMatchHtml(match, slug) {
    const isHome = match.homeSlug === slug;
    return `
        <div class="chart-tooltip-match">
            <span class="${isHome ? "is-team" : ""}"><img src="assets/logos/${escapeHtml(match.homeSlug)}.svg" alt="">${escapeHtml(match.homeTeam)}</span>
            <strong>${match.homeGoals}-${match.awayGoals}</strong>
            <span class="${isHome ? "" : "is-team"}">${escapeHtml(match.awayTeam)}<img src="assets/logos/${escapeHtml(match.awaySlug)}.svg" alt=""></span>
        </div>
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

function hideChartTooltips() {
    document.querySelectorAll(".chart-card .chart-tooltip").forEach(tooltip => {
        tooltip.hidden = true;
    });
}

function bindChartTooltips(container) {
    container.addEventListener("pointerover", event => {
        const dot = event.target.closest(".chart-dot");
        if (dot) {
            showChartTooltip(dot);
        }
    });

    container.addEventListener("pointerout", event => {
        // na ekranie dotykowym dymek zostaje po puszczeniu palca i znika dopiero po dotknieciu obok
        if (event.pointerType !== "touch" && event.target.closest(".chart-dot")) {
            hideChartTooltips();
        }
    });

    document.addEventListener("pointerdown", event => {
        if (!event.target.closest(".chart-dot")) {
            hideChartTooltips();
        }
    });
}

const siteLabel = "siemaxinh0.github.io/pl_predictor";

function forecastUpdatedText(source = forecastMeta) {
    const generatedAt = source.generatedAtUTC ? new Date(source.generatedAtUTC) : null;
    return generatedAt && !Number.isNaN(generatedAt.getTime())
        ? new Intl.DateTimeFormat("pl-PL", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Warsaw" }).format(generatedAt)
        : "";
}

function exportMetaText(source = forecastMeta) {
    const updated = forecastUpdatedText(source);
    return [
        source.simulations ? `${formatInteger(source.simulations)} symulacji` : "",
        updated ? `Aktualizacja: ${updated}` : ""
    ].filter(Boolean).join("  ·  ");
}
const exportDisplayFont = `"Bahnschrift", "Aptos Display", sans-serif`;
const exportBodyFont = `"Trebuchet MS", "Aptos", sans-serif`;

function loadExportImage(src) {
    return new Promise(resolve => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = src;
    });
}

function drawContainedImage(context, image, x, y, size) {
    const ratio = image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 1;
    const width = ratio >= 1 ? size : size * ratio;
    const height = ratio >= 1 ? size / ratio : size;
    context.drawImage(image, x + (size - width) / 2, y + (size - height) / 2, width, height);
}

function fillFittedText(context, text, x, y, maxWidth, size, weight, family) {
    let fontSize = size;
    context.font = `${weight} ${fontSize}px ${family}`;
    while (fontSize > 9 && context.measureText(text).width > maxWidth) {
        fontSize -= 1;
        context.font = `${weight} ${fontSize}px ${family}`;
    }
    context.fillText(text, x, y);
}

function wrapText(context, text, maxWidth) {
    const lines = [];
    let line = "";
    text.split(" ").forEach(word => {
        const candidate = line ? `${line} ${word}` : word;
        if (line && context.measureText(candidate).width > maxWidth) {
            lines.push(line);
            line = word;
        } else {
            line = candidate;
        }
    });
    return line ? [...lines, line] : lines;
}

function mixColor(from, to, share) {
    return from.map((value, index) => value + (to[index] - value) * share);
}

// gradient z canvasu jest ditherowany i zamienia PNG w szum ważący ponad 1 MB, pasy w jednolitych kolorach ważą ułamek tego
function fillBands(context, width, y, height, colorAt) {
    const bandWidth = 5;
    for (let x = 0; x < width; x += bandWidth) {
        const [red, green, blue] = colorAt(x / width).map(Math.round);
        context.fillStyle = `rgb(${red}, ${green}, ${blue})`;
        context.fillRect(x, y, bandWidth, height);
    }
}

function createExportCanvas(width, height, scale) {
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext("2d");
    context.scale(scale, scale);

    fillBands(context, width, 0, height, share => {
        const glow = share < 0.55
            ? mixColor([114, 215, 255, 0.35], [233, 64, 145, 0.08], share / 0.55)
            : mixColor([233, 64, 145, 0.08], [233, 64, 145, 0], (share - 0.55) / 0.45);
        return mixColor([251, 253, 255, 1], [glow[0], glow[1], glow[2], 1], glow[3]);
    });
    fillBands(context, width, height - 10, 10, share => mixColor([61, 25, 91, 1], [233, 64, 145, 1], share));
    return { canvas, context };
}

function drawExportBrand(context, width, pad, y, withMeta = false) {
    context.textAlign = "right";
    context.fillStyle = "#3d195b";
    context.font = `700 20px ${exportDisplayFont}`;
    context.fillText(siteLabel, width - pad, y);
    if (withMeta) {
        context.fillStyle = "#69758b";
        context.font = `700 15px ${exportBodyFont}`;
        context.fillText(exportMetaText(), width - pad, y + 26);
    }
    context.textAlign = "left";
}

function canvasBlob(canvas) {
    return new Promise((resolve, reject) => {
        try {
            canvas.toBlob(resolve, "image/png");
        } catch (error) {
            reject(error);
        }
    });
}

async function downloadCanvasPng(drawCanvas, fileName) {
    let blob;
    try {
        blob = await canvasBlob(await drawCanvas(true));
    } catch {
        // strona otwarta z dysku (file://) blokuje zapis canvasu z narysowanymi herbami
        blob = await canvasBlob(await drawCanvas(false));
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
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

function fact(label, value, detail = "", className = "") {
    return `
        <div class="team-fact ${className}">
            <span>${label}</span>
            <strong>${value}</strong>
            ${detail ? `<small>${detail}</small>` : ""}
        </div>
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

const distCharts = new Map();

function distPanelHtml(chart) {
    if (!chart) {
        return "";
    }
    distCharts.set(chart.id, chart);
    const clickable = chart.columns.some(column => column.example);
    const columns = chart.columns.map((column, index) => `
        <div class="dist-col ${column.className} ${column.isCurrent ? "is-current" : ""}" title="${escapeHtml(column.tip)}"${column.example ? ` data-example="${chart.id}:${index}" role="button" tabindex="0"` : ""}>
            ${distBar(column.height, column.value)}
            <span class="dist-label">${column.label}</span>
        </div>
    `).join("");

    return `
        <section class="team-panel">
            <div class="table-toolbar panel-head">
                <h2>${chart.title}</h2>
                <button type="button" class="action-button action-button-secondary team-export" data-export-chart="${chart.id}">Zapisz PNG</button>
            </div>
            <div class="team-facts">${chart.facts.map(([label, value]) => fact(label, value)).join("")}</div>
            <div class="dist-scroll">
                <div class="dist-chart ${chart.chartClass || ""}">${columns}</div>
            </div>
            <div class="dist-legend">${chart.legend.map(([label, className]) => `<span class="${className}">${label}</span>`).join("")}</div>
            ${clickable ? `<p class="dist-hint">Kliknij słupek, żeby zobaczyć przykładową symulację z taką sytuacją.</p>` : ""}
        </section>
    `;
}

function exampleIndex(examples, offset) {
    const index = examples?.[offset];
    return index >= 0 && exampleTables?.tables[index] ? index : null;
}

function exampleTable(index) {
    const table = exampleTables.tables[index];
    const names = new Map(teams.map(team => [team.slug, team.team]));
    const rows = [];
    for (let offset = 0; offset < table.rows.length; offset += 4) {
        const [teamIndex, pts, gf, ga] = table.rows.slice(offset, offset + 4);
        const slug = exampleTables.teamSlugs[teamIndex];
        rows.push({ rank: rows.length + 1, team: names.get(slug) || slug, slug, pts, gf, ga, gd: gf - ga });
    }
    return { simulation: table.simulation, teams: rows };
}

const simulationModal = document.createElement("div");
simulationModal.className = "modal";
simulationModal.id = "random-simulation-modal";
simulationModal.hidden = true;
simulationModal.innerHTML = `
    <div class="modal-backdrop" data-random-close></div>
    <section class="random-simulation-modal" role="dialog" aria-modal="true" aria-labelledby="random-simulation-title">
        <div class="random-simulation-header">
            <div>
                <h3 id="random-simulation-title">Losowa symulacja</h3>
                <p class="simulation-caption" id="simulation-caption" hidden></p>
            </div>
            <button class="action-button action-button-secondary" id="hide-random-simulation" type="button" data-random-close>Zamknij</button>
        </div>
        <div class="table-wrap random-table-wrap">
            <table class="random-table">
                <thead>
                    <tr>
                        <th class="rank-col" data-tip="simPosition">#</th>
                        <th class="team-col">Drużyna</th>
                        <th data-tip="simPoints">Pts</th>
                        <th data-tip="simGoalsFor">GF</th>
                        <th data-tip="simGoalsAgainst">GA</th>
                        <th data-tip="simGoalDiff">GD</th>
                    </tr>
                </thead>
                <tbody id="random-simulation-body"></tbody>
            </table>
        </div>
    </section>
`;
document.body.append(simulationModal);
let simulationOpener = null;

function openSimulation(table, { caption = "", isHighlighted = () => false } = {}) {
    simulationModal.querySelector("#random-simulation-title").textContent = `Symulacja ${formatInteger(table.simulation)} z ${formatInteger(forecastMeta.simulations || sampleTables.length)}`;
    const captionElement = simulationModal.querySelector("#simulation-caption");
    captionElement.textContent = caption;
    captionElement.hidden = !caption;
    simulationModal.querySelector("#random-simulation-body").innerHTML = table.teams.map(team => `
        <tr class="${team.rank >= 18 ? "relegation-row" : ""} ${isHighlighted(team) ? "is-highlight" : ""}">
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
    simulationOpener = document.activeElement;
    simulationModal.hidden = false;
    document.body.classList.add("modal-open");
    simulationModal.querySelector("#hide-random-simulation").focus();
    simulationModal.querySelector(".random-table-wrap").scrollTop = 0;
    simulationModal.querySelector(".is-highlight")?.scrollIntoView({ block: "center" });
}

function closeSimulation() {
    if (simulationModal.hidden) {
        return;
    }
    simulationModal.hidden = true;
    document.body.classList.remove("modal-open");
    simulationOpener?.focus?.();
}

function openColumnExample(element) {
    const [chartId, columnIndex] = element.dataset.example.split(":");
    const example = distCharts.get(chartId)?.columns[Number(columnIndex)]?.example;
    if (example) {
        openSimulation(exampleTable(example.index), example);
    }
}

simulationModal.addEventListener("click", event => {
    if (event.target.closest("[data-random-close]")) {
        closeSimulation();
    }
});

document.addEventListener("click", event => {
    const column = event.target.closest(".dist-col[data-example]");
    if (column) {
        openColumnExample(column);
    }
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        closeSimulation();
        closeTeamCard();
    }
    const column = event.target.closest?.(".dist-col[data-example]");
    if (column && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        openColumnExample(column);
    }
});

function teamTip(team) {
    return teamNotes[teamKey(team)] ? escapeHtml(`note:${teamKey(team)}`) : "";
}

function fixtureTeamLink(name, slug) {
    return `<a class="team-link" href="${teamPageUrl(slug)}" data-team-slug="${escapeHtml(slug)}"><strong>${escapeHtml(name)}</strong></a>`;
}

function fixtureTeam(name, slug, isAway) {
    const position = standings.find(team => team.slug === slug)?.rank;
    const form = recentForm(slug);
    return `
        <div class="fixture-team ${isAway ? "is-away" : ""}">
            ${isAway ? "" : teamCrestLink(slug)}
            <div class="fixture-team-info">
                <div class="fixture-team-name">
                    ${fixtureTeamLink(name, slug)}
                    ${position ? `<span class="team-position" title="Pozycja w tabeli">${position}.</span>` : ""}
                </div>
                ${form ? `<div class="team-form" aria-label="Ostatnie mecze">${form}</div>` : ""}
            </div>
            ${isAway ? teamCrestLink(slug) : ""}
        </div>
    `;
}

// karta lub wiersz z data-match prowadzi do strony meczu, ale linki do klubow w srodku dzialaja po swojemu
document.addEventListener("click", event => {
    const target = event.target.closest("[data-match]");
    if (target && !event.target.closest("a, button") && !window.getSelection()?.toString()) {
        location.href = matchPageUrl(target.dataset.match);
    }
});

function nextFixtureForTeam(slug) {
    return remainingFixtures.find(match => match.homeSlug === slug || match.awaySlug === slug);
}

function formBadge(match, slug) {
    const outcome = matchOutcomeForTeam(match, slug);
    const { letter, label } = formLabels[outcome];
    const detail = `${label}: ${match.homeTeam} ${match.homeGoals}-${match.awayGoals} ${match.awayTeam}, kolejka ${match.round}`;
    return `<a class="form-badge is-${outcome}" href="${matchPageUrl(match.fixture)}" data-form-fixture="${match.fixture}" data-form-slug="${escapeHtml(slug)}" aria-label="${escapeHtml(detail)}">${letter}</a>`;
}

function recentForm(slug, count = 5) {
    return matchesForTeam(slug).slice(-count).map(match => formBadge(match, slug)).join("");
}

function formTooltipHtml(match, slug) {
    const side = teamSide(match, slug);
    const outcome = matchOutcomeForTeam(match, slug);
    const odds = ["win", "draw", "loss"].map(key => `
        <div class="team-odds form-tooltip-odd is-${key} ${key === outcome ? "is-actual" : ""}" style="--probability: ${side[key]}%">
            <span>${formLabels[key].label}</span>
            <strong>${formatPercent(side[key])}</strong>
        </div>
    `).join("");
    return `
        <div class="chart-tooltip-head"><span>Kolejka ${match.round} · ${side.isHome ? "dom" : "wyjazd"}</span><b class="chart-tooltip-outcome is-${outcome}">${formLabels[outcome].label}</b></div>
        ${tooltipMatchHtml(match, slug)}
        <div class="form-tooltip-caption">Szanse według modelu przed kolejką</div>
        <div class="form-tooltip-odds">${odds}</div>
        <div class="form-tooltip-more">Kliknij, żeby zobaczyć szczegóły meczu →</div>
    `;
}

const formTip = document.createElement("div");
formTip.className = "chart-tooltip form-tooltip form-tip";
formTip.setAttribute("role", "tooltip");
formTip.hidden = true;
document.body.append(formTip);

function showFormTip(badge) {
    const match = results.find(item => String(item.fixture) === badge.dataset.formFixture);
    if (!match) {
        return;
    }
    hideFormTip();
    badge.classList.add("is-active");
    formTip.innerHTML = formTooltipHtml(match, badge.dataset.formSlug);
    formTip.hidden = false;

    const rect = badge.getBoundingClientRect();
    const badgeX = rect.left + rect.width / 2;
    const halfWidth = formTip.offsetWidth / 2;
    const left = Math.min(Math.max(badgeX, halfWidth + 8), innerWidth - halfWidth - 8);
    const isBelow = rect.bottom + formTip.offsetHeight + 24 <= innerHeight;
    formTip.classList.toggle("is-below", isBelow);
    formTip.style.left = `${left}px`;
    formTip.style.top = `${isBelow ? rect.bottom : rect.top}px`;
    formTip.style.setProperty("--arrow-x", `${badgeX - left + halfWidth}px`);
}

function hideFormTip() {
    document.querySelectorAll(".form-badge.is-active").forEach(item => item.classList.remove("is-active"));
    formTip.hidden = true;
}

// na telefonie dotkniecie kafelka od razu otwiera mecz, wiec dymek pokazuje sie tylko pod myszka i przy tabulacji
document.addEventListener("pointerover", event => {
    const badge = event.target.closest("[data-form-fixture]");
    if (badge && event.pointerType !== "touch") {
        showFormTip(badge);
    }
});

document.addEventListener("pointerout", event => {
    if (event.target.closest("[data-form-fixture]")) {
        hideFormTip();
    }
});

document.addEventListener("focusin", event => {
    const badge = event.target.closest("[data-form-fixture]");
    if (badge) {
        showFormTip(badge);
    }
});

document.addEventListener("focusout", event => {
    if (event.target.closest("[data-form-fixture]")) {
        hideFormTip();
    }
});

document.addEventListener("scroll", hideFormTip, true);

const teamCard = document.createElement("div");
teamCard.className = "team-card";
teamCard.id = "team-card";
teamCard.setAttribute("role", "dialog");
teamCard.setAttribute("aria-label", "Karta drużyny");
teamCard.hidden = true;
document.body.append(teamCard);
const teamCardState = { slug: "", timer: 0 };

function teamCardNextHtml(slug) {
    const fixture = nextFixtureForTeam(slug);
    if (!fixture) {
        return "";
    }
    const isHome = fixture.homeSlug === slug;
    const opponent = isHome ? fixture.awayTeam : fixture.homeTeam;
    const opponentSlug = isHome ? fixture.awaySlug : fixture.homeSlug;
    const win = isHome ? fixture.homeWin : fixture.awayWin;
    return `
        <div class="team-card-section">
            <span class="team-card-label">Następny mecz · kolejka ${fixture.round}</span>
            <a class="team-card-match" href="${matchPageUrl(fixture.fixture)}" title="Szczegóły meczu">
                ${createLogo({ slug: opponentSlug })}
                <strong>${escapeHtml(opponent)}</strong>
                <span class="team-card-venue">${isHome ? "dom" : "wyjazd"}</span>
                <span class="team-card-win">wygrana <strong>${formatPercent(win)}</strong></span>
            </a>
        </div>
    `;
}

function teamCardHtml(slug) {
    const forecast = teams.find(team => team.slug === slug);
    const current = standings.find(team => team.slug === slug);
    const name = forecast?.team || current?.team || slug;
    const tip = forecast ? teamTip(forecast) : "";
    const form = recentForm(slug);
    const tags = [
        current ? `${current.rank}. miejsce` : "",
        current ? `${current.pts} pkt` : "",
        forecast ? `${formatNumber(forecast.xPts)} xPts` : ""
    ].filter(Boolean);

    return `
        <div class="team-card-head" style="--club: ${teamColors[forecast ? teamKey(forecast) : name] || "var(--sky)"}">
            ${createLogo({ slug })}
            <div class="team-card-title">
                <h3>${escapeHtml(name)}${tip ? `<sup class="team-note-mark" data-tip="${tip}">*</sup>` : ""}</h3>
                <div class="team-card-tags">${tags.map(tag => `<span>${tag}</span>`).join("")}</div>
            </div>
        </div>
        ${form ? `
            <div class="team-card-section team-card-row">
                <span class="team-card-label">Forma</span>
                <div class="team-form" aria-label="Ostatnie mecze">${form}</div>
            </div>
        ` : ""}
        ${forecast ? `
            <div class="team-card-chances">
                ${[["Tytuł", "title"], ["Top 4", "top4"], ["Spadek", "relegation"]].map(([label, key]) => `
                    <div class="team-card-chance is-${key}" style="--value: ${Math.min(100, Number(forecast[key] || 0))}%">
                        <span class="team-card-label">${label}</span>
                        <strong class="${chanceStatus(forecast, key) ? "is-certain" : ""}">${formatChance(forecast, key)}</strong>
                        <i aria-hidden="true"></i>
                    </div>
                `).join("")}
            </div>
        ` : ""}
        ${teamCardNextHtml(slug)}
        <a class="team-card-link" href="${teamPageUrl(slug)}">Pełne statystyki <span aria-hidden="true">→</span></a>
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
    clearTimeout(teamCardState.timer);
    if (teamCardState.slug !== slug) {
        teamCardState.slug = slug;
        teamCard.innerHTML = teamCardHtml(slug);
    }
    teamCard.hidden = false;
    placeTeamCard(anchor);
}

function closeTeamCard() {
    clearTimeout(teamCardState.timer);
    teamCardState.slug = "";
    teamCard.hidden = true;
}

function scheduleCloseTeamCard() {
    clearTimeout(teamCardState.timer);
    teamCardState.timer = setTimeout(closeTeamCard, 160);
}

function scheduleOpenTeamCard(link) {
    clearTimeout(teamCardState.timer);
    if (!teamCard.hidden && teamCardState.slug === link.dataset.teamSlug) {
        return;
    }
    // przy przesuwaniu myszy przez tabele karta nie przebudowuje sie przy kazdej mijanej nazwie
    teamCardState.timer = setTimeout(() => openTeamCard(link.dataset.teamSlug, link), teamCard.hidden ? 220 : 120);
}

document.addEventListener("pointerdown", event => {
    if (!event.target.closest("a[data-team-slug], #team-card")) {
        closeTeamCard();
    }
});

document.addEventListener("pointerover", event => {
    const link = event.target.closest("a[data-team-slug]");
    if (event.pointerType !== "touch" && link) {
        if (!link.contains(event.relatedTarget)) {
            scheduleOpenTeamCard(link);
        }
    } else if (event.target.closest("#team-card")) {
        clearTimeout(teamCardState.timer);
    }
});

document.addEventListener("pointerout", event => {
    const fromTeam = event.target.closest("a[data-team-slug], #team-card");
    if (event.pointerType !== "touch" && fromTeam && !event.relatedTarget?.closest("a[data-team-slug], #team-card")) {
        scheduleCloseTeamCard();
    }
});

document.addEventListener("scroll", event => {
    if (!teamCard.contains(event.target)) {
        closeTeamCard();
    }
}, true);

const exportColors = {
    "is-title": "#3d195b",
    "is-top4": "#72d7ff",
    "is-range": "#72d7ff",
    "is-safe": "#00c983",
    "is-relegation": "#c43f5f",
    "is-median": "#e94091",
    "is-current": "#e94091"
};

async function distChartCanvas(chart, heading, withCrest = true) {
    const width = 1200;
    const height = 675;
    const pad = 56;
    const { canvas, context } = createExportCanvas(width, height, 1.6);

    const crest = withCrest && heading.slug ? await loadExportImage(`assets/logos/${heading.slug}.svg`) : null;
    if (crest) {
        drawContainedImage(context, crest, pad, 34, 100);
    }
    const titleX = crest ? pad + 124 : pad;
    context.textBaseline = "alphabetic";
    context.fillStyle = "#240030";
    fillFittedText(context, heading.title, titleX, 86, 640, 50, 700, exportDisplayFont);
    context.fillStyle = "#6a37a8";
    context.font = `700 24px ${exportBodyFont}`;
    context.fillText(chart.title, titleX, 122);

    drawExportBrand(context, width, pad, 68, true);

    const factGap = 14;
    const factTop = 156;
    const factWidth = (width - 2 * pad - factGap * (chart.facts.length - 1)) / chart.facts.length;
    chart.facts.forEach(([label, value], index) => {
        const x = pad + index * (factWidth + factGap);
        context.beginPath();
        context.roundRect(x, factTop, factWidth, 78, 10);
        context.fillStyle = "#ffffff";
        context.fill();
        context.strokeStyle = "#c9e2f4";
        context.lineWidth = 1;
        context.stroke();
        context.fillStyle = "#69758b";
        fillFittedText(context, label.toUpperCase(), x + 16, factTop + 28, factWidth - 32, 13, 700, exportBodyFont);
        context.fillStyle = "#240030";
        fillFittedText(context, value, x + 16, factTop + 62, factWidth - 32, 26, 700, exportDisplayFont);
    });

    const plotTop = 276;
    const plotBottom = 556;
    const columnGap = chart.columns.length > 30 ? 3 : 8;
    const columnWidth = (width - 2 * pad - columnGap * (chart.columns.length - 1)) / chart.columns.length;
    context.textAlign = "center";
    chart.columns.forEach((column, index) => {
        const x = pad + index * (columnWidth + columnGap);
        const centerX = x + columnWidth / 2;
        const barHeight = Math.max(2, column.height * (plotBottom - plotTop - 26));
        context.beginPath();
        context.roundRect(x, plotBottom - barHeight, columnWidth, barHeight, [Math.min(5, columnWidth / 2), Math.min(5, columnWidth / 2), 0, 0]);
        context.fillStyle = exportColors[column.className] || "rgba(61, 25, 91, 0.2)";
        context.fill();
        if (column.value) {
            context.fillStyle = "#3d195b";
            context.font = `700 15px ${exportBodyFont}`;
            context.fillText(column.value, centerX, plotBottom - barHeight - 8);
        }
        if (column.label) {
            context.font = `700 15px ${exportBodyFont}`;
            if (column.isCurrent) {
                const pillWidth = Math.max(columnWidth, context.measureText(column.label).width + 16);
                context.beginPath();
                context.roundRect(centerX - pillWidth / 2, plotBottom + 8, pillWidth, 24, 6);
                context.fillStyle = exportColors["is-current"];
                context.fill();
                context.fillStyle = "#ffffff";
            } else {
                context.fillStyle = "#69758b";
            }
            context.fillText(column.label, centerX, plotBottom + 26);
        }
    });

    context.textAlign = "left";
    context.font = `700 15px ${exportBodyFont}`;
    let legendX = pad;
    chart.legend.forEach(([label, className]) => {
        context.beginPath();
        context.roundRect(legendX, 610, 14, 14, 3);
        context.fillStyle = exportColors[className];
        context.fill();
        context.fillStyle = "#69758b";
        context.fillText(label, legendX + 22, 623);
        legendX += 22 + context.measureText(label).width + 28;
    });

    return canvas;
}
