from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import poisson, spearmanr

import run_forecast as forecast
from features import DEFAULT_SQUAD_VALUES_PATH, normalize_names

# jak model sie uczy i jak dobrze przewiduje: .\venv\Scripts\python.exe src\model.py
# tylko wybrane czesci: .\venv\Scripts\python.exe src\model.py --sections trening backtest
# wszystko liczone jest tymi samymi funkcjami co strona (run_forecast.py), nic nie jest zapisywane

SEASONS_DIR = forecast.ROOT / "data" / "raw" / "pl_seasons"
SECTIONS = ["dane", "trening", "backtest", "sezon", "tabela"]
MIN_TRAIN_SEASONS = 4
USED_MODEL = "+ wartosc kadry (strona)"
FEATURE_SETS = {
    "tylko druzyny": [],
    "+ ELO, forma, H2H": forecast.DIFF_FEATURES,
    USED_MODEL: forecast.DIFF_FEATURES + [forecast.VALUE_FEATURE],
}
BASELINE = "czestosci z historii"
FEATURE_DESCRIPTIONS = {
    "EloDiff": "roznica ELO (sila druzyny liczona z wynikow)",
    "FormDiff": "roznica formy (srednie punkty z 5 ostatnich meczow)",
    "VenueFormDiff": "roznica formy u siebie / na wyjezdzie",
    "H2HDiff": "roznica punktow w 5 ostatnich meczach tych dwoch druzyn",
    "SquadValueDiff": "roznica log wartosci kadr z Transfermarkt",
}
OUTCOME_LABELS = ["1 (gospodarz)", "X (remis)", "2 (gosc)"]


def header(title: str) -> None:
    print()
    print("=" * 78)
    print(title)
    print("=" * 78)


def season_label(season_file: str) -> str:
    code = season_file.removeprefix("season-").removesuffix(".csv")
    return f"{code[:2]}/{code[2:]}"


def outcome_probabilities(lambda_home: np.ndarray, lambda_away: np.ndarray, max_goals: int = 12) -> np.ndarray:
    # ten sam rachunek co poisson_result_probs w run_forecast.py, tylko dla wielu meczow naraz i bez zaokraglen
    goals = np.arange(max_goals + 1)
    home_pmf = poisson.pmf(goals[None, :], np.asarray(lambda_home)[:, None])
    away_pmf = poisson.pmf(goals[None, :], np.asarray(lambda_away)[:, None])
    scores = home_pmf[:, :, None] * away_pmf[:, None, :]
    scores /= scores.sum(axis=(1, 2), keepdims=True)
    home_win = (scores * (goals[:, None] > goals[None, :])).sum(axis=(1, 2))
    draw = (scores * (goals[:, None] == goals[None, :])).sum(axis=(1, 2))
    return np.column_stack([home_win, draw, 1 - home_win - draw])


def outcome_index(home_goals: np.ndarray, away_goals: np.ndarray) -> np.ndarray:
    return np.select([home_goals > away_goals, home_goals == away_goals], [0, 1], 2)


def outcome_metrics(probs: np.ndarray, outcomes: np.ndarray) -> dict[str, float]:
    picked = probs[np.arange(len(outcomes)), outcomes]
    return {
        "Trafnosc %": float(np.mean(probs.argmax(axis=1) == outcomes) * 100),
        "Log loss": float(-np.mean(np.log(np.clip(picked, 1e-12, 1)))),
        "Brier": float(np.mean(((probs - np.eye(3)[outcomes]) ** 2).sum(axis=1))),
    }


def base_rates(matches: pd.DataFrame) -> np.ndarray:
    outcomes = outcome_index(matches["FTHG"].to_numpy(), matches["FTAG"].to_numpy())
    return np.bincount(outcomes, minlength=3) / len(outcomes)


def show_data(history: pd.DataFrame) -> None:
    header("1. DANE: na czym model sie uczy")
    seasons = sorted(history["SeasonFile"].unique())
    rows = forecast.make_poisson_rows(history)
    rates = base_rates(history)
    print(f"Mecze historyczne: {len(history)} z {len(seasons)} sezonow ({season_label(seasons[0])} - {season_label(seasons[-1])}).")
    print(f"Wiersze dla modelu: {len(rows)}. Kazdy mecz to dwa wiersze: ile goli strzelili gospodarze i ile goscie.")
    print(f"Srednio goli w meczu: gospodarze {history['FTHG'].mean():.2f}, goscie {history['FTAG'].mean():.2f}.")
    print(f"Jak konczyly sie mecze: 1 = {rates[0]:.1%}, X = {rates[1]:.1%}, 2 = {rates[2]:.1%}.")
    print()
    print("Cechy, ktore model dostaje o kazdym meczu (liczone tylko z meczow rozegranych wczesniej):")
    for feature in forecast.model_diff_features(history):
        print(f"  {feature:<15} {FEATURE_DESCRIPTIONS.get(feature, '')}")
    print("  Team, Opponent  kto gra z kim (kazda druzyna dostaje wlasna sile ataku i obrony)")
    print("  IsHome          1 = gra u siebie")
    print()
    print("Przyklad: pierwsze wiersze ostatniego sezonu")
    sample = rows[rows["SeasonFile"] == seasons[-1]].sort_index().head(3)
    sample = pd.concat([sample, rows[(rows["SeasonFile"] == seasons[-1]) & (rows["IsHome"] == 0)].head(3)])
    columns = ["Team", "Opponent", "IsHome"] + forecast.model_diff_features(history) + ["Goals"]
    print(sample[columns].round(2).to_string(index=False))


