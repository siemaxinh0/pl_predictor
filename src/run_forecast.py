from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import PoissonRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

# zmiana liczby symulacji: .\venv\Scripts\python.exe src\run_forecast.py --simulations 10000

# procedura dodawania meczow:
# 1 sprawdzamy nr meczu .\venv\Scripts\python.exe src\add_result.py --list
# 2 dopisanie wyniku i przeliczenie strony .\venv\Scripts\python.exe src\add_result.py --fixture 1 --score 2-0 --run-forecast
# 3 poprawa juz wpisanego wyniku .\venv\Scripts\python.exe src\add_result.py --fixture 1 --score 1-1 --force --run-forecast

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_HISTORY_PATH = ROOT / "data" / "processed" / "PL_base_with_traits.csv"
DEFAULT_FIXTURE_PATH = ROOT / "data" / "raw" / "pl_seasons" / "season-2627.csv"
DEFAULT_SQUAD_VALUES_PATH = ROOT / "data" / "raw" / "squad_values_by_season.csv"
DEFAULT_OUTPUT_PATH = ROOT / "web" / "forecast-data.js"
DEFAULT_FORECAST_HISTORY_PATH = ROOT / "web" / "forecast-history.js"

TEAM_NAME_MAP = {
    "AFC Bournemouth": "Bournemouth",
    "Brighton & Hove Albion": "Brighton",
    "Brighton and Hove Albion": "Brighton",
    "Hull City": "Hull",
    "Manchester City": "Man City",
    "Manchester United": "Man United",
    "Newcastle United": "Newcastle",
    "Nottingham Forest": "Nott'm Forest",
    "Tottenham Hotspur": "Tottenham",
    "West Ham United": "West Ham",
    "Wolverhampton Wanderers": "Wolves",
    "Leeds United": "Leeds",
    "Cardiff City": "Cardiff",
}

DISPLAY_NAME_MAP = {
    "Man City": "Manchester City",
    "Man United": "Manchester United",
    "Nott'm Forest": "Nottingham Forest",
}

DIFF_FEATURES = ["EloDiff", "FormDiff", "VenueFormDiff", "H2HDiff"]
VALUE_FEATURE = "SquadValueDiff"
CATEGORICAL_FEATURES = ["Team", "Opponent"]
RECENT_HISTORY_SEASONS = 3
HISTORY_SCALE_MATCHES = 76
MIN_TEAM_UNCERTAINTY_SIGMA = 0.02
MAX_TEAM_UNCERTAINTY_SIGMA = 0.12
MAX_LOW_HISTORY_SHRINKAGE = 0.50
OPPONENT_NOISE_WEIGHT = 0.35
MAX_STRENGTH_NOISE = 0.18
ELO_K = 20
HOME_ADVANTAGE_ELO = 60
HISTORY_TEAM_FIELDS = [
    "rank", "teamKey", "team", "slug", "xPts", "xGF", "xGA", "xGD",
    "title", "top4", "relegation", "titleCount", "top4Count", "relegationCount",
]


def normalize_team_name(name: object) -> str:
    cleaned_name = str(name).strip()
    return TEAM_NAME_MAP.get(cleaned_name, cleaned_name)


def display_name(team: str) -> str:
    return DISPLAY_NAME_MAP.get(team, team)


def slug_for_team(team: str) -> str:
    return team.lower().replace("'", "").replace(".", "").replace(" ", "-")


def normalize_match_names(matches: pd.DataFrame) -> pd.DataFrame:
    normalized_matches = matches.copy()
    normalized_matches["HomeTeam"] = normalized_matches["HomeTeam"].map(normalize_team_name)
    normalized_matches["AwayTeam"] = normalized_matches["AwayTeam"].map(normalize_team_name)
    return normalized_matches


def result_points(home_goals: int, away_goals: int) -> tuple[int, int]:
    if home_goals > away_goals:
        return 3, 0
    if away_goals > home_goals:
        return 0, 3
    return 1, 1


