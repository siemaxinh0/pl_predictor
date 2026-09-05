import argparse
import csv
import re
import time
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path


FIRST_PAGE_URL = "https://www.transfermarkt.pl/vereins-statistik/wertvollstemannschaften/marktwertetop/plus/0/galerie/0?land_id=189&kontinent_id=0&yt0=Poka%C5%BC"
PAGED_URL = "https://www.transfermarkt.pl/vereins-statistik/wertvollstemannschaften/marktwertetop/plus/land_id/189/kontinent_id/0/yt0/Poka%C5%BC/0//page/{page}"
LEAGUE_PAGE_URL = "https://www.transfermarkt.pl/premier-league/startseite/wettbewerb/GB1?saison_id={season_id}"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept-Language": "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7",
}

TEAM_NAME_MAP = {
    "AFC Bournemouth": "Bournemouth",
    "AFC Sunderland": "Sunderland",
    "Arsenal FC": "Arsenal",
    "Brighton & Hove Albion": "Brighton",
    "Brighton and Hove Albion": "Brighton",
    "Cardiff City": "Cardiff",
    "Chelsea FC": "Chelsea",
    "FC Arsenal": "Arsenal",
    "FC Brentford": "Brentford",
    "FC Burnley": "Burnley",
    "FC Chelsea": "Chelsea",
    "FC Everton": "Everton",
    "FC Fulham": "Fulham",
    "FC Liverpool": "Liverpool",
    "FC Middlesbrough": "Middlesbrough",
    "FC Southampton": "Southampton",
    "FC Watford": "Watford",
    "Hull City": "Hull",
    "Huddersfield Town": "Huddersfield",
    "Ipswich Town": "Ipswich",
    "Leeds United": "Leeds",
    "Leicester City": "Leicester",
    "Luton Town": "Luton",
    "Manchester City": "Man City",
    "Manchester United": "Man United",
    "Newcastle United": "Newcastle",
    "Norwich City": "Norwich",
    "Nottingham Forest": "Nott'm Forest",
    "Queens Park Rangers": "QPR",
    "Sheffield United": "Sheffield United",
    "Stoke City": "Stoke",
    "Swansea City": "Swansea",
    "Tottenham Hotspur": "Tottenham",
    "West Bromwich Albion": "West Brom",
    "West Ham United": "West Ham",
    "Wolverhampton Wanderers": "Wolves",
}

COMPETITION_MARKERS = (
    "Premier League",
    "Championship",
    "League One",
    "League Two",
    "National League",
)

FIELDNAMES = [
    "SeasonFile",
    "Team",
    "TransfermarktTeam",
    "Rank",
    "Competition",
    "SquadValueEUR",
    "SquadValueText",
    "SourceURL",
    "ScrapedAtUTC",
]


class ItemsTableParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_items_table = False
        self.table_depth = 0
        self.in_row = False
        self.in_cell = False
        self.current_cell = []
        self.current_row = []
        self.rows = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "table" and "items" in attrs.get("class", "").split():
            self.in_items_table = True
            self.table_depth = 1
            return
        if not self.in_items_table:
            return
        if tag == "table":
            self.table_depth += 1
        elif tag == "tr":
            self.in_row = True
            self.current_row = []
        elif self.in_row and tag in {"td", "th"}:
            self.in_cell = True
            self.current_cell = []

    def handle_data(self, data):
        if self.in_cell:
            self.current_cell.append(data)

    def handle_endtag(self, tag):
        if not self.in_items_table:
            return
        if tag in {"td", "th"} and self.in_cell:
            self.current_row.append(clean_text(" ".join(self.current_cell)))
            self.current_cell = []
            self.in_cell = False
        elif tag == "tr" and self.in_row:
            row = [cell for cell in self.current_row if cell]
            if row:
                self.rows.append(row)
            self.current_row = []
            self.in_row = False
        elif tag == "table":
            self.table_depth -= 1
            if self.table_depth <= 0:
                self.in_items_table = False


def clean_text(text):
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


def normalize_team_name(name):
    name = clean_text(name)
    return TEAM_NAME_MAP.get(name, name)


