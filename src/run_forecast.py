from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import poisson
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import PoissonRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from features import (
    DEFAULT_SQUAD_VALUES_PATH,
    TeamState,
    add_diff_features,
    apply_results,
    load_squad_values,
    normalize_names,
    season_start_state,
    squad_value_diff,
)

# zmiana liczby symulacji: .\venv\Scripts\python.exe src\run_forecast.py --simulations 10000

# nowe wyniki z football-data.co.uk i przeliczenie strony: .\venv\Scripts\python.exe src\update_results.py

# reczne dodawanie meczow:
# 1 sprawdzamy nr meczu .\venv\Scripts\python.exe src\add_result.py --list
# 2 dopisanie wyniku i przeliczenie strony .\venv\Scripts\python.exe src\add_result.py --fixture 1 --score 2-0 --run-forecast
# 3 poprawa juz wpisanego wyniku .\venv\Scripts\python.exe src\add_result.py --fixture 1 --score 1-1 --force --run-forecast

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_HISTORY_PATH = ROOT / "data" / "processed" / "PL_base_with_traits.csv"
DEFAULT_FIXTURE_PATH = ROOT / "data" / "raw" / "pl_seasons" / "season-2627.csv"
DEFAULT_OUTPUT_PATH = ROOT / "web" / "forecast-data.js"
DEFAULT_FORECAST_HISTORY_PATH = ROOT / "web" / "forecast-history.js"

DISPLAY_NAME_MAP = {
    "Man City": "Manchester City",
    "Man United": "Manchester United",
    "Nott'm Forest": "Nottingham Forest",
}

DIFF_FEATURES = ["EloDiff", "FormDiff", "VenueFormDiff", "H2HDiff"]
VALUE_FEATURE = "SquadValueDiff"
CATEGORICAL_FEATURES = ["Team", "Opponent"]
ROUND_SIZE = 10
RECENT_HISTORY_SEASONS = 3
HISTORY_SCALE_MATCHES = 76
MIN_TEAM_UNCERTAINTY_SIGMA = 0.02
MAX_TEAM_UNCERTAINTY_SIGMA = 0.12
MAX_LOW_HISTORY_SHRINKAGE = 0.50
OPPONENT_NOISE_WEIGHT = 0.35
MAX_STRENGTH_NOISE = 0.18
HISTORY_TEAM_FIELDS = [
    "rank", "teamKey", "team", "slug", "avgRank", "xPts", "xGF", "xGA", "xGD",
    "title", "top4", "relegation", "titleCount", "top4Count", "relegationCount",
    "bestPossibleRank", "worstPossibleRank",
]


def display_name(team: str) -> str:
    return DISPLAY_NAME_MAP.get(team, team)


def slug_for_team(team: str) -> str:
    return team.lower().replace("'", "").replace(".", "").replace(" ", "-")


def load_history(history_path: Path) -> pd.DataFrame:
    history = pd.read_csv(history_path)
    return normalize_names(history.dropna(subset=["HomeTeam", "AwayTeam", "FTHG", "FTAG"]))


def model_diff_features(frame: pd.DataFrame) -> list[str]:
    return DIFF_FEATURES + ([VALUE_FEATURE] if VALUE_FEATURE in frame.columns else [])


def make_poisson_rows(history: pd.DataFrame, diff_features: list[str] | None = None) -> pd.DataFrame:
    diff_features = model_diff_features(history) if diff_features is None else diff_features
    base_columns = ["HomeTeam", "AwayTeam", "FTHG", "FTAG", "SeasonFile"] + diff_features
    home_rows = history[base_columns].copy().rename(columns={
        "HomeTeam": "Team",
        "AwayTeam": "Opponent",
        "FTHG": "Goals",
        "FTAG": "OpponentGoals",
    })
    home_rows["IsHome"] = 1

    away_rows = history[base_columns].copy().rename(columns={
        "AwayTeam": "Team",
        "HomeTeam": "Opponent",
        "FTAG": "Goals",
        "FTHG": "OpponentGoals",
    })
    away_rows["IsHome"] = 0

    for feature in diff_features:
        away_rows[feature] = -away_rows[feature]

    return pd.concat([home_rows, away_rows], ignore_index=True)