def expected_home_score(home_elo: float, away_elo: float) -> float:
    return 1 / (1 + 10 ** ((away_elo - (home_elo + HOME_ADVANTAGE_ELO)) / 400))


def update_elo(home_elo: float, away_elo: float, home_goals: int, away_goals: int) -> tuple[float, float]:
    home_score, away_score = result_points(home_goals, away_goals)
    actual_home_score = home_score / 3 if home_score != 1 else 0.5
    actual_away_score = away_score / 3 if away_score != 1 else 0.5
    expected_home = expected_home_score(home_elo, away_elo)
    expected_away = 1 - expected_home
    new_home_elo = home_elo + ELO_K * (actual_home_score - expected_home)
    new_away_elo = away_elo + ELO_K * (actual_away_score - expected_away)
    return new_home_elo, new_away_elo


def add_score_to_histories(point_history: dict[str, list[int]], home_point_history: dict[str, list[int]], away_point_history: dict[str, list[int]], h2h_history: dict[tuple[str, str], list[int]], home_team: str, away_team: str, home_goals: int, away_goals: int) -> None:
    home_points, away_points = result_points(home_goals, away_goals)
    point_history[home_team].append(home_points)
    point_history[away_team].append(away_points)
    home_point_history[home_team].append(home_points)
    away_point_history[away_team].append(away_points)
    h2h_history[(home_team, away_team)].append(home_points)
    h2h_history[(away_team, home_team)].append(away_points)
    h2h_history[(home_team, away_team)] = h2h_history[(home_team, away_team)][-5:]
    h2h_history[(away_team, home_team)] = h2h_history[(away_team, home_team)][-5:]


def load_squad_values(squad_values_path: Path) -> dict[tuple[str, str], float]:
    if not squad_values_path.exists():
        return {}
    squad_values = pd.read_csv(squad_values_path)
    squad_values["Team"] = squad_values["Team"].map(normalize_team_name)
    squad_values = squad_values.drop_duplicates(["SeasonFile", "Team"])
    return {(row.SeasonFile, row.Team): float(row.SquadValueEUR) for row in squad_values.itertuples(index=False)}


def squad_value_diff(matches: pd.DataFrame, squad_values: dict[tuple[str, str], float], seasons) -> pd.Series:
    home_values = [squad_values.get(key, np.nan) for key in zip(seasons, matches["HomeTeam"])]
    away_values = [squad_values.get(key, np.nan) for key in zip(seasons, matches["AwayTeam"])]
    return pd.Series(np.log(home_values) - np.log(away_values), index=matches.index, dtype=float)


def load_history(history_path: Path, squad_values: dict[tuple[str, str], float]) -> pd.DataFrame:
    history = pd.read_csv(history_path)
    history = normalize_match_names(history.dropna(subset=["HomeTeam", "AwayTeam", "FTHG", "FTAG"]).copy())
    # wartosc kadry wchodzi do modelu tylko wtedy, gdy jest znana dla kazdego meczu historii
    value_diff = squad_value_diff(history, squad_values, history["SeasonFile"])
    if squad_values and value_diff.notna().all():
        history[VALUE_FEATURE] = value_diff
    return history


def model_diff_features(frame: pd.DataFrame) -> list[str]:
    return DIFF_FEATURES + ([VALUE_FEATURE] if VALUE_FEATURE in frame.columns else [])


def make_poisson_rows(history: pd.DataFrame) -> pd.DataFrame:
    diff_features = model_diff_features(history)
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


def train_poisson_model(model_rows: pd.DataFrame) -> Pipeline:
    numeric_features = ["IsHome"] + model_diff_features(model_rows)
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


