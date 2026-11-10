# Premier League Predictor

A side project that forecasts the final Premier League table. A Poisson goals model predicts every remaining match, a Monte Carlo simulation plays the rest of the season tens of thousands of times, and a small website shows the result: the predicted table, title / top 4 / relegation chances, predictions for upcoming matches and how all of that changed during the season.

Live site: https://siemaxinh0.github.io/pl_predictor/ (the UI is in Polish)

It's not a betting model and I wouldn't use it as one. The point was something I can understand end to end - where the expected points come from, why a team has 12% relegation chance and not 30%, etc.

---

## Contents

1. [How it works in 5 sentences](#how-it-works-in-5-sentences)
2. [First time setup](#first-time-setup)
3. [After every matchweek](#after-every-matchweek)
4. [How the live site gets updated](#how-the-live-site-gets-updated)
5. [See how the model learns and how good it is](#see-how-the-model-learns-and-how-good-it-is)
6. [Optional: local server with the "Pobierz wyniki" button](#optional-local-server-with-the-pobierz-wyniki-button)
7. [New season checklist](#new-season-checklist)
8. [Project structure](#project-structure)
9. [How the model works (details)](#how-the-model-works-details)
10. [Something doesn't work](#something-doesnt-work)
11. [TODO / ideas](#todo--ideas)

---

## How it works in 5 sentences

1. Historical seasons (2015/16 - 2025/26) are combined and every match gets "pre-match" numbers: ELO, form, home/away form, head to head and squad value difference.
2. A Poisson regression learns from that how many goals a team scores against a given opponent.
3. For every match that hasn't been played yet the model predicts expected goals for both sides (called lambdas, e.g. 2.1 vs 0.9).
4. The rest of the season is simulated 10 000 - 100 000 times: each time random scores are drawn from those lambdas, a final table is built, and we count who finished where.
5. The counts are written to two JS files that the website reads (`web/forecast-data.js`, `web/forecast-history.js`).

---

## First time setup

You only do this once. All commands are for Windows PowerShell, run from the project folder (`pl_predictor`). On Linux/Mac use `venv/bin/python` instead of `.\venv\Scripts\python.exe` and `/` instead of `\`.

**Step 1 - install Python 3.13** from https://www.python.org/downloads/ (tick "Add Python to PATH" in the installer). Check it in a new terminal:

```powershell
python --version
```

**Step 2 - create a virtual environment** (a private folder `venv` with its own Python and packages, so nothing gets installed system-wide):

```powershell
python -m venv venv
```

**Step 3 - install the packages:**

```powershell
.\venv\Scripts\pip install -r requirements.txt
```

**Step 4 - calculate the forecast:**

```powershell
.\venv\Scripts\python.exe src\run_forecast.py --simulations 100000
```

It takes ~20 seconds and prints something like:

```text
Zapisano dane strony: ...\web\forecast-data.js
Rozegrane mecze: 87/380
Rozegrane pelne kolejki: 8
```

**Step 5 - open the website:** double click `web\index.html`, or (better, because then the PNG downloads work with crests) start a tiny local server:

```powershell
cd web
..\venv\Scripts\python.exe -m http.server 8765
```

and open http://localhost:8765. Stop the server with `Ctrl+C`. After regenerating data press `Ctrl+F5` in the browser, it likes to cache the old JS files.

That's it. The data and squad values are already in the repo, so nothing else is needed to run it.

---

## After every matchweek

Pick **one** of the two options.

### Option A - download the results automatically (normal way)

```powershell
.\venv\Scripts\python.exe src\update_results.py
```

What it does, step by step:

1. downloads the current season CSV from [football-data.co.uk](https://www.football-data.co.uk/englandm.php),
2. finds each game in `data/raw/pl_seasons/season-2627.csv` by home and away team,
3. fills in the scores that are missing,
4. reruns the forecast (once for every newly finished matchweek, so the history has no gaps).

Want to see what it would add without saving anything? Add `--dry-run`.

Good to know:

- football-data usually has the results a day or two after the games. If it prints `Brak nowych wynikow`, it just hasn't updated yet.
- scores already in the CSV are never overwritten. If the source says something different, you get a warning.
- if football-data uses a team name the project doesn't know, the script stops and saves nothing. Fix: add the name to `TEAM_NAME_MAP` in `src/features.py` (that's how "Coventry" -> "Coventry City" got there) and run it again.

### Option B - type the results in by hand

Useful right after the final whistle, before football-data has it.

**Step 1** - find the match number:

```powershell
.\venv\Scripts\python.exe src\add_result.py --list
```

```text
081. Bournemouth - Leeds United [bez wyniku]
082. Aston Villa - Fulham [bez wyniku]
```

**Step 2** - add the score (repeat for every match):

```powershell
.\venv\Scripts\python.exe src\add_result.py --fixture 81 --score 2-0
```

or by team names:

```powershell
.\venv\Scripts\python.exe src\add_result.py --home Arsenal --away "Coventry City" --score 2-0
```

**Step 3** - recalculate the forecast once at the end:

```powershell
.\venv\Scripts\python.exe src\run_forecast.py --simulations 100000
```

(or add `--run-forecast --simulations 100000` to the last `add_result.py` command). To fix a score that's already there, add `--force`.

### Then (both options) - publish

```powershell
git add data web
git commit -m "Results for matchweek 9"
git push
```

The push starts the deploy on GitHub (see the next section) and the live site updates in a minute or two.

A note on matchweeks: they are simply blocks of 10 rows in the fixture CSV, so the order of rows in `season-2627.csv` matters. A postponed match keeps its matchweek "unfinished" until it's played, and the history tab only saves a snapshot after a complete matchweek.

---

## How the live site gets updated

The site is hosted on GitHub Pages. The workflow `.github/workflows/pages.yml` runs:

- on every push to `main` that touches `web/`, `src/`, `data/` or `requirements.txt`,
- every day at 07:00 UTC,
- or by hand: GitHub -> Actions -> Deploy website -> Run workflow.

Every run does the same thing: installs the packages, runs `update_results.py` (so it downloads new results by itself), and publishes the fresh `web/` folder. **Nothing is committed back**, so the data in the repo can be a few matchweeks behind the live site - that's fine, the next run fills in whatever is missing. Because the seed is fixed, the numbers come out the same as if you had run everything locally week by week.

In short: if you don't feel like doing anything, the live site still updates itself every morning.

---

## See how the model learns and how good it is

```powershell
.\venv\Scripts\python.exe src\model.py
```

Takes ~15 seconds, writes nothing, and prints five sections. It uses exactly the same functions as the website (`run_forecast.py`), so what you see is what the site uses.

| Section | What it shows |
| --- | --- |
| `dane` | how many matches the model learns from, average goals, how often home / draw / away happens, example training rows |
| `trening` | the trained model: how much each feature matters, each team's own attack / defence strength |
| `backtest` | for every season since 19/20: train on the older seasons only, predict that season's matches, compare with what happened. Also compares feature sets and checks calibration ("when the model says 60%, does it happen ~60% of the time?") |
| `sezon` | the current season: how good were the pre-matchweek predictions from the "Wyniki" tab, round by round, plus the biggest surprises |
| `tabela` | the whole table: forecast made before each past season started vs the real final table |

Only some of them:

```powershell
.\venv\Scripts\python.exe src\model.py --sections trening backtest
```

Main numbers at the time of writing (seasons 19/20 - 25/26):

| | No model (always the historical 1/X/2 shares) | This model |
| --- | --- | --- |
| Correct 1/X/2 pick | 43.4% | 52.9% |
| Log loss (lower = better, coin flip on 3 outcomes = 1.099) | 1.070 | 0.981 |

Table forecast made in August, compared with the final table: on average ~9 points off per team, rank correlation 0.76, 2.7 of the real top 4 and 1.9 of the 3 relegated teams were in those zones in the forecast, and the champion was the favourite in 4 of 7 seasons. During the season the site has more data, so it does better than that.

This script replaced the old notebook (`src/model.ipynb`), which had its own copy of the whole pipeline.

---

## Optional: local server with the "Pobierz wyniki" button

Normally the site reads the two JS files. There's also a small FastAPI server (`src/api.py`) that keeps the forecast in memory and lets anyone on the site click **"Pobierz wyniki"** to fetch new results and recalculate - no commit needed. For now it only runs on your own computer.

**Step 1 - install the extra packages** (once):

```powershell
.\venv\Scripts\pip install -r requirements-api.txt
```

**Step 2 - start the server:**

```powershell
$env:PL_API_KEY = "some-password"
.\venv\Scripts\python.exe -m uvicorn api:app --app-dir src --port 8000
```

**Step 3 - wait for the first forecast.** On start the server downloads results and runs 100 000 simulations, about a minute. In a hurry? Set `$env:PL_SIMULATIONS = "10000"` before step 2 (~10 seconds).

**Step 4 - open http://localhost:8000** (this address, not the file from disk). The button is in the "Mecze rozegrane" box at the top. If you opened the page during step 3, refresh it with `Ctrl+F5`.

**Step 5 - stop the server** with `Ctrl+C` in its terminal.

How the button behaves:

- it shows up only when the page got its data from the server,
- new results: the server recalculates and the page reloads itself,
- nothing new: it says so, with the time of the last check,
- football-data is asked at most once every 10 minutes, a click during the break just shows the current state.

Adding a score by hand through the server (needs the password from step 2):

```powershell
Invoke-RestMethod http://localhost:8000/api/results -Method Post -ContentType "application/json" -Headers @{ "X-API-Key" = "some-password" } -Body '{"home": "Arsenal", "away": "Coventry City", "score": "2-0"}'
```

Those scores are saved in `data/api/manual-results.json` (not in git), survive a restart and win over football-data.

<details>
<summary>All endpoints and settings</summary>

- `GET /api/forecast`, `GET /api/history` - the same data as the two JS files
- `GET /api/status` - when it last checked, what got added, last error
- `POST /api/refresh` - check football-data now (the button)
- `POST /api/results` - add or fix a score, needs the `X-API-Key` header

Environment variables: `PL_API_KEY`, `PL_SIMULATIONS` (default 100000), `PL_REFRESH_COOLDOWN_MINUTES` (default 10), `PL_CORS_ORIGINS` (default `https://siemaxinh0.github.io`).

The pages read the API address from `data-api` on the `data-loader.js` script tag (`api` = same server). If the API doesn't answer within 5 seconds, they fall back to the JS files. GitHub Pages has no server, so the deploy workflow replaces that address with the repository variable `PL_API_URL` (Settings -> Secrets and variables -> Actions -> Variables). While it's empty the live site works from the JS files. Once the API is hosted somewhere, setting that variable to its address (e.g. `https://my-api.example.com/api`) switches the live site over without touching the code.

</details>

---

## New season checklist

When a new season starts (example: 2027/28):

1. **Move last season into history.** Make sure `data/raw/pl_seasons/season-2627.csv` has all 380 results.
2. **Add the new fixture list** as `data/raw/pl_seasons/season-2728.csv` with columns `HomeTeam,AwayTeam,FTHG,FTAG` (scores empty). Order the rows by matchweek, 10 per matchweek.
3. **Point the scripts at the new season:** change `season-2627.csv` to `season-2728.csv` in `CURRENT_SEASON_FILE` (`src/features.py`) and `DEFAULT_FIXTURE_PATH` (`src/run_forecast.py`), and the title in `web/index.html`.
4. **Get the new squad values:**

   ```powershell
   .\venv\Scripts\python.exe src\scrape_transfermarkt_squad_values.py
   ```

5. **Rebuild the features** (ELO, form... for all past seasons):

   ```powershell
   .\venv\Scripts\python.exe src\features.py
   ```

6. **Start a fresh history:** delete `web/forecast-history.js`, then run the forecast:

   ```powershell
   .\venv\Scripts\python.exe src\run_forecast.py --simulations 100000
   ```

7. Check `src/model.py` still looks sane, update the notes in `teamNotes` (`web/common.js`) if they don't apply anymore, commit, push.

---

## Project structure

```text
data/raw/pl_seasons/                  one CSV per season, season-2627.csv = current season (fixtures + results so far)
data/raw/squad_values_by_season.csv   squad values from Transfermarkt
data/processed/PL_base_with_traits.csv   historical matches with pre-match features

src/features.py                       builds the features CSV from the raw seasons
src/run_forecast.py                   trains the model, runs the simulation, writes the website data
src/update_results.py                 downloads new results and reruns the forecast
src/add_result.py                     manual result entry / corrections
src/model.py                          training, backtests and accuracy report (writes nothing)
src/api.py                            optional FastAPI server ("Pobierz wyniki" button)
src/scrape_transfermarkt_squad_values.py   squad value scraper

web/index.html, app.js                main page
web/team.html, team.js                club page (team.html?club=arsenal)
web/common.js, styles.css             shared code and styles
web/data-loader.js                    loads the data (API first, then the JS files)
web/forecast-data.js                  current forecast (generated)
web/forecast-history.js               snapshot after every complete matchweek (generated)
```

---

## How the model works (details)

### Features

All of them are calculated from the state **before** the match, otherwise the model would be peeking at the result. Training and the forecast use the same code for this (`TeamState` in `src/features.py`), so the current season is described with exactly the same rules as the seasons the model learned from.

- **ELO** - every team starts at 1500 and after each match `new_elo = old_elo + K * (actual - expected)`, where `actual` is 1 / 0.5 / 0 for win / draw / loss and `expected` comes from the ELO difference with a home bonus. K = 20, home advantage = 90 ELO points. Between seasons ratings are pulled 5% back to 1500. Promoted teams get the average ELO of the teams that went down (or something in between if they were in the league before).
- **Form** - average points from the last 5 matches, in three versions: overall, home only and away only.
- **H2H** - average points from the last 5 meetings of the two teams.
- **Squad value** - log difference of the two squad values for that season (scraped from Transfermarkt).

### Model

Every match becomes two training rows, one from each team's point of view:

```text
Arsenal - Chelsea 2:1

Arsenal | Chelsea | IsHome=1 | Goals=2
Chelsea | Arsenal | IsHome=0 | Goals=1
```

and the model is

```text
Goals ~ Team + Opponent + IsHome + EloDiff + FormDiff + VenueFormDiff + H2HDiff + SquadValueDiff
```

Team and opponent are one-hot encoded, numbers are scaled, and it's fitted with sklearn's `PoissonRegressor` (small L2 penalty). The prediction is a lambda = expected goals, e.g. Man City vs Leeds might come out as 2.65 vs 0.80. From two lambdas you get the chances of every score, and from those 1 / X / 2.

Two adjustments for teams without much recent Premier League history (mostly promoted sides):

- their lambdas are pulled towards the league average home/away goals,
- in every simulation each team gets a random strength "noise", bigger for teams with less history. So the simulation covers "this team is just better/worse than the model thinks", not only bad luck in single matches.

### Simulation

Played matches are facts: they go into the starting table and update ELO / form / H2H. Only the remaining fixtures are simulated. The simulation is vectorised with NumPy (all seasons at once), and the table is sorted by points, then goal difference, then goals scored.

```powershell
.\venv\Scripts\python.exe src\run_forecast.py --simulations 100000 --sample-tables 120
```

- `--simulations` - how many seasons to simulate (default 10 000, a few seconds; 100 000 takes ~20 s). Note that `update_results.py` - also the one in the daily deploy - uses the default, so results it adds on its own come with 10 000,
- `--sample-tables` - how many single simulated seasons are saved for the "Losowa symulacja" button.

The seed is fixed (42), so the same data always gives the same numbers.

### The website

Tabs: predicted table (hover a percentage for the exact count), current table, upcoming matches with 1/X/2, results with what the model predicted before each matchweek, history of the forecast, charts and league stats (how many points were enough for the title, Top 4 and survival across all simulations). Clicking a team opens its page: distribution of final positions and points, how its chances changed, every played match with the pre-match odds and the remaining schedule. Clicking a bar on the league stats or team charts opens an example simulation where that outcome happened. Tables, rounds and charts can be saved as PNG.

When a chance is shown as **0%** or **100%** in bold, it's mathematically decided. `~0%` / `~100%` means it didn't happen in any simulation (or happened in all of them), but it's still mathematically possible.

---

## Something doesn't work

| Problem | Fix |
| --- | --- |
| The site shows old numbers | `Ctrl+F5` in the browser |
| "Zapisz PNG" saves an image without crests | the page was opened from disk (`file://`), use the local server from step 5 of the setup |
| `update_results.py` stops with an unknown team name | add the name to `TEAM_NAME_MAP` in `src/features.py` |
| `Brak nowych wynikow` right after the games | football-data needs a day or two, use `add_result.py` instead |
| No "Pobierz wyniki" button | it only exists on http://localhost:8000 with the API server running |
| `python` is not recognised | Python isn't on PATH, reinstall it with "Add Python to PATH" ticked |
| Port 8000 / 8765 already in use | something is still running there, close that terminal or use another port (`--port 8001`) |

---

## TODO / ideas

- Dixon-Coles correction for low scores (0-0, 1-0, 1-1 are usually underestimated by plain Poisson)
- time weighting so recent seasons matter more
- football-data also has xG columns now, could be worth trying as a feature
- host the API somewhere so the live site gets the "Pobierz wyniki" button too
