from __future__ import annotations

import argparse
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

from run_forecast import normalize_team_name

# przebudowa cech z surowych sezonow: .\venv\Scripts\python.exe src\features.py

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SEASONS_DIR = ROOT / "data" / "raw" / "pl_seasons"
DEFAULT_OUTPUT_PATH = ROOT / "data" / "processed" / "PL_base_with_traits.csv"
CURRENT_SEASON_FILE = "season-2627.csv"

START_ELO = 1500.0
ELO_K = 20
HOME_ADVANTAGE_ELO = 90
SEASON_CARRYOVER = 0.95
FORM_WINDOW = 5
H2H_WINDOW = 5
NEUTRAL_POINTS = 1.0

FEATURE_COLUMNS = [
    "HomeElo", "AwayElo",
    "HomeForm", "AwayForm",
    "HomeFormAtHome", "AwayFormAtAway",
    "HomeH2H", "AwayH2H",
]


def match_points(home_goals: int, away_goals: int) -> tuple[int, int]:
    if home_goals > away_goals:
        return 3, 0
    if away_goals > home_goals:
        return 0, 3
    return 1, 1


class TeamState:
    """Stan wszystkich druzyn w danym momencie: ELO, punkty z ostatnich meczow i H2H."""

    def __init__(self) -> None:
        self.elo: dict[str, float] = {}
        self.elo_when_relegated: dict[str, float] = {}
        self.points: dict[str, list[int]] = defaultdict(list)
        self.home_points: dict[str, list[int]] = defaultdict(list)
        self.away_points: dict[str, list[int]] = defaultdict(list)
        self.h2h_points: dict[tuple[str, str], list[int]] = defaultdict(list)

    def start_season(self, teams: set[str]) -> None:
        if not self.elo:
            self.elo = {team: START_ELO for team in teams}
            return

        relegated = [team for team in self.elo if team not in teams]
        relegated_mean = float(np.mean([self.elo[team] for team in relegated])) if relegated else START_ELO
        self.elo_when_relegated.update({team: self.elo[team] for team in relegated})

        season_elo = {}
        for team in teams:
            if team in self.elo:
                base_elo = self.elo[team]
            elif team in self.elo_when_relegated:
                base_elo = (self.elo_when_relegated[team] + relegated_mean) / 2
            else:
                base_elo = relegated_mean
            season_elo[team] = START_ELO + SEASON_CARRYOVER * (base_elo - START_ELO)
        self.elo = season_elo

    def form(self, team: str, venue: str | None = None) -> float:
        history = {"home": self.home_points, "away": self.away_points}.get(venue, self.points)[team]
        return float(np.mean(history[-FORM_WINDOW:])) if history else NEUTRAL_POINTS

    def h2h(self, team: str, opponent: str) -> float:
        history = self.h2h_points[(team, opponent)]
        return float(np.mean(history[-H2H_WINDOW:])) if history else NEUTRAL_POINTS

    def snapshot(self, home_team: str, away_team: str) -> dict[str, float]:
        return {
            "HomeElo": self.elo[home_team],
            "AwayElo": self.elo[away_team],
            "HomeForm": self.form(home_team),
            "AwayForm": self.form(away_team),
            "HomeFormAtHome": self.form(home_team, "home"),
            "AwayFormAtAway": self.form(away_team, "away"),
            "HomeH2H": self.h2h(home_team, away_team),
            "AwayH2H": self.h2h(away_team, home_team),
        }

    def update(self, home_team: str, away_team: str, home_goals: int, away_goals: int) -> None:
        home_elo = self.elo[home_team]
        away_elo = self.elo[away_team]
        expected_home = 1 / (1 + 10 ** ((away_elo - (home_elo + HOME_ADVANTAGE_ELO)) / 400))
        actual_home = 1.0 if home_goals > away_goals else (0.5 if home_goals == away_goals else 0.0)
        self.elo[home_team] = home_elo + ELO_K * (actual_home - expected_home)
        self.elo[away_team] = away_elo + ELO_K * ((1 - actual_home) - (1 - expected_home))

        home_points, away_points = match_points(home_goals, away_goals)
        self.points[home_team].append(home_points)
        self.points[away_team].append(away_points)
        self.home_points[home_team].append(home_points)
        self.away_points[away_team].append(away_points)
        self.h2h_points[(home_team, away_team)].append(home_points)
        self.h2h_points[(away_team, home_team)].append(away_points)


