/* ============================================================
 * 规划模式测试（离线、合成数据、可复现）
 * 用法: node test/plan-test.js
 * 覆盖：按点取时刻 / 五条诊断规则 / 分数与最差点 / 边界
 * ============================================================ */

const path = require('path');
const { analyzePlan, analyzePlanRoute, buildPlanSamples, buildProfile, diagnosePlan, planLeg, minToHM, hmToMin, combineRouteScore, goodWindowsOf, fmtWindow } = require(path.join(__dirname, '..', 'js', 'scoring.js'));

const p2 = n => String(n).padStart(2, '0');

const GOOD = { temp: 20, pp: 5, precip: 0, wind: 5, code: 1 };
const BAD = { temp: 2, pp: 95, precip: 6, wind: 55, code: 95 };
const MID = { temp: 10, pp: 55, precip: 1, wind: 25, code: 61 };

function mk(name, lat, lon, fn) {
  const hours = [];
  for (let h = 0; h < 24; h++) {
    const w = fn(h);
    hours.push({
      time: '2026-10-19T' + p2(h) + ':00', hour: h,
      temp: w.temp, appTemp: w.temp, pp: w.pp, precip: w.precip,
      wind: w.wind, dir: 0, code: w.code,
    });
  }
  return { name, lat, lon, hours };
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  (' + extra + ')' : '')); }
}

const PTS = [
  { name: '雅安', lat: 29.9853, lon: 102.9998 },
  { name: '天全', lat: 30.0700, lon: 102.7630 },
  { name: '泸定', lat: 29.9144, lon: 102.2344 },
];
const SUN = [{ sunrise: '06:30', sunset: '18:30' }, { sunrise: '06:32', sunset: '18:28' }, { sunrise: '06:35', sunset: '18:25' }];

console.log('\n【用例1】三个点全晴 → 全部 100 分，无问题');
{
  const series = [mk('雅安', 29.98, 103.0, () => GOOD), mk('天全', 30.07, 102.76, () => GOOD), mk('泸定', 29.91, 102.23, () => GOOD)];
  const r = analyzePlan(series, [600, 800, 1300], PTS, [480, 570, 690], SUN, '2026-10-19', 'drive');
  ok('非空', !!r);
  ok('路线分 = 100', r.routeScore === 100, r.routeScore);
  ok('诊断摘要 ok', r.diagnosis.summary === 'ok', r.diagnosis.summary);
  ok('时间标签正确', r.points[0].timeLabel === '08:00' && r.points[2].timeLabel === '11:30', r.points[0].timeLabel + '/' + r.points[2].timeLabel);
  ok('无阻断项', r.diagnosis.blockCount === 0);
}

console.log('\n【用例2】中间点 14:00 暴雨，其余时间晴 → 应命中该点且为阻断');
{
  const series = [mk('雅安', 29.98, 103.0, () => GOOD), mk('天全', 30.07, 102.76, h => (h === 14 ? BAD : GOOD)), mk('泸定', 29.91, 102.23, () => GOOD)];
  const r = analyzePlan(series, [600, 800, 1300], PTS, [480, 840, 960], SUN, '2026-10-19', 'drive');
  ok('最差点是第 2 个点', r.worstIndex === 1, r.worstIndex);
  ok('路线分被最差段封顶（<60）', r.routeScore < 60, r.routeScore);
  const hit = r.diagnosis.items.find(x => x.severity === 'block' && x.title.indexOf('天全') >= 0);
  ok('命中「天气不适合」', !!hit, JSON.stringify(r.diagnosis.items.map(x => x.title)));
  ok('有证据与建议', !!hit && !!hit.evidence && !!hit.advice);
}

console.log('\n【用例3】同一条数据，把时间改到 09:00 → 应恢复 100 分（证明按点取时刻）');
{
  const series = [mk('雅安', 29.98, 103.0, () => GOOD), mk('天全', 30.07, 102.76, h => (h === 14 ? BAD : GOOD)), mk('泸定', 29.91, 102.23, () => GOOD)];
  const r = analyzePlan(series, [600, 800, 1300], PTS, [480, 540, 660], SUN, '2026-10-19', 'drive');
  ok('路线分回到 100', r.routeScore === 100, r.routeScore);
  ok('摘要 ok', r.diagnosis.summary === 'ok', r.diagnosis.summary);
}

