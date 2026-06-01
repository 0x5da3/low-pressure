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

// 12時間後までの時別予報（気象庁MSM/GSMモデルをOpen-Meteo経由で取得）
const TOKYO_LAT = 35.6895;
const TOKYO_LON = 139.6917;
const HOURLY_URL =
  `https://api.open-meteo.com/v1/jma?latitude=${TOKYO_LAT}&longitude=${TOKYO_LON}` +
  `&hourly=temperature_2m,weather_code,pressure_msl&timezone=Asia%2FTokyo` +
  `&timeformat=unixtime&past_days=1&forecast_days=2`;
const FORECAST_HOURS = 12; // 何時間後まで表示するか
const PAST_HOURS = 6;      // 何時間前から表示するか

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

// WMO天気コード → 絵文字・文章（Open-Meteoの天気コード体系）
function wmoWeather(code) {
  const m = {
    0: ["☀️", "快晴"], 1: ["🌤️", "晴れ"], 2: ["⛅", "薄曇り"], 3: ["☁️", "曇り"],
    45: ["🌫️", "霧"], 48: ["🌫️", "霧"],
    51: ["🌦️", "霧雨"], 53: ["🌦️", "霧雨"], 55: ["🌧️", "霧雨"],
    56: ["🌧️", "凍える霧雨"], 57: ["🌧️", "凍える霧雨"],
    61: ["🌧️", "弱い雨"], 63: ["🌧️", "雨"], 65: ["🌧️", "強い雨"],
    66: ["🌧️", "凍雨"], 67: ["🌧️", "凍雨"],
    71: ["🌨️", "弱い雪"], 73: ["🌨️", "雪"], 75: ["❄️", "強い雪"], 77: ["🌨️", "霧雪"],
    80: ["🌦️", "にわか雨"], 81: ["🌧️", "にわか雨"], 82: ["⛈️", "激しいにわか雨"],
    85: ["🌨️", "にわか雪"], 86: ["❄️", "強いにわか雪"],
    95: ["⛈️", "雷雨"], 96: ["⛈️", "雹を伴う雷雨"], 99: ["⛈️", "激しい雷雨"],
  };
  return m[code] || ["•", "—"];
}

// 気象庁の天気コード → 絵文字（アイコン画像が読めない場合のフォールバック）
// 先頭桁: 1=晴 2=曇 3=雨 4=雪（300台でも雪/雷を含む細分は概略で表現）
function jmaEmoji(code) {
  const c = String(code || "");
  if (!c) return "🌡️";
  const specifics = {
    "100": "☀️", "101": "🌤️", "110": "🌤️", "111": "🌤️", "112": "🌦️", "115": "🌦️",
    "200": "☁️", "201": "⛅", "202": "🌧️", "210": "⛅", "211": "🌤️", "212": "🌧️",
    "300": "🌧️", "301": "🌦️", "302": "🌧️", "303": "🌨️", "308": "🌧️",
    "311": "🌦️", "313": "🌧️", "314": "🌨️", "400": "❄️", "401": "🌨️",
    "402": "❄️", "403": "🌨️", "406": "❄️", "411": "🌨️", "413": "🌨️",
  };
  if (specifics[c]) return specifics[c];
  switch (c[0]) {
    case "1": return "☀️";
    case "2": return "☁️";
    case "3": return "🌧️";
    case "4": return "❄️";
    default: return "🌡️";
  }
}

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

// --- 時別予報（12時間後まで）の取得 -----------------------------------
async function fetchHourly() {
  const data = await fetchJSON(HOURLY_URL);
  const h = data.hourly;
  const offset = data.utc_offset_seconds || 0;
  const times = h.time; // unix秒(UTC)
  const nowSec = Math.floor(Date.now() / 1000);

  // 現在時刻を含むスロット（その時間の正時 <= 現在 < 次の正時）を特定
  let cur = times.findIndex((t) => t > nowSec) - 1;
  if (cur < 0) cur = times.findIndex((t) => t >= nowSec);
  if (cur < 0) cur = times.length - 1;

  const start = Math.max(0, cur - PAST_HOURS);
  const end = Math.min(cur + FORECAST_HOURS + 1, times.length);

  const points = [];
  for (let i = start; i < end; i++) {
    const localHour = new Date((times[i] + offset) * 1000).getUTCHours();
    points.push({
      hour: localHour,
      temp: h.temperature_2m ? h.temperature_2m[i] : null,
      pressure: h.pressure_msl ? Math.round(h.pressure_msl[i]) : null,
      code: h.weather_code ? h.weather_code[i] : null,
      isPast: i < cur,
      isNow: i === cur,
    });
  }
  return { points, nowIndex: cur - start };
}