def build_state(history: pd.DataFrame, played_matches: pd.DataFrame) -> tuple[dict[str, float], dict[str, list[int]], dict[str, list[int]], dict[str, list[int]], dict[tuple[str, str], list[int]]]:
    last_home = history.groupby("HomeTeam").tail(1).set_index("HomeTeam")
    last_away = history.groupby("AwayTeam").tail(1).set_index("AwayTeam")
    all_history_teams = sorted(set(history["HomeTeam"]) | set(history["AwayTeam"]))
    current_elo: dict[str, float] = {}

    for team in all_history_teams:
        elo_values = []
        if team in last_home.index:
            elo_values.append(float(last_home.at[team, "HomeElo"]))
        if team in last_away.index:
            elo_values.append(float(last_away.at[team, "AwayElo"]))
        current_elo[team] = float(np.mean(elo_values)) if elo_values else 1400.0

    point_history: dict[str, list[int]] = defaultdict(list)
    home_point_history: dict[str, list[int]] = defaultdict(list)
    away_point_history: dict[str, list[int]] = defaultdict(list)
    h2h_history: dict[tuple[str, str], list[int]] = defaultdict(list)

    for match in history.itertuples(index=False):
        add_score_to_histories(
            point_history,
            home_point_history,
            away_point_history,
            h2h_history,
            match.HomeTeam,
            match.AwayTeam,
            int(match.FTHG),
            int(match.FTAG),
        )

    for match in played_matches.itertuples(index=False):
        home_team = match.HomeTeam
        away_team = match.AwayTeam
        home_goals = int(match.FTHG)
        away_goals = int(match.FTAG)
        current_elo.setdefault(home_team, 1400.0)
        current_elo.setdefault(away_team, 1400.0)
        new_home_elo, new_away_elo = update_elo(current_elo[home_team], current_elo[away_team], home_goals, away_goals)
        current_elo[home_team] = new_home_elo
        current_elo[away_team] = new_away_elo
        add_score_to_histories(
            point_history,
            home_point_history,
            away_point_history,
            h2h_history,
            home_team,
            away_team,
            home_goals,
            away_goals,
        )

    return current_elo, point_history, home_point_history, away_point_history, h2h_history


def latest_form(point_history: dict[str, list[int]], home_point_history: dict[str, list[int]], away_point_history: dict[str, list[int]], team: str, venue: str | None = None) -> float:
    if venue == "home" and home_point_history.get(team):
        return float(np.mean(home_point_history[team][-5:]))
    if venue == "away" and away_point_history.get(team):
        return float(np.mean(away_point_history[team][-5:]))
    if point_history.get(team):
        return float(np.mean(point_history[team][-5:]))
    return 1.0


def h2h_average(h2h_history: dict[tuple[str, str], list[int]], team: str, opponent: str) -> float:
    values = h2h_history.get((team, opponent), [])
    return float(np.mean(values)) if values else 1.0


def fixture_feature_row(team: str, opponent: str, is_home: int, venue_team: str, venue_opponent: str, value_diff: float, state: tuple) -> dict[str, float | str | int]:
    current_elo, point_history, home_point_history, away_point_history, h2h_history = state
    return {
        "Team": team,
        "Opponent": opponent,
        "IsHome": is_home,
        "EloDiff": current_elo.get(team, 1400.0) - current_elo.get(opponent, 1400.0),
        "FormDiff": latest_form(point_history, home_point_history, away_point_history, team) - latest_form(point_history, home_point_history, away_point_history, opponent),
        "VenueFormDiff": latest_form(point_history, home_point_history, away_point_history, team, venue_team) - latest_form(point_history, home_point_history, away_point_history, opponent, venue_opponent),
        "H2HDiff": h2h_average(h2h_history, team, opponent) - h2h_average(h2h_history, opponent, team),
        VALUE_FEATURE: value_diff,
    }


def build_fixture_features(fixtures: pd.DataFrame, state: tuple) -> tuple[pd.DataFrame, pd.DataFrame]:
    home_features = []
    away_features = []
    for match in fixtures.itertuples(index=False):
        home_features.append(fixture_feature_row(match.HomeTeam, match.AwayTeam, 1, "home", "away", match.SquadValueDiff, state))
        away_features.append(fixture_feature_row(match.AwayTeam, match.HomeTeam, 0, "away", "home", -match.SquadValueDiff, state))
    return pd.DataFrame(home_features), pd.DataFrame(away_features)


