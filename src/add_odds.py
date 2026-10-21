from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

from run_forecast import normalize_team_name
from scrape_odds import (
    DEFAULT_DB_PATH,
    DEFAULT_FIXTURE_PATH,
    DEFAULT_WEB_PATH,
    OddsDatabase,
    build_manual_odds_row,
    fixture_rounds,
    parse_odds_triple,
    refresh_web_export,
)

ROOT = Path(__file__).resolve().parents[1]


def load_fixtures(fixture_path: Path) -> pd.DataFrame:
    fixtures = pd.read_csv(fixture_path)
    fixtures["fixture"] = range(1, len(fixtures) + 1)
    fixtures["home_key"] = fixtures["HomeTeam"].map(normalize_team_name)
    fixtures["away_key"] = fixtures["AwayTeam"].map(normalize_team_name)
    fixtures["FTHG"] = pd.to_numeric(fixtures["FTHG"], errors="coerce")
    fixtures["FTAG"] = pd.to_numeric(fixtures["FTAG"], errors="coerce")
    return fixtures


def find_fixture_index(
    fixtures: pd.DataFrame,
    fixture_number: int | None,
    home_team: str | None,
    away_team: str | None,
) -> int:
    if fixture_number is not None:
        fixture_index = fixture_number - 1
        if fixture_index < 0 or fixture_index >= len(fixtures):
            raise ValueError(f"Numer meczu musi byc miedzy 1 a {len(fixtures)}.")
        return fixture_index

    if not home_team or not away_team:
        raise ValueError("Podaj --fixture albo obie druzyny przez --home i --away.")

    normalized_home = normalize_team_name(home_team)
    normalized_away = normalize_team_name(away_team)
    matches = fixtures[
        fixtures["home_key"].eq(normalized_home) & fixtures["away_key"].eq(normalized_away)
    ]
    if matches.empty:
        raise ValueError(f"Nie ma meczu: {home_team} - {away_team}.")
    if len(matches) > 1:
        raise ValueError("Znaleziono wiecej niz jeden mecz. Uzyj --fixture z listy --list.")
    return int(matches.index[0])


def odds_status(existing: dict[str, object] | None) -> str:
    if not existing:
        return "brak kursow"
    source = str(existing.get("source_url") or "")
    label = "recznie" if source == "manual" else "w bazie"
    return (
        f"{label}: {existing['odds_home']}/{existing['odds_draw']}/{existing['odds_away']} "
        f"({existing['bookmaker']})"
    )


def print_fixture_list(fixtures: pd.DataFrame, indexed_odds: dict[int, dict[str, object]]) -> None:
    for row in fixtures.itertuples(index=False):
        fixture_number = int(row.fixture)
        played = pd.notna(row.FTHG) and pd.notna(row.FTAG)
        result = f"{int(row.FTHG)}-{int(row.FTAG)}" if played else "bez wyniku"
        status = odds_status(indexed_odds.get(fixture_number))
        print(f"{fixture_number:03d}. {row.HomeTeam} - {row.AwayTeam} [{result}] | {status}")


def parse_odds_args(args: argparse.Namespace) -> tuple[float, float, float]:
    if args.odds:
        return parse_odds_triple(args.odds)
    if args.odds_home is not None and args.odds_draw is not None and args.odds_away is not None:
        return float(args.odds_home), float(args.odds_draw), float(args.odds_away)
    raise ValueError("Podaj --odds 2.1/3.4/3.2 albo trzy osobne: --odds-home, --odds-draw, --odds-away.")


def row_from_fixture(
    fixtures: pd.DataFrame,
    fixture_index: int,
    odds_home: float,
    odds_draw: float,
    odds_away: float,
    bookmaker: str,
    scraped_at: str | None,
    rounds_by_fixture: dict[int, int],
) -> dict[str, object]:
    row = fixtures.loc[fixture_index]
    fixture_number = int(row["fixture"])
    return build_manual_odds_row(
        fixture_number=fixture_number,
        home_team=row["home_key"],
        away_team=row["away_key"],
        odds_home=odds_home,
        odds_draw=odds_draw,
        odds_away=odds_away,
        bookmaker=bookmaker,
        round_number=rounds_by_fixture.get(fixture_number),
        scraped_at=scraped_at,
    )


def load_csv_rows(csv_path: Path, fixtures: pd.DataFrame, default_bookmaker: str, fixture_path: Path, round_size: int) -> list[dict[str, object]]:
    imported = pd.read_csv(csv_path)
    required = {"odds_home", "odds_draw", "odds_away"}
    if not required.issubset(imported.columns):
        raise ValueError(f"CSV musi miec kolumny: {', '.join(sorted(required))}.")

    rounds_by_fixture = fixture_rounds(fixture_path, round_size)
    rows: list[dict[str, object]] = []

    for index, item in imported.iterrows():
        bookmaker = str(item.get("bookmaker") or default_bookmaker).strip().lower()
        scraped_at = str(item["scraped_at"]).strip() if pd.notna(item.get("scraped_at")) else None

        if pd.notna(item.get("fixture")):
            fixture_index = find_fixture_index(fixtures, int(item["fixture"]), None, None)
        elif pd.notna(item.get("home_team")) and pd.notna(item.get("away_team")):
            fixture_index = find_fixture_index(fixtures, None, str(item["home_team"]), str(item["away_team"]))
        else:
            raise ValueError(f"Wiersz {index + 2} CSV: podaj fixture albo home_team i away_team.")

        rows.append(
            row_from_fixture(
                fixtures,
                fixture_index,
                float(item["odds_home"]),
                float(item["odds_draw"]),
                float(item["odds_away"]),
                bookmaker,
                scraped_at,
                rounds_by_fixture,
            )
        )

    return rows


