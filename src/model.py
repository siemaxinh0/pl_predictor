import pandas as pd
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
import warnings

warnings.filterwarnings('ignore')

# import terminarza PL z sezonu 25/26 i wynikow zeby sprawdzac skutecznosc modelu
url = "data/raw/PL-25-26.csv"
df = pd.read_csv(url)

# dane o ELO druzyn przed sezonem 25/26 zhardcode'owane zeby bylo szybciej
# (wziete z elofootball.com)
elo_data = {
    'TeamName': [
        'Liverpool', 'Arsenal', 'Man City', 'Chelsea', 
        'Aston Villa', 'Newcastle', 'Crystal Palace', 'Brighton',
        'Man United', 'Bournemouth', 'Brentford', 'Tottenham', 
        "Nott'm Forest", 'Everton', 'Fulham', 'Wolves', 
        'West Ham', 'Burnley', 'Leeds', 'Sunderland'
    ],
    'HomeElo': [
        2273, 2270, 2243, 2184, 2167, 2154, 2147, 2112, 
        2075, 2054, 2038, 2037, 2033, 2027, 2011, 1987, 
        1983, 1952, 1935, 1735
    ]
}

# ELO gospodarza i goscia 
elo_df_home = pd.DataFrame(elo_data)
elo_df_away = elo_df_home.rename(columns={'HomeElo': 'AwayElo'})

# konwersja danych o ELO na slownik druzyna: ELO
current_elo = dict(zip(elo_df_home['TeamName'], elo_df_home['HomeElo']))

# wzor oparty na ELO na szanse na wygrana druzyny A
def get_expected_score(elo_a, elo_b):
    return 1 / (1 + 10 ** ((elo_b - elo_a) / 400))

# maksymalna liczba ELO ktore druzyna moze zyskac lub stracic w jednym meczu
K = 20

# listy do przechowywania calego ciagu ELO dla kazdego meczu dla goscia i gospodarza
dynamic_home_elo = []
dynamic_away_elo = []

for index, row in df.iterrows():
    home_team = row['HomeTeam']
    away_team = row['AwayTeam']

    # ELO przed meczem brane ze slownika current_elo
    home_elo_before = current_elo.get(home_team, 1500)
    away_elo_before = current_elo.get(away_team, 1500)

    # dodanie ELO przedmeczowego do listy 
    dynamic_home_elo.append(home_elo_before)
    dynamic_away_elo.append(away_elo_before)

    # wynik meczu w zaleznosci od goli
    if row['FTHG'] > row['FTAG']:
        score_home, score_away = 1, 0
    elif row['FTHG'] == row['FTAG']:
        score_home, score_away = 0.5, 0.5
    else:
        score_home, score_away = 0, 1

    # policzenie szans na wygrana druzyn ze wzoru
    expected_home = get_expected_score(home_elo_before, away_elo_before)
    expected_away = get_expected_score(away_elo_before, home_elo_before)

    # dodanie i odjecie ELO druzynom za mecz i zapisanie w slowniku
    current_elo[home_team] = home_elo_before + K * (score_home - expected_home)
    current_elo[away_team] = away_elo_before + K * (score_away - expected_away)

# zapisanie w tabeli zmieniajacego sie ELO
df['HomeElo'] = dynamic_home_elo
df['AwayElo'] = dynamic_away_elo
df['EloDifference'] = df['HomeElo'] - df['AwayElo']

# reguly dla punktow po meczu (bez petli tylko numpy)
df['HomePoints'] = np.select([df['FTHG'] > df['FTAG'], df['FTHG'] == df['FTAG']], [3, 1], default=0)
df['AwayPoints'] = np.select([df['FTAG'] > df['FTHG'], df['FTAG'] == df['FTHG']], [3, 1], default=0)

