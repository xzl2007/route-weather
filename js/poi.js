/* ============================================================
 * RouteWeather · 沿途地点推荐
 * ------------------------------------------------------------
 * 数据来自天地图 POI 搜索，推荐层再做三件事：
 *   1. 按路线距离、预计经过时刻、出行方式与绕行成本排序；
 *   2. 用品牌 / 口碑关键词（连锁、温泉、观景、老字号等）做质量加权，
 *      并剔除停车场、管委会、村委会等无关结果；
 *   3. 对少量 OTA 口碑较好的住宿/景区做人工精选（CURATED），
 *      报告里给出「大众点评 / 去哪儿 / 高德」直达链接，方便复核。
 *
 * 加油与充电拆成两个独立分类，地图上使用不同图例。
 * ============================================================ */
(function (root) {
  'use strict';

  const CATEGORY_META = {
    attraction: { label: '景点', icon: '◇', className: 'attraction' },
    food: { label: '美食', icon: '⌁', className: 'food' },
    lodging: { label: '住宿', icon: '⌂', className: 'lodging' },
    fuel: { label: '加油站', icon: '⛽', className: 'fuel' },
    charging: { label: '充电站', icon: '🔌', className: 'charging' },
  };

  const MODE_SETTINGS = {
    drive: {
      radiusM: 6000,
      queries: {
        attraction: ['风景名胜', '博物馆'],
        food: ['餐厅', '火锅'],
        lodging: ['酒店', '民宿'],
        fuel: ['加油站'],
        charging: ['充电站'],
      },
    },
    bike: {
      radiusM: 2200,
      queries: {
        attraction: ['风景名胜', '博物馆'],
        food: ['餐厅', '小吃'],
        lodging: ['酒店', '民宿'],
        charging: ['充电站'],
      },
    },
    hike: {
      radiusM: 1200,
      queries: {
        attraction: ['风景名胜', '博物馆'],
        food: ['餐厅'],
        lodging: ['酒店', '民宿'],
      },
    },
  };

  const MODE_LABEL = { drive: '自驾', bike: '骑行', hike: '徒步' };
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  const CACHE_PREFIX = 'rwc:route-pois:v4:';

  /* ---------------- OTA 口碑精选（人工核对） ----------------
   * 只收录坐标明确、在多个 OTA 页面可查到的住宿 / 景区；
   * 不伪造评分，报告里统一标「OTA 口碑精选」，并给出点评/去哪儿搜索链接。
   */
  const CURATED = [
    { key: '羊茸哈德', name: '羊茸哈德藏寨', category: 'lodging', lat: 32.10636, lon: 102.85880, note: '黑水彩林深处的藏式村寨民宿，适合秋季与达古冰川连线', tags: ['藏寨民宿', '彩林景观'] },
    { key: '达古冰川大酒店', name: '达古冰川大酒店', category: 'lodging', lat: 32.10221, lon: 102.96670, note: '达古冰川沟口，位置最省心，适合次日一早进景区', tags: ['景区门口', '停车方便'] },
    { key: '四姑娘山阳光酒店', name: '新四姑娘山阳光酒店', category: 'lodging', lat: 30.99323, lon: 102.83671, note: '四姑娘山镇金峰村，距长坪沟/双桥沟都不远', tags: ['镇中心', '口碑稳定'] },
    { key: '日松贡布酒店', name: '日松贡布酒店', category: 'lodging', lat: 28.55955, lon: 100.34766, note: '香格里拉镇，亚丁景区换乘与补给都方便', tags: ['亚丁门口', '高原住宿'] },
    { key: '稻城亚丁智选假日酒店', name: '稻城亚丁智选假日酒店', category: 'lodging', lat: 28.55657, lon: 100.33674, note: '香格里拉镇俄初路，连锁品牌，供氧/供暖相对稳定', tags: ['连锁品牌', '供氧'] },
    { key: '康定情歌大酒店', name: '康定情歌大酒店', category: 'lodging', lat: 30.05252, lon: 101.96324, note: '康定老城东大街，吃饭与补给方便，适合川藏线首晚', tags: ['老城中心', '补给方便'] },
    { key: '甲居三姐妹客栈', name: '丹巴甲居三姐妹客栈', category: 'lodging', lat: 30.92157, lon: 101.86217, note: '甲居藏寨内，观景位置好，适合拍晨雾与碉楼', tags: ['藏寨景观', '摄影'] },
    { key: '四姑娘山长坪沟景区', name: '四姑娘山长坪沟景区', category: 'attraction', lat: 31.00163, lon: 102.84458, note: '四姑娘山三条沟中最适合轻徒步的一条，观光车+栈道', tags: ['轻徒步', '雪山'] },
    { key: '达古冰川', name: '达古冰川', category: 'attraction', lat: 32.24700, lon: 102.75800, note: '黑水核心景区，索道上到海拔约 4860 m，注意高反与保暖', tags: ['冰川', '高海拔'] },
    { key: '甲居藏寨', name: '丹巴甲居藏寨', category: 'attraction', lat: 30.92488, lon: 101.87683, note: '中国最美乡村之一，晨昏光线最好，寨内可步行', tags: ['藏寨', '摄影'] },
  ];

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

  const BRANDS = /中国石化|中国石油|中石化|中石油|壳牌|BP|国家电网|特来电|星星充电|云快充|小鹏|蔚来|特斯拉|理想|洲际|希尔顿|万豪|凯悦|香格里拉|亚朵|全季|桔子|汉庭|如家|维也纳|智选假日|华美达|锦江|七天|喆啡|麗枫|丽枫/;
  const QUALITY_WORDS = /观景|山景|湖景|雪景|温泉|庭院|藏式|藏族|木屋|星空|摄影|精品|度假|庄园|营地|老字号|人气|必住|首选|旗舰|中心|景区内|沟口|镇中心|停车|供氧|供暖|地暖|氧吧/;
  const NEGATIVE_WORDS = /招待所|停车场|管理站|管委会|管理局|售票处|验票|游客中心|服务点|观光车站|换乘站|乘车点|公厕|厕所|诊所|卫生院|药店|超市|小卖部|门市|五金|汽修|维修|洗车|驾校|仓库|工厂|村委会|居委会|政府|县委|派出所|学校|幼儿园|银行|ATM|移动|联通|电信|彩票|快递|物流|设计|装饰|工程|工作室|事务所|策划|传媒|文化传播|咨询/;

  function relevantName(name, category) {
    const n = cleanName(name);
    if (!n || NEGATIVE_WORDS.test(n)) return false;
    if (category === 'attraction') {
      if (/^(?:观景台|观景平台|拍照点|打卡点)$/.test(n)) return false;
      if (/停车场|入口$|出口$/.test(n)) return false;
      return /景区|风景|名胜|博物馆|纪念馆|遗址|公园|古镇|古城|寺|庙|山|湖|沟|寨|关|桥|观景|索道|游客中心|故里|庄园|洞|峡|草原|湿地|温泉|营地|瀑布|石窟|楼|塔|冰川/.test(n);
    }
    if (category === 'lodging') return /酒店|宾馆|民宿|客栈|旅馆|度假|山庄|公寓|营地|驿站|庄园/.test(n);
    if (category === 'food') return /餐厅|饭店|食堂|美食|火锅|烧烤|小吃|面馆|菜馆|咖啡馆|咖啡|餐吧|食府|酒家|汤锅|藏餐|川菜|农家/.test(n);
    if (category === 'fuel') return /加油站|加气站|能源站|中国石化|中国石油|中石化|中石油|壳牌/.test(n);
    if (category === 'charging') return /充电站|充电桩|充电|国家电网|特来电|星星充电|云快充|蔚来|小鹏|特斯拉/.test(n);
    return false;
  }

  function qualityOf(item) {
    const name = cleanName(item && item.name);
    let score = 0;
    const badges = [];
    if (BRANDS.test(name)) { score += 22; badges.push('品牌'); }
    if (QUALITY_WORDS.test(name)) { score += 14; badges.push('口碑关键词'); }
    if (item && item.category === 'lodging' && /酒店|度假|庄园/.test(name)) score += 6;
    if (item && item.category === 'food' && /火锅|汤锅|藏餐|川菜|老字号|人气/.test(name)) score += 8;
    if (item && item.category === 'fuel' && /中国石化|中国石油|中石化|中石油|壳牌/.test(name)) score += 10;
    if (item && item.category === 'charging' && /国家电网|特来电|星星充电|云快充/.test(name)) score += 10;
    if (item && item.curated) { score += 34; badges.unshift('OTA 口碑精选'); }
    if (item && item.rating != null) score += Math.max(0, (Number(item.rating) - 4) * 12);
    if (/^(?:民宿民家|民宿|酒店|宾馆|餐厅|饭店|观景台|农家乐)$/.test(name)) score -= 18;
    if (/设计|装饰|工程|工作室|事务所|公司|咨询/.test(name)) score -= 40;
    return { score, badges: [...new Set(badges)] };
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
    const latPad = Math.max(0.04, Number(radiusM || 1000) / 111320 * 1.6);
    const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const lonPad = Math.max(0.04, Number(radiusM || 1000) / (111320 * Math.max(0.2, Math.cos(toRad(midLat)))) * 1.6);
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
      // 同名且相距很近的天地图/高德重复点，保留高德（字段更全、带评分）
      const near = out.find(existing => existing.category === item.category
        && existing.name.replace(/\s+/g, '') === item.name.replace(/\s+/g, '')
        && haversineM(existing, item) < 1500);
      if (near) {
        if (item.source === '高德地图' && near.source !== '高德地图') Object.assign(near, item);
        return;
      }
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
    return near.slice(0, limit || 200);
  }

  /** 把人工精选合并进 POI 结果（按距离与名称去重） */
  function mergeCurated(items, metrics, radiusM) {
    const out = (items || []).slice();
    CURATED.forEach(entry => {
      const near = nearestOnRoute(entry, metrics);
      if (!Number.isFinite(near.distanceM) || near.distanceM > radiusM + 800) return;
      const base = Object.assign({}, entry, {
        id: `curated:${entry.category}:${entry.lat.toFixed(4)}:${entry.lon.toFixed(4)}`,
        source: 'OTA 口碑精选',
        curated: true,
        distanceM: near.distanceM,
        routeKm: near.routeKm,
        ratio: near.ratio,
      });
      const existing = out.find(item => item.category === entry.category
        && (item.name.indexOf(entry.key) >= 0 || entry.key.indexOf(item.name) >= 0
          || item.name === entry.name));
      if (existing) {
        Object.assign(existing, {
          curated: true,
          curatedNote: entry.note,
          curatedTags: entry.tags,
          rating: existing.rating != null ? existing.rating : entry.rating,
        });
      } else {
        out.push(base);
      }
    });
    return out;
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

  /** 高德 Key：优先 localStorage（报告里可临时填），其次 js/config.js */
  function amapKey() {
    try {
      const stored = root.localStorage && root.localStorage.getItem('rwc:amapKey');
      if (stored) return stored.trim();
    } catch (e) { /* ignore */ }
    return typeof AMAP_KEY !== 'undefined' ? String(AMAP_KEY || '').trim() : '';
  }

  /**
   * 高德地图 Web 服务：沿路线取若干中心点，查 10 km 内的加油站/充电站。
   * 高德返回 GCJ-02，这里用 map.js 的 GCJ.gcj2wgs 转回 WGS-84 后再参与距离计算。
   */
  async function fetchAmapAlongRoute(coords, mode) {
    const key = amapKey();
    if (!key || typeof fetchJson !== 'function') {
      return { ok: false, items: [], reason: 'no-key', meta: { ok: false, reason: 'no-key' } };
    }
    const metrics = routeMetrics(coords);
    if (metrics.coords.length < 2 || metrics.totalM <= 0) {
      return { ok: false, items: [], reason: 'no-route', meta: { ok: false, reason: 'no-route' } };
    }
    const centerCount = Math.max(3, Math.min(10, Math.ceil(metrics.totalM / 25000)));
    const centers = [];
    for (let i = 0; i < centerCount; i++) {
      const idx = Math.round(i / (centerCount - 1) * (metrics.coords.length - 1));
      centers.push(metrics.coords[idx]);
    }

    const items = [];
    let failed = 0;
    for (let i = 0; i < centers.length; i += 3) {
      const batch = centers.slice(i, i + 3);
      const results = await Promise.all(batch.map(async center => {
        const params = new URLSearchParams({
          key,
          location: `${Number(center.lon).toFixed(6)},${Number(center.lat).toFixed(6)}`,
          radius: '12000',
          types: '010100|011100',
          offset: '25',
          page: '1',
          extensions: 'all',
          citylimit: 'false',
        });
        try {
          return await fetchJson(`https://restapi.amap.com/v3/place/around?${params}`, 9000);
        } catch (e) {
          failed++;
          return null;
        }
      }));
      results.forEach(payload => {
        if (!payload || payload.status !== '1' || !Array.isArray(payload.pois)) return;
        payload.pois.forEach(poi => {
          const name = cleanName(poi && poi.name);
          if (!name || NEGATIVE_WORDS.test(name)) return;
          const pair = String(poi.location || '').split(',').map(Number);
          if (!Number.isFinite(pair[0]) || !Number.isFinite(pair[1])) return;
          let lat = pair[1];
          let lon = pair[0];
          if (typeof GCJ !== 'undefined' && GCJ.gcj2wgs) {
            const wgs = GCJ.gcj2wgs(lat, lon);
            lat = wgs.lat;
            lon = wgs.lon;
          }
          const typecode = String(poi.typecode || '');
          const category = typecode.indexOf('011100') === 0 || /充电/.test(name) ? 'charging' : 'fuel';
          if (!relevantName(name, category)) return;
          const rating = Number(poi.biz_ext && poi.biz_ext.rating);
          items.push({
            id: `amap:${poi.id || `${lat.toFixed(5)}:${lon.toFixed(5)}:${name}`}`,
            name,
            category,
            lat,
            lon,
            address: cleanName(poi.address),
            phone: cleanName(poi.tel),
            poiType: typecode,
            source: '高德地图',
            rating: Number.isFinite(rating) && rating > 0 ? Math.round(rating * 10) / 10 : null,
            amap: true,
          });
        });
      });
      if (i + 3 < centers.length) await new Promise(resolve => setTimeout(resolve, 160));
    }
    return {
      ok: failed < centers.length,
      items,
      meta: { ok: failed < centers.length, degraded: failed > 0, centers: centers.length, failed, source: '高德地图' },
    };
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
      amapKey() ? 'amap' : 'tdt',
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

    const results = [];
    const amapPromise = amapKey() ? fetchAmapAlongRoute(metrics.coords, mode).catch(e => {
      console.warn('[poi] 高德 POI 获取失败：', e);
      return { ok: false, items: [], meta: { ok: false, degraded: true, reason: 'amap-failed' } };
    }) : Promise.resolve(null);
    // 天地图对并发比较敏感：每批 3 个关键词，批间留出间隔，失败再补一次。
    for (let i = 0; i < jobs.length; i += 3) {
      const batch = jobs.slice(i, i + 3);
      const batchResults = await Promise.all(batch.map(async job => {
        try {
          const payload = await queryWithRetry(job.keyword, bounds.mapBound, options.count || 60);
          return { job, items: normalizeResponse(payload, job.category) };
        } catch (e) {
          return { job, items: [], error: e };
        }
      }));
      results.push(...batchResults);
      if (i + 3 < jobs.length) await new Promise(resolve => setTimeout(resolve, 180));
    }

    // 失败的关键词再补一轮（有时只是瞬时限流）
    const retryJobs = results.filter(result => result.error).map(result => result.job);
    if (retryJobs.length) {
      await new Promise(resolve => setTimeout(resolve, 700));
      for (const job of retryJobs) {
        try {
          const payload = await queryKeyword(job.keyword, bounds.mapBound, options.count || 60);
          const index = results.findIndex(result => result.job === job);
          if (index >= 0) results[index] = { job, items: normalizeResponse(payload, job.category) };
        } catch (e) { /* 保留失败结果 */ }
      }
    }

    const amap = await amapPromise;
    const failed = results.filter(result => result.error).length;
    const all = results.flatMap(result => result.items);
    if (amap && Array.isArray(amap.items) && amap.items.length) all.push(...amap.items);
    const merged = mergeCurated(all, metrics, settings.radiusM);
    const items = enrichNearRoute(merged, metrics, settings.radiusM, options.limit || 200);
    const response = {
      ok: failed < results.length,
      items,
      meta: {
        ok: failed < results.length,
        degraded: failed > 0 || !!(amap && amap.meta && amap.meta.degraded),
        failedQueries: failed,
        queryCount: results.length,
        radiusM: settings.radiusM,
        mode,
        fetchedAt: Date.now(),
        curated: items.filter(item => item.curated).length,
        amap: !!(amap && amap.ok && amap.items.length),
        amapCount: amap && amap.items ? amap.items.length : 0,
        amapConfigured: !!amapKey(),
      },
    };
    // 只缓存完整结果；降级结果不缓存，用户切换/重试时还能补齐
    if (response.ok && failed === 0) writeCache(cacheKey, response);
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
      drive: { attraction: 4, food: 12, lodging: 10, fuel: 6, charging: 6 },
      bike: { attraction: 9, food: 13, lodging: 8, charging: 6 },
      hike: { attraction: 12, food: 10, lodging: 13 },
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
      const quality = qualityOf(item);
      let score = 72 - detourRatio * 40 + (weights[item.category] || 0) + quality.score;
      const tags = [];

      if (item.category === 'food') {
        const lunch = etaHour >= 10.5 && etaHour <= 14.5;
        const dinner = etaHour >= 17 && etaHour <= 20.5;
        if (lunch || dinner) {
          score += 18;
          tags.push(lunch ? '午餐时段' : '晚餐时段');
        }
        var reason = (lunch || dinner)
          ? `预计 ${clockLabel(etaMin)} 经过，适合安排${lunch ? '午餐' : '晚餐'}；${quality.badges.length ? quality.badges.join(' · ') : '按路线位置排序'}`
          : `预计 ${clockLabel(etaMin)} 经过，适合沿途用餐`;
      } else if (item.category === 'lodging') {
        const late = etaHour >= 17 || etaHour < 1;
        const nearEnd = ratio >= 0.58;
        if (late || (durationMin >= 300 && nearEnd)) {
          score += 16;
          tags.push(late ? '适合落脚' : '长行程住宿');
        }
        var reason = late
          ? `预计 ${clockLabel(etaMin)} 到达，适合安排住宿${item.curatedNote ? '；' + item.curatedNote : ''}`
          : (item.curatedNote || (durationMin >= 300 && nearEnd ? '靠近路线后段，适合长行程中途住宿' : '距路线较近，可作为休息落脚点'));
      } else if (item.category === 'fuel' || item.category === 'charging') {
        const middle = ratio >= 0.15 && ratio <= 0.9;
        if (mode === 'drive' && totalKm >= 50 && middle) {
          score += 15;
          tags.push('长途中段补给');
        } else if (mode === 'bike' && item.category === 'charging') {
          score += 7;
          tags.push('骑行能源补给');
        }
        var reason = tags.length ? tags[0] : `距路线 ${distanceLabel(item.distanceM)}，便于临时补给`;
      } else {
        if (mode === 'bike' || mode === 'hike') score += (Number(item.distanceM) || 0) <= 700 ? 8 : 3;
        if (ratio >= 0.25 && ratio <= 0.82) tags.push('途中短停');
        var reason = item.curatedNote || (tags.length
          ? `距路线 ${distanceLabel(item.distanceM)}，适合途中短停`
          : `预计 ${clockLabel(etaMin)} 经过，距路线 ${distanceLabel(item.distanceM)}`);
      }

      return Object.assign({}, item, {
        score: Math.round(score * 10) / 10,
        ratio,
        etaMin,
        etaLabel: etaLabel,
        distanceLabel: distanceLabel(item.distanceM),
        qualityBadges: quality.badges,
        reason,
        tags,
      });
    }).sort((a, b) => b.score - a.score);

    const groups = {};
    scored.forEach(item => { (groups[item.category] || (groups[item.category] = [])).push(item); });
    const diversified = [];
    const categories = ['food', 'lodging', 'attraction', 'fuel', 'charging'];
    const usedSegments = new Set();
    for (let round = 0; round < 8; round++) {
      categories.forEach(category => {
        const bucket = groups[category] || [];
        // 同一轮尽量避开已用过的 30 km 区段，避免 6 张卡全挤在一个镇上
        let item = bucket.find(x => !usedSegments.has(`${category}:${Math.floor((x.routeKm || 0) / 30)}`));
        if (!item) item = bucket[round];
        if (!item) return;
        usedSegments.add(`${category}:${Math.floor((item.routeKm || 0) / 30)}`);
        diversified.push(item);
      });
    }

    return {
      items: diversified,
      mode,
      modeLabel: MODE_LABEL[mode] || '自驾',
      radiusM: settings.radiusM,
      nearbyCount: (items || []).length,
      note: `${MODE_LABEL[mode] || '自驾'}模式，按品牌/口碑关键词、预计经过时段与绕行距离排序；住宿与景点可跳转大众点评 / 去哪儿复核`,
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
    mergeCurated,
    personalize,
    fetchAlongRoute,
    qualityOf,
    CURATED,
  };

  root.RoutePois = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);