def simplify_repeated_name(name):
    name = clean_text(name)
    words = name.split()
    if len(words) % 2 == 0:
        half = len(words) // 2
        if words[:half] == words[half:]:
            return " ".join(words[:half])
    return name


def page_url(page):
    if page == 1:
        return FIRST_PAGE_URL
    return PAGED_URL.format(page=page)


def league_page_url(season_id):
    return LEAGUE_PAGE_URL.format(season_id=season_id)


def season_id_to_file(season_id):
    return f"season-{str(season_id)[-2:]}{(season_id + 1) % 100:02d}.csv"


def fetch_html(url, timeout):
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        encoding = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(encoding, errors="replace")


def parse_market_value(text):
    value_text = text.lower().replace("\u20ac", " ").replace("\xa0", " ")
    if "," in value_text:
        value_text = value_text.replace(".", "").replace(",", ".")
    match = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*([a-z]+)?", value_text)
    if not match:
        return None

    value = float(match.group(1))
    unit = match.group(2) or ""
    if unit in {"mld", "bn", "b", "mrd"}:
        value *= 1_000_000_000
    elif unit in {"mln", "mio", "m", "million"}:
        value *= 1_000_000
    elif unit in {"tys", "k", "th"}:
        value *= 1_000
    return int(round(value))


def contains_market_value(cell):
    return "\u20ac" in cell or "eur" in cell.lower()


def contains_competition(cell):
    return any(marker in cell for marker in COMPETITION_MARKERS)


def is_rank_cell(cell):
    return bool(re.fullmatch(r"\d+", cell.strip()))


def first_int(cell):
    match = re.search(r"\b\d+\b", cell)
    return int(match.group(0)) if match else None


def row_to_record(cells, source_url, season, scraped_at):
    value_index = next((index for index in range(len(cells) - 1, -1, -1) if contains_market_value(cells[index])), None)
    if value_index is None:
        return None

    rank_index = next((index for index, cell in enumerate(cells[:value_index]) if first_int(cell) is not None), None)
    if rank_index is None:
        return None

    competition_index = next((index for index, cell in enumerate(cells) if contains_competition(cell)), None)
    candidate_end = min(value_index, competition_index if competition_index is not None else value_index)
    club_candidates = []

    for cell in cells[rank_index + 1:candidate_end]:
        cell = simplify_repeated_name(cell)
        if not cell or contains_market_value(cell) or contains_competition(cell) or is_rank_cell(cell):
            continue
        club_candidates.append(cell)

    if not club_candidates:
        return None

    transfermarkt_team = club_candidates[0]
    squad_value = parse_market_value(cells[value_index])
    if squad_value is None:
        return None

    return {
        "SeasonFile": season,
        "Team": normalize_team_name(transfermarkt_team),
        "TransfermarktTeam": transfermarkt_team,
        "Rank": first_int(cells[rank_index]),
        "Competition": cells[competition_index] if competition_index is not None else "",
        "SquadValueEUR": squad_value,
        "SquadValueText": cells[value_index],
        "SourceURL": source_url,
        "ScrapedAtUTC": scraped_at,
    }


def league_row_to_record(cells, source_url, season, scraped_at, rank):
    if len(cells) < 6 or cells[0] in {"Klub", "#"}:
        return None

    value_text = cells[-1]
    if not contains_market_value(value_text):
        return None

    squad_value = parse_market_value(value_text)
    if squad_value is None:
        return None

    transfermarkt_team = simplify_repeated_name(cells[0])
    return {
        "SeasonFile": season,
        "Team": normalize_team_name(transfermarkt_team),
        "TransfermarktTeam": transfermarkt_team,
        "Rank": rank,
        "Competition": "Premier League",
        "SquadValueEUR": squad_value,
        "SquadValueText": value_text,
        "SourceURL": source_url,
        "ScrapedAtUTC": scraped_at,
    }


def scrape_page(url, season, timeout):
    html = fetch_html(url, timeout)
    parser = ItemsTableParser()
    parser.feed(html)
    scraped_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    records = []
    for row in parser.rows:
        record = row_to_record(row, url, season, scraped_at)
        if record is not None:
            records.append(record)
    return records