def train_poisson_model(model_rows: pd.DataFrame, diff_features: list[str] | None = None) -> Pipeline:
    numeric_features = ["IsHome"] + (model_diff_features(model_rows) if diff_features is None else diff_features)
    preprocessor = ColumnTransformer(transformers=[
        ("teams", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL_FEATURES),
        ("numbers", StandardScaler(), numeric_features),
    ])
    poisson_model = Pipeline(steps=[
        ("preprocessor", preprocessor),
        ("model", PoissonRegressor(max_iter=1000, alpha=0.03)),
    ])
    poisson_model.fit(model_rows[CATEGORICAL_FEATURES + numeric_features], model_rows["Goals"].astype(float))
    return poisson_model


def build_fixture_features(fixtures: pd.DataFrame, state: TeamState) -> tuple[pd.DataFrame, pd.DataFrame]:
    # te same cechy co w treningu: stan druzyn sprzed meczu, a wiersz goscia ma roznice z przeciwnym znakiem
    snapshots = pd.DataFrame([state.snapshot(match.HomeTeam, match.AwayTeam) for match in fixtures.itertuples(index=False)], index=fixtures.index)
    diffs = add_diff_features(snapshots)[DIFF_FEATURES].assign(**{VALUE_FEATURE: fixtures[VALUE_FEATURE]})
    home_features = diffs.assign(Team=fixtures["HomeTeam"], Opponent=fixtures["AwayTeam"], IsHome=1)
    away_features = (-diffs).assign(Team=fixtures["AwayTeam"], Opponent=fixtures["HomeTeam"], IsHome=0)
    return home_features, away_features


def predict_fixture_lambdas(fixtures: pd.DataFrame, poisson_model: Pipeline, state: TeamState) -> pd.DataFrame:
    match_lambdas = fixtures[["FixtureIndex", "ForecastRound", "HomeTeam", "AwayTeam", "FTHG", "FTAG"]].copy()
    if fixtures.empty:
        match_lambdas["lambda_home"] = []
        match_lambdas["lambda_away"] = []
        return match_lambdas

    home_features, away_features = build_fixture_features(fixtures, state)
    model_features = poisson_model.feature_names_in_
    match_lambdas["lambda_home"] = np.clip(poisson_model.predict(home_features[model_features]), 0.05, 5.0)
    match_lambdas["lambda_away"] = np.clip(poisson_model.predict(away_features[model_features]), 0.05, 5.0)
    return match_lambdas


def played_mask(fixtures: pd.DataFrame) -> pd.Series:
    return fixtures["FTHG"].notna() & fixtures["FTAG"].notna()


def build_standings(teams: list[str], played_matches: pd.DataFrame) -> list[dict[str, object]]:
    home_rows = pd.DataFrame({"teamKey": played_matches["HomeTeam"], "gf": played_matches["FTHG"], "ga": played_matches["FTAG"]})
    away_rows = pd.DataFrame({"teamKey": played_matches["AwayTeam"], "gf": played_matches["FTAG"], "ga": played_matches["FTHG"]})
    team_rows = pd.concat([home_rows, away_rows])
    team_rows["wins"] = team_rows["gf"] > team_rows["ga"]
    team_rows["draws"] = team_rows["gf"] == team_rows["ga"]
    team_rows["losses"] = team_rows["gf"] < team_rows["ga"]

    table = team_rows.groupby("teamKey").sum().reindex(teams, fill_value=0).astype(int)
    table["played"] = table["wins"] + table["draws"] + table["losses"]
    table["gd"] = table["gf"] - table["ga"]
    table["pts"] = 3 * table["wins"] + table["draws"]
    # przy rownej liczbie punktow, bilansie i golach zostaje kolejnosc alfabetyczna
    table = table.sort_values(["pts", "gd", "gf"], ascending=False, kind="stable").reset_index()
    table.insert(0, "rank", table.index + 1)
    table.insert(2, "team", table["teamKey"].map(display_name))
    table.insert(3, "slug", table["teamKey"].map(slug_for_team))
    columns = ["rank", "teamKey", "team", "slug", "played", "wins", "draws", "losses", "gf", "ga", "gd", "pts"]
    return table[columns].to_dict(orient="records")


