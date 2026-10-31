/* ============================================================
 * 评分算法 —— 可解释、可复现
 * ------------------------------------------------------------
 * 原则：不可解释即不输出。任何分数都必须能列出扣分原因。
 * 详见《路线天气体检_MVP技术方案与评分算法细则.md》第三节
 * ============================================================ */

/* ---------------- WMO 天气码 ---------------- */

const WMO = {
  0:  { zh: '晴',       sev: 0 },
  1:  { zh: '少云',     sev: 0 },
  2:  { zh: '多云',     sev: 0 },
  3:  { zh: '阴',       sev: 0 },
  45: { zh: '雾',       sev: 10 },
  48: { zh: '雾凇',     sev: 10 },
  51: { zh: '小毛毛雨', sev: 3 },
  53: { zh: '毛毛雨',   sev: 6 },
  55: { zh: '大毛毛雨', sev: 10 },
  56: { zh: '冻毛毛雨', sev: 20 },
  57: { zh: '强冻毛毛雨', sev: 20 },
  61: { zh: '小雨',     sev: 5 },
  63: { zh: '中雨',     sev: 12 },
  65: { zh: '大雨',     sev: 20 },
  66: { zh: '冻雨',     sev: 20 },
  67: { zh: '强冻雨',   sev: 20 },
  71: { zh: '小雪',     sev: 10 },
  73: { zh: '中雪',     sev: 15 },
  75: { zh: '大雪',     sev: 20 },
  77: { zh: '米雪',     sev: 10 },
  80: { zh: '阵雨',     sev: 8 },
  81: { zh: '中阵雨',   sev: 15 },
  82: { zh: '强阵雨',   sev: 20 },
  85: { zh: '小阵雪',   sev: 12 },
  86: { zh: '大阵雪',   sev: 20 },
  95: { zh: '雷暴',     sev: 25 },
  96: { zh: '雷暴伴冰雹', sev: 25 },
  99: { zh: '强雷暴伴冰雹', sev: 25 },
};

function wmoText(code) {
  if (code === null || code === undefined) return '未知';
  return (WMO[code] || { zh: '未知', sev: 0 }).zh;
}

/** WMO 天气码 → 图标（用于逐小时天气条） */
function wmoIcon(code) {
  if (code == null) return '·';
  if (code === 0) return '☀️';
  if (code === 1) return '🌤️';
  if (code === 2) return '⛅';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 57) return '🌦️';
  if (code >= 61 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '🌨️';
  if (code >= 80 && code <= 82) return '🌧️';
  if (code >= 85 && code <= 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '·';
}

function wmoSev(code) {
  if (code === null || code === undefined) return 0;
  return (WMO[code] || { sev: 0 }).sev;
}

/* ---------------- 等级 ---------------- */

function levelOf(score) {
  if (score >= 80) return { key: 'good',   text: '适宜',   icon: '🟢', short: '适合出行' };
  if (score >= 60) return { key: 'fair',   text: '一般',   icon: '🟡', short: '可以出行，注意天气变化' };
  if (score >= 40) return { key: 'caution',text: '谨慎',   icon: '🟠', short: '谨慎出行' };
  return               { key: 'bad',   text: '不建议', icon: '🔴', short: '不建议出行' };
}

/* ---------------- 单项扣分 ---------------- */

function dedPrecipProb(pp) {
  if (pp === null) return { pts: 0, label: null };
  let pts = 0;
  if (pp > 80) pts = 35;
  else if (pp > 60) pts = 22;
  else if (pp > 40) pts = 12;
  else if (pp > 20) pts = 5;
  return { pts, label: `降水概率 ${Math.round(pp)}%` };
}

function dedPrecip(mm) {
  if (mm === null) return { pts: 0, label: null };
  let pts = 0;
  if (mm > 8) pts = 35;
  else if (mm > 2.5) pts = 20;
  else if (mm > 0.5) pts = 10;
  else if (mm > 0) pts = 3;
  return { pts, label: `降水量 ${mm.toFixed(1)} mm/h` };
}

function dedWind(w) {
  if (w === null) return { pts: 0, label: null };
  let pts = 0;
  if (w > 50) pts = 30;
  else if (w > 40) pts = 20;
  else if (w > 29) pts = 12;
  else if (w > 18) pts = 5;
  return { pts, label: `风速 ${Math.round(w)} km/h` };
}

function dedTemp(t) {
  if (t === null) return { pts: 0, label: null };
  const COMFORT_LO = 12, COMFORT_HI = 26;
  let dev = 0;
  if (t < COMFORT_LO) dev = COMFORT_LO - t;
  else if (t > COMFORT_HI) dev = t - COMFORT_HI;
  let pts = Math.min(20, Math.floor(dev / 5) * 5);
  return { pts, label: pts > 0 ? `气温偏离舒适区 ${t.toFixed(1)}℃` : null };
}

function dedFreezing(t) {
  if (t === null) return { pts: 0, label: null };
  if (t < 0) return { pts: 10, label: `气温 ${t.toFixed(1)}℃（结冰风险）` };
  return { pts: 0, label: null };
}

function dedWeather(code) {
  const pts = wmoSev(code);
  return { pts, label: pts > 0 ? `天气现象「${wmoText(code)}」` : null };
}

function dedAltitude(elev) {
  if (elev === null || elev === undefined) return { pts: 0, label: null };
  if (elev > 3000) return { pts: 5, label: `高海拔 ${elev} m` };
  return { pts: 0, label: null };
}

/* ---------------- 单小时评分 ---------------- */

/**
 * @param {object} h 归一化后的小时数据
 * @param {number|null} elev 海拔
 * @returns {{score:number, level:object, deductions:Array<{pts:number,label:string}>}}
 */
function scoreHour(h, elev) {
  const items = [
    dedPrecipProb(h.pp),
    dedPrecip(h.precip),
    dedWind(h.wind),
    dedTemp(h.temp),
    dedFreezing(h.temp),
    dedWeather(h.code),
    dedAltitude(elev),
  ];

  const deductions = items
    .filter(d => d.pts > 0 && d.label)
    .map(d => ({ pts: d.pts, label: d.label }))
    .sort((a, b) => b.pts - a.pts);

  const total = items.reduce((s, d) => s + d.pts, 0);
  const score = Math.max(0, Math.round(100 - total));

  return { score, level: levelOf(score), deductions };
}

/* ---------------- 逐小时矩阵 + 路线分析 ---------------- */

/**
 * @param {Array} series  fetchHourly 返回的 series
 * @param {Array} elevations  与 series 等长
 * @param {string} dateStr
 * @param {string} mode  drive|hike|bike
 */
function analyze(series, elevations, dateStr, mode) {
  const nHours = Math.min(...series.map(s => s.hours.length));
  if (!nHours || nHours <= 0) return null;

  // 逐点逐小时评分
  const points = series.map((s, pi) => {
    const elev = elevations[pi];
    const hourly = [];
    for (let k = 0; k < s.hours.length; k++) {
      const h = s.hours[k];
      const sc = scoreHour(h, elev);
      hourly.push({
        hour: h.hour, time: h.time, score: sc.score, level: sc.level,
        deductions: sc.deductions,
        temp: h.temp, pp: h.pp, precip: h.precip, wind: h.wind, code: h.code,
      });
    }
    return { name: s.name, lat: s.lat, lon: s.lon, elev, hourly };
  });

  // 若出行日期是今天，只保留当前时刻之后的小时
  const isToday = dateStr === todayStr();
  const nowHour = new Date().getHours();
  points.forEach(p => {
    p.hourly = p.hourly.filter(x => (isToday ? x.hour >= nowHour : true));
  });

  const len = Math.min(...points.map(p => p.hourly.length));
  if (len <= 0) return null;

  // 每个小时索引上的路线分（短板原则）
  const routeByIndex = [];
  for (let i = 0; i < len; i++) {
    const scores = points.map(p => p.hourly[i].score);
    routeByIndex.push(Math.min(...scores));
  }

  // 最佳出发窗口：所有点同时 ≥60 且连续 ≥2 小时
  // 但若合格时段长达十几小时，"出发窗口"就失去意义 —— 因此取其中最优质的一段（上限 6 小时）
  const TH = 60, MIN_LEN = 2, MAX_WINDOW = 6;

  // 先找出所有合格的连续段
  const runs = [];
  let cur = null;
  for (let i = 0; i < len; i++) {
    if (routeByIndex[i] >= TH) {
      if (!cur) cur = { start: i, end: i };
      else cur.end = i;
    } else {
      if (cur && cur.end - cur.start + 1 >= MIN_LEN) runs.push(cur);
      cur = null;
    }
  }
  if (cur && cur.end - cur.start + 1 >= MIN_LEN) runs.push(cur);

  // 在每个合格段内滑窗，取评分最优且长度不超过 MAX_WINDOW 的子段
  let best = null;
  for (const run of runs) {
    const runLen = run.end - run.start + 1;
    const winLen = Math.min(runLen, MAX_WINDOW);
    for (let s = run.start; s + winLen - 1 <= run.end; s++) {
      const e = s + winLen - 1;
      let sum = 0, mn = 101;
      for (let i = s; i <= e; i++) { sum += routeByIndex[i]; if (routeByIndex[i] < mn) mn = routeByIndex[i]; }
      const avg = sum / winLen;
      const cand = { start: s, end: e, avg, min: mn };
      // 排序：先看窗口内平均分，再看窗口内最低分，再看更早开始
      if (!best
        || cand.avg > best.avg + 1e-9
        || (Math.abs(cand.avg - best.avg) < 1e-9 && cand.min > best.min)
        || (Math.abs(cand.avg - best.avg) < 1e-9 && cand.min === best.min && cand.start < best.start)) {
        best = cand;
      }
    }
  }

  // 记录合格时段的总体情况，用于报告说明
  const qualifyHours = routeByIndex.filter(s => s >= TH).length;

  // 选定"评估时刻"：有窗口取窗口起点；无窗口取路线分最高的时刻
  let chosenIndex, window;
  if (best) {
    chosenIndex = best.start;
    window = {
      exists: true,
      startHour: points[0].hourly[best.start].hour,
      endHour: points[0].hourly[best.end].hour + 1,
      routeScoreAtStart: routeByIndex[best.start],
      avg: Math.round(best.avg),
      min: best.min,
      qualifyHours,
      capped: qualifyHours > MAX_WINDOW,
    };
  } else {
    let maxI = 0;
    for (let i = 1; i < len; i++) if (routeByIndex[i] > routeByIndex[maxI]) maxI = i;
    chosenIndex = maxI;
    // 降级：给出"最接近时段"与瓶颈点位
    const worstIdx = argmin(points.map(p => p.hourly[maxI].score));
    window = {
      exists: false,
      nearestHour: points[0].hourly[maxI].hour,
      nearestEndHour: points[0].hourly[maxI].hour + 1,
      routeScoreAtNearest: routeByIndex[maxI],
      bottleneckName: points[worstIdx].name,
    };
  }

  // 选定时刻的逐点结果
  const atMoment = points.map(p => ({
    name: p.name,
    lat: p.lat,
    lon: p.lon,
    elev: p.elev,
    score: p.hourly[chosenIndex].score,
    level: p.hourly[chosenIndex].level,
    deductions: p.hourly[chosenIndex].deductions,
    temp: p.hourly[chosenIndex].temp,
    code: p.hourly[chosenIndex].code,
    weatherText: wmoText(p.hourly[chosenIndex].code),
    pp: p.hourly[chosenIndex].pp,
    hourly: p.hourly,
  }));

  const routeScore = Math.min(...atMoment.map(p => p.score));
  const avgScore = Math.round(atMoment.reduce((s, p) => s + p.score, 0) / atMoment.length);
  const worstIdx = argmin(atMoment.map(p => p.score), atMoment.map(p => p.elev));
  const routeLevel = levelOf(routeScore);

  return {
    date: dateStr,
    mode: mode || 'drive',
    chosenHour: points[0].hourly[chosenIndex].hour,
    points: atMoment,
    routeScore,
    avgScore,
    level: routeLevel,
    worstIndex: worstIdx,
    window,
    advice: buildAdvice(atMoment, window, mode),
  };
}

/** 取最小值的索引；并列时取海拔更高者 */
function argmin(scores, elevs) {
  let idx = 0;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] < scores[idx]) idx = i;
    else if (scores[i] === scores[idx] && elevs && elevs[i] != null && elevs[idx] != null) {
      if (elevs[i] > elevs[idx]) idx = i;
    }
  }
  return idx;
}

