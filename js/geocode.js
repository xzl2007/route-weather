/* ============================================================
 * 全国地名搜索（天地图 · 多结果）
 * ------------------------------------------------------------
 * 之前用 geocoder 接口只返回「一个最佳点」，像「黑水」会被解析到
 * 陕西宁强的黑水，而四川阿坝的黑水县根本不会出现。
 *
 * 现在改用天地图 v2/search：
 *   · 一次返回多个 POI，带完整行政区地址与经纬度
 *   · 本地再按「行政区级别 / 景区 / 精确名称」重排，避免被
 *     机场、酒店、村委会之类的结果挤到前面
 *   · 保留 geocoder 作为兜底（v2 不可用时仍能搜到一个点）
 *
 * 接口均为浏览器端 CORS 开放；坐标 CGCS2000，与 WGS-84 基本一致。
 * ============================================================ */

const Geocode = {
  cache: new Map(),
  MAX_CACHE: 200,
  CHINA_BOUND: '73,3,136,54',

  get enabled() {
    return typeof TIANDITU_KEY === 'string' && TIANDITU_KEY.length > 0;
  },

  /** 逆地理编码：坐标 → 地名（天地图，浏览器端 Key） */
  async reverse(lat, lon) {
    if (!isFinite(lat) || !isFinite(lon) || !this.enabled) return null;
    const key = 'rev:' + Number(lat).toFixed(4) + ',' + Number(lon).toFixed(4);
    if (this.cache.has(key)) return this.cache.get(key);
    try {
      const postStr = encodeURIComponent(JSON.stringify({ lon: Number(lon), lat: Number(lat), ver: 1 }));
      const url = `https://api.tianditu.gov.cn/geocoder?postStr=${postStr}&type=geocode&tk=${TIANDITU_KEY}`;
      const json = await fetchJson(url, 8000);
      const a = (json.result && json.result.addressComponent) || {};
      const name = a.town || a.poi || a.county || a.city || a.province || null;
      if (this.cache.size >= this.MAX_CACHE) this.cache.clear();
      this.cache.set(key, name);
      return name;
    } catch (e) {
      console.warn('[geocode] 逆地理编码失败：', e);
      return null;
    }
  },

  /**
   * 全国地名搜索（多结果）
   * @param {string} keyword
   * @returns {Promise<Array<{name,displayName,lat,lon,address,kind,score,source}>|null>}
   *   null = 请求出错；[] = 确实没搜到
   */
  async search(keyword) {
    const kw = (keyword || '').trim();
    if (!kw || kw.length < 2 || !this.enabled) return [];
    if (this.cache.has(kw)) return this.cache.get(kw);

    let out = [];
    let v2Failed = false;
    try {
      const json = await this._queryV2(kw, this.CHINA_BOUND, 30);
      const pois = json && Array.isArray(json.pois) ? json.pois : [];
      out = pois.map((poi, index) => this._normalize(poi, kw, index)).filter(Boolean);
    } catch (e) {
      v2Failed = true;
      console.warn('[geocode] v2 搜索失败，尝试单点兜底：', e);
    }

    // v2 没结果或请求失败时，用 geocoder 兜底（至少给一个可用的点）
    if (!out.length) {
      const one = await this._queryGeocoder(kw);
      if (one) out = [one];
      else if (v2Failed) return null;
    }

    out = this._rankAndDedupe(out, kw);

    // 命中内置点位库的，也在结果里给出「内置点位」标记，避免重复添加
    if (typeof POINT_LIBRARY !== 'undefined' && Array.isArray(POINT_LIBRARY)) {
      const local = POINT_LIBRARY.find(p => p.name === kw);
      const near = local && out.some(item => Math.abs(item.lat - local.lat) < 0.04 && Math.abs(item.lon - local.lon) < 0.04);
      if (local && !near) {
        out.push({
          name: local.name,
          displayName: local.name,
          lat: local.lat,
          lon: local.lon,
          address: local.region || '内置点位',
          kind: '内置点位',
          score: 60,
          source: '内置点位库',
        });
      }
    }

    if (this.cache.size >= this.MAX_CACHE) this.cache.clear();
    this.cache.set(kw, out);
    return out;
  },

  /** 天地图 v2 多结果搜索 */
  async _queryV2(kw, mapBound, count) {
    const postStr = JSON.stringify({
      keyWord: kw,
      level: 12,
      mapBound: mapBound || this.CHINA_BOUND,
      queryType: 1,
      start: 0,
      count: count || 30,
    });
    const url = `https://api.tianditu.gov.cn/v2/search?postStr=${encodeURIComponent(postStr)}&type=query&tk=${encodeURIComponent(TIANDITU_KEY)}`;
    return fetchJson(url, 10000);
  },

  /** 天地图地理编码：单点兜底 */
  async _queryGeocoder(kw) {
    try {
      const ds = encodeURIComponent(JSON.stringify({ keyWord: kw }));
      const json = await fetchJson(`https://api.tianditu.gov.cn/geocoder?ds=${ds}&tk=${TIANDITU_KEY}`, 8000);
      const loc = json.location || (json.result && json.result.location);
      if (!loc) return null;
      const lat = Number(loc.lat);
      const lon = Number(loc.lon);
      if (!isFinite(lat) || !isFinite(lon) || lat === 0 || lon === 0) return null;
      return {
        name: kw,
        displayName: kw,
        lat,
        lon,
        address: '',
        kind: loc.level || '地名',
        score: 30,
        source: '天地图地理编码',
      };
    } catch (e) {
      return null;
    }
  },

  _normalize(poi, kw, index) {
    const name = this._clean(poi && poi.name);
    const address = this._clean(poi && poi.address);
    const pair = String((poi && poi.lonlat) || '').split(',').map(Number);
    const lon = pair[0];
    const lat = pair[1];
    if (!name || !isFinite(lat) || !isFinite(lon)) return null;

    const kind = this._kindOf(name, address);
    const region = this._regionOf(address);
    const displayName = this._displayName(name, region, kind);

    return {
      name,
      displayName,
      lat,
      lon,
      address,
      region,
      kind,
      score: this._scoreOf(name, address, kind, kw),
      source: '天地图',
      sourceIndex: index,
      poiType: this._clean(poi && poi.poiType),
      phone: this._clean(poi && poi.phone),
    };
  },

  _clean(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  },

  _kindOf(name, address) {
    if (/机场|火车站|高铁站|客运站|汽车站/.test(name)) return '交通';
    if (/餐厅|饭店|火锅|烧烤|小吃|面馆|菜馆|食府|酒家|咖啡|野菜|农家/.test(name)) return '餐饮';
    if (/酒店|宾馆|民宿|客栈|旅馆|度假|山庄/.test(name)) return '住宿';
    if (/加油站|加气站|充电站|充电桩/.test(name)) return '补能';
    if (/景区|风景名胜|国家公园|自然保护区|森林公园|地质公园|古镇|古城|游客中心/.test(name + address)) return '景区';
    if (/县$|区$|市$|州$|旗$/.test(name) && !/超市|门市|城市/.test(name)) return '行政区';
    if (/镇$|乡$|街道$/.test(name)) return '乡镇';
    if (/村$|社区$/.test(name)) return '村社';
    if (/政府|县委|县委|人大|政协|局$|委员会|管委会|派出所|卫生院|学校/.test(name)) return '机构';
    return '兴趣点';
  },

  _regionOf(address) {
    const text = this._clean(address);
    if (!text) return '';
    const provinces = /^(北京市|天津市|上海市|重庆市|河北省|山西省|辽宁省|吉林省|黑龙江省|江苏省|浙江省|安徽省|福建省|江西省|山东省|河南省|湖北省|湖南省|广东省|海南省|四川省|贵州省|云南省|陕西省|甘肃省|青海省|台湾省|内蒙古自治区|广西壮族自治区|西藏自治区|宁夏回族自治区|新疆维吾尔自治区|香港特别行政区|澳门特别行政区)/;
    const parts = [];
    let rest = text;
    const p = rest.match(provinces);
    if (p) {
      parts.push(p[1]);
      rest = rest.slice(p[1].length);
    }
    const c = rest.match(/^(.{2,15}?(?:市|自治州|地区|盟))/);
    if (c) {
      parts.push(c[1]);
      rest = rest.slice(c[1].length);
    }
    const d = rest.match(/^(.{2,15}?(?:县|区|旗|市))/);
    if (d) parts.push(d[1]);
    return parts.join(' · ');
  },

  _displayName(name, region, kind) {
    const short = (region || '').split(' · ').filter(Boolean);
    const tail = short.length ? short[short.length - 1] : '';
    if (!tail || name.indexOf(tail) >= 0) return name;
    // 两字地名很容易重名（黑水 / 新都桥），补一个行政区尾缀
    if (name.length <= 4 && /行政区|乡镇|村社/.test(kind)) return `${name}（${tail}）`;
    return name;
  },

  _scoreOf(name, address, kind, kw) {
    let score = 0;
    const scenicQuery = /(?:景区|风景|雪山|冰川|古镇|古城|温泉|沟|湖|山|草原|湿地|寨|寺|关)$/.test(kw);
    if (name === kw) score += 50;
    else if (name.indexOf(kw) === 0) score += 24;
    else if (name.indexOf(kw) >= 0) score += 12;

    // 「黑水」→「黑水县」这类行政区补全，必须排在最前；
    // 但「四姑娘山」这种景区名，不能让「四姑娘山镇」压过风景名胜区。
    const adminSuffix = /(?:县|区|市|州|旗|镇|乡)$/;
    if (name.indexOf(kw) === 0 && adminSuffix.test(name) && name.length <= kw.length + 2) score += 62;
    if (scenicQuery && kind === '乡镇') score -= 50;
    if (scenicQuery && kind === '景区') score += 30;

    if (kind === '景区') score += 34;
    if (kind === '行政区') score += 18;
    if (kind === '乡镇') score += 8;
    if (kind === '交通') score -= 26;
    if (kind === '住宿' || kind === '餐饮') score -= 18;
    if (kind === '机构') score -= 24;
    if (kind === '村社') score -= 16;

    // 景区 / 目的地类关键词，优先风景名胜而不是机场酒店
    if (/景区|风景|雪山|冰川|古镇|古城|温泉|草原|湿地|沟|湖|山|关|寨|寺|庙/.test(name)) score += 10;
    if (/(?:景区|风景区|风景名胜区|国家公园|自然保护区)$/.test(name)) score += 20;
    if (/游客中心|售票处|验票|服务点|观景台|停车场|管理局|管委会/.test(name)) score -= 30;
    if (/机场|火车站|客运站/.test(name)) score -= 20;
    if (/管理局|管委会|政府|县委|村委会|停车场|收费站/.test(name)) score -= 28;
    if (/酒店|宾馆|民宿|客栈|餐厅|饭店|加油站|充电站/.test(name)) score -= 12;
    if (/野菜|农家|餐|食府|酒家|火锅|烧烤/.test(name)) score -= 18;

    // 地址里有完整省/州/县，说明是可靠行政区结果
    if (/省|自治区/.test(address)) score += 4;
    return score;
  },

  _rankAndDedupe(items, kw) {
    const sorted = (items || []).filter(Boolean).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN');
    });
    const out = [];
    for (const item of sorted) {
      const dup = out.find(existing => this._samePlace(existing, item));
      if (!dup) out.push(item);
    }
    return out.slice(0, 20);
  },

  _samePlace(a, b) {
    if (!a || !b) return false;
    const sameName = String(a.name).replace(/\s+/g, '') === String(b.name).replace(/\s+/g, '');
    const close = Math.abs(Number(a.lat) - Number(b.lat)) < 0.008
      && Math.abs(Number(a.lon) - Number(b.lon)) < 0.008;
    return sameName && close;
  },
};
