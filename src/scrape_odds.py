from __future__ import annotations

import argparse
import json
import logging
import re
import sqlite3
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from run_forecast import TEAM_NAME_MAP, display_name, forecast_rounds, normalize_team_name

# agent ETL do kursow 1X2
# 1 zwykly przebieg (Betclic, zapis do JSON i SQLite)
#   .\venv\Scripts\python.exe src\scrape_odds.py
# 2 podglad markup do ustawienia selektorow
#   .\venv\Scripts\python.exe src\scrape_odds.py --headed --dump-html data\raw\odds\page.html
# 3 offline parsowanie zapisanego HTML (bez wchodzenia na strone)
#   .\venv\Scripts\python.exe src\scrape_odds.py --html-file data\raw\odds\page.html

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FIXTURE_PATH = ROOT / "data" / "raw" / "pl_seasons" / "season-2627.csv"
DEFAULT_JSON_PATH = ROOT / "data" / "raw" / "odds" / "odds_1x2.json"
DEFAULT_DB_PATH = ROOT / "data" / "processed" / "odds.sqlite"
DEFAULT_WEB_PATH = ROOT / "web" / "odds-data.js"

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

# kursy dziesietne: 1.85, 2,40, 12.00
ODDS_PATTERN = re.compile(r"^\d{1,3}[.,]\d{1,2}$")

# teksty ktore siedza w kafelku obok nazw druzyn i nigdy nie sa druzyna
TEAM_TEXT_BLOCKLIST = {
    "1", "x", "2", "1x", "x2", "12", "remis", "draw",
    "premier league", "anglia", "england", "wynik meczu", "1x2",
    "live", "dzisiaj", "jutro", "wiecej", "zaklady", "kursy",
}

# skroty ktorych bukmacherzy uzywaja czesciej niz pelnych nazw
BOOKMAKER_ALIASES = {
    "Man Utd": "Man United",
    "Man Utd.": "Man United",
    "Manchester Utd": "Man United",
    "Manchester United FC": "Man United",
    "Man City FC": "Man City",
    "Manchester City FC": "Man City",
    "Spurs": "Tottenham",
    "Tottenham FC": "Tottenham",
    "Nottingham": "Nott'm Forest",
    "Nottingham Forest FC": "Nott'm Forest",
    "Notts Forest": "Nott'm Forest",
    "Nott. Forest": "Nott'm Forest",
    "Wolverhampton": "Wolves",
    "Wolverhampton Wanderers FC": "Wolves",
    "Brighton & Hove": "Brighton",
    "Brighton FC": "Brighton",
    "Newcastle Utd": "Newcastle",
    "Newcastle Utd.": "Newcastle",
    "Leeds Utd": "Leeds",
    "West Ham Utd": "West Ham",
    "Coventry": "Coventry City",
    "Hull City AFC": "Hull",
    "Ipswich Town": "Ipswich",
    "Sunderland AFC": "Sunderland",
    "Bournemouth AFC": "Bournemouth",
    "Crystal Palace FC": "Crystal Palace",
    "Aston Villa FC": "Aston Villa",
}

LOGGER = logging.getLogger("scrape_odds")


class ScrapeError(RuntimeError):
    """Blad ktory konczy caly przebieg agenta (np. strona sie nie zaladowala)."""


@dataclass(frozen=True)
class BookmakerConfig:
    name: str
    url: str
    card_selector: str
    team_selector: str
    odds_selector: str
    kickoff_selector: str = ""
    consent_selectors: tuple[str, ...] = ()


# Selektory bukmacherow zmieniaja sie co kilka miesiecy, dlatego siedza w konfiguracji,
# a nie w kodzie. Jesli przestana dzialac, parser ma jeszcze heurystyke po strukturze DOM.
BOOKMAKERS: dict[str, BookmakerConfig] = {
    "betclic": BookmakerConfig(
        name="betclic",
        url="https://www.betclic.pl/pilka-nozna-s1/anglia-premier-league-c3",
        card_selector="sports-events-event, .cardEvent, .event, [class*='cardEvent']",
        team_selector=".scoreboard_contestantLabel, .contestant-name, [class*='contestantLabel']",
        odds_selector=".oddValue, .odd-value, [class*='oddValue'], button[class*='odd']",
        kickoff_selector=".scoreboard_hour, .event_infoTime, .eventDate, time",
        consent_selectors=(
            "#onetrust-accept-btn-handler",
            "button#didomi-notice-agree-button",
            "button:has-text('Akceptuj')",
            "button:has-text('Zgadzam')",
        ),
    ),
}


