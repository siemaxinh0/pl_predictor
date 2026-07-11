import numpy as np

match_result = np.random.choice([0,1,2], p=[0.10, 0.85, 0.05])

for i in range(100):
    match_result = np.random.choice([0,1,2], p=[0.10, 0.85, 0.05])
    print(match_result)