/* ---------------- 出行准备建议 ---------------- */

function buildAdvice(points, window, mode) {
  const out = [];
  const maxPP = Math.max(...points.map(p => p.pp ?? 0));
  const maxCode = Math.max(...points.map(p => wmoSev(p.code) ?? 0));
  const minTemp = Math.min(...points.filter(p => p.temp != null).map(p => p.temp));
  const maxWind = Math.max(...points.map(p => p.wind ?? 0));

  if (maxPP >= 50) out.push('带上雨具，建议穿防水鞋');
  if (maxCode >= 25) out.push('⚠️ 有雷暴预报，尽量上午通过，避开午后');
  if (isFinite(minTemp) && minTemp < 10) out.push('最低气温低于 10℃，加带一件保暖外套');
  if (points.some(p => p.elev != null && p.elev > 2500)) out.push('高海拔点位明显更冷，注意保暖与高反');
  if (maxWind > 29) out.push('注意大风，固定好帽子与随身物品');
  if (mode === 'hike') out.push('徒步请预留下山时间，确保天黑前通过最差点位');
  if (mode === 'bike') out.push('骑行注意侧风，下坡路段控制车速');

  if (!window.exists) {
    const worstName = points[argmin(points.map(p => p.score))].name;
    out.push(`今日无完全适宜窗口，建议改期；如必须出行，缩短行程至「${worstName}」之前`);
  } else {
    out.push(`建议在 ${String(window.startHour).padStart(2, '0')}:00–${String(window.endHour).padStart(2, '0')}:00 之间出发`);
    if (window.capped) {
      out.push(`当天共有约 ${window.qualifyHours} 个时段达到「一般」以上，以上为其中最优的 ${window.endHour - window.startHour} 小时`);
    }
  }
  return out;
}

/* ============================================================
 * 导航模式：沿路采样 + 按「到达时刻」逐点评分
 * ------------------------------------------------------------
 * 与点位模式的核心区别：
 *   点位模式   —— 所有点位用同一个时刻的天气
 *   导航模式   —— 第 i 个采样点用「预计到达那一刻」的天气
 *   例：成都→稻城 7.9 小时，第 8 个点到达时已是 8 小时后，
 *       用出发时刻的天气去评估它是错的。
 * ============================================================ */

/** 取某采样点序列的第 idx 小时（idx 可跨日，0..47） */
function hourAt(p, idx) {
  if (!p.hours || !p.hours.length) return null;
  return p.hours[Math.max(0, Math.min(p.hours.length - 1, idx))];
}

/**
 * 计算某个出发时刻下，每个采样点的分数与到达时刻
 * @returns {{entries:Array, min:number, avg:number, valid:boolean}}
 */
