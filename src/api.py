from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import pandas as pd
from fastapi import FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import run_forecast as forecast
from add_result import find_fixture, parse_score
from features import DEFAULT_SQUAD_VALUES_PATH
from update_results import download_results, fill_results, results_url, round_stages

# start serwera: .\venv\Scripts\python.exe -m uvicorn api:app --app-dir src --port 8000
# strona z danymi z API: http://localhost:8000
# ustawienia przez zmienne srodowiskowe: PL_API_KEY, PL_SIMULATIONS, PL_REFRESH_COOLDOWN_MINUTES, PL_CORS_ORIGINS

API_KEY = os.environ.get("PL_API_KEY", "")
SIMULATIONS = int(os.environ.get("PL_SIMULATIONS", "100000"))
REFRESH_COOLDOWN_SECONDS = 60 * float(os.environ.get("PL_REFRESH_COOLDOWN_MINUTES", "10"))
CORS_ORIGINS = os.environ.get("PL_CORS_ORIGINS", "https://siemaxinh0.github.io").split(",")
MANUAL_RESULTS_PATH = forecast.ROOT / "data" / "api" / "manual-results.json"
WEB_PATH = forecast.ROOT / "web"

FORECAST_ARGS = argparse.Namespace(
    history=forecast.DEFAULT_HISTORY_PATH,
    fixtures=forecast.DEFAULT_FIXTURE_PATH,
    squad_values=DEFAULT_SQUAD_VALUES_PATH,
    simulations=SIMULATIONS,
    sample_tables=80,
    seed=42,
    round_size=forecast.ROUND_SIZE,
)

compute_lock = threading.Lock()
start_lock = threading.Lock()
state: dict[str, object] = {
    "lastDownload": None,
    "downloadFailed": False,
    "fixtures": None,
    "history": None,
    "forecastJson": None,
    "historyJson": None,
    "meta": None,
    "updatedAtUTC": None,
    "refreshing": False,
    "lastError": None,
    "lastAdded": [],
}


def read_fixtures() -> pd.DataFrame:
    fixtures = pd.read_csv(FORECAST_ARGS.fixtures)
    fixtures["FTHG"] = pd.to_numeric(fixtures["FTHG"], errors="coerce")
    fixtures["FTAG"] = pd.to_numeric(fixtures["FTAG"], errors="coerce")
    return fixtures


def read_manual_results() -> list[dict[str, object]]:
    if not MANUAL_RESULTS_PATH.exists():
        return []
    return json.loads(MANUAL_RESULTS_PATH.read_text(encoding="utf-8"))


def apply_manual_results(fixtures: pd.DataFrame) -> list[str]:
    applied = []
    for result in read_manual_results():
        index = int(result["fixture"]) - 1
        current = fixtures.loc[index, ["FTHG", "FTAG"]]
        score = [result["homeGoals"], result["awayGoals"]]
        if current.isna().any() or [int(value) for value in current] != score:
            fixtures.loc[index, ["FTHG", "FTAG"]] = score
            applied.append(f"{fixtures.at[index, 'HomeTeam']} - {fixtures.at[index, 'AwayTeam']} {score[0]}-{score[1]}")
    return applied