def show_training(history: pd.DataFrame) -> None:
    header("2. TRENING: model Poissona na calej historii (dokladnie ten ze strony)")
    rows = forecast.make_poisson_rows(history)
    model = forecast.train_poisson_model(rows)
    preprocessor, regressor = model.named_steps["preprocessor"], model.named_steps["model"]
    names = preprocessor.get_feature_names_out()
    coefs = pd.Series(regressor.coef_, index=names)

    print("Model przewiduje srednia liczbe goli (lambda) jednej druzyny w meczu:")
    print("  lambda = exp(stala + sila ataku druzyny + slabosc obrony rywala + suma(waga * cecha))")
    print(f"Stala: exp({regressor.intercept_:.3f}) = {np.exp(regressor.intercept_):.2f} gola, kara L2 alpha = {regressor.alpha}.")
    print()
    print("Wplyw cech liczbowych. 'x1.10' znaczy: przy przewadze o jedno typowe odchylenie druzyna strzela srednio 10% wiecej goli.")
    scaler = preprocessor.named_transformers_["numbers"]
    for feature, scale in zip(scaler.feature_names_in_, scaler.scale_):
        coef = coefs[f"numbers__{feature}"]
        print(f"  {feature:<15} typowe odchylenie {scale:8.2f}   wplyw x{np.exp(coef):.3f}")

    teams = sorted(set(normalize_names(pd.read_csv(forecast.DEFAULT_FIXTURE_PATH))["HomeTeam"]))
    strengths = pd.DataFrame({
        "Druzyna": [forecast.display_name(team) for team in teams],
        "Atak": [np.exp(coefs.get(f"teams__Team_{team}", 0.0)) for team in teams],
        "Obrona": [np.exp(coefs.get(f"teams__Opponent_{team}", 0.0)) for team in teams],
    })
    strengths["Atak / obrona"] = strengths["Atak"] / strengths["Obrona"]
    print()
    print("Wlasna sila druzyn z obecnego sezonu, czyli to, co zostaje PO uwzglednieniu ELO, formy i wartosci kadry.")
    print("Atak > 1 = strzela wiecej, niz wynikaloby z tych cech, obrona < 1 = traci mniej. Druzyna z wysokim ELO")
    print("i droga kadra moze tu miec slabe liczby, bo jej sile niosa juz cechy. 1.00 = brak historii w PL.")
    print(strengths.sort_values("Atak / obrona", ascending=False).round(2).to_string(index=False))

    predicted = np.clip(model.predict(rows[model.feature_names_in_]), 0.05, 5.0)
    print()
    print(f"Kontrola: srednio przewidziane gole {predicted.mean():.3f}, prawdziwe {rows['Goals'].mean():.3f}.")