function scoreAtDeparture(samples, series, elevations, durationSec, departHour) {
  const entries = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const ser = series[i];
    if (!ser || !ser.hours || !ser.hours.length) return { entries: [], min: 0, avg: 0, valid: false };
    // 到达该点的时刻 = 出发时刻 + 行程进度 × 总时长
    const arriveAbs = departHour + (s.ratio * durationSec) / 3600;
    const idx = Math.round(arriveAbs);
    // 超出已取到的预报范围就判为无效，避免静默地用最后一条小时数据顶替
    if (idx < 0 || idx >= ser.hours.length) return { entries: [], min: 0, avg: 0, valid: false };
    const h = ser.hours[idx];

    const elev = elevations ? elevations[i] : null;
    const sc = scoreHour(h, elev);

    // 该采样点「到达那一天」的 24 小时评分，报告卡片里铺成和规划模式一样的逐小时天气条
    const dayStart = Math.floor(idx / 24) * 24;
    const hourly = ser.hours.slice(dayStart, dayStart + 24).map(x => {
      const s2 = scoreHour(x, elev);
      return {
        hour: x.hour, time: x.time, score: s2.score, level: s2.level, deductions: s2.deductions,
        temp: x.temp, pp: x.pp, precip: x.precip, wind: x.wind, code: x.code,
      };
    });

    entries.push({
      name: s.name,
      lat: s.lat, lon: s.lon,
      elev,
      cumKm: s.cumKm,
      ratio: s.ratio,
      arriveAbs,
      arriveIdx: idx,
      hours: ser.hours,
      hourly,
      dayStart,
      hour: ((idx % 24) + 24) % 24,
      dayOffset: Math.floor(idx / 24),
      score: sc.score,
      level: sc.level,
      deductions: sc.deductions,
      temp: h.temp,
      code: h.code,
      pp: h.pp,
      precip: h.precip,
      wind: h.wind,
      weatherText: wmoText(h.code),
      icon: wmoIcon(h.code),
    });
  }
  const scores = entries.map(e => e.score);
  return {
    entries,
    min: Math.min(...scores),
    avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    valid: true,
  };
}

/**
 * 推荐出发时刻：在给定的小时区间内取「全程最低分」最高的那个。
 * 默认整天 0–23 点；若出行日期是今天，调用方应传入已过滤过去时刻的区间。
 */
function findBestDeparture(samples, series, elevations, durationSec, fromIdx, toIdx) {
  const from = Math.max(0, fromIdx == null ? 0 : fromIdx);
  const to = toIdx == null ? 24 : toIdx;
  let best = null;
  for (let h = from; h < to; h++) {
    const r = scoreAtDeparture(samples, series, elevations, durationSec, h);
    if (!r.valid) continue;
    if (!best || r.min > best.min || (r.min === best.min && h < best.hour)) {
      best = { hour: h, min: r.min, avg: r.avg };
    }
  }
  return best;
}

/**
 * 出发时刻矩阵：对 [fromIdx, toIdx) 的每个「绝对小时下标」算一次全程分。
 * 下标以 series[0].hours 的起点为 0，跨天时 24 = 次日 00:00。
 * 报告页「出发时刻对比」用它铺网格，点某一格就是换一个出发时刻。
 */
function departureMatrix(samples, series, elevations, durationSec, fromIdx, toIdx) {
  const len = Math.min(...series.map(s => (s.hours || []).length));
  const from = Math.max(0, fromIdx == null ? 0 : fromIdx);
  const to = Math.min(len, toIdx == null ? 24 : toIdx);
  const out = [];
  for (let idx = from; idx < to; idx++) {
    const r = scoreAtDeparture(samples, series, elevations, durationSec, idx);
    // 起点那一个小时的天气，用于把"指数"画成一张看得懂的逐小时预报
    const startH = series[0] && series[0].hours ? series[0].hours[idx] : null;
    out.push({
      idx,
      hour: ((idx % 24) + 24) % 24,
      dayOffset: Math.floor(idx / 24),
      min: r.valid ? r.min : null,
      avg: r.valid ? r.avg : null,
      valid: r.valid,
      code: startH ? startH.code : null,
      temp: startH ? startH.temp : null,
      pp: startH ? startH.pp : null,
    });
  }
  return out;
}

/**
 * @param {Array} series     每个采样点的逐小时数据（48 小时，不按"今天"过滤）
 * @param {Array} elevations 海拔
 * @param {Array} samples    [{lat, lon, ratio, cumKm, name}]
 * @param {object} route     {distance(米), duration(秒), approx, profile}
 * @param {number} departHour 出发时刻 0–23；传 -1 表示自动取推荐时刻
 * @param {string} dateStr
 * @param {string} mode
 */
function analyzeNavigation(series, elevations, samples, route, departHour, dateStr, mode) {
  const durationSec = route.duration;
  const auto = departHour == null || departHour < 0;

  // 出行日期是今天时，推荐窗口 = 现在 → 现在 + 4 小时，不能从过去出发
  const isToday = dateStr === todayStr();
  const now = new Date();
  const nowH = now.getHours() + now.getMinutes() / 60;
  const fromIdx = isToday ? Math.max(0, Math.ceil(nowH)) : 0;
  const toIdx = isToday ? Math.min(24, Math.floor(nowH) + 5) : 24;
  let bestDep = findBestDeparture(samples, series, elevations, durationSec, fromIdx, toIdx);
  // 未来 4 小时内都不可用时，退到「今天剩余时间」再找一次（仍然不选过去）
  if (!bestDep && isToday) {
    bestDep = findBestDeparture(samples, series, elevations, durationSec, fromIdx, 24);
  }
  const useHour = auto && bestDep ? bestDep.hour : (departHour == null || departHour < 0 ? 0 : departHour);

  const res = scoreAtDeparture(samples, series, elevations, durationSec, useHour);
  if (!res.valid) return null;

  const points = res.entries;
  const combined = combineRouteScore(points.map(p => p.score));
  const routeScore = combined.score;
  const avgScore = combined.avg;
  const worstIndex = argmin(points.map(p => p.score), points.map(p => p.elev));
  const routeLevel = levelOf(routeScore);

  // 风险路段统计
  const risky = points.filter(p => p.score < 60);
  const cautionCount = points.filter(p => p.score >= 40 && p.score < 60).length;
  const badCount = points.filter(p => p.score < 40).length;

  return {
    mode: 'nav',
    date: dateStr,
    travelMode: mode,
    departureHour: useHour,
    autoDeparture: auto,
    recommendedHour: bestDep ? bestDep.hour : null,
    recommendedMin: bestDep ? bestDep.min : null,
    route: {
      distanceKm: route.distance / 1000,
      durationMin: route.duration / 60,
      approx: !!route.approx,
      provider: route.provider,
      profile: route.profile,
      speedKmh: route.speedKmh,          // 徒步/骑行时为估算速度，自驾为 null
      arriveHour: useHour + route.duration / 3600,
    },
    points,
    routeScore,
    avgScore,
    minScore: res.min,
    level: routeLevel,
    worstIndex,
    riskyCount: risky.length,
    cautionCount,
    badCount,
    advice: buildNavAdvice(points, route, useHour, mode),
  };
}

function buildNavAdvice(points, route, departHour, mode) {
  const out = [];
  const maxPP = Math.max(...points.map(p => p.pp ?? 0));
  const hasStorm = points.some(p => wmoSev(p.code) >= 25);
  const maxElev = Math.max(...points.filter(p => p.elev != null).map(p => p.elev));
  const minTemp = Math.min(...points.filter(p => p.temp != null).map(p => p.temp));
  const worst = points[argmin(points.map(p => p.score))];

  // 统一分钟口径，避免 23.95:00 这类非法时间
  const departLabel = minToHM(Math.round(departHour * 60));
  const arriveMin = Math.round((departHour + route.duration / 3600) * 60);
  out.push(`建议 ${departLabel} 出发，预计 ${minToLabel(arriveMin)} 抵达终点`);

  if (worst && worst.score < 60) {
    out.push(`风险最高路段在第 ${points.indexOf(worst) + 1} 个采样点附近（${worst.cumKm.toFixed(0)} km 处），预计 ${minToHM(worst.hour * 60)} 到达`);
  }
  if (maxPP >= 50) out.push('沿途有较高降水概率，注意山路湿滑');
  if (hasStorm) out.push('⚠️ 沿途有雷暴预报，山区避免午后通过');
  if (maxElev > 3000) out.push(`途经海拔 ${maxElev} m 的路段，明显更冷，注意保暖与高反`);
  if (isFinite(minTemp) && minTemp < 0) out.push('部分路段气温低于 0℃，注意路面结冰');
  if (route.approx) {
    const travelLabel = mode === 'hike' ? '徒步' : '骑行';
    out.push(`已采用${travelLabel}专用路网；时长按 ${route.speedKmh} km/h 估算，请结合个人体能与路线难度调整`);
  }
  if (route.duration / 3600 > 4) out.push('全程超过 4 小时，建议中途安排休息并复核后段天气');
  if (mode === 'drive') {
    out.push('自驾用时按汽车路网估算；山路实际车速可能更慢，建议按抵达时间预留 20–30% 余量');
  } else {
    const travelLabel = mode === 'hike' ? '徒步' : '骑行';
    out.push(`${travelLabel}用时按 ${route.speedKmh} km/h 平均速度估算，未计入个人体能、休息与路线难度`);
  }
  return out;
}

