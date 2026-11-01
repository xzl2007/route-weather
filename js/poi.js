/* ============================================================
 * RouteWeather · 沿途地点推荐
 * ------------------------------------------------------------
 * 数据来自天地图 POI 搜索。推荐先按路线距离筛选，再结合出行方式、
 * 预计经过时刻与路线位置排序，避免只返回“附近最热门”的无关地点。
 * ============================================================ */
(function (root) {
  'use strict';

  const CATEGORY_META = {
    attraction: { label: '景点', icon: '◇', className: 'attraction' },
    food: { label: '美食', icon: '⌁', className: 'food' },
    lodging: { label: '住宿', icon: '⌂', className: 'lodging' },
    supply: { label: '加油充电', icon: '⚡', className: 'supply' },
  };

  const MODE_SETTINGS = {
    drive: {
      radiusM: 2500,
      queries: {
        attraction: ['风景名胜', '博物馆'],
        food: ['餐厅'],
        lodging: ['酒店', '民宿'],
        supply: ['加油站', '充电站'],
      },
    },
    bike: {
      radiusM: 1500,
      queries: {
        attraction: ['风景名胜', '博物馆'],
        food: ['餐厅'],
        lodging: ['酒店', '民宿'],
        supply: ['充电站'],
      },
    },
    hike: {
      radiusM: 900,
      queries: {
        attraction: ['风景名胜', '博物馆'],
        food: ['餐厅'],
        lodging: ['酒店', '民宿'],
        supply: [],
      },
    },
  };

  const MODE_LABEL = { drive: '自驾', bike: '骑行', hike: '徒步' };
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  const CACHE_PREFIX = 'rwc:route-pois:v1:';

  function modeSettings(mode) {
    return MODE_SETTINGS[mode] || MODE_SETTINGS.drive;
  }

  function hashString(value) {
    let h = 2166136261;
    const text = String(value || '');
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function cleanName(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function relevantName(name, category) {
    const n = cleanName(name);
    if (!n) return false;
    if (category === 'attraction') {
      if (/管理委员会|执法大队|人民调解|停车场|公共厕所|售票处|入口$|出口$/.test(n)) return false;
      return /景区|风景|名胜|博物馆|纪念馆|遗址|公园|古镇|古城|寺|庙|山|湖|沟|寨|关|桥|观景|索道|游客中心|故里|庄园|洞|峡|草原|湿地|温泉|营地|瀑布|石窟|楼|塔/.test(n);
    }
    if (category === 'lodging') return /酒店|宾馆|民宿|客栈|旅馆|度假|山庄|公寓|营地/.test(n);
    if (category === 'food') return /餐厅|饭店|食堂|美食|火锅|烧烤|小吃|面馆|菜馆|咖啡馆|咖啡|餐吧|食府|酒家/.test(n);
    if (category === 'supply') return /加油站|加气站|充电站|能源站|充电桩|中国石化|中国石油/.test(n);
    return false;
  }

  function toRad(value) {
    return Number(value) * Math.PI / 180;
  }

  function haversineM(a, b) {
    const R = 6371008.8;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
  }

  function routeMetrics(coords) {
    const list = Array.isArray(coords) ? coords.filter(c => c && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lon))) : [];
    const cumM = [0];
    for (let i = 1; i < list.length; i++) cumM.push(cumM[i - 1] + haversineM(list[i - 1], list[i]));
    return { coords: list, cumM, totalM: cumM[cumM.length - 1] || 0 };
  }

  function nearestOnRoute(point, metrics) {
    if (!point || !metrics || !metrics.coords || metrics.coords.length < 2) {
      return { distanceM: Infinity, routeKm: 0, ratio: 0 };
    }
    let best = { distanceM: Infinity, routeKm: 0, ratio: 0 };
    const cosLat = Math.cos(toRad(point.lat));
    const xScale = 111320 * cosLat;
    const yScale = 111320;
    for (let i = 1; i < metrics.coords.length; i++) {
      const a = metrics.coords[i - 1];
      const b = metrics.coords[i];
      const bx = (Number(b.lon) - Number(a.lon)) * xScale;
      const by = (Number(b.lat) - Number(a.lat)) * yScale;
      const px = (Number(point.lon) - Number(a.lon)) * xScale;
      const py = (Number(point.lat) - Number(a.lat)) * yScale;
      const len2 = bx * bx + by * by;
      const t = len2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
      const dx = px - bx * t;
      const dy = py - by * t;
      const distanceM = Math.sqrt(dx * dx + dy * dy);
      if (distanceM < best.distanceM) {
        const segM = metrics.cumM[i] - metrics.cumM[i - 1];
        const routeM = metrics.cumM[i - 1] + segM * t;
        best = {
          distanceM,
          routeKm: routeM / 1000,
          ratio: metrics.totalM > 0 ? routeM / metrics.totalM : 0,
        };
      }
    }
    return best;
  }

  function buildBounds(coords, radiusM) {
    const metrics = routeMetrics(coords);
    if (metrics.coords.length < 2) return null;
    const lats = metrics.coords.map(c => Number(c.lat));
    const lons = metrics.coords.map(c => Number(c.lon));
    const latPad = Math.max(0.025, Number(radiusM || 1000) / 111320 * 1.6);
    const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const lonPad = Math.max(0.025, Number(radiusM || 1000) / (111320 * Math.max(0.2, Math.cos(toRad(midLat)))) * 1.6);
    const west = Math.max(-180, Math.min(...lons) - lonPad);
    const east = Math.min(180, Math.max(...lons) + lonPad);
    const south = Math.max(-90, Math.min(...lats) - latPad);
    const north = Math.min(90, Math.max(...lats) + latPad);
    return {
      west, east, south, north,
      mapBound: [west, south, east, north].map(v => Number(v).toFixed(5)).join(','),
    };
  }

  function normalizeResponse(payload, category) {
    const list = payload && Array.isArray(payload.pois) ? payload.pois : [];
    return list.map((poi, index) => {
      const name = cleanName(poi && poi.name);
      const pair = String(poi && poi.lonlat || '').split(',').map(Number);
      const lon = pair[0];
      const lat = pair[1];
      if (!name || !relevantName(name, category) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return {
        id: cleanName(poi.hotPointID) || `${category}:${lat.toFixed(5)}:${lon.toFixed(5)}:${name}`,
        name,
        category,
        lat,
        lon,
        address: cleanName(poi.address),
        phone: cleanName(poi.phone),
        poiType: cleanName(poi.poiType),
        source: '天地图',
        sourceIndex: index,
      };
    }).filter(Boolean);
  }

  function dedupe(items) {
    const seen = new Set();
    const out = [];
    (items || []).forEach(item => {
      if (!item) return;
      const key = `${item.name.replace(/\s+/g, '').toLowerCase()}|${item.lat.toFixed(3)}|${item.lon.toFixed(3)}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(item);
    });
    return out;
  }

  function enrichNearRoute(items, metrics, radiusM, limit) {
    const near = dedupe(items).map(item => {
      const nearest = nearestOnRoute(item, metrics);
      return Object.assign({}, item, {
        distanceM: nearest.distanceM,
        routeKm: nearest.routeKm,
        ratio: nearest.ratio,
      });
    }).filter(item => Number.isFinite(item.distanceM) && item.distanceM <= radiusM)
      .sort((a, b) => a.distanceM - b.distanceM);
    return near.slice(0, limit || 160);
  }

  function readCache(key) {
    try {
      if (!root.localStorage) return null;
      const raw = root.localStorage.getItem(key);
      if (!raw) return null;
      const hit = JSON.parse(raw);
      if (!hit || !hit.t || Date.now() - hit.t > CACHE_TTL) return null;
      return hit.data;
    } catch (e) { return null; }
  }

  function writeCache(key, data) {
    try {
      if (root.localStorage) root.localStorage.setItem(key, JSON.stringify({ t: Date.now(), data }));
    } catch (e) { /* storage may be unavailable */ }
  }

  async function queryKeyword(keyword, mapBound, count) {
    const keyValue = typeof TIANDITU_KEY !== 'undefined' ? TIANDITU_KEY : '';
    if (!keyValue || typeof fetchJson !== 'function') throw new Error('地点搜索未配置');
    const postStr = JSON.stringify({
      keyWord: keyword,
      level: 12,
      mapBound,
      queryType: 1,
      start: 0,
      count: count || 60,
    });
    const url = `https://api.tianditu.gov.cn/v2/search?postStr=${encodeURIComponent(postStr)}&type=query&tk=${encodeURIComponent(keyValue)}`;
    return fetchJson(url, 9000);
  }

  async function queryWithRetry(keyword, mapBound, count) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await queryKeyword(keyword, mapBound, count);
      } catch (e) {
        lastError = e;
        if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 350));
      }
    }
    throw lastError || new Error('地点搜索失败');
  }

  async function fetchAlongRoute(coords, mode, options) {
    options = options || {};
    const metrics = routeMetrics(coords);
    const settings = modeSettings(mode);
    const bounds = buildBounds(metrics.coords, settings.radiusM);
    if (metrics.coords.length < 2 || !bounds) {
      return { ok: false, items: [], meta: { ok: false, degraded: false, reason: 'no-route' } };
    }

    const keyValue = typeof TIANDITU_KEY !== 'undefined' ? TIANDITU_KEY : '';
    if (!keyValue || typeof fetchJson !== 'function') {
      return { ok: false, items: [], meta: { ok: false, degraded: false, reason: 'disabled' } };
    }

    const first = metrics.coords[0];
    const last = metrics.coords[metrics.coords.length - 1];
    const signature = hashString([
      mode,
      metrics.coords.length,
      metrics.totalM.toFixed(0),
      Number(first.lat).toFixed(4), Number(first.lon).toFixed(4),
      Number(last.lat).toFixed(4), Number(last.lon).toFixed(4),
      bounds.mapBound,
    ].join('|'));
    const cacheKey = CACHE_PREFIX + signature;
    const cached = readCache(cacheKey);
    if (cached && Array.isArray(cached.items)) return cached;

    const jobs = [];
    Object.keys(settings.queries).forEach(category => {
      settings.queries[category].forEach(keyword => jobs.push({ category, keyword }));
    });
    if (!jobs.length) {
      const empty = { ok: true, items: [], meta: { ok: true, degraded: false, radiusM: settings.radiusM, mode, fetchedAt: Date.now() } };
      writeCache(cacheKey, empty);
      return empty;
    }

    const results = await Promise.all(jobs.map(async job => {
      try {
        const payload = await queryWithRetry(job.keyword, bounds.mapBound, options.count || 60);
        return { job, items: normalizeResponse(payload, job.category) };
      } catch (e) {
        return { job, items: [], error: e };
      }
    }));

    const failed = results.filter(result => result.error).length;
    const all = results.flatMap(result => result.items);
    const items = enrichNearRoute(all, metrics, settings.radiusM, options.limit || 160);
    const response = {
      ok: failed < results.length,
      items,
      meta: {
        ok: failed < results.length,
        degraded: failed > 0,
        failedQueries: failed,
        queryCount: results.length,
        radiusM: settings.radiusM,
        mode,
        fetchedAt: Date.now(),
      },
    };
    if (response.ok) writeCache(cacheKey, response);
    return response;
  }

  function clockLabel(minute) {
    const normalized = ((Math.round(Number(minute) || 0) % 1440) + 1440) % 1440;
    return String(Math.floor(normalized / 60)).padStart(2, '0') + ':' + String(normalized % 60).padStart(2, '0');
  }

  function distanceLabel(meters) {
    const m = Number(meters);
    if (!Number.isFinite(m)) return '';
    if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
    return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
  }

  function personalize(items, context) {
    context = context || {};
    const mode = context.mode || 'drive';
    const settings = modeSettings(mode);
    const totalKm = Math.max(0.001, Number(context.totalKm) || Number(context.routeDistanceKm) || 0);
    const durationMin = Math.max(1, Number(context.durationMin) || 0);
    const startMinute = Number.isFinite(Number(context.startMinute)) ? Number(context.startMinute) : 8 * 60;
    const weights = {
      drive: { attraction: 4, food: 10, lodging: 7, supply: 13 },
      bike: { attraction: 9, food: 13, lodging: 8, supply: 4 },
      hike: { attraction: 12, food: 10, lodging: 13, supply: 0 },
    }[mode] || {};

    const scored = (items || []).filter(item => item && CATEGORY_META[item.category]).map(item => {
      const routeKm = Number(item.routeKm) || 0;
      const ratio = totalKm > 0 ? Math.max(0, Math.min(1, routeKm / totalKm)) : 0;
      const etaAbs = startMinute + durationMin * ratio;
      const etaMin = ((Math.round(etaAbs) % 1440) + 1440) % 1440;
      const etaHour = etaMin / 60;
      const etaDayOffset = Math.floor(etaAbs / 1440);
      const etaLabel = (etaDayOffset === 1 ? '次日 ' : etaDayOffset > 1 ? `第${etaDayOffset + 1}天 ` : '') + clockLabel(etaMin);
      const detourRatio = Math.max(0, Math.min(1, (Number(item.distanceM) || 0) / settings.radiusM));
      let score = 100 - detourRatio * 42 + (weights[item.category] || 0);
      const tags = [];

      if (item.category === 'food') {
        const lunch = etaHour >= 10.5 && etaHour <= 14.5;
        const dinner = etaHour >= 17 && etaHour <= 20.5;
        if (lunch || dinner) {
          score += 18;
          tags.push(lunch ? '午餐时段' : '晚餐时段');
        }
        var reason = (lunch || dinner)
          ? `预计 ${clockLabel(etaMin)} 经过，适合安排${lunch ? '午餐' : '晚餐'}`
          : `预计 ${clockLabel(etaMin)} 经过，适合沿途用餐`;
      } else if (item.category === 'lodging') {
        const late = etaHour >= 17 || etaHour < 1;
        const nearEnd = ratio >= 0.58;
        if (late || (durationMin >= 300 && nearEnd)) {
          score += 16;
          tags.push(late ? '适合落脚' : '长行程住宿');
        }
        var reason = late
          ? `预计 ${clockLabel(etaMin)} 到达，适合安排住宿`
          : (durationMin >= 300 && nearEnd ? '靠近路线后段，适合长行程中途住宿' : '距路线较近，可作为休息落脚点');
      } else if (item.category === 'supply') {
        const middle = ratio >= 0.18 && ratio <= 0.88;
        if (mode === 'drive' && totalKm >= 60 && middle) {
          score += 15;
          tags.push('长途中段补给');
        } else if (mode === 'bike') {
          score += 7;
          tags.push('骑行能源补给');
        }
        var reason = tags.length ? tags[0] : `距路线 ${distanceLabel(item.distanceM)}，便于临时补给`;
      } else {
        if (mode === 'bike' || mode === 'hike') score += (Number(item.distanceM) || 0) <= 700 ? 8 : 3;
        if (ratio >= 0.25 && ratio <= 0.82) tags.push('途中短停');
        var reason = tags.length
          ? `距路线 ${distanceLabel(item.distanceM)}，适合途中短停`
          : `预计 ${clockLabel(etaMin)} 经过，距路线 ${distanceLabel(item.distanceM)}`;
      }

      return Object.assign({}, item, {
        score: Math.round(score * 10) / 10,
        ratio,
        etaMin,
        etaLabel: etaLabel,
        distanceLabel: distanceLabel(item.distanceM),
        reason,
        tags,
      });
    }).sort((a, b) => b.score - a.score);

    const groups = {};
    scored.forEach(item => { (groups[item.category] || (groups[item.category] = [])).push(item); });
    const diversified = [];
    const categories = ['attraction', 'food', 'lodging', 'supply'];
    for (let round = 0; round < 6; round++) {
      categories.forEach(category => {
        const item = groups[category] && groups[category][round];
        if (item) diversified.push(item);
      });
    }

    return {
      items: diversified,
      mode,
      modeLabel: MODE_LABEL[mode] || '自驾',
      radiusM: settings.radiusM,
      nearbyCount: (items || []).length,
      note: `${MODE_LABEL[mode] || '自驾'}模式，按预计经过时段与绕行距离排序`,
    };
  }

  const API = {
    CATEGORY_META,
    MODE_SETTINGS,
    routeMetrics,
    nearestOnRoute,
    buildBounds,
    normalizeResponse,
    dedupe,
    enrichNearRoute,
    personalize,
    fetchAlongRoute,
  };

  root.RoutePois = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);