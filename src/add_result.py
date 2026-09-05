from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FIXTURE_PATH = ROOT / "data" / "raw" / "pl_seasons" / "season-2627.csv"
RUN_FORECAST_PATH = ROOT / "src" / "run_forecast.py"

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


def normalize_team_name(name: object) -> str:
    cleaned_name = str(name).strip()
    return TEAM_NAME_MAP.get(cleaned_name, cleaned_name)


def parse_score(score: str | None, home_goals: int | None, away_goals: int | None) -> tuple[int, int]:
    if score:
        normalized_score = score.replace(":", "-").strip()
        parts = normalized_score.split("-")
        if len(parts) != 2:
            raise ValueError("Score must look like 2-1 or 2:1.")
        return int(parts[0]), int(parts[1])

    if home_goals is None or away_goals is None:
        raise ValueError("Pass --score 2-1 or both --home-goals and --away-goals.")

    return home_goals, away_goals


def status_for_row(row: pd.Series) -> str:
    if pd.notna(row["FTHG"]) and pd.notna(row["FTAG"]):
        return f"{int(row['FTHG'])}-{int(row['FTAG'])}"
    return "bez wyniku"


def print_fixtures(fixtures: pd.DataFrame) -> None:
    for row_number, row in fixtures.iterrows():
        fixture_number = row_number + 1
        print(f"{fixture_number:03d}. {row['HomeTeam']} - {row['AwayTeam']} [{status_for_row(row)}]")


def find_fixture(fixtures: pd.DataFrame, fixture_number: int | None, home_team: str | None, away_team: str | None) -> int:
    if fixture_number is not None:
        fixture_index = fixture_number - 1
        if fixture_index < 0 or fixture_index >= len(fixtures):
            raise ValueError(f"Fixture number must be between 1 and {len(fixtures)}.")
        return fixture_index

    if not home_team or not away_team:
        raise ValueError("Pass --fixture or both --home and --away.")

    normalized_home = normalize_team_name(home_team)
    normalized_away = normalize_team_name(away_team)
    matches = fixtures[
        fixtures["HomeTeam"].map(normalize_team_name).eq(normalized_home)
        & fixtures["AwayTeam"].map(normalize_team_name).eq(normalized_away)
    ]

    if matches.empty:
        raise ValueError(f"Fixture not found: {home_team} - {away_team}.")
    if len(matches) > 1:
        raise ValueError("More than one matching fixture found. Use --fixture with the row number from --list.")

    return int(matches.index[0])


def add_result(args: argparse.Namespace) -> None:
    fixtures = pd.read_csv(args.fixtures)
    fixtures["FTHG"] = pd.to_numeric(fixtures["FTHG"], errors="coerce")
    fixtures["FTAG"] = pd.to_numeric(fixtures["FTAG"], errors="coerce")

    if args.list:
        print_fixtures(fixtures)
        return

    home_goals, away_goals = parse_score(args.score, args.home_goals, args.away_goals)
    fixture_index = find_fixture(fixtures, args.fixture, args.home, args.away)
    current_row = fixtures.loc[fixture_index]

    if pd.notna(current_row["FTHG"]) and pd.notna(current_row["FTAG"]) and not args.force:
        raise ValueError("This fixture already has a result. Pass --force to overwrite it.")

    fixtures.at[fixture_index, "FTHG"] = home_goals
    fixtures.at[fixture_index, "FTAG"] = away_goals

    if "FTR" in fixtures.columns:
        if home_goals > away_goals:
            fixtures.at[fixture_index, "FTR"] = "H"
        elif away_goals > home_goals:
            fixtures.at[fixture_index, "FTR"] = "A"
        else:
            fixtures.at[fixture_index, "FTR"] = "D"

    fixtures.to_csv(args.fixtures, index=False)
    print(f"Dodano wynik: {current_row['HomeTeam']} - {current_row['AwayTeam']} {home_goals}-{away_goals}")

    if args.run_forecast:
        command = [
            sys.executable,
            str(RUN_FORECAST_PATH),
            "--fixtures",
            str(args.fixtures),
            "--simulations",
            str(args.simulations),
            "--sample-tables",
            str(args.sample_tables),
        ]
        subprocess.run(command, check=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Add a real match result to the season fixture CSV.")
    parser.add_argument("--fixtures", type=Path, default=DEFAULT_FIXTURE_PATH)
    parser.add_argument("--list", action="store_true", help="Show fixture row numbers and current result status.")
    parser.add_argument("--fixture", type=int, help="1-based fixture number from --list.")
    parser.add_argument("--home", help="Home team name, used with --away when --fixture is not passed.")
    parser.add_argument("--away", help="Away team name, used with --home when --fixture is not passed.")
    parser.add_argument("--score", help="Final score, for example 2-1 or 2:1.")
    parser.add_argument("--home-goals", type=int)
    parser.add_argument("--away-goals", type=int)
    parser.add_argument("--force", action="store_true", help="Overwrite an existing result.")
    parser.add_argument("--run-forecast", action="store_true", help="Regenerate web/forecast-data.js after saving the score.")
    parser.add_argument("--simulations", type=int, default=10000, help="Monte Carlo simulations when --run-forecast is used.")
    parser.add_argument("--sample-tables", type=int, default=80, help="Single-simulation tables saved for the random simulation button.")
    return parser.parse_args()


def main() -> None:
    try:
        add_result(parse_args())
    except Exception as error:
        print(f"Blad: {error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