@dataclass
class ScrapedOffer:
    """Surowy kafelek meczu, jeszcze bez mapowania nazw i bez zdjetej marzy."""

    home_name: str
    away_name: str
    odds_home: float
    odds_draw: float
    odds_away: float
    kickoff: str = ""


@dataclass
class TeamMatch:
    canonical: str | None
    score: int
    note: str = ""


@dataclass
class ParseReport:
    offers: list[ScrapedOffer] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# EKSTRAKCJA
# ---------------------------------------------------------------------------


def fetch_html(config: BookmakerConfig, url: str, timeout_ms: int, headless: bool, scroll_rounds: int) -> str:
    try:
        from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise ScrapeError(
            "Brak playwright. Zainstaluj: pip install playwright, potem python -m playwright install chromium"
        ) from error

    with sync_playwright() as playwright:
        try:
            browser = playwright.chromium.launch(headless=headless)
        except Exception as error:
            raise ScrapeError(
                "Nie udalo sie odpalic Chromium. Sprawdz: python -m playwright install chromium"
            ) from error

        try:
            context = browser.new_context(
                locale="pl-PL",
                user_agent=USER_AGENT,
                viewport={"width": 1440, "height": 900},
            )
            page = context.new_page()

            try:
                page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            except PlaywrightTimeoutError as error:
                raise ScrapeError(f"Strona nie odpowiedziala w {timeout_ms} ms: {url}") from error

            accept_consent(page, config)

            # kafelki z meczami doklejaja sie po JS, wiec czekamy na pierwszy z nich
            try:
                page.wait_for_selector(config.card_selector, timeout=timeout_ms)
            except PlaywrightTimeoutError:
                LOGGER.warning(
                    "Selektor kafelkow nie zlapal niczego (%s). Probuje heurystyki po DOM.",
                    config.card_selector,
                )

            scroll_page(page, scroll_rounds)
            return page.content()
        finally:
            browser.close()


def accept_consent(page, config: BookmakerConfig) -> None:
    for selector in config.consent_selectors:
        try:
            page.click(selector, timeout=2500)
        except Exception:
            continue
        LOGGER.info("Zaakceptowano zgode na cookies (%s).", selector)
        return


def scroll_page(page, scroll_rounds: int) -> None:
    # lazy loading: nizsze kolejki dogrywaja sie tylko po zescrollowaniu
    for _ in range(max(scroll_rounds, 0)):
        page.mouse.wheel(0, 2000)
        page.wait_for_timeout(400)
    page.wait_for_timeout(500)


# ---------------------------------------------------------------------------
# PARSOWANIE HTML
# ---------------------------------------------------------------------------


def clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", str(text).replace("\xa0", " ")).strip()


def parse_odd(text: str) -> float | None:
    cleaned = clean_text(text)
    if not ODDS_PATTERN.match(cleaned):
        return None
    value = float(cleaned.replace(",", "."))
    # kurs 1.00 albo nizszy nie istnieje - to zwykle placeholder zablokowanego rynku
    return value if value > 1.0 else None


def find_cards(soup, config: BookmakerConfig) -> list:
    selected = soup.select(config.card_selector) if config.card_selector else []
    cards = [card for card in selected if len(collect_odds(card, config)) == 3]
    if selected and len(cards) < len(selected):
        LOGGER.warning("Kafelki bez pelnego rynku 1X2: %d z %d", len(selected) - len(cards), len(selected))
    if cards:
        return dedupe_cards(cards)

    # Fallback: idziemy od kazdego kursu w gore drzewa i szukamy najmniejszego
    # przodka, ktory zawiera dokladnie 3 kursy. To wlasnie jest kafelek meczu.
    LOGGER.info("Selektor kafelkow nie zadzialal, uzywam heurystyki 3 kursow w przodku.")
    cards = []
    for node in soup.find_all(string=ODDS_PATTERN):
        parent = node.parent
        while parent is not None:
            if len(collect_odds(parent, config)) == 3:
                cards.append(parent)
                break
            parent = parent.parent
    return dedupe_cards(cards)


def dedupe_cards(cards: list) -> list:
    unique = {}
    for card in cards:
        unique.setdefault(id(card), card)
    return list(unique.values())


def collect_odds(card, config: BookmakerConfig) -> list[float]:
    values = []
    if config.odds_selector:
        for node in card.select(config.odds_selector):
            odd = parse_odd(node.get_text())
            if odd is not None:
                values.append(odd)
    if len(values) != 3:
        # bez selektora: kazdy tekst w kafelku, ktory wyglada jak kurs dziesietny
        values = [odd for text in card.stripped_strings if (odd := parse_odd(text)) is not None]
    return values


