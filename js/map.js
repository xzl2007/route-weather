/* ============================================================
 * 地图模块（Leaflet，本地化于 vendor/leaflet）
 * ------------------------------------------------------------
 * 瓦片：提供「普通」「地形」「影像」三种底图；
 * 用途：
 *   · 报告页 —— 路线可视化，点位按评分着色，点击点位联动下方卡片
 *   · 新建页 —— 边加点边画线，可直接点地图选点
 * ============================================================ */

/**
 * 底图源
 * gcj: true 表示该底图使用 GCJ-02（中国国测局）坐标系，
 *      绘制前必须把 WGS-84 坐标偏移过去，否则点位会偏几百米。
 *      当前底图使用 WGS-84 / CGCS2000 坐标，可直接使用路由与天气坐标。
 *
 * TIANDITU_KEY 定义在 js/config.js（地图与地名搜索共用）
 */

function tdtUrl(layer) {
  return `https://t{s}.tianditu.gov.cn/${layer}_w/wmts`
    + `?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=default`
    + `&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`
    + `&tk=${TIANDITU_KEY}`;
}

function buildTileLayers() {
  // 只提供普通、地形和影像三种底图。
  // 优先用天地图（国内访问快、路网与注记完整）；没有 Key 时退回 OSM / Esri。
  if (TIANDITU_KEY) {
    return [
      {
        name: '普通',
        url: tdtUrl('vec'),
        opts: {
          subdomains: '01234567',
          maxZoom: 18,
          attribution: '底图 &copy; <a href="https://www.tianditu.gov.cn/">天地图</a>（国家地理信息公共服务平台）'
        },
        extras: [{ url: tdtUrl('cva'), opts: { subdomains: '01234567', maxZoom: 18, attribution: '' } }],
        gcj: false,
      },
      {
        name: '地形',
        url: tdtUrl('ter'),
        opts: {
          subdomains: '01234567',
          maxZoom: 18,
          attribution: '地形 &copy; <a href="https://www.tianditu.gov.cn/">天地图</a>'
        },
        extras: [{ url: tdtUrl('cta'), opts: { subdomains: '01234567', maxZoom: 18, attribution: '' } }],
        gcj: false,
      },
      {
        name: '影像',
        url: tdtUrl('img'),
        opts: {
          subdomains: '01234567',
          maxZoom: 18,
          attribution: '影像 &copy; <a href="https://www.tianditu.gov.cn/">天地图</a>'
        },
        extras: [{ url: tdtUrl('cia'), opts: { subdomains: '01234567', maxZoom: 18, attribution: '' } }],
        // 天地图 WMTS 使用 CGCS2000 / Web Mercator，与 WGS-84 路由点近似一致；不做 GCJ-02 偏移。
        gcj: false,
      },
    ];
  }

  return [
    {
      name: '普通',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      opts: {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      },
      gcj: false,
    },
    {
      name: '地形',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      opts: {
        maxZoom: 19,
        attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a> — Esri, HERE, Garmin, USGS, NGA'
      },
      gcj: false,
    },
    {
      name: '影像',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      opts: {
        maxZoom: 19,
        attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community'
      },
      extras: [{
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        opts: { maxZoom: 19, attribution: '' }
      }],
      gcj: false,
    },
  ];
}

const TILE_LAYERS = buildTileLayers();

/** 全局偏好的底图序号（切换后重建时沿用） */
const prefersTouchMap = (navigator.maxTouchPoints || 0) > 0
  || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
let preferredTileIdx = TILE_LAYERS.findIndex(layer => layer.name === '普通');
if (preferredTileIdx < 0) preferredTileIdx = 0;

/* ---------------- WGS-84 → GCJ-02 坐标纠偏 ---------------- */
/* 用途：OPEN-METEO / OSRM 返回的都是 WGS-84，而高德瓦片是 GCJ-02。
   不做转换，点位会偏 300–700 米。算法为标准公开实现。 */

