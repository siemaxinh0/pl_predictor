from __future__ import annotations

import argparse
import io
import subprocess
import sys
import urllib.request
from pathlib import Path

import pandas as pd

from features import normalize_names
from run_forecast import DEFAULT_FIXTURE_PATH, ROUND_SIZE, played_mask

# pobranie nowych wynikow i przeliczenie strony: .\venv\Scripts\python.exe src\update_results.py
# podglad bez zapisywania: .\venv\Scripts\python.exe src\update_results.py --dry-run

RUN_FORECAST_PATH = Path(__file__).resolve().parent / "run_forecast.py"
RESULTS_URL = "https://www.football-data.co.uk/mmz4281/{season}/E0.csv"


def results_url(fixtures_path: Path) -> str:
    # season-2627.csv -> https://www.football-data.co.uk/mmz4281/2627/E0.csv
    return RESULTS_URL.format(season=fixtures_path.stem.removeprefix("season-"))


def download_results(url: str) -> pd.DataFrame:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        results = pd.read_csv(io.BytesIO(response.read()), encoding="utf-8-sig")
    return normalize_names(results.dropna(subset=["HomeTeam", "AwayTeam", "FTHG", "FTAG"]))


def fill_results(fixtures: pd.DataFrame, results: pd.DataFrame) -> tuple[list[str], list[str]]:
    names = normalize_names(fixtures)
    # w sezonie kazda para gospodarz-gosc gra tylko raz, wiec para jednoznacznie wskazuje mecz
    fixture_index = {pair: index for index, pair in enumerate(zip(names["HomeTeam"], names["AwayTeam"]))}
    unknown = [f"{home} - {away}" for home, away in zip(results["HomeTeam"], results["AwayTeam"]) if (home, away) not in fixture_index]
    if unknown:
        raise ValueError(f"Mecze spoza terminarza (brakuje nazwy w TEAM_NAME_MAP w features.py?): {', '.join(unknown)}")

    added, conflicts = [], []
    for match in results.itertuples(index=False):
        index = fixture_index[(match.HomeTeam, match.AwayTeam)]
        home_goals, away_goals = int(match.FTHG), int(match.FTAG)
        label = f"{fixtures.at[index, 'HomeTeam']} - {fixtures.at[index, 'AwayTeam']} {home_goals}-{away_goals}"
        current = fixtures.loc[index, ["FTHG", "FTAG"]]
        if current.isna().any():
            fixtures.loc[index, ["FTHG", "FTAG"]] = [home_goals, away_goals]
            added.append(label)
        elif (int(current["FTHG"]), int(current["FTAG"])) != (home_goals, away_goals):
            conflicts.append(f"{label} (w terminarzu jest {int(current['FTHG'])}-{int(current['FTAG'])})")
    return added, conflicts


def round_stages(before: pd.DataFrame, after: pd.DataFrame) -> list[pd.DataFrame]:
    # migawka historii powstaje tylko dla stanu po pelnej kolejce, wiec kazda nowo dopelniona kolejka to osobny etap
    rounds = pd.Series(before.index // ROUND_SIZE + 1, index=before.index)
    complete_before = played_mask(before).groupby(rounds).all()
    complete_after = played_mask(after).groupby(rounds).all()
    stages = []
    for round_number in complete_after.index[complete_after & ~complete_before]:
        stage = after.copy()
        later = rounds > round_number
        stage.loc[later, ["FTHG", "FTAG"]] = before.loc[later, ["FTHG", "FTAG"]]
        stages.append(stage)
    if not stages or not stages[-1].equals(after):
        stages.append(after)
    return stages


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download new Premier League results from football-data.co.uk and fill the season fixture CSV.")
    parser.add_argument("--fixtures", type=Path, default=DEFAULT_FIXTURE_PATH)
    parser.add_argument("--dry-run", action="store_true", help="Only show what would be added, do not save anything.")
    parser.add_argument("--no-forecast", action="store_true", help="Save results without regenerating the web data.")
    return parser.parse_args()


def update_results(args: argparse.Namespace) -> None:
    fixtures = pd.read_csv(args.fixtures)
    fixtures["FTHG"] = pd.to_numeric(fixtures["FTHG"], errors="coerce")
    fixtures["FTAG"] = pd.to_numeric(fixtures["FTAG"], errors="coerce")
    before = fixtures.copy()
    added, conflicts = fill_results(fixtures, download_results(results_url(args.fixtures)))

    for conflict in conflicts:
        print(f"Uwaga, inny wynik w zrodle, zostawiam wpisany: {conflict}", file=sys.stderr)
    if not added:
        print("Brak nowych wynikow.")
        return

    print(f"{'Do dodania' if args.dry_run else 'Dodano'} {len(added)} wynikow:")
    for label in added:
        print(f"  {label}")
    if args.dry_run:
        return
    if args.no_forecast:
        fixtures.to_csv(args.fixtures, index=False)
        return

    for stage in round_stages(before, fixtures):
        stage.to_csv(args.fixtures, index=False)
        sys.stdout.flush()
        subprocess.run([sys.executable, str(RUN_FORECAST_PATH), "--fixtures", str(args.fixtures)], check=True)


def main() -> None:
    try:
        update_results(parse_args())
    except Exception as error:
        print(f"Blad: {error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
