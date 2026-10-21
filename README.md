# Premier League Predictor

Projekt do symulowania tabeli Premier League na podstawie danych historycznych. Aktualnie glowny model w notebooku liczy oczekiwane gole przez regresje Poissona, a potem losuje wiele sezonow metoda Monte Carlo.

To nie jest gotowy bukmacherski model. Bardziej roboczy predictor: ma dawac sensowna, latwa do przejrzenia prognoze tabeli i pokazywac, skad biora sie punkty, gole oraz procenty typu mistrzostwo/top 4/spadek.

## Dane

Dane sa trzymane w `data/raw/pl_seasons/`. Historyczne sezony maja realne wyniki meczow, a przyszly sezon (`season-2627.csv`) jest terminarzem bez wynikow.

Notebook najpierw laczy historyczne pliki w:

```text
data/processed/PL_allseasons.csv
```

Potem na tej bazie powstaje:

```text
data/processed/PL_base_with_traits.csv
```

Ten drugi plik zawiera juz cechy przedmeczowe, m.in. ELO, forme i H2H. Wazne: mecze bez `FTHG` i `FTAG` sa wyrzucane z treningu, zeby przyszly terminarz nie udawal historycznych wynikow.

## ELO

ELO opisuje aktualna sile druzyny. Kazdy mecz aktualizuje ranking wedlug wzoru:

```text
new_elo = old_elo + K * (actual_score - expected_score)
```

Gdzie:

- `actual_score` to `1` za wygrana, `0.5` za remis, `0` za porazke,
- `expected_score` wynika z roznicy ELO obu druzyn,
- gospodarz dostaje bonus `HOME_ADVANTAGE`,
- `K` ustala jak mocno jeden mecz rusza ranking.

Miedzy sezonami jest mala regresja do sredniej, zeby stara sila druzyny nie byla przenoszona w 100% na kolejny sezon.

## Forma i H2H

Forma jest liczona jako srednia punktow z ostatnich 5 meczow. Sa trzy warianty:

- forma ogolna,
- forma u siebie,
- forma na wyjezdzie.

H2H dziala podobnie, tylko dla konkretnej pary druzyn. Model dostaje roznice H2H z perspektywy aktualnej druzyny.

## Model Poissona

Wczesniejsza wersja modelu przewidywala od razu `1/X/2`. Aktualna wersja robi cos blizszego pilce: przewiduje liczbe goli.

Mecz jest zamieniany na dwa wiersze treningowe:

```text
Arsenal - Chelsea 2:1

Arsenal | Chelsea | IsHome=1 | Goals=2
Chelsea | Arsenal | IsHome=0 | Goals=1
```

Model uczy sie:

```text
Goals ~ Team + Opponent + IsHome + EloDiff + FormDiff + VenueFormDiff + H2HDiff
```

`Team` i `Opponent` sa kodowane przez one-hot encoding. Numeryczne cechy sa skalowane. Na koncu `PoissonRegressor` zwraca lambde, czyli oczekiwana liczbe goli.

Przyklad:

```text
Man City - Leeds
lambda_home = 2.65
lambda_away = 0.80
```

To znaczy: model oczekuje srednio 2.65 gola City i 0.80 gola Leeds.

## Monte Carlo

Dla kazdego meczu terminarza najpierw liczone sa lambdy:

```text
lambda_home
lambda_away
```

Potem w kazdej symulacji losowany jest wynik:

```text
home_goals ~ Poisson(lambda_home)
away_goals ~ Poisson(lambda_away)
```

Z wyniku bramkowego liczone sa:

- punkty,
- gole strzelone (`GF`),
- gole stracone (`GA`),
- bilans (`GD`).

Sezon jest powtarzany wiele razy (`N_SIMS`). Finalna tabela pokazuje srednie punkty i gole oraz procenty:

- `Tytul (%)`,
- `Top 4 (%)`,
- `Spadek (%)`.

## Jak aktualizowac strone

Strona nie ma juz recznie wpisanej tabeli w `web/app.js`. Dane dla frontendu sa generowane przez Monte Carlo do pliku:

```text
web/forecast-data.js
```

Po kazdym uruchomieniu prognozy strona bierze nowa tabele, liczbe rozegranych meczow i zakladke najblizszej kolejki wlasnie z tego pliku.

Zwykle odswiezenie prognozy:

```powershell
.\venv\Scripts\python.exe src\run_forecast.py
```

Domyslnie skrypt wykonuje `10000` symulacji i zapisuje do strony ograniczona pule pojedynczych przebiegow dla przycisku `Losowa symulacja`. Liczbe symulacji i liczbe zapisanych przykladow mozna zmienic tak:

```powershell
.\venv\Scripts\python.exe src\run_forecast.py --simulations 20000 --sample-tables 120
```

Model traktuje mecze z wypelnionymi `FTHG` i `FTAG` jako fakty. Te spotkania sa dodawane do startowej tabeli, aktualizuja ELO, forme i H2H, a Monte Carlo losuje tylko pozostale mecze.

Procenty w tabeli maja tez dokladne liczniki. Po najechaniu albo kliknieciu procentu widac, w ilu symulacjach dana sytuacja wystapila, np. `Tytul: 6321 z 10000 symulacji`.

Oprocz biezacego pliku `web/forecast-data.js` generator aktualizuje tez:

```text
web/forecast-history.js
```

Ten plik przechowuje snapshoty prognozy przed sezonem i po kazdej pelnej kolejce. Zakladka `Historia` pozwala przelaczac zapisane tabele prawdopodobienstw, a zakladka `Wykresy` rysuje trendy dla tytulu, Top 4 i spadku na podstawie tych snapshotow oraz aktualnej prognozy.

## Dodawanie wyniku

Najpierw mozna wyswietlic terminarz z numerami wierszy:

```powershell
.\venv\Scripts\python.exe src\add_result.py --list
```

Dodanie wyniku po numerze meczu i automatyczna regeneracja strony:

```powershell
.\venv\Scripts\python.exe src\add_result.py --fixture 1 --score 2-0 --run-forecast
```

Przy dodawaniu wyniku mozna uzyc tych samych ustawien Monte Carlo:

```powershell
.\venv\Scripts\python.exe src\add_result.py --fixture 1 --score 2-0 --run-forecast --simulations 20000 --sample-tables 120
```

Mozna tez wpisac druzyny:

```powershell
.\venv\Scripts\python.exe src\add_result.py --home Arsenal --away "Coventry City" --score 2-0 --run-forecast
```

Jesli mecz ma juz wynik, skrypt nie nadpisze go przypadkiem. Do poprawki wyniku trzeba dodac `--force`.

Zakladka `Nadchodzace mecze` pokazuje tylko najblizsza nierozgrana kolejke. Jesli plik terminarza nie ma kolumny `Round` albo `Matchweek`, skrypt liczy kolejki blokami po 10 meczow wedlug kolejnosci w CSV.

## Kursy bukmacherskie

`src/scrape_odds.py` to osobny agent ETL. Pobiera kursy 1X2 na najblizsze mecze, zdejmuje marze bukmachera i zapisuje wynik. Nie wchodzi do modelu Poissona, sluzy do porownania prognozy z rynkiem.

Pierwsze uruchomienie wymaga przegladarki dla Playwright:

```powershell
.\venv\Scripts\python.exe -m pip install -r requirements.txt
.\venv\Scripts\python.exe -m playwright install chromium
```

Zwykly przebieg:

```powershell
.\venv\Scripts\python.exe src\scrape_odds.py
```

Agent zapisuje trzy pliki:

```text
data/raw/odds/odds_1x2.json
data/processed/odds.sqlite
web/odds-data.js
```

JSON to zawsze ostatni przebieg. SQLite trzyma cala historie, bo kazdy przebieg to snapshot z wlasnym `scraped_at_utc`. Dzieki temu widac, jak kurs rusza sie przed meczem. Metoda `OddsDatabase.latest_odds()` zwraca najswiezszy kurs na kazdy mecz.

Plik `web/odds-data.js` jest generowany z bazy, a nie z biezacego przebiegu. To wazne: agent scrapuje tylko mecze nierozegrane, wiec ostatni zapisany snapshot danego meczu jest jego kursem przedmeczowym. Strona moze wiec pokazac kursy takze dla meczow juz rozegranych i nigdzie nie zaglada w przyszlosc.

Nazwy druzyn od bukmachera sa mapowane na nazwy modelu przez `thefuzz`. Najpierw leci trafienie dokladne i `TEAM_NAME_MAP`, potem fuzzy matching z progiem `--threshold` (domyslnie 80). Nazwy niejednoznaczne, na przyklad samo `Manchester`, sa odrzucane, a nie zgadywane. Kursy dostaja tez numer meczu z terminarza, ten sam ktorego uzywa `add_result.py`.

Selektory bukmachera zmieniaja sie co kilka miesiecy. Jesli agent przestanie widziec mecze, najpierw trzeba zobaczyc markup:

```powershell
.\venv\Scripts\python.exe src\scrape_odds.py --headed --dump-html data\raw\odds\page.html
```

