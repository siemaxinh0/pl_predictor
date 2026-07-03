import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier

url = "data/raw/PL-25-26.csv"
df = pd.read_csv(url)

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

elo_df_home = pd.DataFrame(elo_data)
elo_df_away = elo_df_home.rename(columns={'HomeElo': 'AwayElo'})

df = pd.merge(df, elo_df_home, left_on='HomeTeam', right_on='TeamName', how='left')
df = df.drop(columns=['TeamName'])
df = pd.merge(df, elo_df_away, left_on='AwayTeam', right_on='TeamName', how='left')
df = df.drop(columns=['TeamName'])
df['EloDifference'] = df['HomeElo'] - df['AwayElo']

df['HomePoints'] = np.select([df['FTHG'] > df['FTAG'], df['FTHG'] == df['FTAG']], [3, 1], default=0)
df['AwayPoints'] = np.select([df['FTAG'] > df['FTHG'], df['FTAG'] == df['FTHG']], [3, 1], default=0)

df['HomeTeam_Form'] = df.groupby('HomeTeam')['HomePoints'].transform(lambda x: x.rolling(5).mean().shift(1))
df['AwayTeam_Form'] = df.groupby('AwayTeam')['AwayPoints'].transform(lambda x: x.rolling(5).mean().shift(1))

target_cond = [df['FTHG'] > df['FTAG'], df['FTHG'] == df['FTAG'], df['FTHG'] < df['FTAG']]
df['Target'] = np.select(target_cond, [1, 0, 2], default=np.nan)

df_clean = df.dropna(subset=['EloDifference', 'HomeTeam_Form', 'AwayTeam_Form', 'Target'])

traits = ['EloDifference', 'HomeTeam_Form', 'AwayTeam_Form']
X = df_clean[traits]
y = df_clean['Target'].astype(int)

split_point = int(len(df_clean) * 0.8)

X_train, X_test = X.iloc[:split_point], X.iloc[split_point:]
y_train, y_test = y.iloc[:split_point], y.iloc[split_point:]

model = RandomForestClassifier(n_estimators=100, random_state=67)
model.fit(X_train, y_train)

efectiveness = model.score(X_test, y_test)
print(f"Skutecznosc modelu: {efectiveness * 100:.2f}%")

df_clean['Predicted_Target'] = model.predict(X)
cond_home = [df_clean['Predicted_Target'] == 1, df_clean['Predicted_Target'] == 0]
df_clean['Pred_Home_Pts'] = np.select(cond_home, [3, 1], default = 0)

cond_away = [df_clean['Predicted_Target'] == 2, df_clean['Predicted_Target'] == 0]
df_clean['Pred_Away_Pts'] = np.select(cond_away, [3, 1], default=0)

home_table = df_clean.groupby('HomeTeam')['Pred_Home_Pts'].sum()
away_table = df_clean.groupby('AwayTeam')['Pred_Away_Pts'].sum()

final_table = home_table.add(away_table, fill_value = 0).sort_values(ascending=False)

print("\n przewidywana tabela premier league")
print(final_table)