def backtest_matches(history: pd.DataFrame) -> None:
    header("3. BACKTEST MECZOW: uczymy na starszych sezonach, sprawdzamy na nastepnym")
    seasons = sorted(history["SeasonFile"].unique())
    records, calibration = [], []
    for test_season in seasons[MIN_TRAIN_SEASONS:]:
        train = history[history["SeasonFile"] < test_season]
        test = history[history["SeasonFile"] == test_season]
        outcomes = outcome_index(test["FTHG"].to_numpy(), test["FTAG"].to_numpy())
        label = season_label(test_season)
        print(f"  sezon {label}: trening na {len(train)} meczach, test na {len(test)}")

        records.append({"Model": BASELINE, "Sezon": label, "MAE goli": np.nan, **outcome_metrics(np.tile(base_rates(train), (len(test), 1)), outcomes)})
        for name, diff_features in FEATURE_SETS.items():
            model = forecast.train_poisson_model(forecast.make_poisson_rows(train, diff_features), diff_features)
            test_rows = forecast.make_poisson_rows(test, diff_features)
            lambdas = np.clip(model.predict(test_rows[model.feature_names_in_]), 0.05, 5.0)
            lambda_home, lambda_away = lambdas[:len(test)], lambdas[len(test):]
            probs = outcome_probabilities(lambda_home, lambda_away)
            goal_errors = np.concatenate([test["FTHG"] - lambda_home, test["FTAG"] - lambda_away])
            records.append({"Model": name, "Sezon": label, "MAE goli": float(np.mean(np.abs(goal_errors))), **outcome_metrics(probs, outcomes)})
            if name == USED_MODEL:
                calibration.append(pd.DataFrame({"home": probs[:, 0], "draw": probs[:, 1], "outcome": outcomes}))

    results = pd.DataFrame(records)
    order = [BASELINE] + list(FEATURE_SETS)
    print()
    print("Jak czytac:")
    print("  Trafnosc %  jak czesto najbardziej prawdopodobny wynik (1, X albo 2) faktycznie padl")
    print("  Log loss    kara za pewnosc przy pomylkach, nizej = lepiej (losowe 1/3 na wszystko daje 1.099)")
    print("  Brier       blad kwadratowy prawdopodobienstw, nizej = lepiej (losowe 1/3 daje 0.667)")
    print("  MAE goli    o ile goli srednio myli sie przewidywana lambda")
    print(f"  '{BASELINE}' to brak modelu: zawsze te same szanse 1/X/2 co w poprzednich sezonach")
    print()
    print("Srednio we wszystkich testowanych sezonach:")
    summary = results.groupby("Model").mean(numeric_only=True).reindex(order)
    print(summary.round(3).to_string())
    print()
    print("Log loss sezon po sezonie:")
    print(results.pivot(index="Sezon", columns="Model", values="Log loss")[order].round(3).to_string())

    calibration = pd.concat(calibration, ignore_index=True)
    print()
    print("Kalibracja (model ze strony): czy '60%' naprawde wychodzi w ~60% przypadkow?")
    for column, outcome, title, bins in [
        ("home", 0, "wygrana gospodarzy", [0, 0.2, 0.35, 0.5, 0.65, 0.8, 1]),
        ("draw", 1, "remis", [0, 0.2, 0.24, 0.28, 1]),
    ]:
        grouped = calibration.groupby(pd.cut(calibration[column], bins), observed=True)
        table = pd.DataFrame({
            "Mecze": grouped.size(),
            "Model mowil %": grouped[column].mean() * 100,
            "Naprawde %": grouped["outcome"].apply(lambda values: np.mean(values == outcome) * 100),
        })
        table.index = [f"{interval.left:.0%}-{interval.right:.0%}" for interval in table.index]
        print(f"  {title}:")
        print("    " + table.round(1).to_string().replace("\n", "\n    "))


def forecast_args(simulations: int, fixtures: Path = forecast.DEFAULT_FIXTURE_PATH) -> argparse.Namespace:
    return argparse.Namespace(
        history=forecast.DEFAULT_HISTORY_PATH,
        fixtures=fixtures,
        squad_values=DEFAULT_SQUAD_VALUES_PATH,
        simulations=simulations,
        sample_tables=0,
        seed=42,
        round_size=forecast.ROUND_SIZE,
    )


def check_current_season(history: pd.DataFrame) -> None:
    header("4. OBECNY SEZON: prognozy z zakladki 'Wyniki' kontra to, co padlo")
    results = forecast.build_payload(forecast_args(simulations=1000))["results"]
    if not results:
        print("Zaden mecz sezonu nie ma jeszcze wyniku.")
        return

    frame = pd.DataFrame(results)
    probs = frame[["homeWin", "draw", "awayWin"]].to_numpy() / 100
    outcomes = frame["outcome"].map({"home": 0, "draw": 1, "away": 2}).to_numpy()
    print("Kazda kolejka jest prognozowana tylko z wynikow sprzed niej, tak jak na stronie.")
    print()
    model_metrics = outcome_metrics(probs, outcomes)
    baseline_metrics = outcome_metrics(np.tile(base_rates(history), (len(frame), 1)), outcomes)
    print(f"Mecze: {len(frame)}")
    print(f"  model:               trafnosc {model_metrics['Trafnosc %']:.1f}%, log loss {model_metrics['Log loss']:.3f}, Brier {model_metrics['Brier']:.3f}")
    print(f"  {BASELINE}: trafnosc {baseline_metrics['Trafnosc %']:.1f}%, log loss {baseline_metrics['Log loss']:.3f}, Brier {baseline_metrics['Brier']:.3f}")

    frame["trafiony"] = probs.argmax(axis=1) == outcomes
    frame["szansa wyniku %"] = probs[np.arange(len(frame)), outcomes] * 100
    by_round = frame.groupby("round").agg(Mecze=("trafiony", "size"), Trafione=("trafiony", "sum"))
    by_round["Log loss"] = frame.groupby("round")["szansa wyniku %"].apply(lambda values: -np.mean(np.log(np.clip(values / 100, 1e-12, 1))))
    print()
    print("Kolejka po kolejce:")
    print(by_round.rename_axis("Kolejka").round(3).to_string())

    frame["Mecz"] = frame["homeTeam"] + " - " + frame["awayTeam"]
    frame["Wynik"] = frame["homeGoals"].astype(str) + "-" + frame["awayGoals"].astype(str)
    print()
    print("Najwieksze niespodzianki (najmniejsza szansa na to, co padlo):")
    surprises = frame.nsmallest(5, "szansa wyniku %")[["round", "Mecz", "Wynik", "szansa wyniku %"]]
    print(surprises.rename(columns={"round": "Kolejka"}).round(1).to_string(index=False))