const GCJ = {
  a: 6378245.0,
  ee: 0.00669342162296594323,

  outOfChina(lat, lon) {
    return !(lon > 73.66 && lon < 135.05 && lat > 3.86 && lat < 53.55);
  },

  _tLat(x, y) {
    let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
    r += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
    r += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
    return r;
  },

  _tLon(x, y) {
    let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
    r += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
    r += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
    return r;
  },

  wgs2gcj(lat, lon) {
    if (this.outOfChina(lat, lon)) return { lat, lon };
    let dLat = this._tLat(lon - 105, lat - 35);
    let dLon = this._tLon(lon - 105, lat - 35);
    const radLat = lat / 180 * Math.PI;
    let magic = Math.sin(radLat);
    magic = 1 - this.ee * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180) / ((this.a * (1 - this.ee)) / (magic * sqrtMagic) * Math.PI);
    dLon = (dLon * 180) / (this.a / sqrtMagic * Math.cos(radLat) * Math.PI);
    return { lat: lat + dLat, lon: lon + dLon };
  },

  /** GCJ-02 → WGS-84（迭代逼近，用于把地图点击位置转回真实坐标） */
  gcj2wgs(lat, lon) {
    if (this.outOfChina(lat, lon)) return { lat, lon };
    let wLat = lat, wLon = lon;
    for (let i = 0; i < 3; i++) {
      const g = this.wgs2gcj(wLat, wLon);
      wLat += lat - g.lat;
      wLon += lon - g.lon;
    }
    return { lat: wLat, lon: wLon };
  },
};

const PIN_COLORS = {
  good: '#12B76A',
  fair: '#FFB400',
  caution: '#FF6B00',
  bad: '#FF4D4F',
  neutral: '#0091FF',
  start: '#12B76A',
  end: '#FF4D4F',
};

/** 高德风格路线配色 */
const ROUTE_STYLE = {
  main: '#0091FF',   // 品牌蓝主线
  casing: '#FFFFFF', // 白色描边
  mainWeight: 6,
  casingWeight: 11,
};

const WEATHER_ROUTE_COLORS = {
  good: '#28A879',
  fair: '#D7A326',
  caution: '#E77832',
  bad: '#D95050',
  neutral: '#8595A6',
};