/**
 * 导航模式的行程诊断：与规划模式同一套数据结构（severity / title / evidence /
 * impact / advice / actions，可选 apply），报告里复用同一个诊断卡片与弹层。
 * @param {Array} points     评分后的采样点（按到达顺序）
 * @param {object} route     {distance, duration, ...}
 * @param {number} departHour 出发时刻 0–23
 * @param {string} mode
 * @param {number|null} recommendedHour 自动推荐的出发时刻（可选）
 */
function diagnoseNav(points, route, departHour, mode, recommendedHour) {
  const items = [];
  // 统一把小时值转成合法 HH:MM，支持小数小时
  const hh = n => minToHM(Math.round(Number(n) * 60));
  const moveApply = (recommendedHour != null && recommendedHour !== departHour)
    ? { apply: { type: 'navDepart', hour: recommendedHour }, applyLabel: `改到 ${hh(recommendedHour)} 出发` }
    : {};

  // 1) 逐点天气：只挑最差的 1–2 个，避免淹没报告
  const low = points
    .map((p, i) => ({ p, i }))
    .filter(x => x.p.score < 60)
    .sort((a, b) => a.p.score - b.p.score)
    .slice(0, 2);

  low.forEach(({ p, i }) => {
    const block = p.score < 40;
    items.push(Object.assign({
      severity: block ? 'block' : 'warn',
      index: i,
      tag: block ? '天气不适合' : '天气偏弱',
      title: `${p.name}（${hh(p.hour)} 到达）${block ? '天气不适合通过' : '天气条件一般'}`,
      evidence: `${wmoText(p.code)}，降水概率 ${p.pp == null ? '—' : Math.round(p.pp) + '%'}`
        + `，风速 ${p.wind == null ? '—' : Math.round(p.wind) + ' km/h'}，评分 ${p.score}`,
      impact: block
        ? '这是全程最危险的一段，经过时体验差、风险高'
        : '这一段会把全程评分拉低，但仍在可通过范围',
      advice: recommendedHour != null && recommendedHour !== departHour
        ? `避开这个时段：改到 ${hh(recommendedHour)} 出发（自动推荐）`
        : '在出发时刻对比里换一个评分更高的时刻',
      actions: [
        '点摘要里的「采用」推荐时刻，或用上方的提前/推迟对比调整出发时间',
        '无法调整时，缩短在这一段的停留并留意路面湿滑',
      ],
    }, moveApply));
  });

  // 2) 雷暴
  const storm = points.find(p => wmoSev(p.code) >= 25);
  if (storm) {
    items.push(Object.assign({
      severity: 'block',
      tag: '雷暴',
      title: '沿途有雷暴预报',
      evidence: `${storm.name} 附近预计 ${hh(storm.hour)} 出现${wmoText(storm.code)}`,
      impact: '山区雷暴来得快、范围小，靠边停车或临时避雨都很难，属于明确风险',
      advice: '尽量避开午后通过；已经定了日期的话，优先把出发时刻提前到上午',
      actions: ['把出发时刻提前，争取在 11:00 前通过高海拔路段', '当天早上再看一次预报，出现雷暴就改期'],
    }, moveApply));
  }

  // 3) 高海拔
  const high = points.filter(p => p.elev != null && p.elev > 3000).sort((a, b) => b.elev - a.elev)[0];
  if (high) {
    items.push({
      severity: 'warn',
      tag: '高海拔',
      title: `途经海拔 ${Math.round(high.elev)} m 的路段`,
      evidence: `${high.name} 附近海拔约 ${Math.round(high.elev)} m，气温 ${high.temp == null ? '—' : high.temp.toFixed(0) + '℃'}`,
      impact: '海拔每升高 1000 m 气温约降 6℃，风大体感更低，路面也可能结冰',
      advice: '备保暖层与防滑装备，高海拔段不要久留',
      actions: ['带一件抓绒或羽绒在后备箱，翻垭口时再穿', '注意路面暗冰，弯道提前减速'],
    });
  }

  // 4) 出发过早 / 抵达过晚
  const arriveHour = departHour + route.duration / 3600;
  if (departHour < 6) {
    items.push({
      severity: 'warn',
      tag: '出发过早',
      title: '出发时刻在清晨，视线与路面条件较差',
      evidence: `建议 ${hh(departHour)} 出发，预计 ${minToLabel(Math.round(arriveHour * 60))} 抵达`,
      impact: '天没亮时山路能见度低，动物与落石更不易发现',
      advice: '尽量等天亮后再走；必须早走就放慢车速、常开近光灯',
      actions: ['把出发时刻推到日出后半小时', '检查车灯、雨刮与轮胎'],
    });
  } else if (arriveHour >= 22 || arriveHour % 24 >= 22) {
    items.push({
      severity: 'warn',
      tag: '抵达过晚',
      title: '预计抵达时间偏晚',
      evidence: `按 ${hh(departHour)} 出发，预计 ${minToLabel(Math.round(arriveHour * 60))} 抵达终点`,
      impact: '夜间抵达意味着最后一段在黑暗中行驶，疲劳叠加视线差',
      advice: '把出发时刻提前 1–2 小时，或中途安排住宿',
      actions: ['在出发时刻对比里选一个更早的高分时段', '预留 20–30% 的时间余量'],
    });
  }

  const blockCount = items.filter(x => x.severity === 'block').length;
  const warnCount = items.filter(x => x.severity === 'warn').length;

  // 5) 没有问题时补一条"合理项"，报告不至于空着
  if (!items.length) {
    items.push({
      severity: 'ok',
      tag: '安排合理',
      title: '各时段的天气与行程安排匹配',
      evidence: `全程 ${points.length} 个采样点，最低分 ${Math.min(...points.map(p => p.score))}`,
      impact: '没有需要调整的地方',
      advice: '按计划出发即可，出发前再确认一次天气',
      actions: ['出发前 12 小时再刷新一次预报'],
    });
  }

  return {
    items,
    blockCount,
    warnCount,
    summary: blockCount ? 'block' : (warnCount ? 'warn' : 'ok'),
  };
}


/* ============================================================
 * 规划模式：用户给定「点位 + 到达时间」，逐点核对并给出诊断
 * ------------------------------------------------------------
 * 与导航模式的分工：
 *   导航模式 = 系统排时间（按路网时长推算到达时刻，并推荐出发时刻）
 *   规划模式 = 用户排时间（系统只核对合不合理，不替他排）
 * ============================================================ */

