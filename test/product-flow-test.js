/* Product regressions: execute the real app functions with DOM/network boundaries stubbed. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const POI = require('../js/poi.js');
const { minToHM } = require('../js/scoring.js');

function app() {
  const nodes = {};
  const context = {
    console, setTimeout, clearTimeout, Promise, URL,
    window: { innerWidth: 390, scrollTo() {} },
    document: { querySelector: s => nodes[s] || null, querySelectorAll: () => [], addEventListener() {} },
    RoutePois: { ...POI }, minToHM, todayStr: () => '2026-11-04',
    addDays: (date, offset) => new Date(new Date(date + 'T00:00:00Z').getTime() + offset * 86400000).toISOString().slice(0, 10),
    Option: function (text, value) { this.text = text; this.value = value; },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8') + '\nglobalThis.appState = state;', context);
  return { context, state: context.appState, nodes };
}
const points = [
  { name: '起点', lat: 30, lon: 103 },
  { name: '途经点', lat: 30.1, lon: 103.1 },
  { name: '终点', lat: 30.2, lon: 103.2 },
];
const hrefs = markup => [...markup.matchAll(/href="([^"]+)"/g)].map(m => new URL(m[1]));
const countCards = markup => (markup.match(/<article class="poi-card /g) || []).length;

async function main() {
  {
    const { context, state } = app();
    for (const [mode, amap, qq, bd] of [['drive', 'car', 'drive', 'driving'], ['bike', 'ride', 'bike', 'riding'], ['hike', 'walk', 'walk', 'walking']]) {
      state.mode = mode;
      const report = { mode: 'nav', travelMode: mode, navigationPoints: points, points: [points[0], ...Array(10).fill(points[1]), points[2]] };
      for (let leg = 0; leg < 2; leg++) {
        const markup = context.routeNavLinksHtml(report, leg);
        assert.equal((markup.match(/<option /g) || []).length, 2, 'only the user waypoints become navigation legs');
        const links = hrefs(markup);
        assert.equal(links[0].searchParams.get('mode'), amap);
        assert.equal(links[1].searchParams.get('type'), qq);
        assert.equal(links[2].searchParams.get('mode'), bd);
        assert(links[0].searchParams.get('from').startsWith(`${points[leg].lon},${points[leg].lat},`));
        assert(links[0].searchParams.get('to').startsWith(`${points[leg + 1].lon},${points[leg + 1].lat},`));
      }
      assert.equal(hrefs(context.poiLinksHtml(points[1]))[0].searchParams.get('mode'), amap);
    }
    console.log('PASS: all travel modes and every waypoint leg are retained in external navigation');
  }
  {
    const { context, state, nodes } = app();
    const select = { options: [], add(o) { this.options.push(o); } };
    nodes['#selDepart'] = select;
    nodes['#inpDate'] = {};
    const saved = { date: '2026-11-04', mode: 'drive', checkMode: 'nav', departureHour: 8.5, points };
    context.getTrip = () => saved;
    for (const name of ['applyCheckModeUI', 'renderPointList', 'showView', 'runCheckup']) context[name] = () => {};
    state.departHour = 16;
    context.openTrip('saved');
    assert.equal(state.departHour, 8.5);
    assert.equal(state.departOriginal, 8.5);
    assert.equal(select.value, '8.5');
    assert(select.options.some(o => o.text === '08:30'));
    delete saved.departureHour;
    context.openTrip('legacy');
    assert.equal(state.departHour, -1, 'legacy records must not inherit another trip departure');
    console.log('PASS: saved fractional departure and legacy fallback restore correctly');
  }
  {
    const { context, state, nodes } = app();
    const items = Array.from({ length: 8 }, (_, i) => ({ ...points[0], name: `景点${i}`, category: 'attraction' }));
    const report = { travelMode: 'drive', recommendations: { items, radiusM: 6000 } };
    state.poiFilter = 'attraction';
    let markup = context.recommendationSectionHtml(report);
    assert.equal(countCards(markup), 6);
    let more;
    nodes['#poiRecommendations'] = {
      querySelector(s) {
        if (s === 'details') return { addEventListener() {} };
        if (s === '[data-poi-more]' && markup.includes('data-poi-more')) return more = { dataset: { poiMore: '8' }, addEventListener(_, cb) { this.click = cb; } };
        return null;
      },
      querySelectorAll: () => [],
      set outerHTML(value) { markup = value; },
    };
    context.bindRecommendationFilters(report);
    more.click();
    assert.equal(countCards(markup), 8);
    assert(!markup.includes('data-poi-more='));
    console.log('PASS: mobile load-more reveals all eight places and disappears at the end');
  }
  {
    const { context, state } = app();
    let resolve, requests = 0;
    context.RoutePois.fetchAlongRoute = () => { requests++; return new Promise(r => { resolve = r; }); };
    const updates = [];
    context.refreshRecommendationSections = r => updates.push(r);
    const route = { coords: points, distance: 50000, duration: 3600 };
    const slot = {};
    const first = { travelMode: 'drive', departureHour: 8 };
    context.attachRouteRecommendations(first, null, route, 'drive', 480);
    state.currentReport = first;
    const p1 = context.loadReportRecommendations(first, route, slot);
    await Promise.resolve();
    assert.equal(first.recommendationMeta.loading, true);
    assert.equal(requests, 1);
    // Changing departure while the same route's POI request is pending reuses the raw request.
    const latest = { travelMode: 'drive', departureHour: 9 };
    state.currentReport = latest;
    const p2 = context.loadReportRecommendations(latest, route, slot);
    resolve({ ok: true, items: [{ ...points[0], name: '景点', category: 'attraction', routeKm: 25, distanceM: 10 }], meta: { ok: true } });
    await Promise.all([p1, p2]);
    assert.equal(requests, 1);
    assert.equal(updates.length, 1);
    assert.equal(updates[0], latest, 'a stale report must not replace the current UI');
    assert.equal(latest.recommendations.items[0].etaLabel, '09:30');
    context.RoutePois.fetchAlongRoute = async () => { throw new Error('offline'); };
    context.console = { ...console, warn() {} };
    const failed = { travelMode: 'drive', departureHour: 8 };
    state.currentReport = failed;
    await context.loadReportRecommendations(failed, route, {});
    assert.equal(failed.recommendationMeta.ok, false);
    assert.equal(state.currentReport, failed, 'POI failure must preserve the weather report');
    console.log('PASS: deferred POI, stale results, shared in-flight request and request failure');
  }
  {
    const { context, state } = app();
    state.points = points;
    state.date = context.todayStr();
    state.mode = 'drive';
    context.GEO = { sampleCountFor: () => 2, sampleAlong: () => points.slice(0, 2).map((p, i) => ({ ...p, cumKm: i, ratio: i })) };
    context.fetchHourly = async () => ({ ok: true, series: [{ hours: Array(72).fill({}) }] });
    context.fetchElevations = async () => [100, 200];
    context.analyzeNavigation = () => ({ departureHour: 8, travelMode: 'drive' });
    context.recWindow = () => ({ startIdx: 0, endIdx: 24 });
    context.departureMatrix = () => [];
    context.RoutePois.fetchAlongRoute = () => { throw new Error('weather generation must not fetch POI'); };
    const result = await context.buildNavOptionReport({ coords: points, duration: 3600, distance: 50000 }, {}, 8);
    assert(result.report);
    assert.equal(result.report.recommendationMeta.loading, true);
    assert.equal(result.report.navigationPoints.length, 3);
    console.log('PASS: weather report generation completes without waiting for POI');
  }
  {
    const { context, state, nodes } = app();
    const events = [];
    let resolve;
    nodes['#btnCheckup'] = {};
    nodes['#reportBody'] = {};
    state.mode = 'drive'; state.points = points.slice(0, 2); state.times = [480, 600];
    for (const name of ['ensureTimes', 'showView', 'applyCheckModeUI', 'upsertTrip']) context[name] = () => {};
    context.newTripId = () => 'test';
    const route = { ok: true, coords: points, distance: 50000, duration: 3600 };
    context.ROUTING = { fetchRoute: async () => route };
    context.buildPlanSamplesOnRoute = () => ({ samples: state.points.map((p, i) => ({ ...p, minute: state.times[i] })), legs: [] });
    context.fetchHourly = async () => ({ ok: true, series: [{}] });
    context.fetchElevations = async () => [100, 200];
    context.analyzePlanRoute = () => ({ travelMode: 'drive', points: [{ name: '起点', elev: 100 }], worstIndex: 0 });
    context.buildPlanHourScoresFromSeries = () => ({ rows: [] });
    context.pickBestHourRow = () => null;
    context.renderReport = () => events.push('render');
    context.refreshRecommendationSections = () => events.push('poi-update');
    context.RoutePois.fetchAlongRoute = () => { events.push('poi-start'); return new Promise(r => { resolve = r; }); };
    await context.checkupPoints();
    assert.deepEqual(events, ['render', 'poi-start']);
    assert.equal(nodes['#btnCheckup'].disabled, false);
    assert.equal(state.currentReport.recommendationMeta.loading, true);
    resolve({ ok: true, items: [], meta: { ok: true } });
    await state.currentReport._poiRequest;
    assert.deepEqual(events, ['render', 'poi-start', 'poi-update']);
    console.log('PASS: planning report renders and unlocks controls before the POI request finishes');
  }
  {
    const { context, state } = app();
    let resolve;
    const events = [];
    const route = { coords: points, distance: 50000, duration: 3600 };
    const report = { travelMode: 'drive', departureHour: 8 };
    const slot = { route, report };
    state.navOptions = [{}, slot]; state.navRouteIndex = 0;
    context.renderNavReport = () => events.push('render');
    context.refreshRecommendationSections = () => {};
    context.RoutePois.fetchAlongRoute = () => { events.push('poi-start'); return new Promise(r => { resolve = r; }); };
    await context.switchNavRoute(1);
    assert.equal(state.currentReport, report);
    assert.equal(state.navCtx, slot);
    assert.deepEqual(events, ['render', 'poi-start']);
    resolve({ ok: true, items: [], meta: { ok: true } });
    await report._poiRequest;
    console.log('PASS: switching route options is immediate even while place recommendations are loading');
  }
  {
    const { context, state } = app();
    const classList = () => {
      const values = new Set();
      return {
        add: (...names) => names.forEach(name => values.add(name)),
        remove: (...names) => names.forEach(name => values.delete(name)),
        toggle(name, force) {
          const shouldAdd = force == null ? !values.has(name) : force;
          if (shouldAdd) values.add(name); else values.delete(name);
          return shouldAdd;
        },
      };
    };
    const listeners = {};
    const handle = {
      dataset: { i: '1' },
      addEventListener(name, callback) { listeners[name] = callback; },
      setPointerCapture() {}, releasePointerCapture() {},
    };
    const rows = [0, 1, 2].map(index => ({
      classList: classList(),
      getBoundingClientRect: () => ({ top: index * 50, height: 50 }),
    }));
    const container = { querySelectorAll: selector => selector === '.pt-drag' ? [handle] : rows };
    context.document.body = { classList: classList() };
    state.points = [
      { name: '起点', lat: 30, lon: 103 },
      { name: '途经甲', lat: 30.1, lon: 103.1 },
      { name: '途经乙', lat: 30.2, lon: 103.2 },
    ];
    state.times = [480, 610, 900];
    state.mode = 'drive';
    context.renderPointList = () => {};
    context.toast = () => {};
    context.bindDragReorder(container);
    listeners.pointerdown({ pointerId: 1, clientY: 75, preventDefault() {} });
    listeners.pointermove({ pointerId: 1, clientY: 140 });
    listeners.pointerup({ pointerId: 1 });
    assert.deepEqual(state.points.map(point => point.name), ['起点', '途经乙', '途经甲']);
    assert.equal(state.times[0], 480, 'the first route position keeps the departure time');
    assert(state.times[2] >= state.times[1], 'reordered arrival times remain chronological');
    assert.equal(state.planOriginalTimes, null, 'reordering invalidates stale timing comparisons');
    let prevented = false;
    listeners.keydown({ key: 'ArrowDown', preventDefault() { prevented = true; } });
    assert(prevented);
    assert.deepEqual(state.points.map(point => point.name), ['起点', '途经甲', '途经乙']);
    console.log('PASS: pointer and keyboard reorder waypoints while preserving a valid route schedule');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