def collect_team_texts(card, config: BookmakerConfig) -> list[str]:
    texts = []
    if config.team_selector:
        texts = [clean_text(node.get_text()) for node in card.select(config.team_selector)]
    if len(texts) < 2:
        texts = [clean_text(text) for text in card.stripped_strings]

    candidates = []
    for text in texts:
        if len(text) < 3 or len(text) > 40:
            continue
        if text.lower() in TEAM_TEXT_BLOCKLIST or not re.search(r"[a-zA-Z]", text):
            continue
        if parse_odd(text) is not None:
            continue
        if text not in candidates:
            candidates.append(text)
    return candidates


def collect_kickoff(card, config: BookmakerConfig) -> str:
    if not config.kickoff_selector:
        return ""
    node = card.select_one(config.kickoff_selector)
    return clean_text(node.get_text()) if node else ""


def parse_offers(html: str, config: BookmakerConfig, lookup: dict[str, str], threshold: int) -> ParseReport:
    try:
        from bs4 import BeautifulSoup
    except ImportError as error:
        raise ScrapeError("Brak beautifulsoup4. Zainstaluj: pip install beautifulsoup4") from error

    soup = BeautifulSoup(html, "html.parser")
    cards = find_cards(soup, config)
    if not cards:
        raise ScrapeError(
            "Nie znalazlem zadnego kafelka z kursami. Zapisz strone przez --dump-html i popraw selektory."
        )

    LOGGER.info("Znalezionych kafelkow: %d", len(cards))
    report = ParseReport()
    seen_pairs: set[tuple[str, str]] = set()

    for card in cards:
        odds = collect_odds(card, config)
        if len(odds) != 3:
            report.skipped.append("kafelek bez pelnego rynku 1X2")
            continue

        # Nie zgadujemy, ktory tekst jest druzyna - bierzemy pierwsze dwa teksty,
        # ktore fuzzy matching potrafi przypisac do druzyny z terminarza.
        names = []
        for text in collect_team_texts(card, config):
            matched = match_team_name(text, lookup, threshold)
            if matched.canonical is not None and matched.canonical not in [name[1] for name in names]:
                names.append((text, matched.canonical))
            if len(names) == 2:
                break

        if len(names) < 2:
            report.skipped.append("kafelek bez rozpoznanych dwoch druzyn")
            continue

        pair = (names[0][1], names[1][1])
        if pair in seen_pairs:
            continue
        seen_pairs.add(pair)

        report.offers.append(
            ScrapedOffer(
                home_name=names[0][0],
                away_name=names[1][0],
                odds_home=odds[0],
                odds_draw=odds[1],
                odds_away=odds[2],
                kickoff=collect_kickoff(card, config),
            )
        )

    return report


# ---------------------------------------------------------------------------
# TRANSFORMACJA: marza i mapowanie nazw
# ---------------------------------------------------------------------------


def remove_margin_proportional(odds_home: float, odds_draw: float, odds_away: float) -> tuple[float, float, float, float]:
    """Zdejmuje marze bukmacherska metoda proporcjonalna.

    Kurs dziesietny to odwrotnosc prawdopodobienstwa, ale zanizona o marze bukmachera:

        krok 1  prawdopodobienstwo implikowane:  p_raw = 1 / kurs
        krok 2  overround (suma implikowanych):  O = p_raw_1 + p_raw_X + p_raw_2
                dla uczciwej ksiegi O = 1.0, realnie O > 1.0,
                np. O = 1.06 oznacza 6 procent marzy
        krok 3  metoda proporcjonalna:           p = p_raw / O

    Po kroku 3 suma prawdopodobienstw wynosi dokladnie 1.0, bo kazde z nich
    zostalo podzielone przez ten sam overround. Marza jest wiec sciagana
    proporcjonalnie do wielkosci kursu.

    Uwaga na ograniczenie tej metody: marza w praktyce nie jest rozlozona rowno.
    Bukmacher wklada jej wiecej w outsiderow (favourite-longshot bias), wiec
    metoda proporcjonalna lekko zawyza szanse outsidera i zaniza faworyta.
    Dokladniejsze warianty to Shin albo Odds Ratio - dla porownania z modelem
    Poissona proporcjonalna jest jednak wystarczajaca i nie ma parametrow.
    """
    if min(odds_home, odds_draw, odds_away) <= 1.0:
        raise ValueError(f"Kursy musza byc wieksze od 1.0, dostalem {odds_home}/{odds_draw}/{odds_away}")

    implied = [1.0 / odds_home, 1.0 / odds_draw, 1.0 / odds_away]
    overround = sum(implied)
    true_probs = [probability / overround for probability in implied]
    margin = overround - 1.0

    return (
        round(true_probs[0] * 100, 2),
        round(true_probs[1] * 100, 2),
        round(true_probs[2] * 100, 2),
        round(margin * 100, 2),
    )