console.log('\n【用例4】两点相距约 111 km，只留 30 分钟 → 时间过紧');
{
  const far = [{ name: 'A', lat: 30.0, lon: 103.0 }, { name: 'B', lat: 31.0, lon: 103.0 }];
  const series = [mk('A', 30, 103, () => GOOD), mk('B', 31, 103, () => GOOD)];
  const r = analyzePlan(series, [500, 1500], far, [480, 510], [{ sunset: '18:30' }, { sunset: '18:30' }], '2026-10-19', 'drive');
  const hit = r.diagnosis.items.find(x => x.tag === '时间过紧');
  ok('命中「时间过紧」', !!hit);
  ok('严重度为 block（缺口 > 50%）', !!hit && hit.severity === 'block', hit && hit.severity);
  ok('leg 计算距离合理（>100km）', r.legs[0].km > 100, r.legs[0].km.toFixed(0));
}

console.log('\n【用例5】18:00 到达、日落 18:30 → 天黑风险');
{
  const series = [mk('A', 30, 103, () => GOOD), mk('B', 30.1, 103.1, () => GOOD)];
  const r = analyzePlan(series, [500, 600], PTS.slice(0, 2), [600, 1080], [{ sunset: '18:30' }, { sunrise: '06:30', sunset: '18:30' }], '2026-10-19', 'drive');
  ok('命中「天黑风险」', r.diagnosis.items.some(x => x.tag === '天黑风险'));
}

console.log('\n【用例6】海拔 3000 m + 14:00 + 雷暴 → 高海拔午后');
{
  const series = [mk('A', 30, 103, () => GOOD), mk('B', 30.1, 103.1, h => (h === 14 ? BAD : GOOD))];
  const r = analyzePlan(series, [500, 3000], PTS.slice(0, 2), [600, 840], [{ sunset: '18:30' }, { sunset: '18:30' }], '2026-10-19', 'drive');
  ok('命中「高海拔午后」', r.diagnosis.items.some(x => x.tag === '高海拔午后'));
}

console.log('\n【用例7】两个连续点位都在雨中 → 全程降雨');
{
  const series = [mk('A', 30, 103, () => BAD), mk('B', 30.1, 103.1, () => BAD)];
  const r = analyzePlan(series, [500, 600], PTS.slice(0, 2), [600, 660], [{ sunset: '18:30' }, { sunset: '18:30' }], '2026-10-19', 'drive');
  ok('命中「全程降雨」', r.diagnosis.items.some(x => x.tag === '全程降雨'));
  ok('摘要为 block', r.diagnosis.summary === 'block');
}

console.log('\n【用例8】边界：空数据 / 时间换算 / 点间计算');
{
  ok('空 series → null', analyzePlan([], [], [], [], [], '2026-10-19', 'drive') === null);
  ok('minToHM(480) = 08:00', minToHM(480) === '08:00', minToHM(480));
  ok('hmToMin(08:00) = 480', hmToMin('08:00') === 480, hmToMin('08:00'));
  const L = planLeg({ lat: 30, lon: 103 }, { lat: 30.1, lon: 103 }, 'drive');
  ok('planLeg 距离 > 10 km', L.km > 10, L.km.toFixed(1));
  ok('planLeg 耗时 > 0', L.minutes > 0);
}


console.log('\n【用例9】沿途采样：点数、时间、上限');
{
  const t = [480, 600, 780];
  const b = buildPlanSamples(PTS, t, 'drive', 20);
  ok('采样数 > 点位数的（有沿途点）', b.samples.length > 3, b.samples.length);
  ok('采样总数不超过上限 20', b.samples.length <= 20, b.samples.length);
  ok('包含沿途点（kind=leg）', b.samples.some(s => s.kind === 'leg'));
  ok('起点时间 = 用户设定', b.samples[0].minute === 480);
  const last = b.samples[b.samples.length - 1];
  ok('终点时间 = 用户设定', last.minute === 780, last.minute);
  const mins = b.samples.map(s => s.minute);
  ok('时间单调不减', mins.every((m, i) => i === 0 || m >= mins[i - 1]));
  const kms = b.samples.map(s => s.cumKm);
  ok('里程单调不减', kms.every((k, i) => i === 0 || k >= kms[i - 1]));
  const zero = buildPlanSamples(PTS, t, 'drive', 3);
  ok('maxTotal=点位数时不插沿途点', zero.samples.every(s => s.kind === 'point'), zero.samples.length);
}

