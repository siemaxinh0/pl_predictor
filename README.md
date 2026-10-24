# Premier League Predictor

Side project where I try to forecast the final Premier League table. It's built around a Poisson goals model and a Monte Carlo simulation of the rest of the season, and the output is a small static website with the predicted table, title / top 4 / relegation chances and predictions for upcoming matches.

It's not a betting model and I wouldn't use it as one. The goal was something I can actually understand end to end - where the expected points come from, why a team has 12% relegation chance and not 30%, etc.

## How it works (short version)

1. Historical seasons (2015/16 - 2025/26) are combined and every match gets pre-match features: ELO, form, home/away form, head to head and squad value difference.
2. A Poisson regression learns how many goals a team scores against a given opponent.
3. For every remaining fixture the model predicts expected goals for both sides (the lambdas).
4. The rest of the season is simulated 10 000 times. Every simulation draws scores from Poisson(lambda), builds the final table and counts who finished where.
5. The results are written to JS files that the website reads.

## Project structure

```text
data/raw/pl_seasons/        one CSV per season, season-2627.csv is the current one (fixtures + results so far)
data/raw/squad_values_by_season.csv   squad values from Transfermarkt (see below)
data/processed/             PL_base_with_traits.csv - historical matches with features
src/features.py             builds the features CSV from raw seasons
src/run_forecast.py         trains the model, runs the simulation, writes the website data
src/update_results.py       downloads new results and reruns the forecast
src/add_result.py           manual result entry / corrections
src/scrape_transfermarkt_squad_values.py
src/model.ipynb             notebook I used while building the model
web/                        the website (plain HTML/CSS/JS, no build step)
```

## Setup

```powershell
python -m venv venv
.\venv\Scripts\pip install -r requirements.txt
```

I run everything on Windows from PowerShell, so the commands below use `.\venv\Scripts\python.exe`. On Linux/Mac it's just `venv/bin/python` and forward slashes.

## Data

Match data comes from [football-data.co.uk](https://www.football-data.co.uk/englandm.php) (results, shots, cards etc. - only goals are used for now).

Squad values are scraped from Transfermarkt and the CSV is committed, because the forecast needs it (without it every upcoming match gets a squad value difference of 0). The scraper only has to be run again for a new season:

```powershell
.\venv\Scripts\python.exe src\scrape_transfermarkt_squad_values.py
```

Then build the features:

```powershell
.\venv\Scripts\python.exe src\features.py
```

This writes `data/processed/PL_base_with_traits.csv`. Only needed again when the historical data changes, not after every matchweek.

## Features

**ELO** - every team starts at 1500 and after each match:

```text
new_elo = old_elo + K * (actual - expected)
```

`actual` is 1 / 0.5 / 0 for win / draw / loss, `expected` comes from the ELO difference with a home advantage bonus. K = 20, home advantage = 90 ELO points. Between seasons ratings are pulled 5% back to 1500. Promoted teams get the average ELO of the teams that went down (or something in between if they were in the league before).

**Form** - average points from the last 5 matches, in three versions: overall, home only and away only.

**H2H** - average points from the last 5 meetings of the two teams.

**Squad value** - log difference of the two squad values for that season.

All of these are calculated from the state *before* the match, otherwise the model would be peeking at the result.

## Model

Every match becomes two training rows, one from each team's perspective:

```text
Arsenal - Chelsea 2:1

Arsenal | Chelsea | IsHome=1 | Goals=2
Chelsea | Arsenal | IsHome=0 | Goals=1
```

and the model is

```text
Goals ~ Team + Opponent + IsHome + EloDiff + FormDiff + VenueFormDiff + H2HDiff + SquadValueDiff
```

Team and opponent are one-hot encoded, numeric features are scaled, and it's fitted with sklearn's `PoissonRegressor` (small L2 penalty). The prediction is a lambda = expected goals, e.g. Man City vs Leeds might come out as 2.65 vs 0.80.

On top of that there are two adjustments for teams without much recent PL history (mostly promoted sides):

- their lambdas are shrunk towards the league average home/away goals,
- in every simulation each team gets a random strength "noise", bigger for teams with less history. So the simulation also covers "this team is just better/worse than the model thinks", not only bad luck in single matches.

## Simulation

Already played matches are taken as facts - they go into the starting table and update ELO/form/H2H. Only the remaining fixtures are simulated.

The simulation is vectorised with NumPy (all 10 000 seasons at once), so a full run takes a few seconds. Sorting is by points, then goal difference, then goals scored.

```powershell
.\venv\Scripts\python.exe src\run_forecast.py
.\venv\Scripts\python.exe src\run_forecast.py --simulations 20000 --sample-tables 120
```

`--sample-tables` is how many single simulated seasons get saved for the "Losowa symulacja" (random simulation) button on the site. Seed is fixed (42), so the same data gives the same numbers.

## Website

Everything is in `web/`. Just open `web/index.html` in a browser (Ctrl+F5 after regenerating data, the browser likes to cache the JS files). The UI is in Polish.

Tabs:

- predicted table with xPts, xG and title / top 4 / relegation % (hover a percentage to see the exact count out of 10 000)
- current table
- next matchweek with 1/X/2 probabilities
- results - what the model predicted for each played match, using only data from before that matchweek
- history + charts - how the chances changed week by week

Clicking a team name opens `web/team.html?club=<slug>`, a page for one club: distribution of final positions and points across the 10 000 simulations, how its forecast changed, every played match with the pre-match odds and the whole remaining schedule.

Data comes from two generated files:

- `web/forecast-data.js` - current forecast, overwritten on every run
- `web/forecast-history.js` - one snapshot before the season and after every complete matchweek, the state in the middle of a matchweek is only shown on the site and never saved here

## Adding new results

Normally just:

```powershell
.\venv\Scripts\python.exe src\update_results.py
```

It downloads the current season CSV from football-data, matches games to the fixture list by home/away team, fills in missing scores and reruns the forecast. `--dry-run` shows what would be added without saving anything.

Some notes:

- football-data usually updates within a day or two after the games.
- scores that are already in the fixture file are never overwritten - if the source has a different score it just prints a warning.
- if a few complete matchweeks come in at once, the forecast is run after each of them so the history doesn't have gaps.
- if the source uses a team name the project doesn't know, the script stops with an error and saves nothing. Fix: add the name to `TEAM_NAME_MAP` in `src/features.py` (that's how "Coventry" -> "Coventry City" got there).