def load_canonical_teams(fixture_path: Path) -> list[str]:
    """Kanoniczne nazwy druzyn bierzemy z terminarza, zeby zgadzaly sie z modelem."""
    if not fixture_path.exists():
        raise ScrapeError(f"Nie ma terminarza: {fixture_path}")

    fixtures = pd.read_csv(fixture_path)
    teams = set()
    for column in ("HomeTeam", "AwayTeam"):
        teams.update(normalize_team_name(name) for name in fixtures[column].dropna())
    return sorted(teams)


def build_team_lookup(canonical_teams: list[str]) -> dict[str, str]:
    """Slownik alias -> kanoniczna nazwa modelu.

    Zbieramy wszystko, czym bukmacher moze nazwac druzyne: nazwe kanoniczna,
    nazwe wyswietlana na stronie, dlugie nazwy z TEAM_NAME_MAP i skroty bukmacherskie.
    """
    canonical_set = set(canonical_teams)
    lookup: dict[str, str] = {}

    for team in canonical_teams:
        lookup[team] = team
        lookup[display_name(team)] = team

    for long_name, short_name in TEAM_NAME_MAP.items():
        if short_name in canonical_set:
            lookup[long_name] = short_name

    for alias, target in BOOKMAKER_ALIASES.items():
        if target in canonical_set:
            lookup[alias] = target

    # warianty bez "FC" na koncu i bez znakow interpunkcyjnych
    for alias in list(lookup):
        target = lookup[alias]
        stripped = re.sub(r"\b(FC|AFC)\b", "", alias).strip()
        stripped = re.sub(r"\s+", " ", stripped)
        if stripped and stripped not in lookup:
            lookup[stripped] = target

    return lookup


def match_team_name(name: str, lookup: dict[str, str], threshold: int) -> TeamMatch:
    """Mapuje zeskrapowana nazwe na kanoniczna. Najpierw dokladnie, potem fuzzy."""
    cleaned = clean_text(name)
    if not cleaned:
        return TeamMatch(None, 0, "pusta nazwa")

    if cleaned in lookup:
        return TeamMatch(lookup[cleaned], 100, "trafienie dokladne")

    normalized = normalize_team_name(cleaned)
    if normalized in lookup:
        return TeamMatch(lookup[normalized], 100, "trafienie po TEAM_NAME_MAP")

    try:
        from thefuzz import fuzz, process
    except ImportError as error:
        raise ScrapeError("Brak thefuzz. Zainstaluj: pip install thefuzz") from error

    candidates = process.extract(cleaned, lookup.keys(), scorer=fuzz.token_set_ratio, limit=3)
    if not candidates:
        return TeamMatch(None, 0, "brak kandydatow")

    best_alias, best_score = candidates[0]
    if best_score < threshold:
        return TeamMatch(None, int(best_score), f"ponizej progu (najblizej: {best_alias})")

    # Remis miedzy roznymi druzynami znaczy, ze nazwa jest niejednoznaczna
    # (klasyczny przypadek: samo "Manchester"). Lepiej odrzucic niz zgadnac.
    best_team = lookup[best_alias]
    for alias, score in candidates[1:]:
        if score == best_score and lookup[alias] != best_team:
            return TeamMatch(None, int(best_score), f"niejednoznaczne: {best_team} vs {lookup[alias]}")

    return TeamMatch(best_team, int(best_score), f"fuzzy przez '{best_alias}'")