def scrape_league_season(season_id, timeout):
    season = season_id_to_file(season_id)
    url = league_page_url(season_id)
    html = fetch_html(url, timeout)
    parser = ItemsTableParser()
    parser.feed(html)
    scraped_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    records = []

    for row in parser.rows:
        record = league_row_to_record(row, url, season, scraped_at, len(records) + 1)
        if record is not None:
            records.append(record)
        if len(records) == 20:
            break

    return records


def load_fixture_teams(path):
    teams = set()
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        for row in reader:
            for column in ("HomeTeam", "AwayTeam"):
                if row.get(column):
                    teams.add(normalize_team_name(row[column]))
    return teams


def read_existing_rows(path, season, replacement_teams):
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        rows = list(reader)
    return [row for row in rows if not (row.get("SeasonFile") == season and row.get("Team") in replacement_teams)]


def write_rows(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)


def scrape_squad_values(max_pages, season, timeout, delay):
    records = []
    seen = set()
    try:
        for page in range(1, max_pages + 1):
            url = page_url(page)
            page_records = scrape_page(url, season, timeout)
            new_records = []
            for record in page_records:
                key = record["TransfermarktTeam"]
                if key not in seen:
                    seen.add(key)
                    new_records.append(record)
            if not new_records:
                break
            records.extend(new_records)
            print(f"Page {page}: {len(new_records)} teams")
            if delay and page < max_pages:
                time.sleep(delay)
    except KeyboardInterrupt:
        print("\nInterrupted. Saving records fetched so far.")
    return sorted(records, key=lambda row: int(row["Rank"]))


def parse_season_ids(value):
    season_ids = []
    for part in value.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start, end = [int(item.strip()) for item in part.split("-", 1)]
            season_ids.extend(range(start, end + 1))
        else:
            season_ids.append(int(part))
    return season_ids


def scrape_league_values(season_ids, timeout, delay):
    records = []
    try:
        for index, season_id in enumerate(season_ids, start=1):
            season_records = scrape_league_season(season_id, timeout)
            records.extend(season_records)
            print(f"Season {season_id_to_file(season_id)}: {len(season_records)} teams")
            if delay and index < len(season_ids):
                time.sleep(delay)
    except KeyboardInterrupt:
        print("\nInterrupted. Saving records fetched so far.")
    return records


def parse_args():
    parser = argparse.ArgumentParser(description="Scrape current English club squad values from Transfermarkt.")
    parser.add_argument("--source", choices=["ranking", "league"], default="ranking")
    parser.add_argument("--output", type=Path, default=Path("data/raw/squad_values_by_season.csv"))
    parser.add_argument("--season-file", type=Path, default=None)
    parser.add_argument("--season", default=None)
    parser.add_argument("--season-ids", default="2015-2026")
    parser.add_argument("--max-pages", type=int, default=4)
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--delay", type=float, default=0.0)
    parser.add_argument("--append", action="store_true")
    return parser.parse_args()


def main():
    args = parse_args()
    if args.source == "league":
        records = scrape_league_values(parse_season_ids(args.season_ids), args.timeout, args.delay)
        season = None
    else:
        season = args.season or (args.season_file.name if args.season_file else "current_snapshot")
        records = scrape_squad_values(args.max_pages, season, args.timeout, args.delay)

    fixture_teams = load_fixture_teams(args.season_file) if args.season_file and args.source == "ranking" else None
    if fixture_teams is not None:
        records = [record for record in records if record["Team"] in fixture_teams]
        found_teams = {record["Team"] for record in records}
        missing_teams = sorted(fixture_teams - found_teams)
        if missing_teams:
            print("Missing fixture teams: " + ", ".join(missing_teams))

    replacement_teams = {record["Team"] for record in records}
    rows = read_existing_rows(args.output, season, replacement_teams) if args.append and season is not None else []
    rows.extend(records)
    write_rows(args.output, rows)

    print(f"Saved {len(records)} rows to {args.output}")


if __name__ == "__main__":
    main()