# forma czyli srednia kroczaca punktow z ostatnich 5 meczow
df['HomeTeam_Form'] = df.groupby('HomeTeam')['HomePoints'].transform(lambda x: x.rolling(5, min_periods = 1).mean().shift(1).fillna(1.0))
df['AwayTeam_Form'] = df.groupby('AwayTeam')['AwayPoints'].transform(lambda x: x.rolling(5, min_periods = 1).mean().shift(1).fillna(1.0))

# target czyli 1/0/2 gdzie 1 - wygrana gospodarzy, 0 - remis, 2 - wygrana gosci
target_cond = [df['FTHG'] > df['FTAG'], df['FTHG'] == df['FTAG'], df['FTHG'] < df['FTAG']]
df['Target'] = np.select(target_cond, [1, 0, 2], default=np.nan)

# oczyszczenie tabeli z NaN bo to float i lubi wywalac bledy
df_clean = df.dropna(subset=['EloDifference', 'HomeTeam_Form', 'AwayTeam_Form', 'Target'])

# cechy na ktore model patrzy przewidujac - roznica elo i forma druzyn
traits = ['EloDifference', 'HomeTeam_Form', 'AwayTeam_Form']
X = df_clean[traits]
y = df_clean['Target'].astype(int)

# 80% danych to zbior treningowy, pozostale 20 to zbior testowy
split_point = int(len(df_clean) * 0.8)
X_train, X_test = X.iloc[:split_point], X.iloc[split_point:]
y_train, y_test = y.iloc[:split_point], y.iloc[split_point:]

scaler = StandardScaler()

X_train_scaled = scaler.fit_transform(X_train)

X_test_scaled = scaler.transform(X_test)
X_scaled = scaler.transform(X)

model = LogisticRegression(max_iter=1000)
model.fit(X_train_scaled, y_train)

efectiveness = model.score(X_test_scaled, y_test)
print(f"Skutecznosc modelu: {efectiveness * 100:.2f}%")

N_SIMULATIONS = 1000
SHARPNESS = 1.8

# liczenie punktow probabilistycznie
probs = model.predict_proba(X_scaled)

teams = df_clean['HomeTeam'].unique()

positions_count = {team: np.zeros(20) for team in teams}

total_simulated_pts = {team: 0 for team in teams}

sharp_probs_list = []

for p in probs:
    sharp_p = p ** SHARPNESS
    sharp_p = sharp_p / np.sum(sharp_p)
    sharp_probs_list.append(sharp_p)

for _ in range(N_SIMULATIONS):
    simulated_pts = {team: 0 for team in teams}

    for i, sharp_p in enumerate(sharp_probs_list):
        home = df_clean.iloc[i]['HomeTeam']
        away = df_clean.iloc[i]['AwayTeam']

        match_result = np.random.choice([0,1,2], p=sharp_p)

        if match_result == 1:
            simulated_pts[home] += 3
        elif match_result == 2:
            simulated_pts[away] += 3
        else:
            simulated_pts[home] += 1
            simulated_pts[away] += 1

    for team in teams:
        total_simulated_pts[team] += simulated_pts[team]

    sorted_teams = sorted(simulated_pts.keys(), key=lambda t: simulated_pts[t], reverse=True)

    for rank, team in enumerate(sorted_teams):
        positions_count[team][rank] += 1

    
results = []
for team in teams:
    chances = positions_count[team] / N_SIMULATIONS
    champ = chances[0] * 100
    top4 = np.sum(chances[0:4]) * 100
    relegation = np.sum(chances[17:20]) * 100

    expected_pts = total_simulated_pts[team] / N_SIMULATIONS

    results.append({
        'Drużyna': team,
        'Mistrzostwo (%)': round(champ, 1),
        'Top 4 (%)': round(top4, 1),
        'Spadek (%)': round(relegation, 1),
        'xPts': round(expected_pts, 1)
    })

final_mc_table = pd.DataFrame(results).sort_values(by=['xPts', 'Mistrzostwo (%)'], ascending = False)
final_mc_table = final_mc_table.reset_index(drop=True)
final_mc_table.index += 1


print("Wyniki:")
print(final_mc_table.to_string())