/** 分钟 → "HH:MM" */
function minToHM(min) {
  if (min == null || !isFinite(min)) return '--:--';
  let m = Math.round(min) % 1440;
  if (m < 0) m += 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

/** 分钟（可超过 1440）→ "次日 00:54" / "第3天 05:20" */
function minToLabel(min) {
  if (min == null || !isFinite(min)) return '--:--';
  const m = Math.round(min);
  const day = Math.floor(m / 1440);
  const rest = ((m % 1440) + 1440) % 1440;
  const hm = String(Math.floor(rest / 60)).padStart(2, '0') + ':' + String(rest % 60).padStart(2, '0');
  if (day <= 0) return hm;
  return (day === 1 ? '次日 ' : '第' + (day + 1) + '天 ') + hm;
}

/** "HH:MM" → 分钟 */
function hmToMin(hm) {
  if (!hm) return null;
  const parts = String(hm).split(':');
  const h = Number(parts[0]), m = Number(parts[1] || 0);
  if (!isFinite(h) || !isFinite(m)) return null;
  return h * 60 + m;
}

/** 两点直线距离（km） */
function haversineKm(a, b) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 出行方式速度（km/h），与 routing.js 的 SPEED 保持一致 */
const PLAN_SPEED = { drive: 40, hike: 4, bike: 15 };

/** 两点之间的路程与耗时（直线 × 1.25 近似山路里程） */
function planLeg(a, b, mode) {
  const km = haversineKm(a, b) * 1.25;
  const spd = PLAN_SPEED[mode] || PLAN_SPEED.drive;
  return { km, minutes: km / spd * 60 };
}

/** 取某点位在指定分钟对应的那一小时数据 */
function hourAtMinute(series, minute) {
  if (!series || !series.hours) return null;
  const idx = Math.floor(minute / 60);   // 绝对小时下标：24 = 次日 00:00
  return series.hours[idx] || null;
}

/**
 * 规划模式：把「点位 + 时间」展开成「点位 + 沿途采样点」
 * 目的：体检不能只看几个点，必须覆盖点与点之间的路段。
 *
 * @param {Array} points   [{name, lat, lon}]（2–5 个）
 * @param {Array} times    每个点位的到达时刻（分钟）
 * @param {string} mode    drive | hike | bike
 * @param {number} maxTotal 采样点总数上限（含关键点位），默认 20
 */
function buildPlanSamples(points, times, mode, maxTotal) {
  maxTotal = maxTotal || 30;
  const K = points.length;
  const out = [];
  if (!K) return { samples: [], legs: [] };

  const legRaw = [];
  let cum = 0;
  for (let i = 1; i < K; i++) {
    const km = haversineKm(points[i - 1], points[i]);
    const L = planLeg(points[i - 1], points[i], mode);
    legRaw.push({
      from: points[i - 1].name, to: points[i].name,
      km, needed: L.minutes, planned: times[i] - times[i - 1],
      a: points[i - 1], b: points[i], t0: times[i - 1], t1: times[i], cumStart: cum,
    });
    cum += km;
  }

  // 每条路段的中间采样数：约每 8 km 一个，单段 0–6 个，总预算内按最大段优先削减
  const budget = Math.max(0, maxTotal - K);
  const counts = legRaw.map(L => Math.min(12, Math.max(0, Math.round(L.km / 8))));
  let total = counts.reduce((a, b) => a + b, 0);
  while (total > budget) {
    let idx = -1, best = 0;
    counts.forEach((c, i) => { if (c > best) { best = c; idx = i; } });
    if (idx < 0) break;
    counts[idx]--; total--;
  }

  // 起点
  out.push({
    name: points[0].name, lat: points[0].lat, lon: points[0].lon,
    minute: times[0], kind: 'point', pointIdx: 0, legIndex: -1, ratio: 0, cumKm: 0,
  });

  legRaw.forEach((L, i) => {
    const n = counts[i] || 0;
    for (let k = 1; k <= n; k++) {
      const f = k / (n + 1);
      out.push({
        name: L.from + '→' + L.to + ' K' + Math.max(1, Math.round(L.km * f)),
        lat: L.a.lat + (L.b.lat - L.a.lat) * f,
        lon: L.a.lon + (L.b.lon - L.a.lon) * f,
        minute: L.t0 + (L.t1 - L.t0) * f,
        kind: 'leg', pointIdx: -1, legIndex: i, ratio: f,
        cumKm: L.cumStart + L.km * f,
      });
    }
    // 该段终点（关键点位）
    out.push({
      name: L.to, lat: L.b.lat, lon: L.b.lon,
      minute: L.t1, kind: 'point', pointIdx: i + 1, legIndex: i, ratio: 1,
      cumKm: L.cumStart + L.km,
    });
  });

  return {
    samples: out,
    legs: legRaw.map(L => ({
      from: L.from, to: L.to, km: L.km,
      needed: L.needed, planned: L.planned,
    })),
  };
}

/**
 * 高程剖面
 * ------------------------------------------------------------
 * ⚠️ 口径说明（重要）：
 *   累计爬升只按「用户输入的关键点位」逐段累加，不按沿途采样点累加。
 *   原因：规划模式的沿途采样点是「两点之间的直线插值」，海拔取的是 DEM
 *   地形高程（可能是山脊/沟谷），不是路面高程。若按采样点累加，
 *   直线穿过的起伏会被反复计入，得到虚高的累计爬升（如 3008 m 最高点
 *   却算出 3187 m 爬升）。
 *   terrainMax 单独保留，仅用于展示「沿线地形采样最高」，不参与爬升统计。
 */
function buildProfile(entries) {
  const keys = entries.filter(e => e.kind !== 'leg');
  const use = keys.length >= 2 ? keys : entries;

  let climb = 0, descent = 0, maxGrade = 0, maxElev = null, minElev = null;
  let steep = null, longDown = null, terrainMax = null;

  // 地形采样最高（仅展示，不作为路面海拔）
  entries.forEach(e => {
    if (e.elev == null) return;
    if (terrainMax == null || e.elev > terrainMax) terrainMax = e.elev;
  });

  // 关键点位：海拔极值与累计升降
  use.forEach(e => {
    if (e.elev == null) return;
    if (maxElev == null || e.elev > maxElev) maxElev = e.elev;
    if (minElev == null || e.elev < minElev) minElev = e.elev;
  });

  for (let i = 1; i < use.length; i++) {
    const a = use[i - 1], b = use[i];
    if (a.elev == null || b.elev == null) continue;
    const dh = b.elev - a.elev;
    const d = haversineKm(a, b) * 1000;
    if (!d) continue;
    if (dh > 0) climb += dh; else descent += -dh;
    const grade = Math.abs(dh) / d * 100;
    if (grade > maxGrade) maxGrade = grade;
    if (dh > 0 && grade >= 5 && dh >= 300 && (!steep || dh > steep.dh)) steep = { a, b, dh, grade };
    if (dh < 0 && -dh >= 500 && (!longDown || -dh > longDown.dh)) longDown = { a, b, dh: -dh, grade };
  }

  const netGain = (use.length >= 2 && use[0].elev != null && use[use.length - 1].elev != null)
    ? Math.round(use[use.length - 1].elev - use[0].elev)
    : null;

  return {
    climb: Math.round(climb),
    descent: Math.round(descent),
    netGain,
    maxGrade,
    maxElev,
    minElev,
    terrainMax,
    steep,
    longDown,
  };
}

/**
 * 规划模式分析（含沿途采样）
 * 与 analyzePlan 的区别：这里接受已展开的 samples（含 kind='leg'），
 * 路线分取「所有采样点」的最低分，并在报告中单列沿途风险。
 */
function analyzePlanRoute(opts) {
  const series = opts.series || [];
  const elevations = opts.elevations || [];
  const samples = opts.samples || [];
  if (!series.length || !samples.length) return null;

  const entries = [];
  for (let i = 0; i < samples.length; i++) {
    const sm = samples[i];
    const s = series[i];
    if (!s) continue;
    const h = hourAtMinute(s, sm.minute);
    if (!h) return null;
    const elev = elevations ? elevations[i] : null;
    // 只取「到达那一天」的 24 小时用于展示（跨天时 series 有 48+ 小时）
    const dayIdx = Math.floor(sm.minute / 1440);
    const dayHours = s.hours.slice(dayIdx * 24, dayIdx * 24 + 24);
    const hourly = dayHours.map(x => {
      const s2 = scoreHour(x, elev);
      return {
        hour: x.hour, time: x.time, score: s2.score, level: s2.level, deductions: s2.deductions,
        temp: x.temp, pp: x.pp, precip: x.precip, wind: x.wind, code: x.code,
      };
    });
    const sc = scoreHour(h, elev);
    entries.push({
      name: sm.name, lat: sm.lat, lon: sm.lon, elev,
      minute: sm.minute, timeLabel: minToLabel(sm.minute), hour: h.hour,
      kind: sm.kind, pointIdx: sm.pointIdx, legIndex: sm.legIndex, ratio: sm.ratio, cumKm: sm.cumKm,
      score: sc.score, level: sc.level, deductions: sc.deductions,
      temp: h.temp, code: h.code, pp: h.pp, precip: h.precip, wind: h.wind,
      weatherText: wmoText(h.code), icon: wmoIcon(h.code),
      hourly,
    });
  }
  if (!entries.length) return null;

  const scores = entries.map(e => e.score);
  const combined = combineRouteScore(scores);
  const routeScore = combined.score;
  const worstIndex = argmin(scores, entries.map(e => e.elev));
  const profile = buildProfile(entries);
  const diagnosis = diagnosePlan(entries, opts.legs || [], opts.sun || [], opts.mode, profile);

  return {
    mode: 'plan',
    date: opts.dateStr,
    travelMode: opts.mode,
    points: entries,
    legs: opts.legs || [],
    profile,
    routeScore,
    avgScore: combined.avg,
    minScore: combined.min,
    level: levelOf(routeScore),
    worstIndex,
    diagnosis,
    advice: buildPlanAdvice(entries, opts.legs || [], diagnosis, profile),
  };
}

/**
 * 规划模式分析
 * @param {Array} series      每个点位的逐小时数据（1 天，0–23 时）
 * @param {Array} elevations  海拔
 * @param {Array} points      [{name, lat, lon}]
 * @param {Array} times       每个点位的到达时刻（分钟）
 * @param {Array} sun         [{sunrise, sunset}]
 */
function analyzePlan(series, elevations, points, times, sun, dateStr, mode) {
  if (!series || !series.length) return null;
  const entries = [];
  for (let i = 0; i < series.length; i++) {
    const t = times && times[i] != null ? times[i] : 8 * 60;
    const h = hourAtMinute(series[i], t);
    if (!h) return null;
    const elev = elevations ? elevations[i] : null;
    // 只取「到达那一天」的 24 小时用于展示
    const dayIdx = Math.floor(t / 1440);
    const dayHours = series[i].hours.slice(dayIdx * 24, dayIdx * 24 + 24);
    // 逐小时评分（与 analyze() 的结构保持一致，供小时条/展开表复用）
    const hourly = dayHours.map(x => {
      const s2 = scoreHour(x, elev);
      return {
        hour: x.hour, time: x.time, score: s2.score, level: s2.level, deductions: s2.deductions,
        temp: x.temp, pp: x.pp, precip: x.precip, wind: x.wind, code: x.code,
      };
    });
    const sc = scoreHour(h, elev);
    entries.push({
      name: points[i] ? points[i].name : series[i].name,
      lat: series[i].lat, lon: series[i].lon,
      elev,
      minute: t,
      timeLabel: minToLabel(t),
      hour: h.hour,
      score: sc.score, level: sc.level, deductions: sc.deductions,
      temp: h.temp, code: h.code, pp: h.pp, precip: h.precip, wind: h.wind,
      weatherText: wmoText(h.code),
      hourly,
    });
  }

  // 点与点之间的路程 / 耗时 / 你留出的时间
  const legs = [];
  for (let i = 1; i < entries.length; i++) {
    const L = planLeg(points[i - 1], points[i], mode);
    legs.push({
      from: entries[i - 1].name,
      to: entries[i].name,
      km: L.km,
      needed: L.minutes,
      planned: entries[i].minute - entries[i - 1].minute,
    });
  }

  const scores = entries.map(e => e.score);
  const combined = combineRouteScore(scores);
  const routeScore = combined.score;
  const worstIndex = argmin(scores, entries.map(e => e.elev));
  const diagnosis = diagnosePlan(entries, legs, sun, mode);

  return {
    mode: 'plan',
    date: dateStr,
    travelMode: mode,
    points: entries,
    legs,
    routeScore,
    avgScore: combined.avg,
    minScore: combined.min,
    level: levelOf(routeScore),
    worstIndex,
    diagnosis,
    advice: buildPlanAdvice(entries, legs, diagnosis),
  };
}

/**
 * 行程诊断：R1 单点天气 / R2 高海拔午后 / R3 时间过紧 / R4 天黑 / R5 全程降雨
 * 每条都输出：证据 + 影响 + 建议
 */
/** 路线综合分：平均分 70% + 最差段 30%；最差段低于 60 时封顶，避免"一段很差还被平均掉" */
function combineRouteScore(scores) {
  const n = scores.length || 1;
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / n);
  const minScore = Math.min.apply(null, scores);
  let score = Math.round(avg * 0.7 + minScore * 0.3);
  if (minScore < 40) score = Math.min(score, 59);
  else if (minScore < 60) score = Math.min(score, 79);
  return { score, avg, min: minScore };
}

