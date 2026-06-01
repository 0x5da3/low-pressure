/*
 * 東京の天気アプリ
 * 気象庁(JMA)の数値予報モデル(MSM/GSM)を Open-Meteo 経由で取得し、
 * 東京の「過去6時間〜12時間後」の天気・気温・気圧の変化をグラフ表示する。
 */

// --- 定数 -------------------------------------------------------------
const TOKYO_LAT = 35.6895;
const TOKYO_LON = 139.6917;
const HOURLY_URL =
  `https://api.open-meteo.com/v1/jma?latitude=${TOKYO_LAT}&longitude=${TOKYO_LON}` +
  `&hourly=temperature_2m,weather_code,pressure_msl&timezone=Asia%2FTokyo` +
  `&timeformat=unixtime&past_days=1&forecast_days=2`;
const FORECAST_HOURS = 12; // 何時間後まで表示するか
const PAST_HOURS = 6;      // 何時間前から表示するか

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

// --- ユーティリティ ----------------------------------------------------
async function fetchJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} の取得に失敗しました (HTTP ${res.status})`);
  return res.json();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// --- 時別予報（過去6時間〜12時間後）の取得 -----------------------------
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
function lineChart(points, accessor, { color, fill, unit, decimals = 0, nowIndex = -1, band = null }) {
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

  // 気圧低下に注意する時間帯を帯で強調
  const alertBand = band && band.toIndex > band.fromIndex
    ? (() => {
        const bx = x(band.fromIndex), bw = x(band.toIndex) - x(band.fromIndex);
        return `<rect x="${bx.toFixed(1)}" y="${padT}" width="${bw.toFixed(1)}" height="${(H - padT - padB).toFixed(1)}" fill="${band.color}" opacity="0.16"/>
          <text x="${(bx + bw / 2).toFixed(1)}" y="${(padT + 12).toFixed(1)}" class="bandlabel" text-anchor="middle" fill="${band.color}">${band.label}</text>`;
      })()
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
      ${alertBand}
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

// --- 気圧変化の解析（気象病アラート） ----------------------------------
// 気象病は「気圧の急な低下（下降速度）」が引き金になりやすい。
// 今後の各時刻で 3時間あたりの気圧変化を求め、最大の低下幅から警戒レベルを判定する。
const ALERT_LEVELS = [
  { name: "安定", color: "#2e9e6b", emoji: "🟢",
    advice: "この先12時間、大きな気圧の低下はなさそうです。体調への影響は小さいでしょう。" },
  { name: "やや注意", color: "#d8a200", emoji: "🟡",
    advice: "気圧がゆるやかに下がります。敏感な方は体調の変化に気を配りましょう。" },
  { name: "注意", color: "#e8730c", emoji: "🟠",
    advice: "気圧の低下に注意。頭痛・めまい・だるさが出やすい方は、早めの休息や服薬の準備を。" },
  { name: "警戒", color: "#d6453d", emoji: "🔴",
    advice: "気圧が大きく低下します。症状が出やすい方は無理をせず、休息・水分・服薬など早めの対策を。" },
];

function analyzePressure(points, nowIndex) {
  const P = points.map((p) => p.pressure);
  const current = nowIndex >= 0 && P[nowIndex] != null ? P[nowIndex] : null;

  // これからの時間帯で「3時間前との差」が最も下がるところを探す
  let worst = { delta: 0, i: -1 };
  for (let i = Math.max(3, nowIndex + 1); i < points.length; i++) {
    if (P[i] == null || P[i - 3] == null) continue;
    const d = P[i] - P[i - 3]; // マイナス = 低下
    if (d < worst.delta) worst = { delta: d, i };
  }

  const drop = worst.i >= 0 ? -worst.delta : 0; // 低下幅(hPa, 正の値)
  let level = 0;
  if (drop >= 5) level = 3;
  else if (drop >= 3) level = 2;
  else if (drop >= 1.5) level = 1;

  const result = { level, drop, current, ...ALERT_LEVELS[level], band: null, timing: "" };
  if (level > 0 && worst.i >= 0) {
    const from = Math.max(0, worst.i - 3);
    result.timing = `${points[from].hour}時頃〜${points[worst.i].hour}時頃に約${Math.round(drop)}hPaの低下`;
    result.band = { fromIndex: from, toIndex: worst.i, color: ALERT_LEVELS[level].color, label: "気圧低下" };
  }
  return result;
}

function alertCard(a) {
  const head = a.timing
    ? `<div class="alert-timing">${escapeHtml(a.timing)}</div>`
    : "";
  const cur = a.current != null
    ? `<div class="alert-current">現在の気圧 <strong>${a.current}</strong> hPa</div>`
    : "";
  return `
    <div class="alert" style="--lv:${a.color}">
      <div class="alert-top">
        <span class="alert-badge">${a.emoji} ${a.name}</span>
        ${cur}
      </div>
      ${head}
      <p class="alert-advice">${escapeHtml(a.advice)}</p>
      <p class="alert-note">※ 気圧変化からの体調管理の目安です。診断・治療は専門家にご相談ください。</p>
    </div>`;
}

// --- 描画 --------------------------------------------------------------
function renderCharts(data) {
  const el = document.getElementById("content");
  if (!el) return;
  if (!data || !data.points || !data.points.length) {
    renderError(new Error("予報データを取得できませんでした。"));
    return;
  }
  const { points, nowIndex } = data;
  const alert = analyzePressure(points, nowIndex);
  el.innerHTML = `
    ${alertCard(alert)}

    <div class="charts">
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
        ${lineChart(points, (p) => p.pressure, { color: "#2a7fd4", fill: "#2a7fd4", unit: "pres", decimals: 0, nowIndex, band: alert.band })}
      </div>
    </div>`;
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
      <p>予報データを取得しています…</p>
    </div>`;
  try {
    renderCharts(await fetchHourly());
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
