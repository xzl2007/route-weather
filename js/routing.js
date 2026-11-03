/* ============================================================
 * 路径规划与沿路采样
 * ------------------------------------------------------------
 * 自驾：Valhalla（OSM 路网）优先，支持备选路线与「少高速」方案；
 *       失败时回退 OSRM。骑行/徒步：BRouter 对应 profile。
 * ============================================================ */

/** Valhalla 的 shape 是 precision=6 的 encoded polyline */
function decodeValhallaShape(shape) {
  if (!shape || typeof shape !== 'string') return [];
  let index = 0, lat = 0, lon = 0;
  const out = [];
  while (index < shape.length) {
    let result = 0, shift = 0, b;
    do {
      b = shape.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    result = 0; shift = 0;
    do {
      b = shape.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lon += (result & 1) ? ~(result >> 1) : (result >> 1);
    out.push({ lat: lat / 1e6, lon: lon / 1e6 });
  }
  return out;
}

function valhallaTripToRoute(trip) {
  if (!trip || !trip.legs || !trip.legs.length) return null;
  const coords = [];
  trip.legs.forEach(leg => {
    const decoded = decodeValhallaShape(leg.shape);
    decoded.forEach((point, index) => {
      if (coords.length && index === 0) return;
      coords.push(point);
    });
  });
  const summary = trip.summary || {};
  const distance = Number(summary.length) * 1000;
  const duration = Number(summary.time);
  if (!coords.length || !Number.isFinite(distance) || !Number.isFinite(duration)) return null;
  return { distance, duration, coords };
}

const ROUTING = {
  OSRM_BASE: 'https://router.project-osrm.org/route/v1',
  BROUTER_BASE: 'https://brouter.de/brouter',
  VALHALLA_BASE: 'https://valhalla1.openstreetmap.de/route',
  CACHE_TTL: 24 * 60 * 60 * 1000, // 路网几乎不变，缓存 1 天

  MODES: {
    drive: { provider: 'OSRM', profile: 'driving' },
    bike: { provider: 'BRouter', profile: 'fastbike-asia-pacific' },
    hike: { provider: 'BRouter', profile: 'trekking' },
  },

  /**
   * 各出行方式的实际速度（km/h）
   * 徒步和骑行按模式专用路网计算距离，再用保守的平均速度估算用时。
   */
  SPEED: {
    drive: null,   // 用接口值（汽车路网本来就是对的）
    hike: 4.0,     // 徒步 4 km/h（含爬升，偏保守）
    bike: 15.0,    // 骑行 15 km/h
  },

  /** 预报有效期（天）：Open-Meteo 免费档大约 16 天，保守按 7 天算 */
  FORECAST_HORIZON_DAYS: 7,

  /** 返回当前出行模式对应的路线服务与路网 profile。 */
  configOf(mode) {
    return this.MODES[mode] || this.MODES.drive;
  },

  profileOf(mode) {
    return this.configOf(mode).profile;
  },

  /**
   * 按出行方式换算实际时长
   * @returns {{duration:number, speedKmh:number|null, estimated:boolean}}
   */
  applyMode(mode, distanceM, apiDurationSec) {
    const spd = this.SPEED[mode];
    if (!spd) return { duration: apiDurationSec, speedKmh: null, estimated: false };
    // 徒步/骑行：距离 ÷ 速度
    const duration = (distanceM / 1000) / spd * 3600;
    return { duration, speedKmh: spd, estimated: true };
  },

  /**
   * 规划路径
   * @param {Array} pts [{name, lat, lon}] 第一个为起点，最后一个为终点，中间为途经点
   * @param {string} mode drive|hike|bike
   * @returns {Promise<{ok, distance, duration, coords, approx, provider, profile, speedKmh, overHorizon, horizonDays}>}
   */
  async fetchRoute(pts, mode) {
    if (!pts || pts.length < 2) return { ok: false, error: '至少需要起点和终点' };

    const config = this.configOf(mode);
    const { provider, profile } = config;
    // 缓存必须区分服务与 profile；同一组坐标的汽车、骑行和徒步路线不同。
    const coordStr = pts.map(p => `${p.lon},${p.lat}`).join(';');
    const key = `rwc:route:${provider}:${profile}:${coordStr}`;

    let raw = null;
    try {
      const s = localStorage.getItem(key);
      if (s) {
        const { t, data } = JSON.parse(s);
        if (Date.now() - t < this.CACHE_TTL) raw = data;
      }
    } catch (e) { /* ignore */ }

    if (!raw) {
      try {
        let distance;
        let apiDuration;
        let coordinates;

        if (provider === 'OSRM') {
          const url = `${this.OSRM_BASE}/${profile}/${coordStr}?overview=full&geometries=geojson&steps=false`;
          const json = await fetchJson(url, 20000);
          if (json.code !== 'Ok' || !json.routes || !json.routes.length) {
            throw new Error(json.message || ('OSRM 路由失败: ' + json.code));
          }
          const route = json.routes[0];
          distance = route.distance;
          apiDuration = route.duration;
          coordinates = route.geometry.coordinates;
        } else {
          const params = new URLSearchParams({
            lonlats: pts.map(p => `${p.lon},${p.lat}`).join('|'),
            profile,
            alternativeidx: '0',
            format: 'geojson',
          });
          const json = await fetchJson(`${this.BROUTER_BASE}?${params}`, 45000);
          const feature = json.features && json.features[0];
          if (json.type !== 'FeatureCollection' || !feature || !feature.geometry
              || !Array.isArray(feature.geometry.coordinates)) {
            throw new Error(json.message || 'BRouter 没有返回可用路线，请检查地点或稍后重试。');
          }
          const props = feature.properties || {};
          distance = Number(props['track-length']);
          apiDuration = Number(props['total-time']);
          coordinates = feature.geometry.coordinates;
        }
        if (!Number.isFinite(distance) || distance <= 0 || !coordinates || coordinates.length < 2) {
          throw new Error('路线数据不完整，请稍后重试。');
        }
        raw = {
          distance,
          apiDuration: Number.isFinite(apiDuration) ? apiDuration : null,
          coords: coordinates.map(c => ({ lat: c[1], lon: c[0] })),
        };
        try {
          localStorage.setItem(key, JSON.stringify({ t: Date.now(), data: raw }));
        } catch (e) { /* 配额满忽略 */ }
      } catch (e) {
        console.warn(`${provider} 路径规划失败：`, e);
        return { ok: false, error: e.message || String(e) };
      }
    }

    const conv = this.applyMode(mode, raw.distance, raw.apiDuration);
    const days = conv.duration / 3600 / 24;

    return {
      ok: true,
      distance: raw.distance,           // 米（路网距离）
      duration: conv.duration,          // 秒（已按出行方式换算）
      coords: raw.coords,
      provider,
      profile,                          // 实际调用的道路/步道 profile
      approx: conv.estimated,           // true = 时长是自行估算的
      speedKmh: conv.speedKmh,
      // 是否超出预报有效期（超出则整体评估无意义）
      overHorizon: days > this.FORECAST_HORIZON_DAYS,
      horizonDays: this.FORECAST_HORIZON_DAYS,
      travelDays: days,
    };
  },

  /** 调用 Valhalla，返回 0–3 条原始路线 */
  async _fetchValhalla(pts, autoOptions, alternates) {
    const body = {
      locations: pts.map(p => ({ lat: Number(p.lat), lon: Number(p.lon), type: 'break' })),
      costing: 'auto',
      costing_options: { auto: autoOptions || {} },
      units: 'kilometers',
      alternates: alternates || 0,
      directions_options: { units: 'kilometers' },
    };
    const json = await fetchJson(this.VALHALLA_BASE, 32000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const trips = [];
    if (json && json.trip) trips.push(json.trip);
    (json && json.alternates || []).forEach(entry => {
      if (entry && entry.trip) trips.push(entry.trip);
    });
    return trips.map(trip => valhallaTripToRoute(trip)).filter(Boolean);
  },

  /**
   * 自驾多路线方案：推荐 + 备选 + 少高速。
   * 骑行/徒步仍返回单条路线。
   * @returns {Promise<{ok:boolean,error?:string,options:Array}>}
   */
  async fetchRouteOptions(pts, mode) {
    if (!pts || pts.length < 2) return { ok: false, error: '至少需要起点和终点', options: [] };
    if (mode !== 'drive') {
      const single = await this.fetchRoute(pts, mode);
      if (!single.ok) return { ok: false, error: single.error, options: [] };
      return {
        ok: true,
        options: [Object.assign({}, single, {
          label: mode === 'hike' ? '徒步路线' : '骑行路线',
          note: '按所选出行方式的专用路网规划。',
        })],
      };
    }

    const coordStr = pts.map(p => `${p.lon},${p.lat}`).join(';');
    const key = `rwc:routeopts:v3:${coordStr}`;
    try {
      const s = localStorage.getItem(key);
      if (s) {
        const hit = JSON.parse(s);
        if (Date.now() - hit.t < this.CACHE_TTL && hit.data && hit.data.ok) return hit.data;
      }
    } catch (e) { /* ignore */ }

    const collected = [];
    try {
      const base = await this._fetchValhalla(pts, { use_highways: 0.9, use_tolls: 0.9 }, 2);
      base.forEach((r, i) => collected.push(Object.assign(r, {
        label: i === 0 ? '时间优先' : `备选路线 ${i}`,
        note: i === 0 ? '按时间与路网条件推荐的主路线。' : '同一组起终点的另一条可行路线，里程/用时可能不同。',
        optionKind: i === 0 ? 'main' : 'alternate',
      })));
    } catch (e) {
      console.warn('Valhalla 路线规划失败，回退 OSRM：', e);
    }

    if (collected.length < 3) {
      try {
        const scenic = await this._fetchValhalla(pts, { use_highways: 0.2, use_tolls: 0.2 }, 0);
        scenic.slice(0, 1).forEach(r => collected.push(Object.assign(r, {
          label: '少高速 · 风景优先',
          note: '降低高速与收费权重，优先走国省道；通常里程更长，但沿途乡镇、补给与风景更多。',
          optionKind: 'scenic',
        })));
      } catch (e) { /* 少高速请求失败不影响主路线 */ }
    }

    // 去重：里程/用时接近且中点相近，视为同一条路
    const options = [];
    collected.forEach(item => {
      const dup = options.find(existing => {
        const dDist = Math.abs(existing.distance - item.distance) / Math.max(1, existing.distance);
        const dTime = Math.abs(existing.duration - item.duration) / Math.max(1, existing.duration);
        if (dDist > 0.03 || dTime > 0.04) return false;
        const a = existing.coords[Math.floor(existing.coords.length / 2)];
        const b = item.coords[Math.floor(item.coords.length / 2)];
        const toRad = v => v * Math.PI / 180;
        const h = Math.sin(toRad(b.lat - a.lat) / 2) ** 2
          + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lon - a.lon) / 2) ** 2;
        return 2 * 6371000 * Math.asin(Math.sqrt(h)) < 6000;
      });
      if (!dup) options.push(item);
    });

    if (!options.length) {
      const fallback = await this.fetchRoute(pts, 'drive');
      if (!fallback.ok) return { ok: false, error: fallback.error, options: [] };
      options.push(Object.assign({}, fallback, {
        label: '时间优先',
        note: 'Valhalla 暂不可用，已回退到 OSRM 路网。',
        optionKind: 'main',
      }));
    }

    // 统一补充 forecast horizon / 选项序号
    options.forEach((r, i) => {
      const conv = this.applyMode('drive', r.distance, r.duration);
      r.provider = r.provider || 'Valhalla';
      r.profile = r.profile || 'auto';
      r.approx = false;
      r.speedKmh = null;
      r.duration = conv.duration;
      r.travelDays = conv.duration / 3600 / 24;
      r.overHorizon = r.travelDays > this.FORECAST_HORIZON_DAYS;
      r.horizonDays = this.FORECAST_HORIZON_DAYS;
      r.index = i;
    });

    const result = { ok: true, options: options.slice(0, 3) };
    try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), data: result })); }
    catch (e) { /* 配额满忽略 */ }
    return result;
  },
};