def backtest_table(history: pd.DataFrame, simulations: int) -> None:
    header("5. BACKTEST TABELI: prognoza sprzed startu sezonu kontra koncowa tabela")
    print("Dla kazdego sezonu model zna tylko poprzednie sezony i symuluje caly sezon od zera,")
    print("czyli to, co strona pokazalaby w sierpniu. W trakcie sezonu strona ma wiecej danych, wiec jest lepiej.")
    print()
    seasons = sorted(history["SeasonFile"].unique())
    records, last_details = [], None
    for test_season in seasons[MIN_TRAIN_SEASONS:]:
        played = normalize_names(pd.read_csv(SEASONS_DIR / test_season)[["HomeTeam", "AwayTeam", "FTHG", "FTAG"]])
        fixtures = played.assign(FTHG=np.nan, FTAG=np.nan)
        payload = forecast.build_payload(forecast_args(simulations, Path(test_season)), fixtures, history[history["SeasonFile"] < test_season])
        predicted = pd.DataFrame(payload["teams"]).set_index("teamKey")
        actual = pd.DataFrame(forecast.build_standings(sorted(predicted.index), played)).set_index("teamKey")
        details = predicted[["team", "rank", "xPts", "title", "top4", "relegation"]].join(actual[["rank", "pts"]], rsuffix="Actual")
        champion = details.loc[details["rankActual"] == 1].iloc[0]
        records.append({
            "Sezon": season_label(test_season),
            "Blad pkt": (details["xPts"] - details["pts"]).abs().mean(),
            "Zgodnosc kolejnosci": spearmanr(details["rank"], details["rankActual"]).statistic,
            "Mistrz": champion["team"],
            "Mistrz: miejsce w prognozie": int(champion["rank"]),
            "Mistrz: szansa %": champion["title"],
            "Top 4 trafione": int(((details["rank"] <= 4) & (details["rankActual"] <= 4)).sum()),
            "Spadki trafione": int(((details["rank"] >= 18) & (details["rankActual"] >= 18)).sum()),
        })
        last_details = details
        print(f"  sezon {season_label(test_season)} policzony")

    results = pd.DataFrame(records)
    print()
    print("Jak czytac:")
    print("  Blad pkt             o ile punktow srednio rozjechaly sie xPts z prawdziwymi punktami")
    print("  Zgodnosc kolejnosci  1 = idealna kolejnosc, 0 = jak losowa (korelacja Spearmana)")
    print("  Top 4 / Spadki       ile z 4 (albo 3) prawdziwych druzyn model mial w tej strefie")
    print()
    print(results.round(2).to_string(index=False))
    print()
    print(f"Srednio: blad {results['Blad pkt'].mean():.1f} pkt, zgodnosc kolejnosci {results['Zgodnosc kolejnosci'].mean():.2f}, "
          f"top 4 {results['Top 4 trafione'].mean():.1f}/4, spadki {results['Spadki trafione'].mean():.1f}/3.")

    print()
    print(f"Szczegoly ostatniego sezonu ({records[-1]['Sezon']}):")
    table = last_details.sort_values("rankActual")[["team", "rankActual", "pts", "rank", "xPts", "title", "top4", "relegation"]]
    table.columns = ["Druzyna", "Miejsce", "Pkt", "Miejsce w prognozie", "xPts", "Tytul %", "Top 4 %", "Spadek %"]
    print(table.to_string(index=False))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Show how the forecast model is trained and how well it predicted past seasons.")
    parser.add_argument("--sections", nargs="+", choices=SECTIONS, default=SECTIONS)
    parser.add_argument("--table-simulations", type=int, default=2000, help="Simulations per season in the table backtest.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    pd.set_option("display.width", 200)
    history = forecast.load_history(forecast.DEFAULT_HISTORY_PATH)
    if "dane" in args.sections:
        show_data(history)
    if "trening" in args.sections:
        show_training(history)
    if "backtest" in args.sections:
        backtest_matches(history)
    if "sezon" in args.sections:
        check_current_season(history)
    if "tabela" in args.sections:
        backtest_table(history, args.table_simulations)


if __name__ == "__main__":
    main()