def predict_fixture_lambdas(fixtures: pd.DataFrame, poisson_model: Pipeline, state: tuple) -> pd.DataFrame:
    match_lambdas = fixtures[["FixtureIndex", "ForecastRound", "HomeTeam", "AwayTeam"]].copy()
    if fixtures.empty:
        match_lambdas["lambda_home"] = []
        match_lambdas["lambda_away"] = []
        return match_lambdas

    home_features, away_features = build_fixture_features(fixtures, state)
    model_features = poisson_model.feature_names_in_
    match_lambdas["lambda_home"] = np.clip(poisson_model.predict(home_features[model_features]), 0.05, 5.0)
    match_lambdas["lambda_away"] = np.clip(poisson_model.predict(away_features[model_features]), 0.05, 5.0)
    return match_lambdas


def forecast_rounds(fixtures: pd.DataFrame, fallback_round_size: int) -> pd.Series:
    for column in ["Round", "Matchweek", "Gameweek", "GW"]:
        if column in fixtures.columns:
            return pd.to_numeric(fixtures[column], errors="coerce")
    return pd.Series((np.arange(len(fixtures)) // fallback_round_size) + 1, index=fixtures.index)


def played_mask(fixtures: pd.DataFrame) -> pd.Series:
    return fixtures["FTHG"].notna() & fixtures["FTAG"].notna()


def sort_table_teams(teams: list[str], table: dict[str, dict[str, int]]) -> list[str]:
    return sorted(teams, key=lambda team: (table[team]["Pts"], table[team]["GF"] - table[team]["GA"], table[team]["GF"]), reverse=True)


def build_standings(teams: list[str], played_matches: pd.DataFrame) -> list[dict[str, object]]:
    stats = {team: {"Pts": 0, "GF": 0, "GA": 0, "Played": 0, "Wins": 0, "Draws": 0, "Losses": 0} for team in teams}

    for match in played_matches.itertuples(index=False):
        home_team = match.HomeTeam
        away_team = match.AwayTeam
        home_goals = int(match.FTHG)
        away_goals = int(match.FTAG)
        stats.setdefault(home_team, {"Pts": 0, "GF": 0, "GA": 0, "Played": 0, "Wins": 0, "Draws": 0, "Losses": 0})
        stats.setdefault(away_team, {"Pts": 0, "GF": 0, "GA": 0, "Played": 0, "Wins": 0, "Draws": 0, "Losses": 0})
        home_points, away_points = result_points(home_goals, away_goals)
        stats[home_team]["Played"] += 1
        stats[away_team]["Played"] += 1
        stats[home_team]["Pts"] += home_points
        stats[away_team]["Pts"] += away_points
        stats[home_team]["GF"] += home_goals
        stats[home_team]["GA"] += away_goals
        stats[away_team]["GF"] += away_goals
        stats[away_team]["GA"] += home_goals

        if home_goals > away_goals:
            stats[home_team]["Wins"] += 1
            stats[away_team]["Losses"] += 1
        elif away_goals > home_goals:
            stats[away_team]["Wins"] += 1
            stats[home_team]["Losses"] += 1
        else:
            stats[home_team]["Draws"] += 1
            stats[away_team]["Draws"] += 1

    rows = []
    for rank, team in enumerate(sort_table_teams(list(stats.keys()), stats), start=1):
        team_stats = stats[team]
        rows.append({
            "rank": rank,
            "teamKey": team,
            "team": display_name(team),
            "slug": slug_for_team(team),
            "played": team_stats["Played"],
            "wins": team_stats["Wins"],
            "draws": team_stats["Draws"],
            "losses": team_stats["Losses"],
            "gf": team_stats["GF"],
            "ga": team_stats["GA"],
            "gd": team_stats["GF"] - team_stats["GA"],
            "pts": team_stats["Pts"],
        })

    return rows


def team_uncertainty(history: pd.DataFrame, teams: list[str]) -> tuple[dict[str, float], dict[str, float]]:
    recent_seasons = sorted(history["SeasonFile"].unique())[-RECENT_HISTORY_SEASONS:]
    recent_history = history[history["SeasonFile"].isin(recent_seasons)]
    recent_match_count = {
        team: int(((recent_history["HomeTeam"] == team) | (recent_history["AwayTeam"] == team)).sum())
        for team in teams
    }
    uncertainty_sigma = {
        team: MIN_TEAM_UNCERTAINTY_SIGMA + (MAX_TEAM_UNCERTAINTY_SIGMA - MIN_TEAM_UNCERTAINTY_SIGMA) * np.exp(-recent_match_count[team] / HISTORY_SCALE_MATCHES)
        for team in teams
    }
    shrinkage = {
        team: MAX_LOW_HISTORY_SHRINKAGE * np.exp(-recent_match_count[team] / HISTORY_SCALE_MATCHES)
        for team in teams
    }
    return uncertainty_sigma, shrinkage


def venue_goal_means(model_rows: pd.DataFrame) -> tuple[float, float]:
    home_mean = float(model_rows.loc[model_rows["IsHome"] == 1, "Goals"].mean())
    away_mean = float(model_rows.loc[model_rows["IsHome"] == 0, "Goals"].mean())
    return home_mean, away_mean


def adjusted_lambdas(
    match_lambdas: pd.DataFrame,
    team_shrinkage: dict[str, float],
    home_goal_mean: float,
    away_goal_mean: float,
) -> pd.DataFrame:
    adjusted_matches = match_lambdas.copy()
    if adjusted_matches.empty:
        return adjusted_matches

    home_lambdas = []
    away_lambdas = []
    for match in match_lambdas.itertuples(index=False):
        fixture_shrinkage = max(team_shrinkage[match.HomeTeam], team_shrinkage[match.AwayTeam])
        home_lambdas.append((1 - fixture_shrinkage) * match.lambda_home + fixture_shrinkage * home_goal_mean)
        away_lambdas.append((1 - fixture_shrinkage) * match.lambda_away + fixture_shrinkage * away_goal_mean)

    adjusted_matches["lambda_home"] = home_lambdas
    adjusted_matches["lambda_away"] = away_lambdas
    return adjusted_matches


def make_table_snapshot(sorted_teams: list[str], table: dict[str, dict[str, int]], simulation_number: int) -> dict[str, object]:
    rows = []
    for rank, team in enumerate(sorted_teams, start=1):
        goals_for = table[team]["GF"]
        goals_against = table[team]["GA"]
        rows.append({
            "rank": rank,
            "team": display_name(team),
            "slug": slug_for_team(team),
            "pts": table[team]["Pts"],
            "gf": goals_for,
            "ga": goals_against,
            "gd": goals_for - goals_against,
        })

    return {
        "simulation": simulation_number,
        "teams": rows,
    }


def simulate_table(base_table: dict[str, dict[str, int]], teams: list[str], adjusted_matches: pd.DataFrame, uncertainty_sigma: dict[str, float], simulations: int, seed: int, sample_tables: int) -> tuple[pd.DataFrame, list[dict[str, object]]]:
    random_generator = np.random.default_rng(seed)
    sample_generator = np.random.default_rng(seed + 1)
    sample_size = min(max(sample_tables, 0), simulations)
    sample_indices = set(sample_generator.choice(simulations, size=sample_size, replace=False).tolist()) if sample_size else set()
    sampled_tables = []
    positions_count = {team: np.zeros(len(teams), dtype=int) for team in teams}
    total_points = {team: 0 for team in teams}
    total_goals_for = {team: 0 for team in teams}
    total_goals_against = {team: 0 for team in teams}

    for simulation_index in range(simulations):
        table = {team: stats.copy() for team, stats in base_table.items()}
        strength_noise = {
            team: float(np.clip(random_generator.normal(0, uncertainty_sigma[team]), -MAX_STRENGTH_NOISE, MAX_STRENGTH_NOISE))
            for team in teams
        }

        for match in adjusted_matches.itertuples(index=False):
            home_team = match.HomeTeam
            away_team = match.AwayTeam
            lambda_home = match.lambda_home * np.exp(strength_noise[home_team] - OPPONENT_NOISE_WEIGHT * strength_noise[away_team])
            lambda_away = match.lambda_away * np.exp(strength_noise[away_team] - OPPONENT_NOISE_WEIGHT * strength_noise[home_team])
            lambda_home = float(np.clip(lambda_home, 0.05, 5.0))
            lambda_away = float(np.clip(lambda_away, 0.05, 5.0))
            home_goals = int(random_generator.poisson(lambda_home))
            away_goals = int(random_generator.poisson(lambda_away))
            home_points, away_points = result_points(home_goals, away_goals)

            table[home_team]["Pts"] += home_points
            table[away_team]["Pts"] += away_points
            table[home_team]["GF"] += home_goals
            table[home_team]["GA"] += away_goals
            table[away_team]["GF"] += away_goals
            table[away_team]["GA"] += home_goals

        sorted_teams = sort_table_teams(teams, table)
        for rank, team in enumerate(sorted_teams):
            positions_count[team][rank] += 1

        if simulation_index in sample_indices:
            sampled_tables.append(make_table_snapshot(sorted_teams, table, simulation_index + 1))

        for team in teams:
            total_points[team] += table[team]["Pts"]
            total_goals_for[team] += table[team]["GF"]
            total_goals_against[team] += table[team]["GA"]

    rows = []
    for team in teams:
        chances = positions_count[team] / simulations
        title_count = int(positions_count[team][0])
        top4_count = int(np.sum(positions_count[team][:4]))
        relegation_count = int(np.sum(positions_count[team][-3:]))
        expected_goals_for = total_goals_for[team] / simulations
        expected_goals_against = total_goals_against[team] / simulations
        rows.append({
            "teamKey": team,
            "team": display_name(team),
            "slug": slug_for_team(team),
            "xPts": round(total_points[team] / simulations, 1),
            "xGF": round(expected_goals_for, 1),
            "xGA": round(expected_goals_against, 1),
            "xGD": round(expected_goals_for - expected_goals_against, 1),
            "title": round(float(chances[0] * 100), 1),
            "top4": round(float(np.sum(chances[:4]) * 100), 1),
            "relegation": round(float(np.sum(chances[-3:]) * 100), 1),
            "titleCount": title_count,
            "top4Count": top4_count,
            "relegationCount": relegation_count,
        })

    forecast_table = pd.DataFrame(rows).sort_values(by=["xPts", "xGD", "xGF"], ascending=False).reset_index(drop=True)
    forecast_table["rank"] = forecast_table.index + 1
    sampled_tables = sorted(sampled_tables, key=lambda item: int(item["simulation"]))
    return forecast_table, sampled_tables


def poisson_result_probs(lambda_home: float, lambda_away: float, max_goals: int = 12) -> tuple[float, float, float]:
    goals_axis = np.arange(max_goals + 1)
    factorials = np.array([math.factorial(int(goal)) for goal in goals_axis])
    home_pmf = np.exp(-lambda_home) * np.power(lambda_home, goals_axis) / factorials
    away_pmf = np.exp(-lambda_away) * np.power(lambda_away, goals_axis) / factorials
    score_matrix = np.outer(home_pmf, away_pmf)
    score_matrix = score_matrix / score_matrix.sum()
    home_win = float(np.tril(score_matrix, -1).sum() * 100)
    draw = float(np.trace(score_matrix) * 100)
    away_win = float(np.triu(score_matrix, 1).sum() * 100)
    return round(home_win, 1), round(draw, 1), round(away_win, 1)


def build_upcoming_fixtures(adjusted_matches: pd.DataFrame) -> list[dict[str, object]]:
    if adjusted_matches.empty:
        return []

    next_round = int(adjusted_matches["ForecastRound"].min())
    round_matches = adjusted_matches[adjusted_matches["ForecastRound"] == next_round].copy()
    upcoming_fixtures = []

    for match in round_matches.itertuples(index=False):
        home_win, draw, away_win = poisson_result_probs(float(match.lambda_home), float(match.lambda_away))
        upcoming_fixtures.append({
            "fixture": int(match.FixtureIndex) + 1,
            "round": next_round,
            "homeTeam": display_name(match.HomeTeam),
            "awayTeam": display_name(match.AwayTeam),
            "homeSlug": slug_for_team(match.HomeTeam),
            "awaySlug": slug_for_team(match.AwayTeam),
            "lambdaHome": round(float(match.lambda_home), 2),
            "lambdaAway": round(float(match.lambda_away), 2),
            "homeWin": home_win,
            "draw": draw,
            "awayWin": away_win,
        })

    return upcoming_fixtures


def build_results(fixtures: pd.DataFrame, history: pd.DataFrame, poisson_model: Pipeline, team_shrinkage: dict[str, float], home_goal_mean: float, away_goal_mean: float) -> list[dict[str, object]]:
    played_fixtures = fixtures[played_mask(fixtures)].copy()
    if played_fixtures.empty:
        return []

    actual_scores = {
        int(match.FixtureIndex): (int(match.FTHG), int(match.FTAG))
        for match in played_fixtures.itertuples(index=False)
    }
    results: list[dict[str, object]] = []

    # prognoza kazdej kolejki liczona jest wylacznie na stanie sprzed jej rozegrania
    for round_number in sorted(played_fixtures["ForecastRound"].dropna().unique()):
        earlier_matches = played_fixtures[played_fixtures["ForecastRound"] < round_number]
        round_matches = played_fixtures[played_fixtures["ForecastRound"] == round_number]
        match_lambdas = predict_fixture_lambdas(round_matches, poisson_model, build_state(history, earlier_matches))
        adjusted_matches = adjusted_lambdas(match_lambdas, team_shrinkage, home_goal_mean, away_goal_mean)

        for match in adjusted_matches.itertuples(index=False):
            home_goals, away_goals = actual_scores[int(match.FixtureIndex)]
            home_win, draw, away_win = poisson_result_probs(float(match.lambda_home), float(match.lambda_away))
            if home_goals > away_goals:
                outcome = "home"
            elif away_goals > home_goals:
                outcome = "away"
            else:
                outcome = "draw"

            results.append({
                "fixture": int(match.FixtureIndex) + 1,
                "round": int(round_number),
                "homeTeam": display_name(match.HomeTeam),
                "awayTeam": display_name(match.AwayTeam),
                "homeSlug": slug_for_team(match.HomeTeam),
                "awaySlug": slug_for_team(match.AwayTeam),
                "homeGoals": home_goals,
                "awayGoals": away_goals,
                "outcome": outcome,
                "lambdaHome": round(float(match.lambda_home), 2),
                "lambdaAway": round(float(match.lambda_away), 2),
                "homeWin": home_win,
                "draw": draw,
                "awayWin": away_win,
            })

    return results


def complete_rounds_count(fixtures: pd.DataFrame) -> int:
    full_rounds = 0
    for _round_number, round_matches in fixtures.groupby("ForecastRound"):
        if played_mask(round_matches).all():
            full_rounds += 1
    return full_rounds


def snapshot_id_and_label(played_rounds: int, played_matches: int, total_matches: int) -> tuple[str, str]:
    if played_matches == 0:
        return "round-0", "Przed sezonem"
    if played_rounds > 0:
        return f"round-{played_rounds}", f"Po {played_rounds}. kolejce"
    return f"current-{played_matches}", f"Aktualnie: {played_matches}/{total_matches} meczów"


def build_payload(args: argparse.Namespace) -> dict[str, object]:
    squad_values = load_squad_values(args.squad_values)
    history = load_history(args.history, squad_values)
    model_rows = make_poisson_rows(history)
    poisson_model = train_poisson_model(model_rows)
    home_goal_mean, away_goal_mean = venue_goal_means(model_rows)

    fixtures = pd.read_csv(args.fixtures)
    fixtures.insert(0, "FixtureIndex", range(len(fixtures)))
    fixtures = normalize_match_names(fixtures)
    fixtures["FTHG"] = pd.to_numeric(fixtures["FTHG"], errors="coerce")
    fixtures["FTAG"] = pd.to_numeric(fixtures["FTAG"], errors="coerce")
    fixtures["ForecastRound"] = forecast_rounds(fixtures, args.round_size)
    fixtures[VALUE_FEATURE] = squad_value_diff(fixtures, squad_values, [args.fixtures.name] * len(fixtures)).fillna(0.0)

    played_matches = fixtures[played_mask(fixtures)].copy()
    remaining_matches = fixtures[~played_mask(fixtures)].copy()
    match_lambdas = predict_fixture_lambdas(remaining_matches, poisson_model, build_state(history, played_matches))

    teams = sorted(set(fixtures["HomeTeam"]) | set(fixtures["AwayTeam"]))
    standings = build_standings(teams, played_matches)
    base_table = {row["teamKey"]: {"Pts": row["pts"], "GF": row["gf"], "GA": row["ga"]} for row in standings}
    uncertainty_sigma, shrinkage = team_uncertainty(history, teams)
    adjusted_matches = adjusted_lambdas(match_lambdas, shrinkage, home_goal_mean, away_goal_mean)
    forecast_table, sample_tables = simulate_table(base_table, teams, adjusted_matches, uncertainty_sigma, args.simulations, args.seed, args.sample_tables)
    upcoming_fixtures = build_upcoming_fixtures(adjusted_matches)
    results = build_results(fixtures, history, poisson_model, shrinkage, home_goal_mean, away_goal_mean)
    total_matches = len(fixtures)
    played_matches_count = int(len(played_matches))
    played_rounds = complete_rounds_count(fixtures)
    snapshot_id, snapshot_label = snapshot_id_and_label(played_rounds, played_matches_count, total_matches)

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
        "sampleTables": sample_tables,
    }


def write_forecast_data(payload: dict[str, object], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    json_payload = json.dumps(payload, ensure_ascii=False, indent=4)
    output_path.write_text(f"window.forecastData = {json_payload};\n", encoding="utf-8")


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


def write_forecast_history(payload: dict[str, object], history_path: Path) -> dict[str, object]:
    history_payload = read_forecast_history(history_path)
    # migawki zapisujemy tylko po pelnych kolejkach, stan w trakcie kolejki pokazuje sama strona
    if not payload["meta"]["snapshotId"].startswith("round-"):
        return history_payload

    snapshot = make_history_snapshot(payload)
    snapshots = [item for item in history_payload["snapshots"] if item.get("id") != snapshot["id"]]
    snapshots.append(snapshot)
    snapshots.sort(key=lambda item: int(item.get("playedRounds") or 0))
    history_payload["snapshots"] = snapshots

    history_path.parent.mkdir(parents=True, exist_ok=True)
    json_payload = json.dumps(history_payload, ensure_ascii=False, indent=4)
    history_path.write_text(f"window.forecastHistory = {json_payload};\n", encoding="utf-8")
    return history_payload


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
    parser.add_argument("--round-size", type=int, default=10)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    payload = build_payload(args)
    write_forecast_data(payload, args.output)
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