// --- 折れ線グラフ（インラインSVG） -------------------------------------
function lineChart(points, accessor, { color, fill, unit, decimals = 0, nowIndex = -1 }) {
  const vals = points.map(accessor).filter((v) => v != null);
  if (!vals.length) return "";
  const W = 720, H = 200, padL = 34, padR = 18, padT = 30, padB = 26;
  const n = points.length;
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const yMin = min - range * 0.18, yMax = max + range * 0.18;
  const x = (i) => padL + (W - padL - padR) * (n === 1 ? 0.5 : i / (n - 1));
  const y = (v) => padT + (H - padT - padB) * (1 - (v - yMin) / (yMax - yMin));
  const toStr = (arr) => arr.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  const pts = points.map((p, i) => [i, accessor(p)]).filter(([, v]) => v != null);
  const pastPts = nowIndex >= 0 ? pts.filter(([i]) => i <= nowIndex) : [];
  const futPts = nowIndex >= 0 ? pts.filter(([i]) => i >= nowIndex) : pts;

  const areaPts = `${x(pts[0][0]).toFixed(1)},${(H - padB).toFixed(1)} ${toStr(pts)} ${x(pts[pts.length - 1][0]).toFixed(1)},${(H - padB).toFixed(1)}`;

  // 現在より前の領域を薄く塗って区別
  const nowX = nowIndex >= 0 ? x(nowIndex) : null;
  const pastShade = nowX != null
    ? `<rect x="${padL}" y="${padT}" width="${(nowX - padL).toFixed(1)}" height="${(H - padT - padB).toFixed(1)}" fill="rgba(20,40,80,0.06)"/>`
    : "";

  const dots = pts
    .map(([i, v]) => {
      const isNow = i === nowIndex;
      const showLabel = isNow || i % 2 === 0 || v === min || v === max;
      const label = showLabel
        ? `<text x="${x(i).toFixed(1)}" y="${(y(v) - 10).toFixed(1)}" class="cval ${isNow ? "cval-now" : ""}" text-anchor="middle">${v.toFixed(decimals)}</text>`
        : "";
      const dot = isNow
        ? `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="6" fill="#fff" stroke="${color}" stroke-width="3"/>`
        : `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" fill="${color}" ${i < nowIndex ? 'opacity="0.55"' : ""}/>`;
      return dot + label;
    })
    .join("");

  const xlabels = points
    .map((p, i) =>
      i % 2 === 0 || i === nowIndex
        ? `<text x="${x(i).toFixed(1)}" y="${(H - 8).toFixed(1)}" class="cx ${i === nowIndex ? "cx-now" : ""}" text-anchor="middle">${p.hour}時</text>`
        : ""
    )
    .join("");

  // 現在時刻の縦線＋ラベル
  const nowMarker = nowX != null
    ? `<line x1="${nowX.toFixed(1)}" y1="${padT - 8}" x2="${nowX.toFixed(1)}" y2="${H - padB}" class="nowline"/>
       <text x="${nowX.toFixed(1)}" y="${padT - 13}" class="nowlabel" text-anchor="middle">現在</text>`
    : "";

  const pastLine = pastPts.length > 1
    ? `<polyline points="${toStr(pastPts)}" fill="none" stroke="${color}" stroke-width="2.5" stroke-dasharray="2 5" stroke-opacity="0.55" stroke-linecap="round"/>`
    : "";
  const futLine = `<polyline points="${toStr(futPts)}" fill="none" stroke="${color}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>`;

  return `
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="g_${unit}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${fill}" stop-opacity="0.4"/>
          <stop offset="100%" stop-color="${fill}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${pastShade}
      <polygon points="${areaPts}" fill="url(#g_${unit})"/>
      ${pastLine}
      ${futLine}
      ${nowMarker}
      ${dots}
      ${xlabels}
    </svg>`;
}

