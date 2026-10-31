/* ============================================================
 * 路径规划与沿路采样
 * ------------------------------------------------------------
 * 自驾使用 OSRM driving 路网；骑行和徒步使用 BRouter 的对应 OSM 通行 profile。
 * profile 分别偏向汽车、亚洲太平洋骑行和徒步路径，避免把驾车路线冒充为步道/骑行道。
 * ============================================================ */

const ROUTING = {
  OSRM_BASE: 'https://router.project-osrm.org/route/v1',
  BROUTER_BASE: 'https://brouter.de/brouter',
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
