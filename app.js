/*
 * 東京の天気アプリ
 * 気象庁(JMA)の公開JSONデータを利用して、東京の
 *   - 天気 / 気温 / 降水確率   … 予報データ
 *   - 気温 / 気圧（現在の実況） … アメダス実況データ
 * を取得して表示する。
 *
 * 気象庁 bosai エンドポイントは CORS 許可済みのため、ブラウザから直接取得できる。
 */

// --- 定数 -------------------------------------------------------------
const FORECAST_URL = "https://www.jma.go.jp/bosai/forecast/data/forecast/130000.json"; // 東京都
const AMEDAS_LATEST_URL = "https://www.jma.go.jp/bosai/amedas/data/latest_time.txt";
const AMEDAS_MAP_BASE = "https://www.jma.go.jp/bosai/amedas/data/map/";
const ICON_BASE = "https://www.jma.go.jp/bosai/forecast/img/";

const TOKYO_AREA_CODE = "130010"; // 東京地方
const TOKYO_AMEDAS = "44132";     // 東京（アメダス観測所コード）

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

// --- ユーティリティ ----------------------------------------------------
async function fetchJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} の取得に失敗しました (HTTP ${res.status})`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} の取得に失敗しました (HTTP ${res.status})`);
  return res.text();
}

function isSameDay(isoA, dateB) {
  const a = new Date(isoA);
  return (
    a.getFullYear() === dateB.getFullYear() &&
    a.getMonth() === dateB.getMonth() &&
    a.getDate() === dateB.getDate()
  );
}