def build_odds_frame(
    offers: list[ScrapedOffer],
    lookup: dict[str, str],
    threshold: int,
    bookmaker: str,
    source_url: str,
) -> tuple[pd.DataFrame, list[str]]:
    scraped_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    rows = []
    warnings = []

    for offer in offers:
        home_match = match_team_name(offer.home_name, lookup, threshold)
        away_match = match_team_name(offer.away_name, lookup, threshold)

        if home_match.canonical is None or away_match.canonical is None:
            warnings.append(
                f"pomijam '{offer.home_name}' - '{offer.away_name}': "
                f"{home_match.note or 'ok'} / {away_match.note or 'ok'}"
            )
            continue

        if home_match.canonical == away_match.canonical:
            warnings.append(f"pomijam '{offer.home_name}' - '{offer.away_name}': obie nazwy zmapowane na to samo")
            continue

        try:
            prob_home, prob_draw, prob_away, margin = remove_margin_proportional(
                offer.odds_home, offer.odds_draw, offer.odds_away
            )
        except ValueError as error:
            warnings.append(f"pomijam '{offer.home_name}' - '{offer.away_name}': {error}")
            continue

        rows.append({
            "bookmaker": bookmaker,
            "home_team": home_match.canonical,
            "away_team": away_match.canonical,
            "home_display": display_name(home_match.canonical),
            "away_display": display_name(away_match.canonical),
            "odds_home": offer.odds_home,
            "odds_draw": offer.odds_draw,
            "odds_away": offer.odds_away,
            "prob_home": prob_home,
            "prob_draw": prob_draw,
            "prob_away": prob_away,
            "margin": margin,
            "scraped_home_name": offer.home_name,
            "scraped_away_name": offer.away_name,
            "match_score_home": home_match.score,
            "match_score_away": away_match.score,
            "kickoff": offer.kickoff,
            "source_url": source_url,
            "scraped_at_utc": scraped_at,
        })

    return pd.DataFrame(rows), warnings


def attach_fixture_numbers(odds_frame: pd.DataFrame, fixture_path: Path, unplayed_only: bool = True) -> pd.DataFrame:
    """Dokleja numer meczu z terminarza, ten sam ktorego uzywa add_result.py."""
    if odds_frame.empty:
        return odds_frame

    fixtures = pd.read_csv(fixture_path)
    fixtures["fixture"] = range(1, len(fixtures) + 1)
    fixtures["home_team"] = fixtures["HomeTeam"].map(normalize_team_name)
    fixtures["away_team"] = fixtures["AwayTeam"].map(normalize_team_name)
    fixtures["FTHG"] = pd.to_numeric(fixtures["FTHG"], errors="coerce")
    fixtures["FTAG"] = pd.to_numeric(fixtures["FTAG"], errors="coerce")

    if unplayed_only:
        # scraper: kursy tylko na mecze jeszcze nierozegrane
        fixture_subset = fixtures[fixtures["FTHG"].isna() | fixtures["FTAG"].isna()]
    else:
        fixture_subset = fixtures

    merged = odds_frame.merge(
        fixture_subset[["fixture", "home_team", "away_team"]],
        on=["home_team", "away_team"],
        how="left",
    )
    merged["fixture"] = merged["fixture"].astype("Int64")

    missing = int(merged["fixture"].isna().sum())
    if missing:
        reason = "mecz rozegrany albo inna kolejka" if unplayed_only else "brak pary druzyn w terminarzu"
        LOGGER.warning("Bez numeru w terminarzu: %d meczow (%s).", missing, reason)

    columns = ["bookmaker", "fixture"] + [column for column in merged.columns if column not in {"bookmaker", "fixture"}]
    return merged[columns]


def parse_odds_triple(raw_odds: str) -> tuple[float, float, float]:
    """Parsuje kursy z '2.1/3.4/3.2', '2.1,3.4,3.2' albo '2.1 3.4 3.2'."""
    normalized = raw_odds.strip().replace(",", "/").replace(";", "/")
    for separator in ("/", " "):
        if separator in normalized:
            parts = [part.strip() for part in normalized.split(separator) if part.strip()]
            if len(parts) == 3:
                return tuple(float(part.replace(",", ".")) for part in parts)
    raise ValueError(f"Kursy musza wygladac jak 2.1/3.4/3.2, dostalem: {raw_odds}")


def manual_scraped_at(fixture: int, scraped_at: str | None = None) -> str:
    """Staly znacznik czasu dla recznie wpisanych kursow - latwo nadpisac przez --force."""
    if scraped_at:
        cleaned = scraped_at.strip()
        if "T" not in cleaned:
            cleaned = f"{cleaned}T12:00:00+00:00"
        return cleaned
    return f"manual-fixture-{fixture:04d}"