def possible_rank_bounds(standings: list[dict[str, object]], remaining_matches: pd.DataFrame, teams: list[str]) -> dict[str, tuple[int, int]]:
    # granice sa ostrozne: rywal z rowna liczba punktow moze byc wyzej przez bilans, a wzajemne mecze rywali nie sa rozpisywane,
    # wiec "pewne" znaczy naprawde pewne, a czesc wyeliminowanych druzyn moze jeszcze wygladac na niewyeliminowane
    points = {row["teamKey"]: int(row["pts"]) for row in standings}
    games_left = pd.concat([remaining_matches["HomeTeam"], remaining_matches["AwayTeam"]]).value_counts()
    max_points = {team: points[team] + 3 * int(games_left.get(team, 0)) for team in teams}
    bounds = {}
    for team in teams:
        others = [other for other in teams if other != team]
        surely_above = sum(points[other] > max_points[team] for other in others)
        maybe_above = sum(max_points[other] >= points[team] for other in others)
        bounds[team] = (surely_above + 1, maybe_above + 1)
    return bounds


def team_uncertainty(history: pd.DataFrame, teams: list[str]) -> tuple[dict[str, float], dict[str, float]]:
    recent_seasons = sorted(history["SeasonFile"].unique())[-RECENT_HISTORY_SEASONS:]
    recent_history = history[history["SeasonFile"].isin(recent_seasons)]
    match_counts = pd.concat([recent_history["HomeTeam"], recent_history["AwayTeam"]]).value_counts()
    # 1 dla druzyny bez meczow w ostatnich sezonach, blisko 0 dla stalego bywalca ligi
    low_history = {team: np.exp(-match_counts.get(team, 0) / HISTORY_SCALE_MATCHES) for team in teams}
    uncertainty_sigma = {team: MIN_TEAM_UNCERTAINTY_SIGMA + (MAX_TEAM_UNCERTAINTY_SIGMA - MIN_TEAM_UNCERTAINTY_SIGMA) * weight for team, weight in low_history.items()}
    shrinkage = {team: MAX_LOW_HISTORY_SHRINKAGE * weight for team, weight in low_history.items()}
    return uncertainty_sigma, shrinkage


def venue_goal_means(model_rows: pd.DataFrame) -> tuple[float, float]:
    home_mean = float(model_rows.loc[model_rows["IsHome"] == 1, "Goals"].mean())
    away_mean = float(model_rows.loc[model_rows["IsHome"] == 0, "Goals"].mean())
    return home_mean, away_mean


def adjusted_lambdas(match_lambdas: pd.DataFrame, team_shrinkage: dict[str, float], home_goal_mean: float, away_goal_mean: float) -> pd.DataFrame:
    adjusted_matches = match_lambdas.copy()
    shrinkage = np.maximum(adjusted_matches["HomeTeam"].map(team_shrinkage), adjusted_matches["AwayTeam"].map(team_shrinkage))
    adjusted_matches["lambda_home"] = (1 - shrinkage) * adjusted_matches["lambda_home"] + shrinkage * home_goal_mean
    adjusted_matches["lambda_away"] = (1 - shrinkage) * adjusted_matches["lambda_away"] + shrinkage * away_goal_mean
    return adjusted_matches