def refresh(download: bool) -> None:
    with compute_lock:
        state["refreshing"] = True
        errors = []
        try:
            before = state["fixtures"] if state["fixtures"] is not None else read_fixtures()
            fixtures = before.copy()
            added = []
            if download:
                state["lastDownload"] = time.monotonic()
                state["updatedAtUTC"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
                state["downloadFailed"] = False
                try:
                    added, conflicts = fill_results(fixtures, download_results(results_url(FORECAST_ARGS.fixtures)))
                    errors.extend(f"Inny wynik w football-data, zostaje wpisany: {conflict}" for conflict in conflicts)
                except Exception as error:
                    # bez zrodla wynikow i tak liczymy prognoze z tego, co juz mamy
                    state["downloadFailed"] = True
                    errors.append(f"football-data: {error}")
            added += apply_manual_results(fixtures)

            history = state["history"] if state["history"] is not None else forecast.read_forecast_history(forecast.DEFAULT_FORECAST_HISTORY_PATH)
            if added or state["forecastJson"] is None:
                # kazda nowo dopelniona kolejka dostaje wlasna migawke, tak jak w update_results.py
                for stage in round_stages(before, fixtures):
                    payload = forecast.build_payload(FORECAST_ARGS, stage)
                    history = forecast.add_history_snapshot(history, payload)
                state["forecastJson"] = json.dumps(payload, ensure_ascii=False)
                state["historyJson"] = json.dumps(history, ensure_ascii=False)
                state["meta"] = payload["meta"]

            state["fixtures"] = fixtures
            state["history"] = history
            state["lastAdded"] = added
        except Exception as error:
            errors.append(str(error))
            print(f"Blad przeliczania: {error}", file=sys.stderr)
        finally:
            state["lastError"] = "; ".join(errors) or None
            state["refreshing"] = False


def seconds_to_next_check() -> int:
    if state["lastDownload"] is None:
        return 0
    return max(0, round(REFRESH_COOLDOWN_SECONDS - (time.monotonic() - state["lastDownload"])))


def start_background_refresh() -> bool:
    # przycisk na stronie moze kliknac kazdy, wiec football-data pytamy najwyzej raz na kilka minut
    with start_lock:
        if state["refreshing"] or seconds_to_next_check() > 0:
            return False
        state["refreshing"] = True
        threading.Thread(target=refresh, args=(True,), daemon=True).start()
        return True


class ResultIn(BaseModel):
    home: str
    away: str
    score: str


def check_key(key: str) -> None:
    if not API_KEY:
        raise HTTPException(403, "Ustaw zmienna PL_API_KEY przed startem serwera, zeby wlaczyc ten endpoint.")
    if key != API_KEY:
        raise HTTPException(401, "Zly klucz w naglowku X-API-Key.")


def json_response(text: object) -> Response:
    if text is None:
        raise HTTPException(503, "Prognoza jeszcze sie liczy, sprobuj za chwile.")
    return Response(content=text, media_type="application/json", headers={"Cache-Control": "no-store"})


@asynccontextmanager
async def lifespan(_app: FastAPI):
    start_background_refresh()
    yield


app = FastAPI(title="Premier League Predictor API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["GET", "POST"], allow_headers=["*"])
app.add_middleware(GZipMiddleware, minimum_size=1000)


@app.get("/api/forecast")
def get_forecast() -> Response:
    return json_response(state["forecastJson"])


@app.get("/api/history")
def get_history() -> Response:
    return json_response(state["historyJson"])


@app.get("/api/status")
def get_status() -> dict[str, object]:
    meta = state["meta"] or {}
    return {
        "ready": state["forecastJson"] is not None,
        "refreshing": state["refreshing"],
        "checkedAtUTC": state["updatedAtUTC"],
        "forecastGeneratedAtUTC": meta.get("generatedAtUTC"),
        "playedMatches": meta.get("playedMatches"),
        "simulations": meta.get("simulations"),
        "nextCheckInSeconds": seconds_to_next_check(),
        "downloadFailed": state["downloadFailed"],
        "lastAdded": state["lastAdded"],
        "lastError": state["lastError"],
    }


@app.post("/api/refresh")
def post_refresh() -> dict[str, object]:
    started = start_background_refresh()
    return {**get_status(), "started": started}


@app.post("/api/results")
def post_result(result: ResultIn, x_api_key: str = Header(default="")) -> dict[str, object]:
    check_key(x_api_key)
    fixtures = read_fixtures()
    try:
        home_goals, away_goals = parse_score(result.score)
        index = find_fixture(fixtures, None, result.home, result.away)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error

    # reczne wyniki ida do pliku poza gitem, zeby przetrwaly restart serwera
    fixture = index + 1
    saved = [item for item in read_manual_results() if int(item["fixture"]) != fixture]
    saved.append({
        "fixture": fixture,
        "home": fixtures.at[index, "HomeTeam"],
        "away": fixtures.at[index, "AwayTeam"],
        "homeGoals": home_goals,
        "awayGoals": away_goals,
    })
    MANUAL_RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANUAL_RESULTS_PATH.write_text(json.dumps(saved, ensure_ascii=False, indent=4), encoding="utf-8")
    refresh(download=False)
    return get_status()


app.mount("/", StaticFiles(directory=WEB_PATH, html=True), name="web")