The live site doesn't need this, though. `.github/workflows/pages.yml` runs `update_results.py` before every deploy - on every push, every day at 07:00 UTC, or by hand (Actions -> Deploy website -> Run workflow) - and publishes the fresh `web/` folder straight to GitHub Pages. Nothing gets committed, so the data in the repo can be a few matchweeks behind the site. That's fine, the repo is just the starting point, the script fills in whatever is missing (and the fixed seed means the history snapshots come out the same as if they were generated one by one). Run it locally only when you want the newest data on your machine.

For manual fixes there's still `add_result.py`:

```powershell
.\venv\Scripts\python.exe src\add_result.py --list
.\venv\Scripts\python.exe src\add_result.py --fixture 12 --score 1-1 --force --run-forecast
.\venv\Scripts\python.exe src\add_result.py --home Arsenal --away "Coventry City" --score 2-0 --run-forecast
```

`--force` is needed to overwrite a score that's already there.

Matchweeks are just blocks of 10 rows in the fixture CSV, so the order of rows in `season-2627.csv` matters. A postponed match keeps its matchweek incomplete until it's played.

## Notebook

`src/model.ipynb` is where I originally built and tested the model. It's a bit behind the scripts now (it has its own copy of the pipeline), so treat it as a playground. The website is always generated by `run_forecast.py`.

## TODO / known issues

- `run_forecast.py` still calculates the current ELO/form on its own and uses slightly different rules than `features.py` (home advantage 60 instead of 90, no regression between seasons). Should just reuse `features.py`, but it will change the numbers a bit so I'm leaving it for a separate change.
- slim down the notebook so it imports from the scripts instead of duplicating them
- Dixon-Coles correction for low scores (0-0, 1-0, 1-1 are usually underestimated by plain Poisson)
- time weighting so recent seasons matter more
- proper backtest on past seasons (right now it's mostly sanity checks)
- football-data also has xG columns now, could be worth trying as a feature