/** 某点位在 lo–hi 点之间、评分 ≥ threshold 的连续时段 */
function goodWindowsOf(p, lo, hi, threshold) {
  const hits = (p.hourly || []).filter(h => h.hour >= lo && h.hour <= hi && h.score >= threshold);
  const wins = [];
  let cur = null;
  hits.forEach(h => {
    if (cur && h.hour === cur.end + 1) { cur.end = h.hour; cur.max = Math.max(cur.max, h.score); }
    else { if (cur) wins.push(cur); cur = { start: h.hour, end: h.hour, max: h.score }; }
  });
  if (cur) wins.push(cur);
  return wins;
}

/** 时段 → "09:00–11:00" */
function fmtWindow(w) {
  const a = String(w.start).padStart(2, '0') + ':00';
  if (w.end === w.start) return a;
  return a + '–' + String(w.end + 1).padStart(2, '0') + ':00';
}

/** 按 pointIdx 找到该关键点位在 entries 中的下标（entries 里混有沿途采样点） */
function entryIndexByPoint(entries, pointIdx) {
  for (let k = 0; k < entries.length; k++) {
    if (entries[k].kind === 'point' && entries[k].pointIdx === pointIdx) return k;
  }
  return Math.min(entries.length - 1, pointIdx);
}

/** 某个点位 06–20 点之间评分最高的时刻 */
function bestHourOf(p, lo, hi) {
  let best = null;
  (p.hourly || []).forEach(h => {
    if (h.hour < lo || h.hour > hi) return;
    if (!best || h.score > best.score) best = { hour: h.hour, minute: h.hour * 60, score: h.score };
  });
  return best;
}

/**
 * 把诊断条目变成「可执行措施 + 具体时间」
 * 输出：it.actions（给人看的措施列表）、it.apply（可一键执行的调整）
 */