console.log('\n【用例10】沿途采样进入路线分：中间路段下雨会被拉低');
{
  const t = [480, 600, 780];
  const b = buildPlanSamples(PTS, t, 'drive', 20);
  const series = b.samples.map((s, i) => mk(s.name, s.lat, s.lon, h => (s.kind === 'leg' && h === 10 ? BAD : GOOD)));
  const elevs = b.samples.map((s, i) => 800 + i * 10);
  const r = analyzePlanRoute({ series, elevations: elevs, samples: b.samples, legs: b.legs, sun: SUN, dateStr: '2026-10-19', mode: 'drive' });
  ok('路线分被沿途点拉低（<100）', r.routeScore < 100, r.routeScore);
  ok('最差点是沿途点或对应点位', r.points[r.worstIndex].kind === 'leg', r.points[r.worstIndex].kind);
  ok('报告含沿途条目', r.diagnosis.items.some(x => /沿途|K\\d/.test(x.title) || x.tag === '全程降雨' || x.tag === '天气不适合'));
}

console.log('\n【用例11】高程剖面：累计爬升/下降与陡坡提醒');
{
  const pts = [{ name: 'A', lat: 30, lon: 103 }, { name: 'B', lat: 30.15, lon: 103 }];
  const b = buildPlanSamples(pts, [480, 600], 'drive', 8);
  const n = b.samples.length;
  const series = b.samples.map(s => mk(s.name, s.lat, s.lon, () => GOOD));
  const elevs = b.samples.map((s, i) => 500 + (1000 * i) / (n - 1));   // 500 → 1500 m
  const r = analyzePlanRoute({ series, elevations: elevs, samples: b.samples, legs: b.legs, sun: [{ sunset: '18:30' }, { sunset: '18:30' }], dateStr: '2026-10-19', mode: 'drive' });
  ok('累计爬升约 1000 m', Math.abs(r.profile.climb - 1000) <= 30, r.profile.climb);
  ok('最高海拔 1500 m', Math.round(r.profile.maxElev) === 1500, r.profile.maxElev);
  ok('不再输出地形类诊断（只做天气规划）', !r.diagnosis.items.some(x => ['连续爬升', '长下坡', '高海拔'].includes(x.tag)));
  const p = buildProfile([
    { name: 'x', lat: 30, lon: 103, elev: 2000 },
    { name: 'y', lat: 30.1, lon: 103, elev: 1200 },
  ]);
  ok('buildProfile 计算下降 800 m', p.descent === 800, p.descent);
}

console.log('\n【用例12】点位 63 分（一般）→ 应出「天气一般」建议，且不再标为合理');
{
  const series = [mk('A', 30, 103, () => GOOD), mk('B', 30.1, 103.1, h => (h === 14 ? GOOD : MID))];
  const r = analyzePlan(series, [500, 600], PTS.slice(0, 2), [480, 540], [{ sunset: '18:30' }, { sunset: '18:30' }], '2026-10-19', 'drive');
  ok('B 点分数在 60–79', r.points[1].score >= 60 && r.points[1].score < 80, r.points[1].score);
  ok('出现「天气一般」条目', r.diagnosis.items.some(x => x.tag === '天气一般'));
  ok('该点不再标为合理安排', !r.diagnosis.items.some(x => x.severity === 'ok' && x.index === 1));
  ok('摘要为 warn', r.diagnosis.summary === 'warn', r.diagnosis.summary);
  const it = r.diagnosis.items.find(x => x.tag === '天气一般');
  ok('有具体措施', !!(it && it.actions && it.actions.length));
  ok('给出可选时段', !!(it && it.actions.some(a => a.indexOf('可选') >= 0)));
  ok('不再出现按车程倒推', !!(it && it.actions.every(a => a.indexOf('从起点出发') < 0)));
}

console.log('\n【用例13】综合分公式与可选时段');
{
  const c1 = combineRouteScore([100, 100, 100, 72]);
  ok('一处 72 不再把总分拉到 72（应约 87）', c1.score >= 84 && c1.score <= 92, c1.score);
  const c2 = combineRouteScore([100, 35]);
  ok('最差段 <60 时封顶 79', c2.score <= 79, c2.score);
  const c3 = combineRouteScore([100, 100, 100]);
  ok('全好仍为 100', c3.score === 100, c3.score);
  const w = goodWindowsOf({ hourly: [
    { hour: 8, score: 90 }, { hour: 9, score: 92 }, { hour: 10, score: 70 },
    { hour: 11, score: 85 }, { hour: 12, score: 86 } ] }, 8, 20, 80);
  ok('时段合并为 2 段', w.length === 2, JSON.stringify(w));
  ok('时段格式化正确', fmtWindow(w[0]) === '08:00–10:00', fmtWindow(w[0]));
}
console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);