function formatDate(d) {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// --- 予報データの解析 --------------------------------------------------
function parseForecast(data) {
  const today = new Date();
  const result = { weatherCode: null, weatherText: "—", area: "東京地方", pops: [], tempMax: null, tempMin: null };

  const short = data[0];
  const series = short.timeSeries;

  // [0] 天気
  const weatherTs = series[0];
  const wArea = weatherTs.areas.find((a) => a.area.code === TOKYO_AREA_CODE) || weatherTs.areas[0];
  if (wArea) {
    // 当日に該当する index を探す（無ければ先頭）
    let idx = weatherTs.timeDefines.findIndex((t) => isSameDay(t, today));
    if (idx < 0) idx = 0;
    result.area = wArea.area.name;
    result.weatherCode = wArea.weatherCodes ? wArea.weatherCodes[idx] : null;
    result.weatherText = wArea.weathers ? wArea.weathers[idx].replace(/　/g, " ").trim() : "—";
  }

  // [1] 降水確率（6時間ごと）
  const popsTs = series[1];
  if (popsTs) {
    const pArea = popsTs.areas.find((a) => a.area.code === TOKYO_AREA_CODE) || popsTs.areas[0];
    if (pArea && pArea.pops) {
      popsTs.timeDefines.forEach((t, i) => {
        if (isSameDay(t, today)) {
          const start = new Date(t);
          const endH = (start.getHours() + 6) % 24;
          result.pops.push({
            label: `${String(start.getHours()).padStart(2, "0")}-${String(endH).padStart(2, "0")}`,
            value: pArea.pops[i] === "" ? null : Number(pArea.pops[i]),
          });
        }
      });
    }
  }

  // [2] 気温（最低/最高）。短期予報は当日朝発表だと最低が空のことがあるため週間予報も参照
  const tempTs = series[2];
  if (tempTs) {
    const tArea = tempTs.areas.find((a) => a.area.code === TOKYO_AMEDAS) || tempTs.areas[0];
    if (tArea && tArea.temps) {
      tempTs.timeDefines.forEach((t, i) => {
        if (!isSameDay(t, today)) return;
        const val = tArea.temps[i];
        if (val === "" || val == null) return;
        const h = new Date(t).getHours();
        const num = Number(val);
        // 朝(0時前後)は最低、昼(9時前後)は最高として扱う
        if (h <= 6) result.tempMin = result.tempMin == null ? num : Math.min(result.tempMin, num);
        else result.tempMax = result.tempMax == null ? num : Math.max(result.tempMax, num);
      });
    }
  }

  // 週間予報（data[1]）から最低/最高を補完
  if (data[1] && (result.tempMax == null || result.tempMin == null)) {
    const weekly = data[1].timeSeries.find((ts) => ts.areas.some((a) => a.tempsMax));
    if (weekly) {
      const wa = weekly.areas.find((a) => a.area.code === TOKYO_AMEDAS) || weekly.areas[0];
      const idx = weekly.timeDefines.findIndex((t) => isSameDay(t, today));
      if (wa && idx >= 0) {
        if (result.tempMax == null && wa.tempsMax && wa.tempsMax[idx] !== "") result.tempMax = Number(wa.tempsMax[idx]);
        if (result.tempMin == null && wa.tempsMin && wa.tempsMin[idx] !== "") result.tempMin = Number(wa.tempsMin[idx]);
      }
    }
  }

  result.reportDatetime = short.reportDatetime;
  return result;
}

// --- アメダス実況の解析 ------------------------------------------------
async function fetchAmedas() {
  const latest = (await fetchText(AMEDAS_LATEST_URL)).trim(); // 例 2026-06-01T14:00:00+09:00
  const stamp = latest.slice(0, 19).replace(/[-:T]/g, "");    // 20260601140000
  const map = await fetchJSON(`${AMEDAS_MAP_BASE}${stamp}.json`);
  const point = map[TOKYO_AMEDAS] || {};
  const pick = (f) => (Array.isArray(point[f]) ? point[f][0] : null);
  return {
    time: latest,
    temp: pick("temp"),               // 現在気温 (°C)
    pressure: pick("pressure"),       // 海面気圧 (hPa)
    normalPressure: pick("normalPressure"), // 現地気圧 (hPa)
    humidity: pick("humidity"),       // 湿度 (%)
  };
}

// --- 描画 --------------------------------------------------------------
function render(forecast, amedas) {
  const today = new Date();
  const iconCode = forecast.weatherCode;
  const iconUrl = iconCode ? `${ICON_BASE}${iconCode}.svg` : "";

  // 気圧（海面気圧優先、無ければ現地気圧）
  const pressure = amedas.pressure != null ? amedas.pressure : amedas.normalPressure;
  const pressureLabel = amedas.pressure != null ? "海面気圧" : (amedas.normalPressure != null ? "現地気圧" : "気圧");

  // 現在気温（アメダス）、無ければ予報の最高をフォールバック表示しない
  const currentTemp = amedas.temp;

  const popsCells = forecast.pops.length
    ? forecast.pops.map((p) => `
        <div class="pop-cell ${p.value == null ? "dim" : ""}">
          <div class="pt">${p.label}時</div>
          <div class="pv">${p.value == null ? "—" : p.value + "%"}</div>
        </div>`).join("")
    : `<div class="pop-cell dim"><div class="pt">本日</div><div class="pv">—</div></div>`;

  const tempRange = (forecast.tempMax != null || forecast.tempMin != null)
    ? `<div class="temp-range">
         <span class="hi">最高 ${forecast.tempMax != null ? forecast.tempMax + "°" : "—"}</span>
         <span class="lo">最低 ${forecast.tempMin != null ? forecast.tempMin + "°" : "—"}</span>
       </div>`
    : "";

  const tempMain = currentTemp != null
    ? `<div class="value">${currentTemp}<span class="unit">°C</span></div><div class="sub">現在の気温（実況）</div>`
    : `<div class="value">${forecast.tempMax != null ? forecast.tempMax : "—"}<span class="unit">°C</span></div><div class="sub">本日の予想最高気温</div>`;

  document.getElementById("content").innerHTML = `
    <div class="hero">
      <div class="date">${formatDate(today)}</div>
      ${iconUrl ? `<div class="icon"><img src="${iconUrl}" alt="${escapeHtml(forecast.weatherText)}"></div>` : ""}
      <div class="weather-text">${escapeHtml(forecast.weatherText)}</div>
      <div class="area">${escapeHtml(forecast.area)}の天気</div>
    </div>

    <div class="metrics">
      <div class="metric temp">
        <div class="label">気温</div>
        ${tempMain}
        ${tempRange}
      </div>

      <div class="metric pressure">
        <div class="label">気圧</div>
        <div class="value">${pressure != null ? pressure : "—"}<span class="unit">hPa</span></div>
        <div class="sub">${pressureLabel}（実況）</div>
      </div>

      <div class="metric humidity">
        <div class="label">湿度</div>
        <div class="value">${amedas.humidity != null ? amedas.humidity : "—"}<span class="unit">%</span></div>
        <div class="sub">現在の湿度（実況）</div>
      </div>
    </div>

    <div class="metric pops">
      <div class="label">降水確率（本日・時間帯別）</div>
      <div class="pops-grid">${popsCells}</div>
    </div>
  `;

  // 更新時刻
  const fmt = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  document.getElementById("updated").textContent =
    `予報発表: ${fmt(forecast.reportDatetime)}　/　実況: ${fmt(amedas.time)}`;
}

function renderError(err) {
  document.getElementById("content").innerHTML = `
    <div class="error">
      <p>データを取得できませんでした。</p>
      <p class="emsg">${escapeHtml(err.message || err)}</p>
      <p class="emsg">時間をおいて再読み込みしてください。</p>
    </div>`;
}

// --- 起動 --------------------------------------------------------------
async function load() {
  document.getElementById("content").innerHTML = `
    <div class="loading">
      <div class="spinner" aria-hidden="true"></div>
      <p>気象庁からデータを取得しています…</p>
    </div>`;
  try {
    const [forecastData, amedas] = await Promise.all([
      fetchJSON(FORECAST_URL),
      fetchAmedas().catch(() => ({ time: null, temp: null, pressure: null, normalPressure: null, humidity: null })),
    ]);
    render(parseForecast(forecastData), amedas);
  } catch (err) {
    console.error(err);
    renderError(err);
  }
}

document.getElementById("reload").addEventListener("click", load);
load();