function concretizeItem(it, entries, legs, sun, mode, profile) {
  const p = entries[it.index];
  if (!p || it.severity === 'ok') return it;
  const dep = entries[0] ? entries[0].minute : 0;
  const hm = minToHM;
  const MIN_DEP = 8 * 60 + 30;   // 08:30：不早于这个时间出发

  const sunsetOf = (i) => {
    const v = sun && sun[i] ? hmToMin(sun[i].sunset) : null;
    return v == null ? 18 * 60 + 30 : v;
  };
  const latestOf = (i) => sunsetOf(i) - 60;   // 天黑前 1 小时

  const cumNeed = (pointIdx) => {
    if (pointIdx == null || pointIdx <= 0) return 0;
    return (legs || []).slice(0, pointIdx).reduce((s2, L) => s2 + L.needed, 0);
  };

  if (it.tag === '天气不适合' || it.tag === '天气偏弱' || it.tag === '天气一般') {
    // 可出行窗口：09:00 – 日落前 1 小时（按整点时段给出，天然不早于 08:30）
    const hiH = Math.min(20, Math.floor(latestOf(it.index) / 60));
    let wins = goodWindowsOf(p, 9, hiH, 80);
    if (!wins.length) wins = goodWindowsOf(p, 9, hiH, Math.max(60, p.score + 5));

    const picks = wins.slice()
      .sort((a, b) => Math.abs(a.start * 60 - p.minute) - Math.abs(b.start * 60 - p.minute))
      .slice(0, 3)
      .sort((a, b) => a.start - b.start);

    if (picks.length) {
      it.actions = ['可选的到达时段：' + picks.map(fmtWindow).join('、')];
      it.applies = [];
      const target = picks[0].start * 60;
      if (p.pointIdx != null && p.pointIdx >= 0) {
        it.applies.push({
          type: 'setTime', index: p.pointIdx, minute: target,
          label: '把「' + p.name + '」到达时刻改到 ' + hm(target),
        });
      }
      const diff = target - p.minute;
      if (Math.abs(diff) >= 5) {
        const newDep = dep + diff;
        if (newDep >= MIN_DEP) {
          it.applies.push({
            type: 'shiftAll', delta: diff,
            label: '整体' + (diff > 0 ? '推迟' : '提前') + ' ' + Math.abs(diff) + ' 分钟出发（'
              + hm(dep) + ' → ' + hm(newDep) + '）',
          });
        } else if (dep < MIN_DEP) {
          it.applies.push({
            type: 'shiftAll', delta: MIN_DEP - dep,
            label: '把出发时间调整到 ' + hm(MIN_DEP),
          });
        }
      }
    } else {
      it.actions = ['本日 08:30–' + hm(latestOf(it.index)) + ' 没有更合适的时段，建议改期'];
    }
  }

  if (it.tag === '时间过紧') {
    const L = legs[it.legIndex != null ? it.legIndex : it.index - 1];
    const dest = entries[it.index];
    if (L && dest) {
      const dep2 = Math.max(dep, MIN_DEP);
      const arrive = dep2 + Math.round(L.needed);
      const target = arrive + 10;
      const latest = latestOf(it.index);
      it.actions = [
        '这段车程约 ' + Math.round(L.needed) + ' 分钟，你只安排了 ' + Math.round(L.planned) + ' 分钟',
      ];
      it.applies = [];
      if (target > latest) {
        it.actions.push('按 ' + hm(dep2) + ' 出发也要 ' + hm(arrive) + ' 才到，已晚于 ' + hm(latest) + '，建议缩短行程或改期');
      } else {
        it.actions.push('按 ' + hm(dep2) + ' 出发，约 ' + hm(arrive) + ' 到达；建议把到达时刻设为 ' + hm(target) + '（含 10 分钟余量）');
        if (dest.pointIdx != null && dest.pointIdx >= 0) {
          it.applies.push({
            type: 'setTime', index: dest.pointIdx, minute: target,
            label: '把「' + dest.name + '」到达时刻设为 ' + hm(target),
          });
        }
        if (dep2 > dep) {
          it.applies.push({
            type: 'shiftAll', delta: dep2 - dep,
            label: '把出发时间调整到 ' + hm(dep2),
          });
        }
      }
    }
  }

  if (it.tag === '天黑风险') {
    const latest = latestOf(it.index);
    const need = Math.max(0, p.minute - latest);
    if (need > 0) {
      const canShift = dep - need >= MIN_DEP;
      it.actions = [
        '最晚 ' + hm(latest) + ' 前通过（日落 ' + sun[it.index].sunset + ' 前 60 分钟）',
      ];
      it.applies = [];
      if (canShift) {
        it.actions.push('可以整体提前 ' + need + ' 分钟出发（' + hm(dep) + ' → ' + hm(dep - need) + '）');
        it.applies.push({
          type: 'shiftAll', delta: -need,
          label: '整体提前 ' + need + ' 分钟出发（' + hm(dep) + ' → ' + hm(dep - need) + '）',
        });
      } else {
        it.actions.push('按 ' + hm(MIN_DEP) + ' 出发仍会晚 ' + Math.round(p.minute - (MIN_DEP + (p.minute - dep))) + ' 分钟，建议缩短行程或改期');
      }
    }
  }

  if (it.tag === '高海拔午后') {
    const target = 10 * 60 + 30;
    const delta = Math.max(0, p.minute - target);
    it.actions = ['把「' + p.name + '」调整到 10:30 前通过（当前 ' + p.timeLabel + '）'];
    it.applies = [];
    if (p.pointIdx != null && p.pointIdx >= 0 && delta > 0) {
      it.applies.push({ type: 'setTime', index: p.pointIdx, minute: target,
        label: '把「' + p.name + '」改到 10:30' });
    }
    if (delta > 0 && dep - delta >= MIN_DEP) {
      it.applies.push({ type: 'shiftAll', delta: -delta,
        label: '整体提前 ' + delta + ' 分钟出发（' + hm(dep) + ' → ' + hm(dep - delta) + '）' });
    }
  }

  if (it.tag === '全程降雨') {
    it.actions = [
      '本日整条路线都在降雨中，建议改期（换到预报转好的日期）',
      '若必须当天走，把出发时间安排在 08:30 之后、并在午后雷雨前通过主要路段',
    ];
  }

  return it;
}