def save_rows(
    rows: list[dict[str, object]],
    db_path: Path,
    force: bool,
) -> None:
    if not rows:
        return

    with OddsDatabase(db_path) as database:
        for row in rows:
            if force:
                database.delete_match_odds(str(row["bookmaker"]), str(row["home_team"]), str(row["away_team"]))
            saved = database.save_snapshot(pd.DataFrame([row]))
            if saved != 1:
                raise RuntimeError(f"Nie udalo sie zapisac kursu dla meczu #{row['fixture']}.")


def add_odds(args: argparse.Namespace) -> None:
    fixtures = load_fixtures(args.fixtures)
    rounds_by_fixture = fixture_rounds(args.fixtures, args.round_size)

    with OddsDatabase(args.db) as database:
        indexed_odds = database.fixtures_with_odds(args.bookmaker if args.list else None)

    if args.list:
        print_fixture_list(fixtures, indexed_odds)
        return

    if args.csv:
        rows = load_csv_rows(args.csv, fixtures, args.bookmaker, args.fixtures, args.round_size)
        save_rows(rows, args.db, args.force)
        print(f"Zaimportowano kursy z CSV: {len(rows)} meczow.")
    else:
        odds_home, odds_draw, odds_away = parse_odds_args(args)
        fixture_index = find_fixture_index(fixtures, args.fixture, args.home, args.away)
        row = fixtures.loc[fixture_index]
        fixture_number = int(row["fixture"])

        existing = indexed_odds.get(fixture_number)
        if existing and not args.force:
            raise ValueError(
                f"Mecz #{fixture_number} ma juz kursy ({existing['odds_home']}/{existing['odds_draw']}/{existing['odds_away']}). "
                "Dodaj --force zeby nadpisac."
            )

        manual_row = row_from_fixture(
            fixtures,
            fixture_index,
            odds_home,
            odds_draw,
            odds_away,
            args.bookmaker,
            args.scraped_at,
            rounds_by_fixture,
        )
        save_rows([manual_row], args.db, force=True)
        print(
            f"Dodano kursy: #{fixture_number} {row['HomeTeam']} - {row['AwayTeam']} "
            f"{odds_home}/{odds_draw}/{odds_away} ({args.bookmaker}) -> "
            f"{manual_row['prob_home']}% / {manual_row['prob_draw']}% / {manual_row['prob_away']}%"
        )

    if args.export_web:
        exported = refresh_web_export(args.db, args.fixtures, args.web_output, args.round_size)
        print(f"Odswiezono web/odds-data.js ({exported} meczow).")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Recznie dodaj kursy 1X2 dla meczow z przeszlosci lub przyszlosci.")
    parser.add_argument("--fixtures", type=Path, default=DEFAULT_FIXTURE_PATH)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--web-output", type=Path, default=DEFAULT_WEB_PATH)
    parser.add_argument("--list", action="store_true", help="Pokaz mecze i status kursow w bazie.")
    parser.add_argument("--fixture", type=int, help="Numer meczu z --list (1-based).")
    parser.add_argument("--home", help="Gospodarz, razem z --away gdy nie podajesz --fixture.")
    parser.add_argument("--away", help="Gosc, razem z --home gdy nie podajesz --fixture.")
    parser.add_argument("--odds", help="Kursy 1X2, np. 2.1/3.4/3.2 albo 2.1,3.4,3.2.")
    parser.add_argument("--odds-home", type=float)
    parser.add_argument("--odds-draw", type=float)
    parser.add_argument("--odds-away", type=float)
    parser.add_argument("--bookmaker", default="betclic", help="Identyfikator bukmachera, np. betclic albo bet365.")
    parser.add_argument("--scraped-at", help="Opcjonalna data ISO kursu, np. 2026-08-15.")
    parser.add_argument("--csv", type=Path, help="Import wielu kursow z CSV.")
    parser.add_argument("--force", action="store_true", help="Nadpisz istniejace kursy dla tego meczu i bukmachera.")
    parser.add_argument("--round-size", type=int, default=10)
    parser.add_argument("--no-export-web", action="store_true", help="Nie odswiezaj web/odds-data.js po zapisie.")
    parser.set_defaults(export_web=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.no_export_web:
        args.export_web = False
    try:
        add_odds(args)
    except Exception as error:
        print(f"Blad: {error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