def normalize_names(matches: pd.DataFrame) -> pd.DataFrame:
    normalized = matches.copy()
    normalized["HomeTeam"] = normalized["HomeTeam"].map(normalize_team_name)
    normalized["AwayTeam"] = normalized["AwayTeam"].map(normalize_team_name)
    return normalized


def season_teams(matches: pd.DataFrame) -> set[str]:
    return set(matches["HomeTeam"]) | set(matches["AwayTeam"])


def load_seasons(seasons_dir: Path, current_season_file: str = CURRENT_SEASON_FILE) -> pd.DataFrame:
    frames = []
    for path in sorted(seasons_dir.glob("season-*.csv")):
        if path.name == current_season_file:
            continue
        season = pd.read_csv(path)
        season["SeasonFile"] = path.name
        frames.append(season)

    if not frames:
        raise ValueError(f"Brak plikow season-*.csv w {seasons_dir}.")

    matches = normalize_names(pd.concat(frames, ignore_index=True))
    matches = matches.dropna(subset=["HomeTeam", "AwayTeam", "FTHG", "FTAG"]).reset_index(drop=True)
    validate_matches(matches)
    return matches


def validate_matches(matches: pd.DataFrame) -> None:
    duplicates = matches.duplicated(subset=["SeasonFile", "HomeTeam", "AwayTeam"])
    if duplicates.any():
        first = matches[duplicates].iloc[0]
        raise ValueError(f"Mecz wystepuje dwa razy: {first['HomeTeam']} - {first['AwayTeam']} ({first['SeasonFile']}).")
    if (matches[["FTHG", "FTAG"]] < 0).any().any():
        raise ValueError("Ujemna liczba goli w danych historycznych.")


def build_features(history: pd.DataFrame) -> tuple[pd.DataFrame, TeamState]:
    # cechy meczu to stan druzyn sprzed jego rozegrania, wiec snapshot musi byc przed update
    state = TeamState()
    snapshots = []
    for _season_file, season in history.groupby("SeasonFile", sort=False):
        state.start_season(season_teams(season))
        for match in season.itertuples(index=False):
            snapshots.append(state.snapshot(match.HomeTeam, match.AwayTeam))
            state.update(match.HomeTeam, match.AwayTeam, int(match.FTHG), int(match.FTAG))

    features = history.copy()
    features[FEATURE_COLUMNS] = pd.DataFrame(snapshots, index=history.index)[FEATURE_COLUMNS]
    features["EloDiff"] = features["HomeElo"] - features["AwayElo"]
    features["FormDiff"] = features["HomeForm"] - features["AwayForm"]
    features["VenueFormDiff"] = features["HomeFormAtHome"] - features["AwayFormAtAway"]
    features["H2HDiff"] = features["HomeH2H"] - features["AwayH2H"]
    features["Target"] = np.select(
        [features["FTHG"] > features["FTAG"], features["FTHG"] == features["FTAG"]],
        [1, 0],
        default=2,
    )
    return features, state


def current_state(history: pd.DataFrame, fixtures: pd.DataFrame) -> TeamState:
    _features, state = build_features(history)
    fixtures = normalize_names(fixtures)
    state.start_season(season_teams(fixtures))
    played = fixtures.dropna(subset=["FTHG", "FTAG"])
    for match in played.itertuples(index=False):
        state.update(match.HomeTeam, match.AwayTeam, int(match.FTHG), int(match.FTAG))
    return state


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build pre-match features (ELO, form, H2H) from raw season files.")
    parser.add_argument("--seasons-dir", type=Path, default=DEFAULT_SEASONS_DIR)
    parser.add_argument("--current-season", default=CURRENT_SEASON_FILE, help="Season file skipped in history, e.g. season-2627.csv.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_PATH)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    history = load_seasons(args.seasons_dir, args.current_season)
    features, _state = build_features(history)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    features.to_csv(args.output, index=False)
    print(f"Zapisano cechy: {args.output}")
    print(f"Mecze: {len(features)}, sezony: {features['SeasonFile'].nunique()}")


if __name__ == "__main__":
    main()