Zapisany plik mozna parsowac offline, bez wchodzenia na strone:

```powershell
.\venv\Scripts\python.exe src\scrape_odds.py --html-file data\raw\odds\page.html
```

Selektory siedza w `BOOKMAKERS` w `src/scrape_odds.py`. Gdy zawioda, parser ma jeszcze heurystyke: szuka najmniejszego elementu DOM, ktory zawiera dokladnie trzy kursy, i traktuje go jako kafelek meczu.

Skrypt zwraca kod `0` przy sukcesie i `1` przy bledzie, a logi ida na stderr, wiec nadaje sie pod cron albo Harmonogram zadan.

## Reczne kursy z przeszlosci

Stare kolejki nie maja kursow w CSV sezonu, wiec mozesz je uzupelnic recznie przez `src/add_odds.py`. Dziala podobnie do `add_result.py`: numer meczu bierzesz z `--list`, a skrypt sam liczy prawdopodobienstwa bez marzy i odswieza `web/odds-data.js`.

Lista meczow ze statusem kursow:

```powershell
.\venv\Scripts\python.exe src\add_odds.py --list
```

Jeden mecz po numerze:

```powershell
.\venv\Scripts\python.exe src\add_odds.py --fixture 1 --odds 1.45/4.50/6.50
```

Albo po nazwach druzyn:

```powershell
.\venv\Scripts\python.exe src\add_odds.py --home Arsenal --away "Coventry City" --odds 1.20,6.50,12.00
```

Import wielu meczow z CSV (wzor w `data/raw/odds/manual_odds_template.csv`):

```powershell
.\venv\Scripts\python.exe src\add_odds.py --csv data\raw\odds\manual_odds_template.csv --force
```

Kolumny CSV: `fixture` albo `home_team` + `away_team`, potem `odds_home`, `odds_draw`, `odds_away`, opcjonalnie `bookmaker` i `scraped_at`.

Logo bukmachera na stronie wrzucasz do `web/assets/logos/bookmakers/` jako plik `{bookmaker}.svg`, np. `betclic.svg`. Jesli pliku brakuje, wyswietli sie placeholder `_default.svg`.

## Porownanie z bukmacherem

Kursy widac na stronie w trzech miejscach.

W zakladce `Nadchodzace mecze` i `Wyniki` kazda karta meczu dostaje kurs, szanse bez marzy oraz roznice `model minus bukmacher`. Przy rozegranych meczach dochodzi jeszcze plakietka `Blizej prawdy`, ktora porownuje, ile procent kazda strona dala na wynik, ktory faktycznie padl.

Osobna zakladka `Porownanie z bukmacherem` liczy to kolejka po kolejce. Miara jest Brier score, czyli suma kwadratow roznic miedzy typem a rzeczywistoscia. Nizej znaczy lepiej, zero to typ idealny. Brier jest regula wlasciwa, wiec nie da sie go poprawic samym zawyzaniem pewnosci - to lepsze kryterium niz zwykle zliczanie trafien, ktore i tak jest pokazane obok.

Porownanie jest uczciwe w obie strony. Model dostaje prognoze policzona na stanie sprzed danej kolejki, a bukmacher kurs sprzed meczu, wiec zadna strona nie zna wyniku.

Stare kolejki uzupelniasz recznie przez `add_odds.py`. Agent automatyczny nadal zbiera tylko nierozgrane mecze, ale baza trzyma oba zrodla razem.

## Notebook

Najprosciej odpalic notebook:

```text
src/model.ipynb
```

Notebook zostaje dobry do eksperymentow i sprawdzania modelu, ale aktualizacja strony idzie przez `src/run_forecast.py`, zeby frontend zawsze dostawal gotowy plik danych.

Kolejnosc komorek ma znaczenie:

1. Importy i przygotowanie danych.
2. Liczenie albo wczytanie `PL_base_with_traits.csv`.
3. Sekcja Poissona.
4. Sanity check lambd.
5. Poisson Monte Carlo.

Jesli zmieniasz dane historyczne, najpierw przebuduj pliki w `data/processed/`, a dopiero potem uruchamiaj model Poissona.

## Rzeczy do poprawy pozniej

- Dopasowanie parametru Dixon-Coles dla niskich wynikow typu 0-0, 1-0, 1-1.
- Lepsze traktowanie beniaminkow, ktorzy nie maja historii w Premier League.
- Wagi czasowe, zeby nowsze sezony mocniej wplywaly na model.
- Backtest po sezonach dla samego modelu bramkowego, nie tylko sanity check.