function diagnosePlan(entries, legs, sun, mode, profile) {
  const items = [];

  // 沿途采样点很多时只保留每段最差的一个，避免报告被淹没
  const legWorst = {};
  entries.forEach((p, i) => {
    if (p.kind !== 'leg') return;
    const k = p.legIndex;
    if (legWorst[k] == null || p.score < entries[legWorst[k]].score) legWorst[k] = i;
  });

  entries.forEach((p, i) => {
    // 沿途采样点：每段只报告最差的那一个
    if (p.kind === 'leg' && legWorst[p.legIndex] !== i) return;

    // R1 单点天气
    if (p.score < 40) {
      items.push({
        severity: 'block', index: i, tag: '天气不适合',
        title: p.name + '（' + p.timeLabel + '）天气不适合停留',
        evidence: p.weatherText + '，降水概率 ' + (p.pp == null ? '—' : Math.round(p.pp) + '%')
          + '，气温 ' + (p.temp == null ? '—' : p.temp.toFixed(1) + '℃'),
        impact: '在这个时刻经过或停留，体验差、风险高',
        advice: '把这一段提前或推迟到评分 ≥60 的时段；若终点就是这个时刻，建议改期',
      });
    } else if (p.score < 60) {
      items.push({
        severity: 'warn', index: i, tag: '天气偏弱',
        title: p.name + '（' + p.timeLabel + '）天气条件一般',
        evidence: p.weatherText + '，降水概率 ' + (p.pp == null ? '—' : Math.round(p.pp) + '%')
          + '，风速 ' + (p.wind == null ? '—' : Math.round(p.wind) + ' km/h'),
        impact: '可以通过，但这一段的体验和余量都会打折',
        advice: '如果时间能挪动，优先把这一段换到评分更高的相邻小时',
      });
    } else if (p.score < 80) {
      items.push({
        severity: 'warn', index: i, tag: '天气一般',
        title: p.name + '（' + p.timeLabel + '）天气一般',
        evidence: p.weatherText + '，降水概率 ' + (p.pp == null ? '—' : Math.round(p.pp) + '%')
          + '，风速 ' + (p.wind == null ? '—' : Math.round(p.wind) + ' km/h'),
        impact: '这一段是全程最低分，会把整条路线的评分拉到 ' + p.score,
        advice: '把这一段挪到当天评分更高的时段',
      });
    }

    // R2 高海拔 + 午后
    if (p.elev != null && p.elev > 2500 && p.hour >= 12 && p.hour <= 18 &&
        (wmoSev(p.code) >= 20 || (p.pp != null && p.pp >= 60))) {
      items.push({
        severity: 'warn', index: i, tag: '高海拔午后',
        title: p.name + '（' + p.timeLabel + '）高海拔 + 午后',
        evidence: '海拔 ' + p.elev + ' m，' + p.weatherText
          + '，降水概率 ' + (p.pp == null ? '—' : Math.round(p.pp) + '%'),
        impact: '午后是山区雷暴与阵雨的高发时段，高海拔处风大、体感更差',
        advice: '把这一段调整到 11:00 前通过；无法调整时，缩短停留时间、不在山脊久留',
      });
    }

    // R4 天黑前未通过
    const sunset = sun && sun[i] ? sun[i].sunset : null;
    const sm = hmToMin(sunset);
    const modMin = ((p.minute % 1440) + 1440) % 1440;   // 跨天时只看当天时刻
    if (sm != null && modMin > sm - 60) {
      items.push({
        severity: 'warn', index: i, tag: '天黑风险',
        title: p.name + '（' + p.timeLabel + '）接近或晚于日落',
        evidence: '当天日落 ' + sunset + '，你的到达时刻 ' + p.timeLabel,
        impact: '天黑后山路能见度低、气温骤降，一旦出问题救援难度明显上升',
        advice: '调整到 ' + minToHM(sm - 60) + ' 前通过，或把这一段整体提到上午',
      });
    }
  });

  // R3 时间安排过紧（留 5 分钟估算容差，避免 1–2 分钟的误差也报警）
  const SLACK = 5;
  legs.forEach((L, i) => {
    if (L.planned > 0 && L.planned + SLACK < L.needed) {
      const short = Math.round(L.needed - L.planned);
      const severe = L.planned < L.needed * 0.6;
      items.push({
        severity: severe ? 'block' : 'warn', index: entryIndexByPoint(entries, i + 1), legIndex: i, tag: '时间过紧',
        title: L.from + ' → ' + L.to + ' 时间不够',
        evidence: '约 ' + L.km.toFixed(0) + ' km，按 ' + (PLAN_SPEED[mode] || 40) + ' km/h 需 '
          + Math.round(L.needed) + ' 分钟；你只留了 ' + Math.round(L.planned) + ' 分钟',
        impact: '至少缺 ' + short + ' 分钟，实际会一路赶，没有停留和会车余量',
        advice: '把「' + L.to + '」至少推迟 ' + (short + 10) + ' 分钟，或缩短这一段',
      });
    }
  });

  // R5 连续点位都在降雨
  const rainRuns = [];
  let run = [];
  entries.forEach((p, i) => {
    const rainy = p.precip != null && p.precip > 0 && p.score < 60;
    if (rainy) run.push(i);
    else { if (run.length >= 2) rainRuns.push(run.slice()); run = []; }
  });
  if (run.length >= 2) rainRuns.push(run.slice());
  rainRuns.forEach(idxs => {
    items.push({
      severity: 'block', index: idxs[0], tag: '全程降雨',
      title: idxs.length + ' 个连续点位都在降雨中',
      evidence: idxs.map(i => entries[i].name + ' ' + entries[i].timeLabel
        + '（' + Math.round(entries[i].pp == null ? 0 : entries[i].pp) + '%）').join('、'),
      impact: '整段行程都处在降雨里，属于"换时间也难解决"的情况',
      advice: '建议整体改期；必须走时，压缩为最短路线并避开高海拔段',
    });
  });

  // R6 单段车程过长（>6 小时）：建议拆分途经点
  legs.forEach((L, i) => {
    if (L && L.needed > 360) {
      const hrs = (L.needed / 60).toFixed(1);
      items.push({
        severity: L.needed > 720 ? 'block' : 'warn',
        index: entryIndexByPoint(entries, i + 1),
        legIndex: i, tag: '单段过长',
        title: L.from + ' → ' + L.to + ' 车程约 ' + hrs + ' 小时',
        evidence: '约 ' + Math.round(L.km) + ' km，按 ' + (PLAN_SPEED[mode] || 40) + ' km/h 估算',
        impact: '单段超过 6 小时，途中休息、加油、突发状况都没有余量，且会跨天',
        advice: '在这两点的中间再加 1–2 个途经点，把行程拆成半天以内的段落',
      });
    }
  });

  // R7 夜间到达（凌晨 0–6 点 / 22 点以后）
  entries.forEach((p, i) => {
    const hh = ((p.minute % 1440) + 1440) % 1440 / 60;
    if (hh < 6 || hh >= 22) {
      items.push({
        severity: 'warn', index: i, tag: '夜间到达',
        title: p.name + '（' + p.timeLabel + '）夜间到达',
        evidence: '按你安排的时间推算，到达时约 ' + p.timeLabel,
        impact: '夜间山路能见度低、气温低，事故与迷路风险明显上升',
        advice: '把这一段调整到 08:30–日落前 1 小时之间；做不到就缩短行程或改期',
      });
    }
  });

  // 合理项（最多 3 条）
  entries.forEach((p, i) => {
    if (p.score >= 80) {
      items.push({
        severity: 'ok', index: i, tag: '合理安排',
        title: p.name + '（' + p.timeLabel + '）安排合理',
        evidence: p.weatherText + (p.temp == null ? '' : '，' + p.temp.toFixed(1) + '℃') + '，评分 ' + p.score,
        impact: '', advice: '',
      });
    }
  });

  // 把每条诊断变成可执行措施 + 具体时间
  items.forEach(it => concretizeItem(it, entries, legs, sun, mode, profile));

  // 排序：阻断 → 建议 → 合理；同类按点位顺序
  const order = { block: 0, warn: 1, ok: 2 };
  items.sort((a, b) => (order[a.severity] - order[b.severity]) || (a.index - b.index));

  const okItems = items.filter(x => x.severity === 'ok');
  const trimmed = items.filter(x => x.severity !== 'ok').concat(okItems.slice(0, 3));

  const blockCount = trimmed.filter(x => x.severity === 'block').length;
  const warnCount = trimmed.filter(x => x.severity === 'warn').length;

  return {
    items: trimmed,
    blockCount,
    warnCount,
    summary: blockCount ? 'block' : (warnCount ? 'warn' : 'ok'),
  };
}

/** 规划模式的"出行准备"清单 */
function buildPlanAdvice(entries, legs, diagnosis, profile) {
  const out = [];
  if (diagnosis.blockCount) out.push('先解决上面标红的阻断项，再决定是否出发');
  else if (diagnosis.warnCount) out.push('整体可行，但按上面的建议把时间微调一下会更稳');

  const withElev = entries.filter(e => e.elev != null);
  const maxElev = withElev.length ? Math.max.apply(null, withElev.map(e => e.elev)) : null;
  const temps = entries.filter(e => e.temp != null).map(e => e.temp);
  const minTemp = temps.length ? Math.min.apply(null, temps) : null;
  const winds = entries.filter(e => e.wind != null).map(e => e.wind);
  const maxWind = winds.length ? Math.max.apply(null, winds) : null;
  const maxPP = Math.max.apply(null, entries.map(e => e.pp == null ? 0 : e.pp));

  if (maxPP >= 50) out.push('带雨具，山路湿滑，下坡和弯道减速');
  if (maxElev != null && maxElev > 2500) out.push('最高海拔约 ' + Math.round(maxElev) + ' m，带保暖层，注意高反');
  if (minTemp != null && minTemp < 5) out.push('最低气温约 ' + minTemp.toFixed(0) + '℃，注意防寒与结冰');
  if (maxWind != null && maxWind >= 30) out.push('部分点位风速较大（约 ' + Math.round(maxWind) + ' km/h），山脊段注意防风');
  const tight = legs.filter(L => L.planned > 0 && L.planned + 5 < L.needed).length;
  if (tight) out.push('有 ' + tight + ' 段安排偏紧，建议每段再留 20–30 分钟余量');
  if (!out.length) out.push('天气与时间安排都没有明显问题，按计划出发即可');

  out.push('以上仅为基于公开预报的参考，不构成安全保证');
  return out;
}

/* ---------------- 导出（供 node 测试） ---------------- */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { scoreHour, levelOf, analyze, analyzeNavigation, analyzePlan, analyzePlanRoute,
    buildPlanSamples, buildProfile, diagnosePlan, concretizeItem, bestHourOf,
    combineRouteScore, goodWindowsOf, fmtWindow,
    findBestDeparture, departureMatrix, scoreAtDeparture, diagnoseNav, planLeg, minToHM, minToLabel, hourAtMinute, hmToMin,
    wmoText, wmoIcon, WMO };
}
