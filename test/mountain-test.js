const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync('js/mountain.js', 'utf8') + '\nthis.m = MountainAnalysis;', ctx);
const m = ctx.m;
assert.strictEqual(m.profile([{elev:null},{elev:null}]), null);
const partial = m.profile([{elev:100},{elev:null},{elev:300}]);
assert.strictEqual(partial.climb, null);
const full = m.profile([{elev:100},{elev:110},{elev:140},{elev:190},{elev:155}]);
assert.strictEqual(full.climb, 90);
assert.strictEqual(full.descent, 35);
assert.strictEqual(full.best.gain, 90);
assert.strictEqual(m.reasons({elev: 2100,temp: -1, gust: 51,precip: 3,visibility: 800, score: 100}).length, 4);
assert.strictEqual(m.reasons({elev: null,temp: -1,gust: null,precip: null,visibility: null,score:100}).length, 0);
assert.strictEqual(m.reasons({elev: 100,temp: 15,wind: 3,score: 100}).length, 0);
console.log('PASS: elevation gaps, noise filter, ascent and weather thresholds');
const scoring = require('../js/scoring.js');
const makeSeries = () => ({
  sunDays: {
    '2026-11-04': { sunrise: '2026-11-04T07:00', sunset: '2026-11-04T18:00' },
    '2026-11-05': { sunrise: '2026-11-05T07:10', sunset: '2026-11-05T17:50' },
  },
  hours: Array.from({ length: 48 }, (_, i) => ({ time: `2026-11-${i < 24 ? '04' : '05'}T${String(i % 24).padStart(2,'0')}:00`, hour: i % 24, temp: 6, precip: 0, wind: 5, gust: i, visibility: 10000, code: 0 }))
});
const samples = [{ name:'A', ratio:0, cumKm:0 }, { name:'B', ratio:1, cumKm:20 }];
const atNight = scoring.scoreAtDeparture(samples, [makeSeries(), makeSeries()], [2000,2200], 2*3600, 23);
assert.strictEqual(atNight.entries[1].sun.sunrise, '2026-11-05T07:10');
assert.ok(m.reasons(atNight.entries[1]).some(s => s.includes('夜间')));
assert.ok(!m.reasons({...atNight.entries[1],sun:null}).some(s => s.includes('夜间')));
const atDay = scoring.scoreAtDeparture(samples, [makeSeries(), makeSeries()], [2000,2200], 2*3600, 8);
assert.ok(!m.reasons(atDay.entries[1]).some(s => s.includes('夜间')));
assert.strictEqual(m.conditions(atDay.entries).maxGust, 10);
assert.strictEqual(m.conditions(atNight.entries).maxGust, 25);
console.log('PASS: arrival-day sunrise/sunset and departure-dependent mountain weather');
const goodHour = {pp:0,precip:0,wind:5,temp:18,code:0};
const goodScore = scoring.scoreHour(goodHour, 100).score;
assert.strictEqual(scoring.scoreHour({...goodHour,gust:55},100).score, goodScore-12);
assert.strictEqual(scoring.scoreHour({...goodHour,visibility:500},100).score, goodScore-10);
assert.strictEqual(scoring.scoreHour({...goodHour,wind:45,gust:55},100).score, scoring.scoreHour({...goodHour,wind:45},100).score);
console.log('PASS: gust and visibility adjust existing score without double-counting wind');
const appContext = vm.createContext({ todayStr: () => "2026-11-04", console, setTimeout, clearTimeout, window: {}, document: {addEventListener(){}, querySelector(){return null}, querySelectorAll(){return []}} });
vm.runInContext(fs.readFileSync('js/mountain.js','utf8') + '\n' + fs.readFileSync('js/scoring.js','utf8') + '\n' + fs.readFileSync('js/app.js','utf8'), appContext);
const samplesForMarkup = [
  {name:'A',cumKm:0,elev:1200,temp:16,score:100,weatherText:'晴',minute:480},
  {name:'B',cumKm:10,elev:null,temp:4,score:90,weatherText:'晴',minute:540},
  {name:'C',cumKm:30,elev:2500,temp:1,score:80,weatherText:'阴',minute:600},
];
const chart = appContext.elevationProfileHtml(samplesForMarkup);
assert.ok(chart.includes('数据不足'));
assert.ok(chart.includes('30 km'));
assert.strictEqual((chart.match(/data-mountain-sample=/g)||[]).length, 2);
assert.ok(!chart.includes('NaN'));
assert.ok(appContext.mountainDiagnosisHtml(samplesForMarkup).includes('20.0–30.0 km'));
console.log('PASS: missing elevations do not create chart points; diagnostic range uses route distance');
