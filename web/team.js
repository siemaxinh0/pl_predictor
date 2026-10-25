const teamPage = document.querySelector("#team-page");
const clubSlug = new URLSearchParams(location.search).get("club");
const club = teams.find(team => team.slug === clubSlug);

const historyMetricKeys = ["avgRank", "xPts", "title", "top4", "relegation"];

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

function fact(label, value, detail = "", className = "") {
    return `
        <div class="team-fact ${className}">
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
    return `${counts.win}-${counts.draw}-${counts.loss}`;
}

function teamHeroHtml(team) {
    const counts = teamDetails[team.slug]?.positionCounts || [];
    const note = teamNotes[teamKey(team)];
    const matches = matchesForTeam(team.slug);
    const form = matches.slice(-5).map((match, index) => {
        const outcome = matchOutcomeForTeam(match, team.slug);
        const label = `${formLabels[outcome].label}: ${match.homeTeam} ${match.homeGoals}-${match.awayGoals} ${match.awayTeam}`;
        return `<button type="button" class="form-badge is-${outcome}" data-form-match="${Math.max(0, matches.length - 5) + index}" aria-label="${escapeHtml(label)}">${formLabels[outcome].letter}</button>`;
    }).join("");

    return `
        <section class="team-hero">
            <div class="team-hero-main">
                ${createLogo(team)}
                <div class="team-hero-copy">
                    <h1>${escapeHtml(team.team)}</h1>
                    ${form ? `<div class="team-form" aria-label="Ostatnie mecze">${form}</div>` : ""}
                </div>
            </div>
            <div class="team-facts">
                ${fact("Prognozowane miejsce", `${team.rank}.`)}
                ${counts.length ? fact("Średnie miejsce", formatNumber(countsMean(counts) + 1)) : ""}
                ${fact("Prognozowane punkty", formatNumber(team.xPts))}
                <div class="team-fact">
                    <div class="team-goals-head">
                        <span>Prognozowane bramki</span>
                        <b class="team-goals-diff ${team.xGD < 0 ? "is-bad" : ""}" title="Różnica bramek">${team.xGD > 0 ? "+" : ""}${formatNumber(team.xGD)}</b>
                    </div>
                    <div class="team-goals">
                        <div>
                            <strong>${formatNumber(team.xGF)}</strong>
                            <small>strzelone</small>
                        </div>
                        <div>
                            <strong>${formatNumber(team.xGA)}</strong>
                            <small>stracone</small>
                        </div>
                    </div>
                </div>
            </div>
            <div class="probability-grid team-chances">
                ${probabilityBlock("Mistrzostwo", team.title, "home-win")}
                ${probabilityBlock("Top 4", team.top4, "draw")}
                ${probabilityBlock("Spadek", team.relegation, "away-win")}
            </div>
            ${note ? `<p class="team-hero-note"><span class="team-note-mark">*</span> <strong>${escapeHtml(note[0])}.</strong> ${escapeHtml(note[1])}</p>` : ""}
            <div class="chart-tooltip form-tooltip is-below" hidden></div>
        </section>
    `;
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
        <div class="form-tooltip-odds">${odds}</div>
    `;
}