def make_table_snapshot(teams: list[str], order: np.ndarray, points: np.ndarray, goals_for: np.ndarray, goals_against: np.ndarray, simulation_number: int) -> dict[str, object]:
    rows = [{
        "rank": rank,
        "team": display_name(teams[team]),
        "slug": slug_for_team(teams[team]),
        "pts": int(points[team]),
        "gf": int(goals_for[team]),
        "ga": int(goals_against[team]),
        "gd": int(goals_for[team] - goals_against[team]),
    } for rank, team in enumerate(order, start=1)]
    return {"simulation": simulation_number, "teams": rows}


def team_distributions(teams: list[str], position_counts: np.ndarray, points: np.ndarray) -> dict[str, dict[str, object]]:
    details = {}
    for index, team in enumerate(teams):
        team_points = points[:, index]
        lowest = int(team_points.min())
        details[slug_for_team(team)] = {
            "positionCounts": position_counts[index].tolist(),
            "pointsMin": lowest,
            "pointsCounts": np.bincount(team_points - lowest).tolist(),
        }
    return details


def simulate_table(standings: list[dict[str, object]], teams: list[str], adjusted_matches: pd.DataFrame, uncertainty_sigma: dict[str, float], simulations: int, seed: int, sample_tables: int) -> tuple[pd.DataFrame, list[dict[str, object]], dict[str, dict[str, object]]]:
    # wiersz macierzy to jeden symulowany sezon, kolumna to mecz albo druzyna
    random_generator = np.random.default_rng(seed)
    team_index = {team: index for index, team in enumerate(teams)}
    home = adjusted_matches["HomeTeam"].map(team_index).to_numpy(dtype=int)
    away = adjusted_matches["AwayTeam"].map(team_index).to_numpy(dtype=int)
    home_team_matrix = np.eye(len(teams), dtype=int)[home]
    away_team_matrix = np.eye(len(teams), dtype=int)[away]

    sigma = np.array([uncertainty_sigma[team] for team in teams])
    noise = np.clip(random_generator.normal(0.0, sigma, size=(simulations, len(teams))), -MAX_STRENGTH_NOISE, MAX_STRENGTH_NOISE)
    lambda_home = np.clip(adjusted_matches["lambda_home"].to_numpy() * np.exp(noise[:, home] - OPPONENT_NOISE_WEIGHT * noise[:, away]), 0.05, 5.0)
    lambda_away = np.clip(adjusted_matches["lambda_away"].to_numpy() * np.exp(noise[:, away] - OPPONENT_NOISE_WEIGHT * noise[:, home]), 0.05, 5.0)
    home_goals = random_generator.poisson(lambda_home)
    away_goals = random_generator.poisson(lambda_away)
    home_points = np.select([home_goals > away_goals, home_goals == away_goals], [3, 1], 0)
    away_points = np.select([away_goals > home_goals, home_goals == away_goals], [3, 1], 0)

    current = {row["teamKey"]: row for row in standings}
    points = np.array([current[team]["pts"] for team in teams]) + home_points @ home_team_matrix + away_points @ away_team_matrix
    goals_for = np.array([current[team]["gf"] for team in teams]) + home_goals @ home_team_matrix + away_goals @ away_team_matrix
    goals_against = np.array([current[team]["ga"] for team in teams]) + away_goals @ home_team_matrix + home_goals @ away_team_matrix

    # lexsort jest stabilny, wiec przy rownych punktach, bilansie i golach zostaje kolejnosc alfabetyczna
    order = np.lexsort((-goals_for, -(goals_for - goals_against), -points))
    position_counts = np.zeros((len(teams), len(teams)), dtype=int)
    np.add.at(position_counts, (order, np.arange(len(teams))), 1)

    title_count = position_counts[:, 0]
    top4_count = position_counts[:, :4].sum(axis=1)
    relegation_count = position_counts[:, -3:].sum(axis=1)
    forecast_table = pd.DataFrame({
        "teamKey": teams,
        "team": [display_name(team) for team in teams],
        "slug": [slug_for_team(team) for team in teams],
        "avgRank": ((position_counts @ np.arange(1, len(teams) + 1)) / simulations).round(2),
        "xPts": points.mean(axis=0).round(1),
        "xGF": goals_for.mean(axis=0).round(1),
        "xGA": goals_against.mean(axis=0).round(1),
        "xGD": (goals_for - goals_against).mean(axis=0).round(1),
        "title": (100 * title_count / simulations).round(1),
        "top4": (100 * top4_count / simulations).round(1),
        "relegation": (100 * relegation_count / simulations).round(1),
        "titleCount": title_count,
        "top4Count": top4_count,
        "relegationCount": relegation_count,
    })
    forecast_table = forecast_table.sort_values(by=["xPts", "xGD", "xGF"], ascending=False).reset_index(drop=True)
    forecast_table["rank"] = forecast_table.index + 1

    sample_generator = np.random.default_rng(seed + 1)
    sample_indices = sorted(sample_generator.choice(simulations, size=min(max(sample_tables, 0), simulations), replace=False))
    sampled_tables = [
        make_table_snapshot(teams, order[index], points[index], goals_for[index], goals_against[index], int(index) + 1)
        for index in sample_indices
    ]
    return forecast_table, sampled_tables, team_distributions(teams, position_counts, points)