// 天気の時間帯ストリップ
function weatherStrip(points, nowIndex) {
  const cells = points
    .map((p, i) => {
      // 「現在」を必ず含むよう、現在を基準に2時間ごとに表示
      if (nowIndex >= 0 && Math.abs(i - nowIndex) % 2 !== 0) return "";
      if (nowIndex < 0 && i % 2 !== 0) return "";
      const [emoji, text] = wmoWeather(p.code);
      const cls = p.isNow ? "wstrip-cell now" : (p.isPast ? "wstrip-cell past" : "wstrip-cell");
      const badge = p.isNow ? `<div class="wnow">現在</div>` : "";
      return `<div class="${cls}">
          ${badge}
          <div class="we">${emoji}</div>
          <div class="wt">${escapeHtml(text)}</div>
          <div class="wh">${p.hour}時</div>
        </div>`;
    })
    .join("");
  return `<div class="wstrip">${cells}</div>`;
}

function renderCharts(data) {
  const el = document.getElementById("charts");
  if (!el) return;
  if (!data || !data.points || !data.points.length) {
    el.innerHTML = "";
    return;
  }
  const { points, nowIndex } = data;
  el.innerHTML = `
    <h2 class="section-title">時別予報（過去${PAST_HOURS}時間〜${FORECAST_HOURS}時間後）</h2>
    <p class="section-note">点線=過去 / 実線=予報　・　出典: 気象庁 数値予報モデル（MSM/GSM）・Open-Meteo 経由</p>

    <div class="chart-card">
      <div class="chart-head"><span class="chip weather">天気</span></div>
      ${weatherStrip(points, nowIndex)}
    </div>

    <div class="chart-card">
      <div class="chart-head"><span class="chip temp">気温の変化</span><span class="chart-unit">°C</span></div>
      ${lineChart(points, (p) => p.temp, { color: "#ff6b6b", fill: "#ff6b6b", unit: "temp", decimals: 1, nowIndex })}
    </div>

    <div class="chart-card">
      <div class="chart-head"><span class="chip pressure">気圧の変化</span><span class="chart-unit">hPa</span></div>
      ${lineChart(points, (p) => p.pressure, { color: "#2a7fd4", fill: "#2a7fd4", unit: "pres", decimals: 0, nowIndex })}
    </div>`;
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
    <div id="charts" class="charts"></div>

    <h2 class="section-title">現在の天気・実況</h2>
    <div class="hero">
      <div class="date">${formatDate(today)}</div>
      <div class="icon" id="hero-icon"><span class="emoji-icon" role="img" aria-label="${escapeHtml(forecast.weatherText)}">${jmaEmoji(iconCode)}</span></div>
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

  // 気象庁のSVGアイコンが読み込めた場合のみ、絵文字から差し替える（読めなければ絵文字のまま）
  if (iconUrl) {
    const probe = new Image();
    probe.onload = () => {
      const box = document.getElementById("hero-icon");
      if (box) box.innerHTML = `<img src="${iconUrl}" alt="${escapeHtml(forecast.weatherText)}">`;
    };
    probe.src = iconUrl;
  }
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
    const [forecastData, amedas, hourly] = await Promise.all([
      fetchJSON(FORECAST_URL),
      fetchAmedas().catch(() => ({ time: null, temp: null, pressure: null, normalPressure: null, humidity: null })),
      fetchHourly().catch((e) => { console.warn("hourly forecast unavailable:", e); return null; }),
    ]);
    render(parseForecast(forecastData), amedas);
    renderCharts(hourly);
  } catch (err) {
    console.error(err);
    renderError(err);
  }
}

document.getElementById("reload").addEventListener("click", load);

// 更新履歴の展開/折りたたみ
const historyToggle = document.getElementById("history-toggle");
const historyList = document.getElementById("history-list");
historyToggle.addEventListener("click", () => {
  const expanded = historyToggle.getAttribute("aria-expanded") === "true";
  historyToggle.setAttribute("aria-expanded", String(!expanded));
  historyList.hidden = expanded;
});
load();