function showFormTooltip(badge) {
    const hero = badge.closest(".team-hero");
    const tooltip = hero.querySelector(".form-tooltip");
    const match = matchesForTeam(club.slug)[Number(badge.dataset.formMatch)];
    hero.querySelectorAll(".form-badge.is-active").forEach(item => item.classList.remove("is-active"));
    badge.classList.add("is-active");
    tooltip.innerHTML = formTooltipHtml(match, club.slug);
    tooltip.hidden = false;

    const heroRect = hero.getBoundingClientRect();
    const badgeRect = badge.getBoundingClientRect();
    const badgeX = badgeRect.left + badgeRect.width / 2 - heroRect.left;
    const halfWidth = tooltip.offsetWidth / 2;
    const left = Math.min(Math.max(badgeX, halfWidth + 8), heroRect.width - halfWidth - 8);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${badgeRect.bottom - heroRect.top}px`;
    tooltip.style.setProperty("--arrow-x", `${badgeX - left + halfWidth}px`);
}

function hideFormTooltip() {
    teamPage.querySelectorAll(".form-badge.is-active").forEach(item => item.classList.remove("is-active"));
    const tooltip = teamPage.querySelector(".form-tooltip");
    if (tooltip) {
        tooltip.hidden = true;
    }
}

function bindFormTooltip() {
    teamPage.addEventListener("pointerover", event => {
        const badge = event.target.closest("[data-form-match]");
        if (badge) {
            showFormTooltip(badge);
        }
    });

    teamPage.addEventListener("pointerout", event => {
        // na telefonie dymek zostaje po puszczeniu palca i znika po dotknieciu obok
        if (event.pointerType !== "touch" && event.target.closest("[data-form-match]")) {
            hideFormTooltip();
        }
    });

    teamPage.addEventListener("focusin", event => {
        const badge = event.target.closest("[data-form-match]");
        if (badge) {
            showFormTooltip(badge);
        }
    });

    teamPage.addEventListener("focusout", event => {
        if (event.target.closest("[data-form-match]")) {
            hideFormTooltip();
        }
    });

    document.addEventListener("pointerdown", event => {
        if (!event.target.closest("[data-form-match]")) {
            hideFormTooltip();
        }
    });
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

function positionsChart(team) {
    const counts = teamDetails[team.slug]?.positionCounts;
    if (!counts) {
        return null;
    }
    const total = countsTotal(counts);
    const maxCount = Math.max(...counts);
    const likely = counts.indexOf(maxCount);
    const current = standings.find(row => row.slug === team.slug);
    const higher = current ? counts.slice(0, current.rank - 1).reduce((sum, count) => sum + count, 0) : 0;
    return {
        id: "positions",
        fileName: "miejsca",
        title: "Na którym miejscu skończy sezon",
        facts: [
            ["Najczęściej", `${likely + 1}. miejsce`],
            ["8 na 10 symulacji", `${countsQuantile(counts, 0.1) + 1}.–${countsQuantile(counts, 0.9) + 1}. miejsce`],
            current ? [`Wyżej niż obecne ${current.rank}. miejsce`, shareText(higher, total)] : null,
            ["Środek tabeli (5.–17.)", shareText(counts.slice(4, 17).reduce((sum, count) => sum + count, 0), total)]
        ].filter(Boolean),
        columns: counts.map((count, index) => {
            const position = index + 1;
            const share = shareText(count, total);
            return {
                className: positionZone(position),
                isCurrent: current?.rank === position,
                height: count / maxCount,
                value: count / total >= 0.005 ? share : "",
                label: String(position),
                tip: `${position}. miejsce: ${share} symulacji`
            };
        }),
        legend: [
            ["Mistrzostwo", "is-title"],
            ["Top 4", "is-top4"],
            ["Spadek", "is-relegation"],
            current ? ["Obecne miejsce", "is-current"] : null
        ].filter(Boolean)
    };
}

function pointsChart(team) {
    const details = teamDetails[team.slug];
    if (!details) {
        return null;
    }
    const counts = details.pointsCounts;
    const total = countsTotal(counts);
    const maxCount = Math.max(...counts);
    const low = countsQuantile(counts, 0.1);
    const median = countsQuantile(counts, 0.5);
    const high = countsQuantile(counts, 0.9);
    const above40 = counts.reduce((sum, count, index) => sum + (details.pointsMin + index >= 40 ? count : 0), 0);
    const labelStep = counts.length > 40 ? 10 : 5;
    return {
        id: "points",
        fileName: "punkty",
        title: "Ile punktów zdobędzie",
        chartClass: "dist-points",
        facts: [
            ["Mediana", `${details.pointsMin + median} pkt`],
            ["8 na 10 symulacji", `${details.pointsMin + low}–${details.pointsMin + high} pkt`],
            ["Najlepszy i najgorszy scenariusz", `${details.pointsMin}–${details.pointsMin + counts.length - 1} pkt`],
            ["40 pkt lub więcej", shareText(above40, total)]
        ],
        columns: counts.map((count, index) => {
            const points = details.pointsMin + index;
            return {
                className: index === median ? "is-median" : index >= low && index <= high ? "is-range" : "",
                isCurrent: false,
                height: count / maxCount,
                value: "",
                label: points % labelStep === 0 ? String(points) : "",
                tip: `${points} pkt: ${shareText(count, total)} symulacji`
            };
        }),
        legend: [
            ["Mediana", "is-median"],
            ["8 na 10 symulacji", "is-range"]
        ]
    };
}

const distCharts = new Map();

function distPanelHtml(chart) {
    if (!chart) {
        return "";
    }
    distCharts.set(chart.id, chart);
    const columns = chart.columns.map(column => `
        <div class="dist-col ${column.className} ${column.isCurrent ? "is-current" : ""}" title="${escapeHtml(column.tip)}">
            ${distBar(column.height, column.value)}
            <span class="dist-label">${column.label}</span>
        </div>
    `).join("");

    return `
        <section class="team-panel">
            <div class="team-panel-head">
                <h2>${chart.title}</h2>
                <button type="button" class="action-button action-button-secondary team-export" data-export-chart="${chart.id}">Zapisz PNG</button>
            </div>
            <div class="team-facts">${chart.facts.map(([label, value]) => fact(label, value)).join("")}</div>
            <div class="dist-scroll">
                <div class="dist-chart ${chart.chartClass || ""}">${columns}</div>
            </div>
            <div class="dist-legend">${chart.legend.map(([label, className]) => `<span class="${className}">${label}</span>`).join("")}</div>
        </section>
    `;
}

const exportColors = {
    "is-title": "#3d195b",
    "is-top4": "#72d7ff",
    "is-range": "#72d7ff",
    "is-relegation": "#c43f5f",
    "is-median": "#e94091",
    "is-current": "#e94091"
};
const exportDisplayFont = `"Bahnschrift", "Aptos Display", sans-serif`;
const exportBodyFont = `"Trebuchet MS", "Aptos", sans-serif`;

function loadImage(src) {
    return new Promise(resolve => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = src;
    });
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

async function distChartCanvas(chart, team, withCrest = true) {
    const width = 1200;
    const height = 675;
    const scale = 1.6;
    const pad = 56;
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

    const crest = withCrest ? await loadImage(`assets/logos/${team.slug}.svg`) : null;
    if (crest) {
        const ratio = crest.naturalWidth && crest.naturalHeight ? crest.naturalWidth / crest.naturalHeight : 1;
        const crestWidth = ratio >= 1 ? 100 : 100 * ratio;
        const crestHeight = ratio >= 1 ? 100 / ratio : 100;
        context.drawImage(crest, pad + (100 - crestWidth) / 2, 34 + (100 - crestHeight) / 2, crestWidth, crestHeight);
    }
    const titleX = crest ? pad + 124 : pad;
    context.textBaseline = "alphabetic";
    context.fillStyle = "#240030";
    fillFittedText(context, team.team, titleX, 86, 640, 50, 700, exportDisplayFont);
    context.fillStyle = "#6a37a8";
    context.font = `700 24px ${exportBodyFont}`;
    context.fillText(chart.title, titleX, 122);

    context.textAlign = "right";
    context.fillStyle = "#3d195b";
    context.font = `700 20px ${exportDisplayFont}`;
    context.fillText("Premier League Predictor", width - pad, 68);
    context.fillStyle = "#69758b";
    context.font = `700 15px ${exportBodyFont}`;
    context.fillText(`${forecastMeta.snapshotLabel} · ${formatInteger(forecastMeta.simulations)} symulacji`, width - pad, 94);
    context.textAlign = "left";

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

function canvasBlob(canvas) {
    return new Promise((resolve, reject) => {
        try {
            canvas.toBlob(resolve, "image/png");
        } catch (error) {
            reject(error);
        }
    });
}

async function downloadDistChart(button) {
    const chart = distCharts.get(button.dataset.exportChart);
    button.disabled = true;
    try {
        let blob;
        try {
            blob = await canvasBlob(await distChartCanvas(chart, club));
        } catch {
            // strona otwarta z dysku (file://) blokuje zapis canvasu z narysowanym herbem
            blob = await canvasBlob(await distChartCanvas(chart, club, false));
        }
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${club.slug}-${chart.fileName}.png`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } finally {
        button.disabled = false;
    }
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
            <h2>Jak zmieniała się prognoza</h2>
            <div class="charts-grid team-charts">${cards}</div>
        </section>
    `;
}

function playedHtml(team) {
    const matches = matchesForTeam(team.slug);
    if (!matches.length) {
        return `
            <section class="team-panel">
                <h2>Rozegrane mecze</h2>
                <p class="empty-state">Brak rozegranych meczów.</p>
            </section>
        `;
    }

    const sides = matches.map(match => ({ match, side: teamSide(match, team.slug), outcome: matchOutcomeForTeam(match, team.slug) }));
    const home = recordText(matches.filter(match => match.homeSlug === team.slug), team.slug);
    const away = recordText(matches.filter(match => match.awaySlug === team.slug), team.slug);
    const goalsFor = sides.reduce((sum, item) => sum + item.side.goalsFor, 0);
    const goalsAgainst = sides.reduce((sum, item) => sum + item.side.goalsAgainst, 0);
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
            <h2>Rozegrane mecze</h2>
            <div class="team-facts">
                ${fact("U siebie", home, "", "is-big")}
                ${fact("Na wyjeździe", away, "", "is-big")}
                ${fact("Gole strzelone", goalsFor, "", "is-big")}
                ${fact("Gole stracone", goalsAgainst, "", "is-big")}
                ${fact("Trafione typy modelu", `${hits} z ${sides.length}`, "", "is-big")}
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
                <h2>Pozostałe mecze</h2>
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
            <h2>Pozostałe mecze</h2>
            <div class="team-facts">
                ${fact("Mecze do rozegrania", fixtures.length)}
                ${fact("Oczekiwane punkty", formatNumber(totalPoints), `${formatLambda(totalPoints / fixtures.length)} na mecz`)}
                ${fact("Trudność terminarza", difficultyText(difficulty), `średnio rywale mają ${formatNumber(strength)} xPts`)}
                ${fact("Faworyt w meczach", `${favourite} z ${fixtures.length}`)}
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
        distPanelHtml(positionsChart(club)),
        distPanelHtml(pointsChart(club)),
        historyChartsHtml(club),
        playedHtml(club),
        scheduleHtml(club)
    ].join("");
}

bindChartTooltips(teamPage);
bindFormTooltip();

teamPage.addEventListener("click", event => {
    const button = event.target.closest("[data-export-chart]");
    if (button) {
        downloadDistChart(button);
    }
});

renderTeamPage();