def build_manual_odds_row(
    fixture_number: int,
    home_team: str,
    away_team: str,
    odds_home: float,
    odds_draw: float,
    odds_away: float,
    bookmaker: str,
    round_number: int | None = None,
    scraped_at: str | None = None,
    kickoff: str = "",
) -> dict[str, object]:
    prob_home, prob_draw, prob_away, margin = remove_margin_proportional(odds_home, odds_draw, odds_away)
    timestamp = manual_scraped_at(fixture_number, scraped_at)
    return {
        "bookmaker": bookmaker.strip().lower(),
        "fixture": fixture_number,
        "round": round_number,
        "home_team": home_team,
        "away_team": away_team,
        "home_display": display_name(home_team),
        "away_display": display_name(away_team),
        "odds_home": odds_home,
        "odds_draw": odds_draw,
        "odds_away": odds_away,
        "prob_home": prob_home,
        "prob_draw": prob_draw,
        "prob_away": prob_away,
        "margin": margin,
        "scraped_home_name": home_team,
        "scraped_away_name": away_team,
        "match_score_home": 100,
        "match_score_away": 100,
        "kickoff": kickoff,
        "source_url": "manual",
        "scraped_at_utc": timestamp,
    }


def refresh_web_export(db_path: Path, fixture_path: Path, web_output: Path, round_size: int = 10) -> int:
    with OddsDatabase(db_path) as database:
        rounds_by_fixture = fixture_rounds(fixture_path, round_size)
        return write_web_data(database, web_output, rounds_by_fixture)


# ---------------------------------------------------------------------------
# LADOWANIE: JSON i SQLite
# ---------------------------------------------------------------------------


def to_sql_value(value: object) -> object:
    """sqlite3 nie zna typow numpy - int64 wpadlby do bazy jako BLOB."""
    if value is None or (not isinstance(value, str) and pd.isna(value)):
        return None
    if hasattr(value, "item"):
        return value.item()
    return value


class OddsDatabase:
    """Prosty interfejs do SQLite. Kazdy przebieg to snapshot, historia zostaje."""

    SCHEMA = """
    CREATE TABLE IF NOT EXISTS odds_1x2 (
        bookmaker         TEXT NOT NULL,
        home_team         TEXT NOT NULL,
        away_team         TEXT NOT NULL,
        scraped_at_utc    TEXT NOT NULL,
        fixture           INTEGER,
        kickoff           TEXT,
        odds_home         REAL NOT NULL,
        odds_draw         REAL NOT NULL,
        odds_away         REAL NOT NULL,
        prob_home         REAL NOT NULL,
        prob_draw         REAL NOT NULL,
        prob_away         REAL NOT NULL,
        margin            REAL NOT NULL,
        scraped_home_name TEXT,
        scraped_away_name TEXT,
        match_score_home  INTEGER,
        match_score_away  INTEGER,
        source_url        TEXT,
        PRIMARY KEY (bookmaker, home_team, away_team, scraped_at_utc)
    );
    """

    COLUMNS = [
        "bookmaker", "home_team", "away_team", "scraped_at_utc", "fixture", "kickoff",
        "odds_home", "odds_draw", "odds_away",
        "prob_home", "prob_draw", "prob_away", "margin",
        "scraped_home_name", "scraped_away_name", "match_score_home", "match_score_away",
        "source_url",
    ]

    def __init__(self, path: Path):
        self.path = path
        self.connection: sqlite3.Connection | None = None

    def __enter__(self) -> OddsDatabase:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.path)
        self.connection.row_factory = sqlite3.Row
        self.connection.executescript(self.SCHEMA)
        return self

    def __exit__(self, exception_type, exception_value, traceback) -> None:
        if self.connection is not None:
            self.connection.close()
            self.connection = None

    def save_snapshot(self, odds_frame: pd.DataFrame) -> int:
        if self.connection is None:
            raise RuntimeError("Uzyj OddsDatabase jako context managera.")
        if odds_frame.empty:
            return 0

        frame = odds_frame.reindex(columns=self.COLUMNS)
        records = [
            tuple(to_sql_value(value) for value in row)
            for row in frame.itertuples(index=False, name=None)
        ]
        placeholders = ", ".join(["?"] * len(self.COLUMNS))
        statement = f"INSERT OR REPLACE INTO odds_1x2 ({', '.join(self.COLUMNS)}) VALUES ({placeholders})"

        with self.connection:
            self.connection.executemany(statement, records)
        return len(records)

    def latest_odds(self, bookmaker: str | None = None) -> pd.DataFrame:
        """Najswiezszy kurs na kazdy mecz - to jest wejscie do porownan z modelem."""
        if self.connection is None:
            raise RuntimeError("Uzyj OddsDatabase jako context managera.")

        query = """
        SELECT odds.* FROM odds_1x2 AS odds
        JOIN (
            SELECT bookmaker, home_team, away_team, MAX(scraped_at_utc) AS scraped_at_utc
            FROM odds_1x2
            GROUP BY bookmaker, home_team, away_team
        ) AS newest
        USING (bookmaker, home_team, away_team, scraped_at_utc)
        """
        parameters: tuple[object, ...] = ()
        if bookmaker:
            query += " WHERE odds.bookmaker = ?"
            parameters = (bookmaker,)
        query += " ORDER BY odds.fixture IS NULL, odds.fixture, odds.home_team"

        return pd.read_sql_query(query, self.connection, params=parameters)

    def delete_match_odds(self, bookmaker: str, home_team: str, away_team: str) -> int:
        if self.connection is None:
            raise RuntimeError("Uzyj OddsDatabase jako context managera.")
        with self.connection:
            cursor = self.connection.execute(
                "DELETE FROM odds_1x2 WHERE bookmaker = ? AND home_team = ? AND away_team = ?",
                (bookmaker.strip().lower(), home_team, away_team),
            )
        return int(cursor.rowcount)

    def fixtures_with_odds(self, bookmaker: str | None = None) -> dict[int, dict[str, object]]:
        frame = self.latest_odds(bookmaker)
        indexed: dict[int, dict[str, object]] = {}
        for row in frame.itertuples(index=False):
            if pd.isna(row.fixture):
                continue
            indexed[int(row.fixture)] = {
                "bookmaker": row.bookmaker,
                "odds_home": row.odds_home,
                "odds_draw": row.odds_draw,
                "odds_away": row.odds_away,
                "source_url": row.source_url,
            }
        return indexed