def poisson_result_probs(lambda_home: float, lambda_away: float, max_goals: int = 12) -> tuple[float, float, float]:
    goals_axis = np.arange(max_goals + 1)
    score_matrix = np.outer(poisson.pmf(goals_axis, lambda_home), poisson.pmf(goals_axis, lambda_away))
    score_matrix = score_matrix / score_matrix.sum()
    home_win = float(np.tril(score_matrix, -1).sum() * 100)
    draw = float(np.trace(score_matrix) * 100)
    away_win = float(np.triu(score_matrix, 1).sum() * 100)
    return round(home_win, 1), round(draw, 1), round(away_win, 1)


def match_forecast(match, round_number: int) -> dict[str, object]:
    home_win, draw, away_win = poisson_result_probs(float(match.lambda_home), float(match.lambda_away))
    return {
        "fixture": int(match.FixtureIndex) + 1,
        "round": round_number,
        "homeTeam": display_name(match.HomeTeam),
        "awayTeam": display_name(match.AwayTeam),
        "homeSlug": slug_for_team(match.HomeTeam),
        "awaySlug": slug_for_team(match.AwayTeam),
        "lambdaHome": round(float(match.lambda_home), 2),
        "lambdaAway": round(float(match.lambda_away), 2),
        "homeWin": home_win,
        "draw": draw,
        "awayWin": away_win,
    }


def build_upcoming_fixtures(adjusted_matches: pd.DataFrame) -> list[dict[str, object]]:
    if adjusted_matches.empty:
        return []
    next_round = int(adjusted_matches["ForecastRound"].min())
    round_matches = adjusted_matches[adjusted_matches["ForecastRound"] == next_round]
    return [match_forecast(match, next_round) for match in round_matches.itertuples(index=False)]


def build_remaining_fixtures(adjusted_matches: pd.DataFrame) -> list[dict[str, object]]:
    return [match_forecast(match, int(match.ForecastRound)) for match in adjusted_matches.itertuples(index=False)]


