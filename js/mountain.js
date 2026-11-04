/* Mountain analysis uses the same ETA-matched samples and scores as the report. */
const MountainAnalysis = (() => {
  const RULES = Object.freeze({ altitude: 2000, cold: 3, freezing: 0, gust: 50, rain: 2.5, visibility: 1000, noise: 20, nightAltitude: 1500, longClimb: 300 });
  const valid = n => n !== null && n !== undefined && Number.isFinite(Number(n));
  function profile(points) {
    const p = points || [];
    const available = p.filter(x => valid(x.elev));
    if (available.length < 2) return null;
    const complete = available.length === p.length;
    let climb = 0, descent = 0, anchor = Number(p[0].elev), runStart = 0, runGain = 0, best = null;
    if (complete) for (let i = 1; i < p.length; i++) {
      const delta = Number(p[i].elev) - anchor;
      if (Math.abs(delta) < RULES.noise) continue;
      if (delta > 0) { climb += delta; runGain += delta; }
      else { descent -= delta; if (!best || runGain > best.gain) best = { start: runStart, end: i - 1, gain: runGain }; runStart = i; runGain = 0; }
      anchor = Number(p[i].elev);
    }
    if (complete && (!best || runGain > best.gain)) best = { start: runStart, end: p.length - 1, gain: runGain };
    return { min: Math.min(...available.map(x => Number(x.elev))), max: Math.max(...available.map(x => Number(x.elev))), climb: complete ? climb : null, descent: complete ? descent : null, best: complete && best && best.gain > 0 ? best : null, complete };
  }
  function reasons(p) {
    const r = [];
    if (valid(p.elev) && Number(p.elev) >= RULES.altitude && valid(p.temp) && Number(p.temp) <= RULES.cold) r.push(Number(p.temp) <= RULES.freezing ? '高海拔低温，潮湿路面可能结冰' : '高海拔低温，注意保暖');
    if (valid(p.gust) && Number(p.gust) >= RULES.gust) r.push(`阵风约 ${Math.round(p.gust)} km/h，注意横风`);
    if (valid(p.precip) && Number(p.precip) >= RULES.rain) r.push(`降水约 ${Number(p.precip).toFixed(1)} mm/h，注意路面湿滑`);
    if (valid(p.visibility) && Number(p.visibility) < RULES.visibility) r.push(`能见度约 ${Math.round(p.visibility)} m，减速并保持车距`);
    if (valid(p.elev) && Number(p.elev) >= RULES.nightAltitude && p.sun && p.sun.sunrise && p.sun.sunset && p.forecastTime) {
      const t = String(p.forecastTime).slice(11, 16);
      const actual = valid(p.minute) ? Number(p.minute) : valid(p.arriveAbs) ? Math.round(Number(p.arriveAbs) * 60) : null;
      const clock = actual == null ? t : String(Math.floor((actual % 1440 + 1440) % 1440 / 60)).padStart(2, '0') + ':' + String((actual % 60 + 60) % 60).padStart(2, '0');
      if (clock < p.sun.sunrise.slice(11, 16) || clock >= p.sun.sunset.slice(11, 16)) r.push('预计夜间经过高海拔路段，注意照明和视距');
    }
    if (!r.length && valid(p.score) && Number(p.score) < 80) r.push('该时段天气评分较低，请查看点位详情');
    return r;
  }
  function conditions(points) {
    const p = points || [], high = p.filter(x => valid(x.elev) && Number(x.elev) >= RULES.altitude);
    const max = (arr, key) => { const vals = arr.filter(x => valid(x[key])).map(x => Number(x[key])); return vals.length ? Math.max(...vals) : null; };
    const min = (arr, key) => { const vals = arr.filter(x => valid(x[key])).map(x => Number(x[key])); return vals.length ? Math.min(...vals) : null; };
    return { maxRain: max(p, 'precip'), maxGust: max(p, 'gust'), minTemp: min(p, 'temp'), minVisibility: min(p, 'visibility'), highMinTemp: min(high, 'temp'), flagged: p.filter(x => reasons(x).length).length };
  }
  return { RULES, profile, reasons, conditions, valid };
})();