function mapEscape(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function weatherPopupHtml(point, index) {
  const levels = {
    good: ['影响较小', 'good'], fair: ['一般影响', 'fair'],
    caution: ['需要关注', 'caution'], bad: ['影响较强', 'bad'],
    neutral: ['数据不足', 'neutral'],
  };
  const key = point && point.level ? point.level.key : 'neutral';
  const level = levels[key] || levels.neutral;
  const available = point && point.weatherDataAvailable !== false;
  const arrivalMin = point && point.arriveAbs != null ? Math.round(point.arriveAbs * 60)
    : point && point.hour != null ? Math.round(point.hour * 60) : null;
  const arrival = arrivalMin == null ? '—' : minToLabel(arrivalMin);
  const distance = point && point.cumKm != null ? `${Number(point.cumKm).toFixed(0)} km` : '—';
  const weather = point && point.weatherText ? mapEscape(point.weatherText) : '暂无预报';
  const temperature = point && point.temp != null ? `${Math.round(point.temp)}℃` : '—';
  const precipitation = point && point.pp != null ? `${Math.round(point.pp)}%` : '—';
  const wind = point && point.wind != null ? `${Math.round(point.wind)} km/h` : '—';
  const position = point && Number.isFinite(point.lat) && Number.isFinite(point.lon)
    ? `${point.lat.toFixed(3)}, ${point.lon.toFixed(3)}` : '—';
  const evidence = available
    ? [point && point.code != null ? weather : '', point && point.pp != null ? `降水概率 ${Math.round(point.pp)}%` : '', point && point.wind != null ? `风速 ${Math.round(point.wind)} km/h` : '']
      .filter(Boolean).join(' · ') || '已返回的沿途天气数据'
    : '该采样点未返回可用天气字段，路线以中性样式显示。';

  return `<div class="weather-popup">
    <div class="popup-eyebrow">沿途采样 ${String(index + 1).padStart(2, '0')} <span class="popup-distance">${distance}</span></div>
    <div class="popup-heading"><strong>${mapEscape(point && point.name || '路线采样点')}</strong><span class="impact-chip ${level[1]}">${level[0]}</span></div>
    <div class="popup-weather">${point && point.icon ? mapEscape(point.icon) + ' ' : ''}${weather}<span>${temperature}</span></div>
    <div class="popup-grid"><span>预计到达<b>${arrival}</b></span><span>降水概率<b>${precipitation}</b></span><span>风速<b>${wind}</b></span><span>位置<b>${position}</b></span></div>
    <div class="popup-evidence"><small>天气影响依据</small><span>${mapEscape(evidence)}</span></div>
  </div>`;
}

const MapCtl = {
  report: null,
  create: null,
  baseLayers: [],

  /** 是否桌面端（有精确指针、支持 hover） */
  isDesktop() {
    try {
      return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    } catch (e) {
      return true;
    }
  },

  _makeMap(containerId) {
    const desktop = this.isDesktop();

    const map = L.map(containerId, {
      zoomControl: false,
      attributionControl: true,
      // 滚轮与双击缩放：桌面端才启用（触屏用双指捏合，避免劫持页面滚动）
      scrollWheelZoom: false,      // 由 hover 动态开关，见下
      doubleClickZoom: desktop,
      tap: true,
      // 缩放范围：太小没意义，太大瓦片会糊
      minZoom: 4,
      maxZoom: 17,
    });

    // 缩放按钮（桌面端显示，触屏由 CSS 隐藏）
    try {
      const zoom = L.control.zoom({
        position: 'topleft',
        zoomInTitle: '放大',
        zoomOutTitle: '缩小',
      });
      zoom.addTo(map);
      map.__zoomCtl = zoom;
    } catch (e) {
      console.warn('[map] 缩放控件添加失败：', e);
    }

    if (desktop) {
      // 用容器边界管理滚轮，避免 Leaflet 在地图重建后丢失 hover 状态。
      // 地图重绘时鼠标可能仍停在原位置，因此注册后立即恢复当前 hover 状态。
      const container = map.getContainer();
      const enableWheelZoom = () => { try { map.scrollWheelZoom.enable(); } catch (e) {} };
      const disableWheelZoom = () => { try { map.scrollWheelZoom.disable(); } catch (e) {} };
      const cleanup = () => {
        container.removeEventListener('mouseenter', enableWheelZoom);
        container.removeEventListener('mouseleave', disableWheelZoom);
      };
      container.addEventListener('mouseenter', enableWheelZoom);
      container.addEventListener('mouseleave', disableWheelZoom);
      map.__wheelZoomCleanup = cleanup;
      map.once('unload', cleanup);
      if (container.matches && container.matches(':hover')) enableWheelZoom();
    }

    return map;
  },

  layerIndex: 0,

  _addTiles(map, idx, tried) {
    tried = tried || {};
    const conf = TILE_LAYERS[idx] || TILE_LAYERS[0];
    tried[idx] = true;

    if (map.__tileRetryTimer) {
      clearTimeout(map.__tileRetryTimer);
      map.__tileRetryTimer = null;
    }
    map.__tileIdx = idx;
    map.__gcj = !!conf.gcj;
    const layer = L.tileLayer(conf.url, conf.opts);
    let handled = false;
    let loadedAnyTile = false;

    layer.on('tileload', () => {
      if (map.__tileIdx !== idx) return;
      loadedAnyTile = true;
      preferredTileIdx = idx;
      if (map.__tileRetryTimer) {
        clearTimeout(map.__tileRetryTimer);
        map.__tileRetryTimer = null;
      }
    });

    const failover = () => {
      map.__tileRetryTimer = null;
      if (handled || loadedAnyTile || map.__tileIdx !== idx || !map._container || !document.body.contains(map._container)) return;
      handled = true;
      const nextIdx = TILE_LAYERS.findIndex((_, i) => i !== idx && !tried[i]);
      if (nextIdx >= 0) {
        console.warn('[map] 瓦片源「' + conf.name + '」持续无瓦片加载，自动切换到「' + TILE_LAYERS[nextIdx].name + '」');
        try { map.removeLayer(layer); } catch (e) {}
        (map.__extraLayers || []).forEach(extra => { try { map.removeLayer(extra); } catch (e) {} });
        map.__extraLayers = [];
        this._addTiles(map, nextIdx, tried);
        this._notifyLayer(map, true);
      } else {
        this._showTileFail(map);
      }
    };

    layer.on('tileerror', () => {
      if (handled || loadedAnyTile || map.__tileIdx !== idx || map.__tileRetryTimer) return;
      map.__tileRetryTimer = window.setTimeout(failover, 1600);
    });

    layer.addTo(map);
    // 某些网络请求会长时间挂起而不触发 tileerror。独立看门狗保证底图最终能降级。
    if (!map.__tileRetryTimer) map.__tileRetryTimer = window.setTimeout(failover, 2600);

    // 叠层（如天地图的 cva 注记层）
    map.__extraLayers = [];
    if (Array.isArray(conf.extras)) {
      conf.extras.forEach((ex) => {
        try {
          const el2 = L.tileLayer(ex.url, ex.opts).addTo(map);
          map.__extraLayers.push(el2);
        } catch (e) { console.warn('[map] 叠层加载失败', e); }
      });
    }

    map.__tileLayer = layer;
    map.__tileIdx = idx;
    map.__gcj = !!conf.gcj;   // 当前底图是否需要 GCJ-02 纠偏
    this._notifyLayer(map);
    return layer;
  },

  /** 通知外部（按钮文字 / toast）底图已变化 */
  _notifyLayer(map, automatic = false) {
    const idx = map.__tileIdx || 0;
    const name = (TILE_LAYERS[idx] || {}).name || '';
    const nextIdx = (idx + 1) % TILE_LAYERS.length;
    const btn = document.getElementById('mapToggle');
    if (btn) btn.textContent = TILE_LAYERS[nextIdx].name;
    const btn2 = document.getElementById('btnCreateLayer');
    if (btn2) btn2.textContent = TILE_LAYERS[nextIdx].name;
    if (automatic && typeof window.__onMapLayerChange === 'function') {
      window.__onMapLayerChange(name);
    }
  },

  /** 三套瓦片都失败时的可见提示 + 重试 */
  _showTileFail(map) {
    const wrap = map.getContainer().parentElement;
    if (!wrap || wrap.querySelector('.map-fail')) return;

    const box = document.createElement('div');
    box.className = 'map-fail';
    box.innerHTML = `
      <div class="mf-title">地图瓦片没能加载出来</div>
      <div class="mf-sub">地图瓦片服务不可用；天气数据、评分和列表正常。</div>
      <button class="mf-btn" type="button">重试</button>`;
    box.querySelector('.mf-btn').addEventListener('click', () => {
      box.remove();
      const next = ((map.__tileIdx || 0) + 1) % TILE_LAYERS.length;
      if (map.__tileLayer) { try { map.removeLayer(map.__tileLayer); } catch (e) {} }
      this._addTiles(map, next);
      this._notifyLayer(map);
    });
    wrap.appendChild(box);
  },

  /**
   * 切换底图
   * 关键：底图切换要连同点位一起重建，避免坐标系/图层残留导致的偏移。
   */
  toggleLayer() {
    preferredTileIdx = (preferredTileIdx + 1) % TILE_LAYERS.length;
    const conf = TILE_LAYERS[preferredTileIdx];

    // 清掉可能残留的失败提示
    ['reportMap', 'navMap', 'createMap'].forEach((id) => {
      const el = document.getElementById(id);
      const wrap = el && el.parentElement;
      if (wrap) { const f = wrap.querySelector('.map-fail'); if (f) f.remove(); }
    });

    const alive = (id) => !!document.getElementById(id);

    // 重建报告页地图（导航优先，其次点位）
    const nav = this.__lastNav;
    if (nav && alive(nav.containerId)) {
      this.renderNavigation(nav.containerId, nav.routeCoords, nav.points, nav.onPick);
    } else {
      const rep = this.__lastReport;
      if (rep && alive(rep.containerId)) {
        this.renderReport(rep.containerId, rep.points, rep.onPick);
      }
    }

    // 重建新建页地图
    const cre = this.__lastCreate;
    if (cre && alive(cre.containerId)) {
      this.renderCreate(cre.containerId, cre.points, cre.onMapClick, cre.mode);
    }

    return conf.name;
  },

  /**
   * 点位图标
   * @param {number} index 序号（从 0 开始）
   * @param {string} levelKey 评分等级（决定颜色）
   * @param {boolean} active 是否高亮
   * @param {number} sizeOverride 覆盖尺寸
   * @param {string} labelOverride 覆盖文字（如"起""终"）
   * @param {boolean} bubble true 用高德式圆角气泡，false 用圆形
   */
  _pinIcon(index, levelKey, active, sizeOverride, labelOverride, bubble) {
    const color = PIN_COLORS[levelKey] || PIN_COLORS.neutral;
    const label = labelOverride != null ? String(labelOverride) : String(index + 1);
    const size = sizeOverride || (active ? 34 : 28);

    if (bubble) {
      return L.divIcon({
        className: 'route-pin-wrap',
        html: `<div class="route-bubble${active ? ' on' : ''}" style="--pin:${color}">${label}</div>`,
        iconSize: [30, 30],
        iconAnchor: [13, 26],
      });
    }

    return L.divIcon({
      className: 'route-pin-wrap',
      html: `<div class="route-pin${active ? ' on' : ''}" style="--pin:${color};width:${size}px;height:${size}px">
               <span>${label}</span>
             </div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  },

  /**
   * 起点/终点用气泡，中间点用圆形数字
   * 颜色约定：起 = 绿、终 = 红（沿用地图 App 通行习惯，便于一眼定位）
   * 中间的采样点/途经点用评分色，直观表达"哪一段有问题"
   */
  _iconFor(i, total, levelKey, active, label) {
    if (label != null) {
      if (label === '起') return this._pinIcon(i, 'start', active, 0, '起', true);
      if (label === '终') return this._pinIcon(i, 'end', active, 0, '终', true);
      return this._pinIcon(i, levelKey, active, 0, label);
    }
    if (i === 0) return this._pinIcon(i, 'start', active, 0, '起', true);
    if (i === total - 1) return this._pinIcon(i, 'end', active, 0, '终', true);
    return this._pinIcon(i, levelKey, active);
  },

  /* ---------------- 坐标系转换 ---------------- */

  /**
   * 把 WGS-84 坐标转成当前底图所用坐标系
   * 高德/腾讯底图是 GCJ-02，不转会偏 300–700 米
   */
  _conv(map, lat, lon) {
    if (map && map.__gcj) {
      const g = GCJ.wgs2gcj(lat, lon);
      return [g.lat, g.lon];
    }
    return [lat, lon];
  },

  /* ---------------- 导航模式地图：路径 + 沿路采样点 ---------------- */

  renderNavigation(containerId, routeCoords, points, onPick) {
    this._destroy('report');
    const el = document.getElementById(containerId);
    if (!el || !routeCoords || !routeCoords.length) return;

    // 记住参数，切换底图后要按新坐标系重建
    this.__lastNav = { containerId, routeCoords, points, onPick };
    this.__lastReport = null;

    const map = this._makeMap(containerId);
    this.report = map;
    map.reportMarkers = {};
    map.__points = points;

    this._addTiles(map, preferredTileIdx);

    const line = routeCoords.map(c => this._conv(map, c.lat, c.lon));

    // 基于实际道路几何和采样点累计里程拆分；各段共用边界，缺失数据为中性灰。
    const sections = window.RouteWeatherSegments
      ? RouteWeatherSegments.buildSegments(routeCoords, points)
      : [{ index: -1, point: null, level: 'neutral', coords: routeCoords }];
    map.__routeSections = [];
    sections.forEach(section => {
      const sectionLine = section.coords.map(c => this._conv(map, c.lat, c.lon));
      if (sectionLine.length < 2) return;
      L.polyline(sectionLine, {
        color: ROUTE_STYLE.casing,
        weight: ROUTE_STYLE.casingWeight,
        opacity: 0.94,
        lineJoin: 'round',
        lineCap: 'round',
        className: 'route-weather-casing',
        interactive: false,
      }).addTo(map);
      const lineLayer = L.polyline(sectionLine, {
        color: WEATHER_ROUTE_COLORS[section.level] || WEATHER_ROUTE_COLORS.neutral,
        weight: ROUTE_STYLE.mainWeight,
        opacity: 0.98,
        lineJoin: 'round',
        lineCap: 'round',
        className: `route-weather-line route-${section.level || 'neutral'}`,
      }).addTo(map);
      lineLayer.on('click', () => {
        if (section.index >= 0) this.focusSample(section.index, true);
      });
      map.__routeSections.push(lineLayer);
    });

    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = () => {
      const box = L.DomUtil.create('div', 'weather-legend');
      box.innerHTML = `<div class="legend-title">沿途天气影响</div>
        <div class="legend-items">
          <span><i style="--legend:${WEATHER_ROUTE_COLORS.good}"></i>较小</span>
          <span><i style="--legend:${WEATHER_ROUTE_COLORS.fair}"></i>一般</span>
          <span><i style="--legend:${WEATHER_ROUTE_COLORS.caution}"></i>关注</span>
          <span><i style="--legend:${WEATHER_ROUTE_COLORS.bad}"></i>较强</span>
          <span><i style="--legend:${WEATHER_ROUTE_COLORS.neutral}"></i>数据不足</span>
        </div>`;
      L.DomEvent.disableClickPropagation(box);
      return box;
    };
    legend.addTo(map);

    // 起点用「起」气泡、终点用「终」气泡，中间采样点用数字
    points.forEach((p, i) => {
      const mk = L.marker(this._conv(map, p.lat, p.lon), {
        icon: this._iconFor(i, points.length, p.level ? p.level.key : 'neutral', false, p.pinLabel),
        keyboard: false,
      }).addTo(map);

      const arriveMin = p.arriveAbs != null ? Math.round(p.arriveAbs * 60) : (p.hour != null ? p.hour * 60 : null);
      const arriveClock = arriveMin != null ? minToHM(arriveMin) : null;
      mk.bindTooltip(
        `${i + 1}. ${p.name}${p.weatherText ? ' · ' + p.weatherText : ''}${p.score != null ? ' · ' + p.score + '分' : ''}`
        + (arriveClock != null ? ` · 约 ${arriveClock} 到达` : '')
        + (p.cumKm != null ? ` · ${p.cumKm.toFixed(0)}km` : ''),
        { direction: 'top', offset: [0, -14], opacity: 1, className: 'route-tip' }
      );
      mk.bindPopup(weatherPopupHtml(p, i), {
        maxWidth: 300,
        minWidth: 250,
        closeButton: true,
        className: 'weather-popup-shell',
      });

      mk.on('click', () => { if (typeof onPick === 'function') onPick(i); });

      const navIconEl = mk.getElement();
      if (navIconEl) {
        const pin = navIconEl.querySelector('.route-pin');
        if (pin) {
          pin.style.animation = 'pinPop .42s cubic-bezier(.34,1.56,.64,1) both';
          pin.style.animationDelay = (i * 60) + 'ms';
        }
      }

      map.reportMarkers[i] = mk;
    });

    this._fit(map, line);
    this._observeResize(map, el);
    this._notifyLayer(map);
    return map;
  },

  /* ---------------- 报告页地图 ---------------- */

  renderReport(containerId, points, onPick) {
    this._destroy('report');
    const el = document.getElementById(containerId);
    if (!el || !points.length) return;

    this.__lastReport = { containerId, points, onPick };
    this.__lastNav = null;

    const map = this._makeMap(containerId);
    this.report = map;
    map.reportMarkers = {};
    map.__points = points;

    this._addTiles(map, preferredTileIdx);

    const latlngs = points.map(p => this._conv(map, p.lat, p.lon));

    // Plan mode has sampled route points rather than a road geometry. Color each
    // interval by the weather at its next sample, keeping the estimate explicit.
    for (let i = 1; i < latlngs.length; i++) {
      const section = [latlngs[i - 1], latlngs[i]];
      const p = points[i] || points[i - 1];
      const level = p && p.level ? p.level.key : 'neutral';
      L.polyline(section, {
        color: ROUTE_STYLE.casing,
        weight: ROUTE_STYLE.casingWeight,
        opacity: 0.92,
        lineJoin: 'round',
        lineCap: 'round',
        interactive: false,
      }).addTo(map);
      const lineLayer = L.polyline(section, {
        color: WEATHER_ROUTE_COLORS[level] || WEATHER_ROUTE_COLORS.neutral,
        weight: ROUTE_STYLE.mainWeight,
        opacity: 0.98,
        lineJoin: 'round',
        lineCap: 'round',
        className: `route-weather-line route-${level}`,
      }).addTo(map);
      lineLayer.on('click', () => {
        if (typeof onPick === 'function') onPick(i);
      });
    }

    points.forEach((p, i) => {
      if (p.__showMarker === false) return;
      const mk = L.marker(this._conv(map, p.lat, p.lon), {
        icon: this._iconFor(i, points.length, p.level ? p.level.key : 'neutral', false, p.pinLabel),
        keyboard: false,
      }).addTo(map);

      mk.bindTooltip(`${p.pinLabel ? p.pinLabel + ' ' : (i + 1) + '. '}${p.name}${p.score != null ? ' · ' + p.score + '分' : ''}`, {
        direction: 'top',
        offset: [0, -14],
        opacity: 1,
        className: 'route-tip',
      });

      mk.on('click', () => {
        if (typeof onPick === 'function') onPick(i);
      });

      // 逐点弹入：直接在 addTo 之后同步设置动画，不用 opacity 渐变
      // （曾用 setOpacity(0)+setTimeout，在无头/低性能环境下会出现点位不显示）
      const iconEl = mk.getElement();
      if (iconEl) {
        const pin = iconEl.querySelector('.route-pin');
        if (pin) {
          pin.style.animation = 'pinPop .42s cubic-bezier(.34,1.56,.64,1) both';
          pin.style.animationDelay = (i * 70) + 'ms';
        }
      }

      map.reportMarkers[i] = mk;
    });

    this._fit(map, latlngs);

    // 容器尺寸变化（如旋转屏幕）后重算
    this._observeResize(map, el);
    return map;
  },

  /** 点击点位时高亮对应 marker */
  highlight(index) {
    const map = this.report;
    if (!map || !map.reportMarkers) return;
    Object.entries(map.reportMarkers).forEach(([k, mk]) => {
      const i = Number(k);
      const p = map.__points && map.__points[i];
      mk.setIcon(this._iconFor(i, (map.__points || []).length, p && p.level ? p.level.key : 'neutral', i === index, p && p.pinLabel));
      mk.setZIndexOffset(i === index ? 1000 : 0);
    });
  },

  /** 从采样清单或着色路线定位到对应采样点，并打开天气详情。 */
  focusSample(index, openPopup) {
    const map = this.report;
    const marker = map && map.reportMarkers && map.reportMarkers[index];
    if (!map || !marker) return false;
    this.highlight(index);
    const targetZoom = Math.max(map.getZoom(), 9);
    map.setView(marker.getLatLng(), targetZoom, { animate: true, duration: 0.45 });
    if (openPopup) marker.openPopup();
    const nav = this.__lastNav;
    if (nav && typeof nav.onPick === 'function') nav.onPick(index, { source: 'map' });
    return true;
  },

  /* ---------------- 新建页地图 ---------------- */

  renderCreate(containerId, points, onMapClick, mode) {
    this._destroy('create');
    const el = document.getElementById(containerId);
    if (!el) return;

    const travelMode = mode || 'drive';
    const requestId = (this.__createRouteRequestId || 0) + 1;
    this.__createRouteRequestId = requestId;
    this.__lastCreate = { containerId, points, onMapClick, mode: travelMode, requestId };

    const map = this._makeMap(containerId);
    this.create = map;
    this._addTiles(map, preferredTileIdx);

    const latlngs = points.map(p => this._conv(map, p.lat, p.lon));

    if (latlngs.length > 1) {
      // 路由请求完成前保留轻量方向示意；成功后替换为所选出行方式的真实路网。
      map.__createRouteLayers = [
        L.polyline(latlngs, {
          color: ROUTE_STYLE.casing, weight: ROUTE_STYLE.casingWeight, opacity: 0.42,
          lineJoin: 'round', lineCap: 'round', dashArray: '7 9', interactive: false,
        }).addTo(map),
        L.polyline(latlngs, {
          color: ROUTE_STYLE.main, weight: ROUTE_STYLE.mainWeight, opacity: 0.48,
          lineJoin: 'round', lineCap: 'round', dashArray: '7 9', interactive: false,
        }).addTo(map),
      ];
    }

    points.forEach((p, i) => {
      L.marker(this._conv(map, p.lat, p.lon), { icon: this._pinIcon(i, 'neutral', false) })
        .addTo(map)
        .bindTooltip(`${i + 1}. ${p.name}`, { direction: 'top', offset: [0, -14], opacity: 1, className: 'route-tip' });
    });

    map.on('click', (e) => {
      if (typeof onMapClick === 'function') {
        // 点击位置来自当前底图坐标系，需转回 WGS-84 再存
        const ll = map.__gcj ? GCJ.gcj2wgs(e.latlng.lat, e.latlng.lng) : { lat: e.latlng.lat, lon: e.latlng.lng };
        onMapClick(ll.lat, ll.lon);
      }
    });

    if (latlngs.length) this._fit(map, latlngs);
    else map.setView(this._conv(map, 30.05, 102.7), 7);

    // 延迟请求，合并连续的点位编辑；驾驶、骑行、徒步分别使用各自路网。
    if (points.length > 1 && typeof ROUTING !== 'undefined' && typeof ROUTING.fetchRoute === 'function') {
      map.__createRouteTimer = setTimeout(async () => {
        let route;
        try { route = await ROUTING.fetchRoute(points, travelMode); }
        catch (error) { return; }
        const latest = this.__lastCreate;
        if (!route || !route.ok || this.create !== map || !latest
            || latest.requestId !== requestId || !map._container
            || !document.body.contains(map._container)) return;

        const routeLatLngs = route.coords.map(c => this._conv(map, c.lat, c.lon));
        if (routeLatLngs.length < 2) return;
        (map.__createRouteLayers || []).forEach(layer => { try { map.removeLayer(layer); } catch (e) {} });
        map.__createRouteLayers = [
          L.polyline(routeLatLngs, {
            color: ROUTE_STYLE.casing, weight: ROUTE_STYLE.casingWeight, opacity: 0.94,
            lineJoin: 'round', lineCap: 'round', interactive: false,
          }).addTo(map),
          L.polyline(routeLatLngs, {
            color: ROUTE_STYLE.main, weight: ROUTE_STYLE.mainWeight, opacity: 1,
            lineJoin: 'round', lineCap: 'round', interactive: false,
          }).addTo(map),
        ];
        if (!map.__createUserMoved) this._fit(map, routeLatLngs);
      }, 350);
    }

    // 如果用户缩放或拖动了地图，请求完成时不重置其视野。
    map.on('dragstart zoomstart', () => { map.__createUserMoved = true; });

    this._observeResize(map, el);
    this._notifyLayer(map);
    return map;
  },

  /* ---------------- 工具 ---------------- */

  _fit(map, latlngs) {
    if (!latlngs.length) return;
    if (latlngs.length === 1) {
      map.setView(latlngs[0], 10);
      return;
    }
    // 留白小一点，路线才能占满地图，点位不会挤成一团
    map.fitBounds(L.latLngBounds(latlngs), { padding: [18, 18], maxZoom: 13 });
  },

  _observeResize(map, el) {
    // ResizeObserver 在很旧的移动端浏览器里不存在，缺了不能影响地图显示
    if (typeof ResizeObserver === 'undefined') return;
    try {
      const ro = new ResizeObserver(() => {
        if (map && map._container && document.body.contains(map._container)) {
          map.invalidateSize({ animate: false });
        }
      });
      ro.observe(el);
      map.__ro = ro;
    } catch (e) {
      console.warn('[map] ResizeObserver 不可用，已跳过：', e);
    }
  },

  _destroy(which) {
    const map = this[which];
    if (map) {
      if (map.__createRouteTimer) { clearTimeout(map.__createRouteTimer); map.__createRouteTimer = null; }
      if (map.__tileRetryTimer) { clearTimeout(map.__tileRetryTimer); map.__tileRetryTimer = null; }
      if (map.__ro) { try { map.__ro.disconnect(); } catch (e) {} }
      try { map.remove(); } catch (e) {}
      this[which] = null;
    }
  },

  /** 视图切换后必须调用，否则地图尺寸为 0 会显示错位 */
  refresh(which) {
    const map = this[which];
    if (!map) return;
    // 延迟执行期间地图可能已被重建/销毁，必须确认还是同一个实例
    setTimeout(() => {
      if (this[which] !== map) return;
      if (!map._container || !document.body.contains(map._container)) return;
      try { map.invalidateSize({ animate: false }); } catch (e) { /* 已销毁则忽略 */ }
    }, 60);
  },

  destroyAll() {
    this._destroy('report');
    this._destroy('create');
  },
};