def fixture_rounds(fixture_path: Path, round_size: int) -> dict[int, int]:
    """Numer kolejki dla kazdego meczu, ta sama logika co w run_forecast.py."""
    fixtures = pd.read_csv(fixture_path)
    rounds = forecast_rounds(fixtures, round_size)
    return {
        position + 1: int(value)
        for position, value in enumerate(rounds)
        if pd.notna(value)
    }


def write_web_data(database: OddsDatabase, output_path: Path, rounds_by_fixture: dict[int, int]) -> int:
    """Zapisuje kursy dla frontendu.

    Dane lecą z bazy, a nie z biezacego przebiegu, bo strona musi pokazac tez
    mecze juz rozegrane. Agent scrapuje tylko nierozegrane spotkania, wiec
    ostatni snapshot danego meczu to jego kurs przedmeczowy - dokladnie to,
    z czym uczciwie porownuje sie prognoza modelu sprzed kolejki.
    """
    frame = database.latest_odds()
    records = []

    for row in frame.itertuples(index=False):
        if pd.isna(row.fixture):
            continue
        fixture = int(row.fixture)
        records.append({
            "fixture": fixture,
            "round": rounds_by_fixture.get(fixture),
            "bookmaker": row.bookmaker,
            "homeTeam": display_name(row.home_team),
            "awayTeam": display_name(row.away_team),
            "oddsHome": row.odds_home,
            "oddsDraw": row.odds_draw,
            "oddsAway": row.odds_away,
            "probHome": row.prob_home,
            "probDraw": row.prob_draw,
            "probAway": row.prob_away,
            "margin": row.margin,
            "kickoff": row.kickoff or "",
            "scrapedAtUTC": row.scraped_at_utc,
        })

    payload = {
        "meta": {
            "bookmakers": sorted({record["bookmaker"] for record in records}),
            "market": "1X2",
            "marginMethod": "proportional",
            "matches": len(records),
            "generatedAtUTC": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        },
        "odds": records,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    json_payload = json.dumps(payload, ensure_ascii=False, indent=4)
    output_path.write_text(f"window.oddsData = {json_payload};\n", encoding="utf-8")
    return len(records)


def write_json(odds_frame: pd.DataFrame, output_path: Path, bookmaker: str, source_url: str) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    records = json.loads(odds_frame.to_json(orient="records"))
    payload = {
        "meta": {
            "bookmaker": bookmaker,
            "sourceURL": source_url,
            "market": "1X2",
            "marginMethod": "proportional",
            "matches": len(odds_frame),
            "generatedAtUTC": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        },
        "odds": records,
    }
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=4) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape 1X2 odds, remove bookmaker margin and store the result.")
    parser.add_argument("--bookmaker", choices=sorted(BOOKMAKERS), default="betclic")
    parser.add_argument("--url", default=None, help="Nadpisuje URL z konfiguracji bukmachera.")
    parser.add_argument("--fixtures", type=Path, default=DEFAULT_FIXTURE_PATH)
    parser.add_argument("--json-output", type=Path, default=DEFAULT_JSON_PATH)
    parser.add_argument("--db-output", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--web-output", type=Path, default=DEFAULT_WEB_PATH)
    parser.add_argument("--no-json", action="store_true")
    parser.add_argument("--no-db", action="store_true")
    parser.add_argument("--no-web", action="store_true")
    parser.add_argument("--html-file", type=Path, default=None, help="Parsuje zapisany HTML zamiast wchodzic na strone.")
    parser.add_argument("--dump-html", type=Path, default=None, help="Zapisuje pobrany HTML do podejrzenia selektorow.")
    parser.add_argument("--round-size", type=int, default=10, help="Wielkosc kolejki gdy terminarz nie ma kolumny Round.")
    parser.add_argument("--threshold", type=int, default=80, help="Minimalny wynik fuzzy matchingu (0-100).")
    parser.add_argument("--timeout", type=int, default=45000, help="Timeout Playwright w ms.")
    parser.add_argument("--scroll-rounds", type=int, default=4)
    parser.add_argument("--headed", action="store_true", help="Pokazuje przegladarke (debug).")
    parser.add_argument("--quiet", action="store_true")
    return parser.parse_args()


def run(args: argparse.Namespace) -> int:
    config = BOOKMAKERS[args.bookmaker]
    source_url = args.url or config.url

    canonical_teams = load_canonical_teams(args.fixtures)
    lookup = build_team_lookup(canonical_teams)
    LOGGER.info("Druzyn w terminarzu: %d, aliasow w slowniku: %d", len(canonical_teams), len(lookup))

    if args.html_file:
        if not args.html_file.exists():
            raise ScrapeError(f"Nie ma pliku HTML: {args.html_file}")
        html = args.html_file.read_text(encoding="utf-8", errors="replace")
        LOGGER.info("Parsuje offline: %s", args.html_file)
    else:
        LOGGER.info("Pobieram: %s", source_url)
        html = fetch_html(config, source_url, args.timeout, not args.headed, args.scroll_rounds)

    if args.dump_html:
        args.dump_html.parent.mkdir(parents=True, exist_ok=True)
        args.dump_html.write_text(html, encoding="utf-8")
        LOGGER.info("Zapisano HTML: %s", args.dump_html)

    report = parse_offers(html, config, lookup, args.threshold)
    for reason in report.skipped:
        LOGGER.warning("Pominiety kafelek: %s", reason)

    odds_frame, warnings = build_odds_frame(report.offers, lookup, args.threshold, config.name, source_url)
    for warning in warnings:
        LOGGER.warning(warning)

    if odds_frame.empty:
        raise ScrapeError("Zero meczow po transformacji. Sprawdz selektory albo obniz --threshold.")

    odds_frame = attach_fixture_numbers(odds_frame, args.fixtures)

    if not args.no_json:
        write_json(odds_frame, args.json_output, config.name, source_url)
        LOGGER.info("Zapisano JSON: %s", args.json_output)

    if not args.no_db:
        with OddsDatabase(args.db_output) as database:
            saved = database.save_snapshot(odds_frame)
            LOGGER.info("Zapisano do SQLite: %d wierszy w %s", saved, args.db_output)
            if not args.no_web:
                exported = refresh_web_export(args.db_output, args.fixtures, args.web_output, args.round_size)
                LOGGER.info("Zapisano dane strony: %d meczow w %s", exported, args.web_output)
    elif not args.no_web:
        LOGGER.warning("Pomijam dane strony: eksport dla frontendu czyta z bazy, a jest --no-db.")

    print(f"Kursy 1X2: {len(odds_frame)} meczow, srednia marza {odds_frame['margin'].mean():.2f}%")
    for row in odds_frame.itertuples(index=False):
        fixture_label = f"#{row.fixture:>3}" if pd.notna(row.fixture) else "  ? "
        print(
            f"{fixture_label} {row.home_display} - {row.away_display}: "
            f"{row.odds_home}/{row.odds_draw}/{row.odds_away} -> "
            f"{row.prob_home}% / {row.prob_draw}% / {row.prob_away}%"
        )
    return 0


def main() -> int:
    args = parse_args()
    logging.basicConfig(
        level=logging.WARNING if args.quiet else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        stream=sys.stderr,
    )

    try:
        return run(args)
    except ScrapeError as error:
        # cron patrzy na kod wyjscia, wiec blad idzie na stderr i zwracamy 1
        LOGGER.error("%s", error)
        return 1
    except KeyboardInterrupt:
        LOGGER.error("Przerwane przez uzytkownika.")
        return 130


if __name__ == "__main__":
    sys.exit(main())