/* ---------------- 地理计算 ---------------- */

const GEO = {
  R: 6371000, // 地球半径（米）

  /** 两点距离（米），Haversine */
  dist(a, b) {
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const la1 = toRad(a.lat), la2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * this.R * Math.asin(Math.sqrt(h));
  },

  /** 累计里程数组（米），长度与 coords 相同 */
  cumulative(coords) {
    const cum = [0];
    for (let i = 1; i < coords.length; i++) {
      cum.push(cum[i - 1] + this.dist(coords[i - 1], coords[i]));
    }
    return cum;
  },

  /**
   * 沿路径按「里程」等距采样（不是按索引，因为几何点疏密不均）
   * @param {Array} coords 路径几何点
   * @param {number} n 采样点数（含起点与终点）
   * @returns {Array} [{lat, lon, ratio, cumKm}]
   */
  sampleAlong(coords, n) {
    if (!coords || coords.length < 2) return [];
    n = Math.max(2, Math.min(20, n | 0));
    const cum = this.cumulative(coords);
    const total = cum[cum.length - 1];
    if (!total) return [];

    const out = [];
    let seg = 0;
    for (let k = 0; k < n; k++) {
      const target = total * (k / (n - 1));
      while (seg < cum.length - 2 && cum[seg + 1] < target) seg++;
      const segLen = cum[seg + 1] - cum[seg];
      const f = segLen > 0 ? (target - cum[seg]) / segLen : 0;
      const a = coords[seg], b = coords[seg + 1];
      out.push({
        lat: a.lat + (b.lat - a.lat) * f,
        lon: a.lon + (b.lon - a.lon) * f,
        ratio: k / (n - 1),
        cumKm: target / 1000,
      });
    }
    return out;
  },

  /**
   * 采样点数：按行程时长加密，至少 8 个、最多 12 个。
   * 山区天气变化快，只有 3 个点会让“沿途体检”失去意义。
   * @param {number} durationSec 总时长
   */
  sampleCountFor(durationSec) {
    const minutes = durationSec / 60;
    return Math.max(8, Math.min(12, Math.ceil(minutes / 30) || 8));
  },
};

/* ---------------- 导出（供 node 测试） ---------------- */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ROUTING, GEO };
}