def build_results(fixtures: pd.DataFrame, season_start: TeamState, poisson_model: Pipeline, team_shrinkage: dict[str, float], home_goal_mean: float, away_goal_mean: float) -> list[dict[str, object]]:
    played_fixtures = fixtures[played_mask(fixtures)]
    results: list[dict[str, object]] = []

    # prognoza kazdej kolejki liczona jest wylacznie na stanie sprzed jej rozegrania
    for round_number in sorted(played_fixtures["ForecastRound"].dropna().unique()):
        earlier_matches = played_fixtures[played_fixtures["ForecastRound"] < round_number]
        round_matches = played_fixtures[played_fixtures["ForecastRound"] == round_number]
        match_lambdas = predict_fixture_lambdas(round_matches, poisson_model, apply_results(season_start, earlier_matches))
        adjusted_matches = adjusted_lambdas(match_lambdas, team_shrinkage, home_goal_mean, away_goal_mean)

        for match in adjusted_matches.itertuples(index=False):
            home_goals, away_goals = int(match.FTHG), int(match.FTAG)
            outcome = "home" if home_goals > away_goals else "away" if away_goals > home_goals else "draw"
            results.append({**match_forecast(match, int(round_number)), "homeGoals": home_goals, "awayGoals": away_goals, "outcome": outcome})

    return results


def snapshot_id_and_label(played_rounds: int, played_matches: int, total_matches: int, round_size: int) -> tuple[str, str]:
    if played_matches == 0:
        return "round-0", "Przed sezonem"
    if played_rounds > 0 and played_matches == played_rounds * round_size:
        return f"round-{played_rounds}", f"Po {played_rounds}. kolejce"
    return f"current-{played_matches}", f"Aktualnie: {played_matches}/{total_matches} meczów"


def build_payload(args: argparse.Namespace, fixtures: pd.DataFrame | None = None, history: pd.DataFrame | None = None) -> dict[str, object]:
    history = load_history(args.history) if history is None else history
    model_rows = make_poisson_rows(history)
    poisson_model = train_poisson_model(model_rows)
    home_goal_mean, away_goal_mean = venue_goal_means(model_rows)

    fixtures = pd.read_csv(args.fixtures) if fixtures is None else fixtures.reset_index(drop=True)
    fixtures.insert(0, "FixtureIndex", range(len(fixtures)))
    fixtures = normalize_names(fixtures)
    fixtures["FTHG"] = pd.to_numeric(fixtures["FTHG"], errors="coerce")
    fixtures["FTAG"] = pd.to_numeric(fixtures["FTAG"], errors="coerce")
    fixtures["ForecastRound"] = fixtures.index // args.round_size + 1
    fixtures["SeasonFile"] = args.fixtures.name
    fixtures[VALUE_FEATURE] = squad_value_diff(fixtures, load_squad_values(args.squad_values)).fillna(0.0)

    played_matches = fixtures[played_mask(fixtures)].copy()
    remaining_matches = fixtures[~played_mask(fixtures)].copy()
    teams = sorted(set(fixtures["HomeTeam"]) | set(fixtures["AwayTeam"]))
    season_start = season_start_state(history, set(teams))
    match_lambdas = predict_fixture_lambdas(remaining_matches, poisson_model, apply_results(season_start, played_matches))

    standings = build_standings(teams, played_matches)
    uncertainty_sigma, shrinkage = team_uncertainty(history, teams)
    adjusted_matches = adjusted_lambdas(match_lambdas, shrinkage, home_goal_mean, away_goal_mean)
    forecast_table, sample_tables, team_details = simulate_table(standings, teams, adjusted_matches, uncertainty_sigma, args.simulations, args.seed, args.sample_tables)
    rank_bounds = possible_rank_bounds(standings, remaining_matches, teams)
    forecast_table["bestPossibleRank"] = forecast_table["teamKey"].map(lambda team: rank_bounds[team][0])
    forecast_table["worstPossibleRank"] = forecast_table["teamKey"].map(lambda team: rank_bounds[team][1])
    upcoming_fixtures = build_upcoming_fixtures(adjusted_matches)
    results = build_results(fixtures, season_start, poisson_model, shrinkage, home_goal_mean, away_goal_mean)
    total_matches = len(fixtures)
    played_matches_count = int(len(played_matches))
    played_rounds = int(played_mask(fixtures).groupby(fixtures["ForecastRound"]).all().sum())
    snapshot_id, snapshot_label = snapshot_id_and_label(played_rounds, played_matches_count, total_matches, args.round_size)

    return {
        "meta": {
            "simulations": args.simulations,
            "playedMatches": played_matches_count,
            "totalMatches": total_matches,
            "playedRounds": played_rounds,
            "nextRound": upcoming_fixtures[0]["round"] if upcoming_fixtures else None,
            "generatedAtUTC": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "snapshotId": snapshot_id,
            "snapshotLabel": snapshot_label,
        },
        "teams": forecast_table.to_dict(orient="records"),
        "standings": standings,
        "results": results,
        "upcomingFixtures": upcoming_fixtures,
        "remainingFixtures": build_remaining_fixtures(adjusted_matches),
        "teamDetails": team_details,
        "sampleTables": sample_tables,
    }


