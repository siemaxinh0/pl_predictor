const forecastData = window.forecastData || { meta: {}, teams: [], upcomingFixtures: [], sampleTables: [] };
const forecastHistory = window.forecastHistory || { snapshots: [] };
const forecastMeta = forecastData.meta || {};
const teams = forecastData.teams || [];
const standings = forecastData.standings || [];
const results = forecastData.results || [];
const upcomingFixtures = forecastData.upcomingFixtures || [];
const remainingFixtures = forecastData.remainingFixtures || [];
const teamDetails = forecastData.teamDetails || {};
const sampleTables = forecastData.sampleTables || [];

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

function createLogo(team) {
    return `
        <span class="crest" aria-hidden="true">
            <img src="assets/logos/${escapeHtml(team.slug)}.svg" alt="" onerror="this.classList.add('is-missing')">
        </span>
    `;
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

function forecastUpdatedText() {
    const generatedAt = forecastMeta.generatedAtUTC ? new Date(forecastMeta.generatedAtUTC) : null;
    return generatedAt && !Number.isNaN(generatedAt.getTime())
        ? new Intl.DateTimeFormat("pl-PL", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Warsaw" }).format(generatedAt)
        : "";
}

function exportMetaText() {
    const updated = forecastUpdatedText();
    return [
        forecastMeta.simulations ? `${formatInteger(forecastMeta.simulations)} symulacji` : "",
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
