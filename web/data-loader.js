// strona najpierw pyta API o swieza prognoze, a gdy API nie odpowiada, bierze pliki wygenerowane przez run_forecast.py
(() => {
    const loader = document.currentScript;
    const version = new URL(loader.src, location.href).searchParams.get("v") || "dev";
    const apiBase = (loader.dataset.api || "").replace(/\/$/, "");
    const appScripts = loader.dataset.scripts.split(" ");
    const apiTimeoutMs = 5000;

    function loadScript(name) {
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = `${name}?v=${version}`;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Nie udało się wczytać ${name}`));
            document.body.append(script);
        });
    }

    async function fetchJson(path) {
        const response = await fetch(`${apiBase}/${path}`, { cache: "no-store", signal: AbortSignal.timeout(apiTimeoutMs) });
        if (!response.ok) {
            throw new Error(`${path}: ${response.status}`);
        }
        return response.json();
    }

    async function loadData() {
        if (apiBase) {
            try {
                const [data, history] = await Promise.all([fetchJson("forecast"), fetchJson("history")]);
                window.forecastData = data;
                window.forecastHistory = history;
                window.forecastSource = "api";
                window.forecastApi = apiBase;
                return;
            } catch (error) {
                console.info("API z prognozą nie odpowiada, używam zapisanych plików.", error);
            }
        }
        await loadScript("forecast-data.js");
        await loadScript("forecast-history.js");
        window.forecastSource = "static";
    }

    loadData().then(async () => {
        for (const name of appScripts) {
            await loadScript(name);
        }
    });
})();