def write_js_data(path: Path, variable: str, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"window.{variable} = {json.dumps(payload, ensure_ascii=False, indent=4)};\n", encoding="utf-8")


def make_history_snapshot(payload: dict[str, object]) -> dict[str, object]:
    meta = payload["meta"]
    return {
        "id": meta["snapshotId"],
        "label": meta["snapshotLabel"],
        "playedRounds": meta["playedRounds"],
        "playedMatches": meta["playedMatches"],
        "simulations": meta["simulations"],
        "generatedAtUTC": meta["generatedAtUTC"],
        "teams": [{field: team[field] for field in HISTORY_TEAM_FIELDS} for team in payload["teams"]],
    }


def read_forecast_history(history_path: Path) -> dict[str, object]:
    if not history_path.exists():
        return {"snapshots": []}
    json_text = history_path.read_text(encoding="utf-8").split("=", 1)[1].strip().removesuffix(";")
    return json.loads(json_text)


def add_history_snapshot(history_payload: dict[str, object], payload: dict[str, object]) -> dict[str, object]:
    # migawki zapisujemy tylko po pelnych kolejkach, stan w trakcie kolejki pokazuje sama strona
    if not payload["meta"]["snapshotId"].startswith("round-"):
        return history_payload

    snapshot = make_history_snapshot(payload)
    snapshots = [item for item in history_payload["snapshots"] if item.get("id") != snapshot["id"]]
    snapshots.append(snapshot)
    snapshots.sort(key=lambda item: int(item.get("playedRounds") or 0))
    return {**history_payload, "snapshots": snapshots}


def write_forecast_history(payload: dict[str, object], history_path: Path) -> dict[str, object]:
    history_payload = read_forecast_history(history_path)
    updated = add_history_snapshot(history_payload, payload)
    if updated is not history_payload:
        write_js_data(history_path, "forecastHistory", updated)
    return updated


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Poisson Monte Carlo forecast and write web data.")
    parser.add_argument("--history", type=Path, default=DEFAULT_HISTORY_PATH)
    parser.add_argument("--fixtures", type=Path, default=DEFAULT_FIXTURE_PATH)
    parser.add_argument("--squad-values", type=Path, default=DEFAULT_SQUAD_VALUES_PATH)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_PATH)
    parser.add_argument("--forecast-history-output", type=Path, default=DEFAULT_FORECAST_HISTORY_PATH)
    parser.add_argument("--simulations", type=int, default=10000)
    parser.add_argument("--sample-tables", type=int, default=80)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--round-size", type=int, default=ROUND_SIZE)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    payload = build_payload(args)
    write_js_data(args.output, "forecastData", payload)
    history_payload = write_forecast_history(payload, args.forecast_history_output)
    meta = payload["meta"]
    print(f"Zapisano dane strony: {args.output}")
    print(f"Zapisano snapshotow historii: {len(history_payload['snapshots'])}")
    print(f"Rozegrane mecze: {meta['playedMatches']}/{meta['totalMatches']}")
    print(f"Rozegrane pelne kolejki: {meta['playedRounds']}")
    if payload["upcomingFixtures"]:
        print(f"Najblizsza kolejka w zakladce: {payload['upcomingFixtures'][0]['round']}")


if __name__ == "__main__":
    main()
