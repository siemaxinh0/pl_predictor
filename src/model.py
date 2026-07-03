import pandas as pd
import numpy as np
from sklearn.linear_model import LogisticRegression
import warnings

warnings.filterwarnings('ignore')

# import terminarza PL z sezonu 25/26 i wynikow zeby sprawdzac skutecznosc modelu
url = "data/raw/PL-25-26.csv"
df = pd.read_csv(url)

# dane o ELO druzyn przed sezonem zhardcode'owane zeby bylo szybciej
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

current_elo = dict(zip(elo_df_home['TeamName'], elo_df_home['HomeElo']))

def get_expected_score(elo_a, elo_b):
    return 1 / (1 + 10 ** ((elo_b - elo_a) / 400))

K = 20

# listy do przechowywania calego ciagu elo dla kazdego meczu dla goscia i gospodarza
dynamic_home_elo = []
dynamic_away_elo = []

for index, row in df.iterrows():
    home_team = row['HomeTeam']
    away_team = row['AwayTeam']

    home_elo_before = current_elo.get(home_team, 1500)
    away_elo_before = current_elo.get(away_team, 1500)

    dynamic_home_elo.append(home_elo_before)
    dynamic_away_elo.append(away_elo_before)

    if row['FTHG'] > row['FTAG']:
        score_home, score_away = 1, 0
    elif row['FTHG'] == row['FTAG']:
        score_home, score_away = 0.5, 0.5
    else:
        score_home, score_away = 0, 1

    expected_home = get_expected_score(home_elo_before, away_elo_before)
    expected_away = get_expected_score(away_elo_before, home_elo_before)

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
df['HomeTeam_Form'] = df.groupby('HomeTeam')['HomePoints'].transform(lambda x: x.rolling(5).mean().shift(1))
df['AwayTeam_Form'] = df.groupby('AwayTeam')['AwayPoints'].transform(lambda x: x.rolling(5).mean().shift(1))

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

model = LogisticRegression(max_iter=1000)
model.fit(X_train, y_train)

efectiveness = model.score(X_test, y_test)
print(f"Skutecznosc modelu: {efectiveness * 100:.2f}%")

probs = model.predict_proba(X)

simulated_targets = []

np.random.seed(42)
for p in probs:
    match_result = np.random.choice(model.classes_, p=p)
    simulated_targets.append(match_result)

df_clean['Predicted_Target'] = simulated_targets

# przewidywana tabela czyli suma punktow druzyny ze wszystkich meczow
cond_home = [df_clean['Predicted_Target'] == 1, df_clean['Predicted_Target'] == 0]
df_clean['Pred_Home_Pts'] = np.select(cond_home, [3, 1], default = 0)

cond_away = [df_clean['Predicted_Target'] == 2, df_clean['Predicted_Target'] == 0]
df_clean['Pred_Away_Pts'] = np.select(cond_away, [3, 1], default=0)

home_table = df_clean.groupby('HomeTeam')['Pred_Home_Pts'].sum()
away_table = df_clean.groupby('AwayTeam')['Pred_Away_Pts'].sum()

final_table = home_table.add(away_table, fill_value = 0).sort_values(ascending=False)

print("\n Przewidywana tabela Premier League - sezon 2025/2026")
print(final_table)
