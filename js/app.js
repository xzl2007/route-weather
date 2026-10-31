/* ============================================================
 * 应用层：视图路由、点位编辑、报告渲染
 * ============================================================ */

const state = {
  view: 'home',
  date: todayStr(),
  mode: 'drive',
  checkMode: 'point',   // point | nav
  departHour: -1,       // 首次进入时设为“现在”
  departOriginal: null, // 用户原始出发时刻，用于“恢复原时间”
  planOriginalTimes: null, // 规划模式：平移前的原始时间
  planOriginalDate: null,  // 规划模式：平移前的原始日期
  libraryFilter: 'all',
  libraryQuery: '',
  reportTab: 'routeAnalysis',
  points: [],           // [{name, lat, lon}]
  times: [],            // 规划模式：每个点位的到达时刻（分钟，0–1439）
  currentReport: null,
  expandIdx: -1,
  dxIdx: -1,
  hourSel: {},          // 每个点位当前查看的小时（默认到达时刻）
  navCtx: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ---------------- 视图切换 ---------------- */

function showView(name) {
  const nextView = $('#view-' + name);
  if (!nextView) return;
  state.view = name;
  document.body.classList.toggle('home-active', name === 'home');
  document.body.classList.toggle('immersive-view', name === 'create' || name === 'report');
  $$('.view').forEach(v => v.classList.remove('active'));
  nextView.classList.add('active');
  if (name !== 'report') toggleReportFullscreen(false);
  if (name !== 'create') toggleCreateFullscreen(false);
  const titles = { home: '探索', create: '路线规划', report: '天气分析', saved: '行程收藏' };
  $('#topTitle').textContent = titles[name] || '探索';
  $$('[data-view]').forEach(button => {
    const active = button.dataset.view === name;
    button.classList.toggle('on', active);
    if (button.closest('.app-nav, .mobile-nav')) button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  window.scrollTo({ top: 0 });
  // 地图容器刚显示时尺寸为 0，必须等布局完成后再初始化/重算
  if (name === 'create') {
    setPlannerSheetCollapsed(false);
    requestAnimationFrame(() => {
      ensureCreateMap();
      MapCtl.refresh('create');
    });
    // 移动端地址栏收缩和安全区布局稳定后再测一次，避免首屏地图只绘出空白块。
    window.setTimeout(() => {
      if (state.view === 'create') MapCtl.refresh('create');
    }, 180);
  }
  if (name === 'report') MapCtl.refresh('report');
  if (name === 'home') renderHome();
  if (name === 'saved') renderSavedTrips();
}

/* ---------------- Toast ---------------- */

let toastTimer = null;
function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

/** 立刻收起提示（切换出行方式时用，避免残留旧文案） */
function hideToast() {
  clearTimeout(toastTimer);
  const el = $('#toast');
  if (el) el.classList.add('hidden');
}

/* ============================================================
 * 首页
 * ============================================================ */

function renderHome() {
  const list = loadHistory();
  const listEl = $('#historyList');
  const homeList = $('#homeList');

  if (!list.length) {
    $('#homeEmpty').classList.remove('hidden');
    homeList.classList.add('hidden');
    return;
  }
  $('#homeEmpty').classList.add('hidden');
  homeList.classList.remove('hidden');

  listEl.innerHTML = list.map(t => {
    const isNav = t.checkMode === 'nav';
    const lv = levelOf(t.routeScore ?? 0);
    return `
      <div class="card trip" data-id="${t.id}">
        <div class="trip-main">
          <div class="trip-route">${escapeHtml(t.routeName)}</div>
          <div class="trip-meta">${t.date} · ${modeText(t.mode)}</div>
        </div>
        <div class="trip-score">
          ${isNav ? '<div class="trip-nav-label">导航天气</div>' : `<div class="score-num ${lv.key}">${t.routeScore}</div>
          <div class="score-lv ${lv.key}">${lv.text}</div>`}
        </div>
      </div>`;
  }).join('');

  $$('#historyList .trip').forEach(el => {
    el.addEventListener('click', () => openTrip(el.dataset.id));
  });
}

const FAVORITE_KEY = 'rwc:favorites';

function loadFavoriteIds() {
  try {
    const ids = JSON.parse(localStorage.getItem(FAVORITE_KEY) || '[]');
    return new Set(Array.isArray(ids) ? ids.filter(x => typeof x === 'string') : []);
  } catch { return new Set(); }
}

function currentTripSignature() {
  return tripSignature({ date: state.date, points: state.points });
}

function toggleFavoriteSignature(signature) {
  const ids = loadFavoriteIds();
  if (ids.has(signature)) ids.delete(signature);
  else ids.add(signature);
  try { localStorage.setItem(FAVORITE_KEY, JSON.stringify([...ids])); }
  catch (e) { console.warn('收藏保存失败：', e); }
  renderSavedTrips();
  return ids.has(signature);
}

function renderSavedTrips() {
  const host = $('#savedTripsGrid');
  if (!host) return;
  const trips = loadHistory();
  const favorites = loadFavoriteIds();
  const count = $('#libraryCount');
  const favoriteCount = $('#libraryFavoriteCount');
  const updated = $('#libraryUpdated');
  if (count) count.textContent = String(trips.length);
  if (favoriteCount) favoriteCount.textContent = String(trips.filter(t => favorites.has(tripSignature(t))).length);
  if (updated) updated.textContent = trips.length && trips[0].savedAt
    ? new Date(trips[0].savedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
    : '—';

  const query = state.libraryQuery.trim().toLocaleLowerCase();
  const visible = trips.filter(t => {
    const signature = tripSignature(t);
    const modeMatch = state.libraryFilter === 'all'
      || (state.libraryFilter === 'favorite' ? favorites.has(signature) : t.mode === state.libraryFilter);
    const text = `${t.routeName || ''} ${t.date || ''} ${modeText(t.mode)}`.toLocaleLowerCase();
    return modeMatch && (!query || text.includes(query));
  });

  if (!trips.length) {
    host.innerHTML = `<div class="library-empty">
      <span class="library-empty-icon">⌁</span>
      <h2>你的山地行程会收录在这里</h2>
      <p>完成一次路线分析后，可以在这里回看天气、路线和出发时段。记录只保存在当前设备。</p>
      <button class="btn btn-primary" type="button" data-view="create">规划第一段路线 <span>↗</span></button>
    </div>`;
    return;
  }
  if (!visible.length) {
    host.innerHTML = '<div class="saved-filter-empty">没有找到符合条件的行程，试试其他关键词或筛选。</div>';
    return;
  }

  host.innerHTML = visible.map((t, index) => {
    const signature = tripSignature(t);
    const isFavorite = favorites.has(signature);
    const isNav = t.checkMode === 'nav';
    const score = Number.isFinite(Number(t.routeScore)) ? Math.round(Number(t.routeScore)) : null;
    return `<article class="saved-route-card" style="--card-order:${index}" data-trip-id="${escapeHtml(t.id)}">
      <div class="saved-card-cover">
        <div class="saved-card-topline">
          <span class="saved-card-mode">${modeText(t.mode)} · ${isNav ? '沿途导航' : '点位规划'}</span>
          <button type="button" class="saved-card-favorite${isFavorite ? ' on' : ''}" data-favorite-signature="${escapeHtml(signature)}" aria-label="${isFavorite ? '取消收藏' : '收藏路线'}" aria-pressed="${isFavorite}">${isFavorite ? '♥' : '♡'}</button>
        </div>
        <div class="saved-card-cover-bottom">
          <span><small>${escapeHtml(t.date || '日期未设置')} · 山地行程</small><strong>${isNav && t.distanceKm ? Math.round(t.distanceKm) + ' km 路网' : '路线天气分析'}</strong></span>
          <span class="saved-card-score${isNav ? ' nav' : ''}">${score == null ? '天气' : `<b>${score}</b><small>分</small>`}</span>
        </div>
      </div>
      <div class="saved-card-body">
        <div class="saved-card-meta"><span>${escapeHtml(modeText(t.mode))}</span><span>${t.savedAt ? new Date(t.savedAt).toLocaleDateString('zh-CN') + ' 保存' : '本机记录'}</span></div>
        <div class="saved-card-route">${escapeHtml(t.routeName || '未命名路线')}</div>
        <div class="saved-card-foot"><span>${isNav ? '沿途天气 · 真实路网' : (t.worstName ? '重点关注 · ' + escapeHtml(t.worstName) : '逐点天气评估')}</span><button class="saved-card-open" type="button" data-open-trip="${escapeHtml(t.id)}">打开分析 <span>↗</span></button></div>
      </div>
    </article>`;
  }).join('');

  $$('#savedTripsGrid [data-favorite-signature]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const isFavorite = toggleFavoriteSignature(button.dataset.favoriteSignature);
    const reportButton = $('#btnReportFavorite');
    if (reportButton && button.dataset.favoriteSignature === currentTripSignature()) setReportFavoriteState(reportButton, isFavorite);
    toast(isFavorite ? '已加入收藏' : '已取消收藏');
  }));
  $$('#savedTripsGrid [data-open-trip]').forEach(button => button.addEventListener('click', () => openTrip(button.dataset.openTrip)));
  $$('#savedTripsGrid .saved-route-card').forEach(card => card.addEventListener('click', event => {
    if (event.target.closest('button')) return;
    openTrip(card.dataset.tripId);
  }));
}

function setReportFavoriteState(button, active) {
  button.classList.toggle('on', active);
  button.setAttribute('aria-pressed', String(active));
  button.innerHTML = `${active ? '♥' : '♡'} <span>${active ? '已收藏行程' : '收藏这条行程'}</span>`;
}

function bindReportFavorite() {
  const buttons = $$('#btnReportFavorite, #btnReportFavoriteOverview, #btnReportFavoriteDetails');
  if (!buttons.length) return;
  const signature = currentTripSignature();
  const setAll = active => buttons.forEach(button => setReportFavoriteState(button, active));
  setAll(loadFavoriteIds().has(signature));
  buttons.forEach(button => button.addEventListener('click', () => {
    const active = toggleFavoriteSignature(signature);
    setAll(active);
    toast(active ? '路线已加入行程收藏' : '已从收藏中移除');
  }));
}

function bindProductNavigation() {
  document.addEventListener('click', event => {
    const viewButton = event.target.closest('[data-view]');
    if (viewButton) {
      event.preventDefault();
      showView(viewButton.dataset.view);
      return;
    }

    const demoButton = event.target.closest('[data-home-demo]');
    if (demoButton) {
      $('#btnHomeDemo')?.click();
      return;
    }

    const filterButton = event.target.closest('[data-trip-filter]');
    if (filterButton) {
      state.libraryFilter = filterButton.dataset.tripFilter;
      $$('.library-filters [data-trip-filter]').forEach(button => {
        const active = button === filterButton;
        button.classList.toggle('on', active);
        button.setAttribute('aria-pressed', String(active));
      });
      renderSavedTrips();
      return;
    }

    const planStep = event.target.closest('[data-plan-target]');
    if (planStep) {
      const target = document.getElementById(planStep.dataset.planTarget);
      const sheet = target?.closest('.planner-sheet');
      if (target && sheet) {
        $$('.planner-steps [data-plan-target]').forEach(button => button.classList.toggle('is-current', button === planStep));
        setPlannerSheetCollapsed(false);
        requestAnimationFrame(() => {
          const sheetRect = sheet.getBoundingClientRect();
          const targetRect = target.getBoundingClientRect();
          const delta = targetRect.top - sheetRect.top - Math.max(18, sheet.clientHeight * .34);
          sheet.scrollBy({ top: delta, behavior: 'smooth' });
        });
      }
    }
  });

  const search = $('#tripSearch');
  if (search) search.addEventListener('input', () => {
    state.libraryQuery = search.value;
    renderSavedTrips();
  });
  window.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && state.view === 'saved') {
      event.preventDefault();
      $('#tripSearch')?.focus();
    }
  });
}

function modeText(m) {
  return ({ drive: '自驾', hike: '徒步', bike: '骑行' })[m] || '自驾';
}

/* ============================================================
 * 创建行程
 * ============================================================ */

function initCreate() {
  const d = $('#inpDate');
  d.value = state.date;
  d.min = todayStr();
  d.max = addDays(todayStr(), 15);
  d.addEventListener('change', () => { state.date = d.value; });

  $$('#segMode button').forEach(b => {
    b.addEventListener('click', () => {
      $$('#segMode button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      state.mode = b.dataset.mode;
      markCreateMapDirty();
      const spd = ROUTING.SPEED[state.mode];
      if (spd) {
        const label = state.mode === 'hike' ? '徒步' : '骑行';
        toast(`${label}已切换到专用路网，时长按 ${spd} km/h 估算`, 3200);
      } else {
        toast('自驾已切换到汽车道路路网', 2400);
      }
    });
  });

  $('#btnAddPoint').addEventListener('click', () => openSheet());

  // 首页：载入示例路线
  const homeDemo = $('#btnHomeDemo');
  if (homeDemo) {
    homeDemo.addEventListener('click', () => {
      state.reportTab = 'routeAnalysis';
      state.points = DEMO_ROUTE.map(n => findPointByName(n)).filter(Boolean)
        .map(p => ({ name: p.name, lat: p.lat, lon: p.lon }));
      state.checkMode = 'point';
      $$('#segCheckMode button').forEach(b => b.classList.toggle('on', b.dataset.check === 'point'));
      applyCheckModeUI();
      showView('create');
      renderPointList();
      toast('已载入示例路线：雅安 → 天全 → 泸定');
    });
  }
  $('#btnDemo').addEventListener('click', () => {
    state.reportTab = 'routeAnalysis';
    state.points = DEMO_ROUTE.map(n => findPointByName(n)).filter(Boolean)
      .map(p => ({ name: p.name, lat: p.lat, lon: p.lon }));
    renderPointList();
    toast('已载入示例路线：雅安 → 天全 → 泸定');
  });

  $('#btnAddCoord').addEventListener('click', () => {
    const lat = parseFloat($('#inpLat').value);
    const lon = parseFloat($('#inpLon').value);
    const name = ($('#inpName').value || '').trim();
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      toast('请输入有效的纬度和经度'); return;
    }
    if (state.points.length >= 5) { toast('最多 5 个点位'); return; }
    const pt = { name: name || `点位${state.points.length + 1}`, lat, lon };
    state.points.push(pt);
    $('#inpLat').value = ''; $('#inpLon').value = ''; $('#inpName').value = '';
    renderPointList();
    toast(name ? '已添加' : '已添加，正在识别地名…');
    if (!name) {
      Geocode.reverse(lat, lon).then(nm => {
        if (nm && state.points.indexOf(pt) >= 0) { pt.name = nm; renderPointList(); }
      });
    }
  });

  $('#btnCheckup').addEventListener('click', () => {
    state.reportTab = 'routeAnalysis';
    runCheckup();
  });

  // 体检模式切换
  $$('#segCheckMode button').forEach(b => {
    b.addEventListener('click', () => {
      $$('#segCheckMode button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      state.checkMode = b.dataset.check;
      applyCheckModeUI();
    });
  });

  // 出发时刻：默认“现在”，不再用自动推荐
  const nowD = new Date();
  const nowH = nowD.getHours() + nowD.getMinutes() / 60;
  if (state.departHour < 0) state.departHour = nowH;
  state.departOriginal = state.departHour;
  const nowLabel = String(nowD.getHours()).padStart(2, '0') + ':' + String(nowD.getMinutes()).padStart(2, '0');
  const sel = $('#selDepart');
  sel.innerHTML = `<option value="${nowH}">现在（${nowLabel}）</option>`
    + Array.from({ length: 24 }, (_, h) =>
        `<option value="${h}">${String(h).padStart(2, '0')}:00</option>`).join('');
  sel.value = String(nowH);
  sel.addEventListener('change', () => {
    state.departHour = Number(sel.value);
    state.departOriginal = state.departHour;   // 手动选择视为新的“原时间”
  });

  // 新建页地图：底图切换 + 全屏
  const layerBtn = $('#btnCreateLayer');
  if (layerBtn) {
    layerBtn.addEventListener('click', () => {
      const name = MapCtl.toggleLayer();
      if (!name) return;
      const idx = TILE_LAYERS.findIndex(t => t.name === name);
      const next = TILE_LAYERS[(idx + 1) % TILE_LAYERS.length];
      layerBtn.textContent = next ? next.name : '底图';
      toast('已切换到「' + name + '」底图');
      setTimeout(() => MapCtl.refresh('create'), 120);
    });
  }
  const fsBtn = $('#btnCreateFull');
  if (fsBtn) {
    fsBtn.addEventListener('click', () => toggleCreateFullscreen());
  }

  bindPlannerSheet();

  applyCheckModeUI();
  renderPointList();
}

/** 新建页地图全屏（CSS 沉浸式，兼容 iOS；ESC 可退出） */
function toggleCreateFullscreen(force) {
  const wrap = $('#createMapWrap');
  if (!wrap) return;
  const on = force != null ? force : !wrap.classList.contains('immersive');
  wrap.classList.toggle('immersive', on);
  document.body.classList.toggle('map-immersive', on);
  const btn = $('#btnCreateFull');
  if (btn) btn.textContent = on ? '✕ 退出' : '⛶ 全屏';
  setTimeout(() => MapCtl.refresh('create'), 150);
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  toggleCreateFullscreen(false);
  toggleReportFullscreen(false);
  closeDx();
});

/** 报告页地图全屏：复用新建页的沉浸式样式 */
function toggleReportFullscreen(force) {
  const wrap = document.querySelector('#reportBody .map-wrap');
  const on = force != null ? force : !(wrap && wrap.classList.contains('immersive'));
  if (wrap) wrap.classList.toggle('immersive', on);
  document.body.classList.toggle('map-immersive', on);
  const btn = document.querySelector('#mapFull');
  if (btn) btn.textContent = on ? '✕ 退出' : '⛶ 全屏';
  if (on) setTimeout(() => MapCtl.refresh('report'), 160);
}

/** 整页重绘后恢复全屏状态（展开卡片、切换出发时刻都会重绘） */
function syncReportFullscreen() {
  if (!document.body.classList.contains('map-immersive')) return;
  const wrap = document.querySelector('#reportBody .map-wrap');
  if (wrap) wrap.classList.add('immersive');
  const btn = document.querySelector('#mapFull');
  if (btn) btn.textContent = '✕ 退出';
}

/** 根据体检模式切换界面文案与可见字段 */
function applyCheckModeUI() {
  const nav = state.checkMode === 'nav';
  $('#fieldDepart').classList.toggle('hidden', !nav);
  $('#modeDesc').textContent = nav
    ? '只给起点和终点：规划真实路径，展示预计到达各采样点时的天气；不进行路线评分。'
    : '你自己安排每个点位的到达时间：系统逐点核对，指出不合理的地方并给出调整建议。';
  $('#btnCheckup').innerHTML = `<span>${nav ? '查看沿途天气' : '生成路线天气分析'}</span><span class="btn-arrow" aria-hidden="true">↗</span>`;
  const lbl = document.querySelector('#pointList')?.closest('.field')?.querySelector('label');
  if (lbl) {
    lbl.innerHTML = nav
      ? '起点与终点 <span class="small">（中间可加途经点，最多 5 个）</span>'
      : '行程点位与时刻 <span class="small">（起点 = 出发时刻；途经/终点 = 到达时刻）</span>';
  }
  if (state.points.length) renderPointList();
}

/** 新建页地图是惰性的：只在视图可见时创建/重建，避免在 display:none 容器上初始化 Leaflet */
let createMapDirty = true;
let lastCreateSig = '';

function markCreateMapDirty() {
  createMapDirty = true;
  if (state.view === 'create') ensureCreateMap();
}

function ensureCreateMap() {
  if (state.view !== 'create') return;
  const sig = `${state.mode}:${state.points.map(p => `${p.lat},${p.lon}`).join('|')}`;
  if (!createMapDirty && MapCtl.create && sig === lastCreateSig) return;
  createMapDirty = false;
  lastCreateSig = sig;

  const map = MapCtl.renderCreate('createMap', state.points.map(p => ({ name: p.name, lat: p.lat, lon: p.lon })), (lat, lon) => {
    setPlannerSheetCollapsed(true);
    if (state.points.length >= 5) { toast('最多 5 个点位'); return; }
    const pt = { name: `点位${state.points.length + 1}`, lat, lon };
    state.points.push(pt);
    renderPointList();
    toast('已添加，正在识别地名…');
    Geocode.reverse(lat, lon).then(nm => {
      if (nm && state.points.indexOf(pt) >= 0) {
        pt.name = nm;
        renderPointList();
        toast('已识别地名：' + nm);
      }
    });
  }, state.mode);
  if (map) map.on('dragstart', () => setPlannerSheetCollapsed(true));
}

function renderPointList() {
  const el = $('#pointList');
  const pointCount = $('#plannerPointCount');
  if (pointCount) pointCount.textContent = `${state.points.length} 个点位`;
  if (!state.points.length) {
    el.innerHTML = `<div class="empty-inline">还没有点位，点「载入示例路线」或「添加点位」</div>`;
    const lg0 = $('#planLegs'); if (lg0) lg0.innerHTML = '';
    return;
  }
  ensureTimes();
  const plan = state.checkMode === 'point';

  el.innerHTML = state.points.map((p, i) => {
    const role = i === 0 ? '起点' : (i === state.points.length - 1 ? '终点' : '途经');
    const roleCls = i === 0 ? 'start' : (i === state.points.length - 1 ? 'end' : 'mid');
    const dayOff = Math.floor((state.times[i] || 0) / 1440);
    const timeWord = i === 0 ? '出发' : '到达';
    const tail = plan
      ? `<span class="pt-time-label">${timeWord}</span>`
        + `<input class="pt-time" type="time" step="600" data-i="${i}" value="${minToHM(state.times[i])}" aria-label="${timeWord}时刻">`
        + (dayOff > 0 ? `<span class="pt-day">+${dayOff}天</span>` : '')
      : `<span class="pt-coord">${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}</span>`;
    return `
      <div class="pt-row" data-i="${i}">
        <span class="pt-drag" data-i="${i}" role="button" tabindex="0"
              aria-label="拖动调整顺序" title="拖动调整顺序">⋮⋮</span>
        <span class="pt-role ${roleCls}" aria-label="${role}">${role === '起点' ? '起' : role === '终点' ? '终' : '途'}</span>
        <span class="pt-name">${escapeHtml(p.name)}</span>
        ${tail}
        <button class="pt-del" data-i="${i}" aria-label="删除">✕</button>
      </div>`;
  }).join('');

  $$('#pointList .pt-del').forEach(b => {
    b.addEventListener('click', () => {
      const di = Number(b.dataset.i);
      state.points.splice(di, 1);
      if (state.times.length > di) state.times.splice(di, 1);
      renderPointList();
    });
  });

  $$('#pointList .pt-time').forEach(inp => {
    inp.addEventListener('change', () => setPointTime(Number(inp.dataset.i), hmToMin(inp.value)));
  });

  if (plan) renderLegs();
  else { const lg = $('#planLegs'); if (lg) lg.innerHTML = ''; }

  bindDragReorder(el);
  markCreateMapDirty();
}

function setPlannerSheetCollapsed(collapsed) {
  const sheet = $('.planner-sheet');
  const handle = $('#plannerSheetHandle');
  if (!sheet || !handle) return;
  sheet.classList.toggle('is-collapsed', !!collapsed);
  document.body.classList.toggle('planner-sheet-collapsed', !!collapsed);
  handle.setAttribute('aria-expanded', String(!collapsed));
  handle.setAttribute('aria-label', collapsed ? '展开行程设置' : '收起行程设置');
}

function bindPlannerSheet() {
  const handle = $('#plannerSheetHandle');
  if (!handle || handle.dataset.bound === 'true') return;
  handle.dataset.bound = 'true';
  let startY = null;
  let suppressClick = false;

  handle.addEventListener('click', () => {
    if (suppressClick) return;
    setPlannerSheetCollapsed(!$('.planner-sheet')?.classList.contains('is-collapsed'));
  });
  handle.addEventListener('pointerdown', event => {
    startY = event.clientY;
    try { handle.setPointerCapture(event.pointerId); } catch (error) { /* older Safari */ }
  });
  handle.addEventListener('pointerup', event => {
    if (startY == null) return;
    const deltaY = event.clientY - startY;
    startY = null;
    if (Math.abs(deltaY) < 25) return;
    suppressClick = true;
    setPlannerSheetCollapsed(deltaY > 0);
    window.setTimeout(() => { suppressClick = false; }, 350);
  });
  handle.addEventListener('pointercancel', () => { startY = null; });
}

/* ---------------- 规划模式：时间预填与点间核对 ---------------- */

/** 保证 times 与 points 等长（新增点位时按里程自动补时间） */
function ensureTimes() {
  const n = state.points.length;
  if (!n) { state.times = []; return; }
  if (state.times.length === n) return;
  const out = [];
  for (let i = 0; i < n; i++) {
    if (state.times[i] != null) { out.push(state.times[i]); continue; }
    out.push(i === 0
      ? 8 * 60
      : out[i - 1] + Math.round(legInfo(state.points[i - 1], state.points[i]).minutes) + 10);
  }
  state.times = out;
}

/** 两点之间的近似里程与耗时（直线 × 1.25，按出行方式取速度） */
function legInfo(a, b) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  const km = 2 * R * Math.asin(Math.sqrt(h)) * 1.25;
  const spd = state.mode === 'hike' ? 4 : state.mode === 'bike' ? 15 : 40;
  return { km, minutes: km / spd * 60 };
}

/** 用户改某个点的时间：必须晚于上一点，并自动顺延后面的点 */
function setPointTime(i, minOfDay) {
  if (minOfDay == null || !isFinite(minOfDay)) { renderPointList(); return; }
  // 时间输入只有 HH:MM，需要保留该点原本的“第几天”
  const cur = state.times[i] != null ? state.times[i] : 8 * 60;
  const day = Math.floor(cur / 1440);
  let min = day * 1440 + minOfDay;
  if (i > 0 && min <= state.times[i - 1]) {
    min += 1440;
    toast('时间必须晚于上一点，已顺延到次日');
  }
  state.times[i] = min;
  state.planOriginalTimes = null;   // 手动改过时间，旧基准失效
  for (let k = i + 1; k < state.points.length; k++) {
    const need = Math.max(5, Math.round(legInfo(state.points[k - 1], state.points[k]).minutes));
    const earliest = state.times[k - 1] + need;
    if (state.times[k] < earliest) state.times[k] = earliest;
  }
  renderPointList();
}

/** 输入区下方的点间时间核对 */
function renderLegs() {
  const el = $('#planLegs');
  if (!el) return;
  if (state.points.length < 2) { el.innerHTML = ''; return; }
  let html = '<div class="leg-title">点间时间核对（直线距离 ×1.25 估算，未含停留）</div>';
  for (let i = 1; i < state.points.length; i++) {
    const L = legInfo(state.points[i - 1], state.points[i]);
    const planned = state.times[i] - state.times[i - 1];
    const bad = planned + 5 < L.minutes;   // 与报告一致：留 5 分钟容差
    html += `<div class="leg${bad ? ' bad' : ''}">
      <span class="leg-name">${i} → ${i + 1}　${escapeHtml(state.points[i - 1].name)} → ${escapeHtml(state.points[i].name)}</span>
      <span class="leg-time">${L.km.toFixed(0)} km · 需 ${Math.round(L.minutes)} 分 · ${bad ? '只留了 ' : '留了 '}${Math.round(planned)} 分 ${bad ? '⚠️' : '✓'}</span>
    </div>`;
  }
  el.innerHTML = html;
}

/**
 * 点位拖拽排序
 * 用 Pointer Events，桌面与触屏同一套逻辑；只在「⋮⋮」把手上触发，
 * 所以不会影响页面正常滚动。
 */
function bindDragReorder(container) {
  let dragIdx = -1;
  let startY = 0;
  let dragging = false;
  let targetIdx = -1;

  const rows = () => Array.from(container.querySelectorAll('.pt-row'));
  const clearMarks = () => {
    rows().forEach(r => r.classList.remove('dragging', 'drop-target'));
    document.body.classList.remove('reordering');
  };

  container.querySelectorAll('.pt-drag').forEach(handle => {
    handle.addEventListener('pointerdown', (e) => {
      if (state.points.length < 2) return;
      e.preventDefault();
      dragIdx = Number(handle.dataset.i);
      startY = e.clientY;
      dragging = false;
      targetIdx = dragIdx;
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
    });

    handle.addEventListener('pointermove', (e) => {
      if (dragIdx < 0) return;
      const dy = e.clientY - startY;
      if (!dragging && Math.abs(dy) < 8) return;

      if (!dragging) {
        dragging = true;
        document.body.classList.add('reordering');
        rows()[dragIdx]?.classList.add('dragging');
      }

      // 用指针 Y 与各行中线比较，得出应插入的位置
      const list = rows();
      let idx = list.length - 1;
      for (let i = 0; i < list.length; i++) {
        const r = list[i].getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) { idx = i; break; }
      }
      if (idx !== targetIdx) {
        targetIdx = idx;
        list.forEach((r, i) => {
          r.classList.toggle('drop-target', i === targetIdx && i !== dragIdx);
        });
      }
    });

    const finish = (e) => {
      if (dragIdx < 0) return;
      try { handle.releasePointerCapture(e.pointerId); } catch (err) {}
      const from = dragIdx;
      const to = targetIdx;
      const wasDragging = dragging;
      dragIdx = -1;
      dragging = false;
      clearMarks();

      if (!wasDragging || from === to || to < 0) return;

      const [moved] = state.points.splice(from, 1);
      state.points.splice(to, 0, moved);
      if (state.times.length > from) {
        const [mt] = state.times.splice(from, 1);
        state.times.splice(to, 0, mt);
      }
      renderPointList();
      toast(`已把「${moved.name}」移到第 ${to + 1} 位`);
    };

    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', (e) => {
      if (dragIdx < 0) return;
      try { handle.releasePointerCapture(e.pointerId); } catch (err) {}
      dragIdx = -1;
      dragging = false;
      clearMarks();
    });
  });
}
/* ---------------- 点位选择弹层 ---------------- */

let sheetRegion = '全部';

function openSheet() {
  if (state.points.length >= 5) { toast('最多 5 个点位'); return; }
  $('#sheet').classList.remove('hidden');
  $('#sheetSearch').value = '';
  const rb = $('#sheetRemote');
  if (rb) rb.innerHTML = '';
  remoteToken++;
  renderSheetRegions();
  renderSheetList();
}

function closeSheet() {
  $('#sheet').classList.add('hidden');
  clearTimeout(remoteTimer);
  remoteToken++;
  const rb = $('#sheetRemote');
  if (rb) rb.innerHTML = '';
}

/* ---------------- 全国地名搜索（天地图） ---------------- */

let remoteToken = 0;
let remoteTimer = null;
const REMOTE_MIN_LEN = 2;

/** 输入变化时做防抖，避免每敲一个字就发请求（天地图免费额度有限） */
function scheduleRemoteSearch() {
  clearTimeout(remoteTimer);
  const box = $('#sheetRemote');
  if (!box) return;

  const kw = ($('#sheetSearch').value || '').trim();

  if (kw.length < REMOTE_MIN_LEN) {
    box.innerHTML = '';
    remoteToken++;
    return;
  }
  if (!Geocode.enabled) {
    box.innerHTML = '';
    return;
  }

  box.innerHTML = `<div class="remote-hint">正在搜索「${escapeHtml(kw)}」…</div>`;
  remoteTimer = setTimeout(() => runRemoteSearch(kw), 450);
}

async function runRemoteSearch(kw) {
  const box = $('#sheetRemote');
  if (!box) return;
  const my = ++remoteToken;
  const list = await Geocode.search(kw);
  if (my !== remoteToken || !box.isConnected) return;

  if (list === null) {
    box.innerHTML = `<div class="remote-hint err">地名搜索失败（网络或额度限制）。可在下面选内置点位，或用「手动输入坐标」。</div>`;
    return;
  }
  if (!list.length) {
    box.innerHTML = `<div class="remote-hint">没搜到「${escapeHtml(kw)}」，试试更完整的名称（如「稻城亚丁」「上海外滩」）</div>`;
    return;
  }

  box.innerHTML = `<div class="remote-title">全国搜索 · 天地图</div>` + list.map((it, i) => `
    <div class="remote-item" data-i="${i}">
      <span class="ri-dot"></span>
      <span class="ri-name">${escapeHtml(it.name)}</span>
      <span class="ri-coord">${it.lat.toFixed(3)}, ${it.lon.toFixed(3)}</span>
      <span class="ri-add">添加</span>
    </div>`).join('');

  $$('#sheetRemote .remote-item').forEach(el => {
    el.addEventListener('click', () => {
      const it = list[Number(el.dataset.i)];
      if (!it) return;
      if (state.points.length >= 5) { toast('最多 5 个点位'); return; }
      state.points.push({ name: it.name, lat: it.lat, lon: it.lon });
      renderPointList();
      closeSheet();
      toast('已添加：' + it.name);
    });
  });
}

function renderSheetRegions() {
  $('#sheetRegions').innerHTML = REGIONS.map(r =>
    `<button class="chip ${r === sheetRegion ? 'on' : ''}" data-r="${r}">${r}</button>`
  ).join('');
  $$('#sheetRegions .chip').forEach(b => {
    b.addEventListener('click', () => {
      sheetRegion = b.dataset.r;
      renderSheetRegions();
      renderSheetList();
    });
  });
}

function renderSheetList() {
  const kw = $('#sheetSearch').value;
  const items = searchPoints(kw, sheetRegion);
  const el = $('#sheetList');
  if (!items.length) { el.innerHTML = `<div class="empty-inline">没有匹配的点位</div>`; return; }

  el.innerHTML = items.map(p => {
    const used = state.points.some(x => x.name === p.name);
    return `<div class="sheet-item ${used ? 'used' : ''}" data-name="${escapeHtml(p.name)}">
      <span class="si-name">${escapeHtml(p.name)}</span>
      <span class="si-region">${p.region}</span>
      ${used ? '<span class="si-used">已选</span>' : ''}
    </div>`;
  }).join('');

  $$('#sheetList .sheet-item').forEach(el2 => {
    el2.addEventListener('click', () => {
      const name = el2.dataset.name;
      const p = findPointByName(name);
      if (!p) return;
      if (state.points.length >= 5) { toast('最多 5 个点位'); return; }
      state.points.push({ name: p.name, lat: p.lat, lon: p.lon });
      renderPointList();
      closeSheet();
      toast('已添加：' + p.name);
    });
  });
}

/* ============================================================
 * 执行体检
 * ============================================================ */

function skeletonHtml(msg) {
  return `
    <div class="card skeleton">
      <div class="sk-line sk-map"></div>
      <div class="sk-line sk-score"></div>
      <div class="sk-line" style="width:78%"></div>
      <div class="sk-line" style="width:54%"></div>
    </div>
    <div class="card skeleton">
      <div class="sk-line" style="width:40%"></div>
      <div class="sk-line"></div>
      <div class="sk-line" style="width:66%"></div>
    </div>
    <p class="hint">${escapeHtml(msg)}</p>`;
}

function errHtml(title, sub) {
  return `
    <div class="errbox">
      <p>😕 ${escapeHtml(title)}</p>
      <p class="small">${escapeHtml(sub || '')}</p>
      <button class="btn btn-ghost" onclick="showView('create')">返回修改</button>
    </div>`;
}

/** 统一入口：按体检模式分发 */
async function runCheckup() {
  if (state.points.length < 2) { toast('至少需要 2 个点位（起点和终点）'); return; }
  if (state.checkMode === 'nav') return checkupNavigation();
  return checkupPoints();
}

/* ---------------- 点位模式 ---------------- */

async function checkupPoints() {
  const btn = $('#btnCheckup');
  btn.disabled = true;
  btn.textContent = '体检中…';
  showView('report');
  ensureTimes();
  const built = buildPlanSamples(state.points, state.times, state.mode, 20);
  const pts = built.samples.map(s => ({ name: s.name, lat: s.lat, lon: s.lon }));

  $('#reportBody').innerHTML = skeletonHtml(
    `正在获取 ${pts.length} 个采样点（${state.points.length} 个点位 + ${pts.length - state.points.length} 个沿途点）的逐小时预报…`);

  try {
    const maxMin = built.samples.reduce((m, s2) => Math.max(m, s2.minute), 0);
    const days = Math.max(3, Math.min(5, Math.ceil((maxMin + 60) / 1440)));
    const [series, elevations] = await Promise.all([
      fetchHourly(pts, state.date, days),
      fetchElevations(pts),
    ]);

    if (!series.ok || !series.series.length) {
      $('#reportBody').innerHTML = `
        <div class="errbox">
          <p>😕 暂时取不到天气数据</p>
          <p class="small">可能是网络问题，或该日期超出预报范围（通常未来 16 天内）。</p>
          <button class="btn btn-ghost" onclick="showView('create')">返回修改</button>
        </div>`;
      return;
    }

    const report = analyzePlanRoute({
      series: series.series, elevations, samples: built.samples, legs: built.legs,
      sun: series.sun, dateStr: state.date, mode: state.mode,
    });
    if (!report) {
      $('#reportBody').innerHTML = `
        <div class="errbox">
          <p>😕 该日期已无可用时段</p>
          <p class="small">如果选的是今天，今日剩余时段可能不足。请换个日期试试。</p>
          <button class="btn btn-ghost" onclick="showView('create')">返回修改</button>
        </div>`;
      return;
    }

    report.stale = series.stale;
    report.fetchedAt = series.at;
    // 全程逐小时出发评分：每个格子都重新计算整条路线，而不是只看起点
    const hourScores = buildPlanHourScoresFromSeries({
      series: series.series, elevations, points: state.points, times: state.times,
      mode: state.mode, baseDate: state.date, sun: series.sun,
    });
    const bestHour = pickBestHourRow(hourScores.rows);
    report.hourScores = hourScores.rows;
    report.departureHour = state.times[0] / 60;
    report.recommendedDate = bestHour ? bestHour.date : null;
    report.recommendedHour = bestHour ? bestHour.hour : null;
    report.recommendedMin = bestHour ? bestHour.score : null;
    state.planCtx = { baseDate: state.date };
    state.currentReport = report;
    state.expandIdx = -1;
    state.hourSel = {};
    renderReport(report, series.stale);

    // 存入本机历史
    const trip = {
      id: newTripId(),
      checkMode: 'point',
      date: state.date,
      mode: state.mode,
      points: state.points.slice(),
      times: state.times.slice(),
      routeName: state.points.map(p => p.name).join(' → '),
      routeScore: report.routeScore,
      worstName: report.points[report.worstIndex].name,
      worstElev: report.points[report.worstIndex].elev,
      advice: report.advice,
      window: report.window,
      savedAt: Date.now(),
    };
    upsertTrip(trip);
  } catch (e) {
    console.error(e);
    $('#reportBody').innerHTML = `
      <div class="errbox">
        <p>😕 出错了</p>
        <p class="small">${escapeHtml(String(e.message || e))}</p>
        <pre class="errstack">${escapeHtml(String(e.stack || '').split('\n').slice(0, 8).join('\n'))}</pre>
        <button class="btn btn-ghost" onclick="showView('create')">返回修改</button>
      </div>`;
  } finally {
    btn.disabled = false;
    applyCheckModeUI();
  }
}

/* ---------------- 导航模式 ---------------- */

async function checkupNavigation() {
  // 今天已经没有可出发的整点（23 点之后），自动按明天 0 点体检
  if (state.date === todayStr() && new Date().getHours() >= 23) {
    state.date = addDays(todayStr(), 1);
    state.departHour = 0;
    state.departOriginal = 0;
    const inp = $('#inpDate');
    if (inp) inp.value = state.date;
    const sel = $('#selDepart');
    if (sel) sel.value = '0';
    toast(`今天已没有可出发的整点，已按 ${state.date} 00:00 体检`, 3200);
  }
  const btn = $('#btnCheckup');
  btn.disabled = true;
  btn.textContent = '规划中…';
  showView('report');
  $('#reportBody').innerHTML = skeletonHtml('正在规划路径…');

  try {
    // 1) 路径规划
    const route = await ROUTING.fetchRoute(state.points, state.mode);
    if (!route.ok) {
      $('#reportBody').innerHTML = errHtml('路径规划失败',
        route.error || '请确认起点与终点之间有可行道路，或稍后重试。');
      return;
    }

    // 1.5) 行程超出预报有效期 → 评估本身没有意义，直接拦下
    if (route.overHorizon) {
      const days = route.travelDays;
      const dist = (route.distance / 1000).toFixed(0);
      const spd = route.speedKmh ? `（按 ${route.speedKmh} km/h 估算）` : '';
      $('#reportBody').innerHTML = `
        <div class="errbox">
          <p>😕 这趟行程超出了天气预报的有效范围</p>
          <p class="small">
            ${modeText(state.mode)}模式 · 路网距离约 ${dist} km${spd}<br>
            预计需要约 <b>${days < 10 ? days.toFixed(1) : Math.round(days)} 天</b>，
            而本作品的评估只使用未来 ${route.horizonDays} 天的预报。
          </p>
          <p class="small" style="margin-top:12px">
            建议：<b>换一条短一些的路线</b>，或改用<b>自驾</b>出行方式。
          </p>
          <button class="btn btn-ghost" onclick="showView('create')">返回修改</button>
        </div>`;
      return;
    }

    // 2) 沿路等距采样
    const n = GEO.sampleCountFor(route.duration);
    const raw = GEO.sampleAlong(route.coords, n);
    if (!raw.length) {
      $('#reportBody').innerHTML = errHtml('采样失败', '未能从路径中取到采样点。');
      return;
    }

    const first = state.points[0].name;
    const last = state.points[state.points.length - 1].name;
    const samples = raw.map((s, i) => ({
      lat: s.lat, lon: s.lon, ratio: s.ratio, cumKm: s.cumKm,
      name: i === 0 ? first
        : i === raw.length - 1 ? last
        : `途采${i}（${s.cumKm.toFixed(0)} km）`,
    }));

    $('#reportBody').innerHTML = skeletonHtml(
      `已规划 ${(route.distance / 1000).toFixed(0)} km / 约 ${(route.duration / 60).toFixed(0)} 分钟，`
      + `正在获取 ${samples.length} 个采样点的逐小时预报…`);

    // 3) 取逐小时数据：基准日通常取今天（推荐窗口从这里开始），
    //    若出行日远于 13 天，改以出行日为基准，避免超过 16 天预报上限
    const pts = samples.map(s => ({ name: s.name, lat: s.lat, lon: s.lon }));
    const today = todayStr();
    const dayDiff = Math.round((new Date(state.date + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
    const baseDate = dayDiff <= 13 ? today : state.date;
    const baseDiff = Math.round((new Date(state.date + 'T00:00:00') - new Date(baseDate + 'T00:00:00')) / 86400000);
    const needHours = Math.max(72, baseDiff * 24 + 48) + route.duration / 3600;
    const days = Math.max(3, Math.min(16, Math.ceil(needHours / 24)));
    const [series, elevations] = await Promise.all([
      fetchHourly(pts, baseDate, days),
      fetchElevations(pts),
    ]);
    if (!series.ok || !series.series.length) {
      $('#reportBody').innerHTML = errHtml('暂时取不到天气数据',
        '可能是网络问题，或该日期超出预报范围（通常未来 16 天内）。');
      return;
    }

    // 出行日不是基准日时，把逐小时数据按天切到出行日
    const tripSeries = baseDiff > 0
      ? series.series.map(s => Object.assign({}, s, { hours: s.hours.slice(baseDiff * 24) }))
      : series.series;

    // 4) 按到达时刻逐点评分
    const report = analyzeNavigation(tripSeries, elevations, samples, route,
      state.departHour, state.date, state.mode);
    if (!report) {
      $('#reportBody').innerHTML = errHtml('数据不足', '该出发时刻附近没有可用的逐小时预报。');
      return;
    }

    report.stale = series.stale;
    report.fetchedAt = series.at;
    report.routeCoords = route.coords;
    const compareWindow = recWindow(state.date);
    const forecastHours = Math.min(72, ...tripSeries.map(point => (point.hours || []).length));
    const hourScores = departureMatrix(samples, tripSeries, elevations, route.duration, compareWindow.startIdx, Math.min(compareWindow.endIdx, forecastHours));
    report.hourScores = hourScores.map(row => Object.assign({}, row, { date: addDays(state.date, row.dayOffset) }));
    state.navCtx = {
      baseDate: state.date,
      series: tripSeries,
      elevations,
      samples,
      route,
      hourScores: report.hourScores,
      stale: series.stale,
      at: series.at,
    };
    state.currentReport = report;
    state.expandIdx = -1;
    renderNavReport(report, series.stale);

    upsertTrip({
      id: newTripId(),
      checkMode: 'nav',
      date: state.date,
      mode: state.mode,
      points: state.points.slice(),
      routeName: state.points.map(p => p.name).join(' → '),
      distanceKm: report.route.distanceKm,
      departureHour: report.departureHour,
      savedAt: Date.now(),
    });
  } catch (e) {
    console.error(e);
    $('#reportBody').innerHTML = errHtml('出错了', String(e.message || e));
  } finally {
    btn.disabled = false;
    applyCheckModeUI();
  }
}


/* ============================================================
 * 报告决策摘要与规划模式全程时段评分
 * ============================================================ */

function pickBestHourRow(rows) {
  const valid = (rows || []).filter(x => x && x.valid && Number.isFinite(x.min));
  if (!valid.length) return null;
  return valid.reduce((best, cur) => (cur.min > best.min ? cur : best));
}

/**
 * 规划模式的每个候选出发小时都重新计算整条路线。
 * 这样顶部数字代表“这个时刻出发的全程评分”，而不是起点单点天气。
 */
function buildPlanHourScoresFromSeries({ series, elevations, points, times, mode, baseDate, sun }) {
  if (!series || !series.length || !series[0].hours || !times || !times.length) return { rows: [] };
  const dayCount = Math.min(3, Math.floor(series[0].hours.length / 24));
  const startMinute = times[0] == null ? 8 * 60 : times[0];
  const rows = [];

  for (let dayOffset = 0; dayOffset < dayCount; dayOffset++) {
    for (let hour = 8; hour <= 20; hour++) {
      const targetMinute = dayOffset * 1440 + hour * 60;
      const delta = targetMinute - startMinute;
      const shiftedTimes = times.map(t => (t == null ? startMinute : t) + delta);
      const built = buildPlanSamples(points, shiftedTimes, mode, 20);
      let report = null;
      try {
        report = analyzePlanRoute({
          series, elevations, samples: built.samples, legs: built.legs,
          sun, dateStr: baseDate, mode,
        });
      } catch (e) {
        report = null;
      }
      if (!report) continue;

      const wh = series[0].hours[dayOffset * 24 + hour];
      rows.push({
        idx: dayOffset * 24 + hour,
        date: addDays(baseDate, dayOffset),
        dayOffset,
        hour,
        min: report.routeScore,
        score: report.routeScore,
        avg: report.avgScore,
        valid: true,
        code: wh ? wh.code : null,
        temp: wh ? wh.temp : null,
      });
    }
  }
  return { rows };
}

function dataAgeText(at, stale) {
  if (!at) return stale ? '缓存数据 · 更新时间未知' : '数据更新时间未知';
  const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
  const age = mins < 1 ? '刚刚更新' : `${mins} 分钟前更新`;
  return stale ? `缓存数据 · ${age}` : age;
}

function recommendationForReport(r) {
  if (!r) return null;
  if (r.recommendedHour != null) {
    return {
      date: r.recommendedDate || r.date,
      hour: Math.round(Number(r.recommendedHour)),
      score: r.recommendedMin,
    };
  }
  const best = pickBestHourRow(r.hourScores || []);
  return best ? { date: best.date, hour: best.hour, score: best.score } : null;
}

function applyPlanDeparture(date, hour) {
  ensureTimes();
  if (!state.planOriginalTimes) {
    state.planOriginalTimes = state.times.slice();
    state.planOriginalDate = state.date;
  }
  const diffDays = Math.round((new Date(date + 'T00:00:00') - new Date(state.date + 'T00:00:00')) / 86400000);
  const delta = diffDays * 1440 + hour * 60 - state.times[0];
  const shifted = state.times.map(t => t + delta);
  state.date = date;
  state.times = shifted.map(t => t - diffDays * 1440);
  const inp = $('#inpDate');
  if (inp) inp.value = date;
  runCheckup();
}

function decisionLeadHtml(r, stale) {
  const rec = recommendationForReport(r);
  const curMin = currentDepartureMinute(r);
  const curClock = curMin == null ? '—' : minToHM(curMin);
  const recClock = rec ? minToHM(rec.hour * 60) : null;
  const recDateDiff = rec && rec.date !== r.date;
  const recLabel = rec ? `${recDateDiff ? rec.date.slice(5).replace('-', '/') + ' ' : ''}${recClock}` : null;
  const same = rec && !recDateDiff && curMin != null && Math.abs(rec.hour * 60 - (((curMin % 1440) + 1440) % 1440)) < 5;
  const title = rec
    ? (same ? `建议保持 ${curClock} 出发` : `建议 ${recLabel} 出发`)
    : '当前安排需要调整';
  const risk = ((r.diagnosis && r.diagnosis.items) || []).find(x => x.severity !== 'ok');
  const riskText = risk ? risk.title : '未发现明显风险';
  const scoreText = rec && Number.isFinite(rec.score)
    ? `当前 ${curClock} 出发评分 ${r.routeScore}；推荐时段评分 ${rec.score}。`
    : `当前 ${curClock} 出发评分 ${r.routeScore}。`;
  const score = r.routeScore == null ? 0 : Math.max(0, Math.min(100, Math.round(Number(r.routeScore) || 0)));

  return `
    <div class="decision-lead decision-${r.level.key}">
      <div class="decision-orbit route-score-orbit" style="--score:${score}" aria-label="路线天气评分 ${score} 分">
        <div class="decision-orbit-value">${score}<small>分</small></div>
        <div class="decision-orbit-label">整体适宜出行</div>
      </div>
      <div class="decision-content">
        <div class="decision-kicker">出行结论</div>
        <div class="decision-title">${escapeHtml(title)}</div>
        <div class="decision-copy">${escapeHtml(scoreText)}</div>
        <div class="decision-risk"><span>最大风险</span>${escapeHtml(riskText)}</div>
        <div class="decision-fresh">${escapeHtml(dataAgeText(r.fetchedAt, !!stale))}</div>
      </div>
    </div>`;
}

/* ============================================================
 * 导航模式报告渲染
 * ============================================================ */

function navWeatherKey(p) {
  const hasWeather = ['code', 'pp', 'precip', 'wind', 'temp'].some(k => p && p[k] != null && Number.isFinite(Number(p[k])));
  if (!hasWeather) return 'neutral';
  const code = Number(p.code);
  const pp = Number(p.pp ?? 0);
  const precip = Number(p.precip ?? 0);
  const wind = Number(p.wind ?? 0);
  const temp = p.temp == null ? null : Number(p.temp);
  if (code >= 95 || [65, 67, 75, 82, 86].includes(code) || wind >= 50) return 'bad';
  if ([45, 48, 63, 66, 73, 81, 85].includes(code) || pp >= 70 || precip >= 2.5 || wind >= 40 || (temp != null && temp < 0)) return 'caution';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || pp >= 40 || precip > 0 || wind >= 29) return 'fair';
  return 'good';
}

function bindReportNav() {
  $$('#reportBody [data-report-target]').forEach(button => {
    button.addEventListener('click', () => {
      activateReportScreen(button.dataset.reportTarget, true);
    });
  });
}

function activateReportScreen(id, scroll = false) {
  const screens = $$('#reportBody .report-screen');
  if (!screens.some(screen => screen.id === id)) return false;
  state.reportTab = id;
  screens.forEach(screen => screen.classList.toggle('is-active', screen.id === id));
  $$('.report-local-nav [data-report-target]').forEach(button => {
    const active = button.dataset.reportTarget === id;
    button.classList.toggle('on', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (id === 'routeAnalysis') requestAnimationFrame(() => MapCtl.refresh('report'));
  if (scroll) {
    const screen = document.getElementById(id);
    if (screen) screen.scrollIntoView({ behavior: 'instant', block: 'start' });
  }
  return true;
}

function elevationProfileHtml(points) {
  const values = (points || []).map((point, index) => ({
    index,
    name: point.name || `采样点 ${index + 1}`,
    km: Number(point.cumKm),
    elev: Number(point.elev),
  })).filter(point => Number.isFinite(point.elev));
  if (values.length < 2) return '';
  const min = Math.min(...values.map(point => point.elev));
  const max = Math.max(...values.map(point => point.elev));
  const range = Math.max(1, max - min);
  const left = 34, right = 786, top = 20, bottom = 132;
  const coords = values.map((point, index) => ({
    ...point,
    x: left + index * (right - left) / (values.length - 1),
    y: bottom - (point.elev - min) / range * (bottom - top),
  }));
  const line = coords.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const area = `${line} L${right} ${bottom} L${left} ${bottom} Z`;
  const first = values[0], last = values[values.length - 1];
  return `<section class="elevation-card" aria-label="沿线海拔剖面">
    <div class="elevation-head"><div><h3>沿线海拔变化</h3><p>按沿途采样点展示 · 悬停图表节点可查看海拔</p></div>
      <div class="elevation-range"><span>最高<b>${Math.round(max)} m</b></span><span>最低<b>${Math.round(min)} m</b></span></div></div>
    <svg class="elevation-chart" viewBox="0 0 820 164" role="img" aria-label="海拔从 ${Math.round(min)} 米到 ${Math.round(max)} 米">
      <defs><linearGradient id="elevationFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#4d9bd0" stop-opacity=".26"/><stop offset="100%" stop-color="#4d9bd0" stop-opacity=".015"/></linearGradient></defs>
      <path class="elevation-grid" d="M${left} 42H${right} M${left} 87H${right} M${left} ${bottom}H${right}"/>
      <path class="elevation-area" d="${area}"/><path class="elevation-line" d="${line}"/>
      ${coords.map(point => `<circle class="elevation-point" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.5" tabindex="0" aria-label="${escapeHtml(point.name)}，海拔 ${Math.round(point.elev)} 米"><title>${escapeHtml(point.name)} · ${Math.round(point.elev)} m${Number.isFinite(point.km) ? ` · ${point.km.toFixed(0)} km` : ''}</title></circle>`).join('')}
      <text class="elevation-axis" x="${left}" y="153">${escapeHtml(first.name)}</text><text class="elevation-axis" x="${right}" y="153" text-anchor="end">${escapeHtml(last.name)}</text>
    </svg>
    <div class="elevation-note"><span>海拔仅显示采样点数据</span><span>${values.length} 个有效点位</span></div>
  </section>`;
}

function reportScreenHeader(eyebrow, title, subtitle, trailing = '') {
  return `<div class="report-screen-heading"><div class="screen-heading-copy"><div class="eyebrow">${eyebrow}</div><h2>${title}</h2><p>${subtitle}</p></div>${trailing}</div>`;
}

function routeMapConsoleHtml({ routeName, date, mode, distance, duration, points, stale = false, note = '' }) {
  const counts = { good: 0, fair: 0, caution: 0, bad: 0, neutral: 0 };
  (points || []).forEach(point => {
    const key = point && point.score != null && Number.isFinite(Number(point.score))
      ? levelOf(Number(point.score)).key
      : point && point.level && counts[point.level.key] != null ? point.level.key : navWeatherKey(point);
    counts[key] += 1;
  });
  const flagged = counts.bad + counts.caution + counts.fair;
  const endpoints = String(routeName || '').split(' → ');
  const start = endpoints[0] || '起点';
  const end = endpoints[endpoints.length - 1] || '终点';
  return `<aside class="route-map-console" aria-label="路线概况">
    <div class="route-map-console-head"><div><span class="map-console-kicker">ROUTE WEATHER · ${escapeHtml(String(mode || '行程规划'))}</span><div class="map-console-route"><strong>${escapeHtml(start)}</strong><svg viewBox="0 0 96 16" aria-hidden="true"><path d="M2 12 C16 2 22 14 34 7 S53 2 62 9 79 12 94 3"/><circle cx="3" cy="12" r="2.5"/><circle cx="93" cy="3" r="2.5"/></svg><strong>${escapeHtml(end)}</strong></div></div><span class="map-console-date">${escapeHtml(date || '')}${stale ? ' · 缓存数据' : ''}</span></div>
    <div class="route-map-console-foot"><div class="map-console-metrics"><div><small>路线距离</small><strong>${Math.round(Number(distance) || 0)}<i> km</i></strong></div><div><small>预计用时</small><strong>${escapeHtml(fmtDuration(Number(duration) || 0))}</strong></div><div class="map-console-risk"><small>需留意采样点</small><strong>${flagged}<i> / ${counts.bad + counts.caution + counts.good + counts.fair + counts.neutral}</i></strong></div></div>
      <div class="map-impact-legend" aria-label="路线颜色表示天气影响"><span><i class="good"></i>较小</span><span><i class="fair"></i>一般</span><span><i class="caution"></i>关注</span><span><i class="bad"></i>较强</span></div>
    </div>${note ? `<p class="map-console-note">${escapeHtml(note)}</p>` : ''}</aside>`;
}

function navWeatherOverviewHtml(r, stale) {
  const points = r.points || [];
  const counts = { good: 0, fair: 0, caution: 0, bad: 0, neutral: 0 };
  points.forEach(p => { counts[navWeatherKey(p)] += 1; });
  const key = counts.bad ? 'bad' : counts.caution ? 'caution' : counts.fair ? 'fair' : counts.neutral ? 'neutral' : 'good';
  const title = key === 'bad' ? '沿途有较强天气影响'
    : key === 'caution' ? '部分路段天气条件较差'
    : key === 'fair' ? '沿途有降水或风'
    : key === 'neutral' ? '部分路段天气数据不足'
    : '沿途天气整体平稳';
  const texts = [...new Set(points.map(p => p.weatherText || wmoText(p.code)).filter(Boolean))].slice(0, 4);
  const rainCount = points.filter(p => (p.pp != null && p.pp >= 40) || (p.precip != null && p.precip > 0)).length;
  const stableCount = counts.good + counts.fair;
  const stableRatio = points.length ? Math.round(stableCount / points.length * 100) : 0;
  const overview = `${points.length} 个沿路采样点${texts.length ? '，天气包括 ' + texts.join('、') : ''}；${rainCount} 个点预计有降水。`
    + (counts.neutral ? `另有 ${counts.neutral} 个点缺少天气字段，已在地图上标为中性。` : '');

  return `
    <div class="decision-lead decision-${key}">
      <div class="decision-orbit weather-stability-orbit ${key}" style="--score:${stableRatio}" aria-label="${stableCount} 个点位影响较小，共 ${points.length} 个采样点">
        <div class="decision-orbit-value">${stableCount}<small>/${points.length}</small></div>
        <div class="decision-orbit-label">影响较小点位</div>
      </div>
      <div class="decision-content">
        <div class="decision-kicker">沿途天气</div>
        <div class="decision-title">${escapeHtml(title)}</div>
        <div class="decision-copy">${escapeHtml(overview)}</div>
        <div class="decision-fresh">${escapeHtml(dataAgeText(r.fetchedAt, !!stale))}</div>
      </div>
    </div>`;
}

function navWeatherChips(p) {
  const out = [];
  const code = Number(p.code);
  const pp = p.pp == null ? null : Number(p.pp);
  const precip = p.precip == null ? 0 : Number(p.precip);
  const wind = p.wind == null ? null : Number(p.wind);
  const temp = p.temp == null ? null : Number(p.temp);
  if (pp != null) out.push({ text: `降水概率 ${Math.round(pp)}%`, key: pp >= 50 ? 'caution' : 'good' });
  if (precip > 0) out.push({ text: `小时降水 ${precip.toFixed(1)} mm`, key: precip >= 2.5 ? 'caution' : 'fair' });
  if (wind != null && wind >= 29) out.push({ text: `风速 ${Math.round(wind)} km/h`, key: wind >= 50 ? 'bad' : 'caution' });
  if (code === 45 || code === 48) out.push({ text: '能见度低', key: 'caution' });
  if (temp != null && temp <= 0) out.push({ text: `低温 ${Math.round(temp)}℃`, key: 'bad' });
  if (p.elev != null && p.elev > 3000 && temp != null && temp < 5) out.push({ text: `高海拔 ${p.elev} m`, key: 'fair' });
  return out.slice(0, 4);
}

function buildNavWeatherNotes(r) {
  const points = r.points || [];
  const out = [];
  const departLabel = minToHM(Math.round(r.departureHour * 60));
  const arriveMin = Math.round((r.departureHour + r.route.durationMin / 60) * 60);
  out.push(`预计 ${departLabel} 出发，${minToLabel(arriveMin)} 抵达终点`);
  const maxPP = Math.max(...points.map(p => p.pp == null ? 0 : p.pp));
  const maxWind = Math.max(...points.map(p => p.wind == null ? 0 : p.wind));
  const maxElev = Math.max(...points.filter(p => p.elev != null).map(p => p.elev));
  const minTemp = Math.min(...points.filter(p => p.temp != null).map(p => p.temp));
  if (points.some(p => Number(p.code) >= 95)) out.push('沿途有雷暴预报，山区避免在午后通过高海拔路段');
  if (maxPP >= 50) out.push(`部分路段降水概率较高，最高约 ${Math.round(maxPP)}%`);
  if (points.some(p => Number(p.code) === 45 || Number(p.code) === 48)) out.push('部分路段预计有雾');
  if (maxWind >= 29) out.push(`部分路段风速较大，最大约 ${Math.round(maxWind)} km/h`);
  if (isFinite(maxElev) && maxElev > 3000) out.push(`途经海拔约 ${Math.round(maxElev)} m 的路段`);
  if (isFinite(minTemp) && minTemp < 0) out.push('部分路段气温低于 0℃');
  if (r.route.durationMin > 240) out.push('全程超过 4 小时；中途安排休息并复核后段天气');
  out.push('出发前刷新最新天气');
  return out;
}


function navAdviceIcon(text) {
  if (text.includes('雷暴')) return '⛈';
  if (text.includes('降水') || text.includes('雨') || text.includes('雪')) return '☂';
  if (text.includes('雾')) return '≋';
  if (text.includes('风')) return '≫';
  if (text.includes('海拔') || text.includes('气温')) return '△';
  if (text.includes('4 小时')) return '◷';
  if (text.includes('刷新') || text.includes('预报')) return '↻';
  return '◷';
}

function renderNavAdviceHtml(r) {
  return buildNavWeatherNotes(r).map((text, i) => {
    const pieces = text.split(/[，；]/).map(part => part.trim()).filter(Boolean);
    const title = pieces.shift() || text;
    const detail = pieces.join('，');
    return `<div class="smart-note-row">
      <span class="smart-note-index">${String(i + 1).padStart(2, '0')}</span>
      <span class="smart-note-icon" aria-hidden="true">${navAdviceIcon(text)}</span>
      <span class="smart-note-copy"><strong>${escapeHtml(title)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</span>
    </div>`;
  }).join('');
}

function renderNavReport(r, stale) {
  const p2 = n => String(Math.floor(n)).padStart(2, '0');
  const routeName = state.points.map(p => p.name).join(' → ');
  const arriveH = r.route.arriveHour;
  const arriveTotalMin = Math.round(arriveH * 60);
  const arriveHM = Math.floor(arriveTotalMin / 60);
  const arriveClock = `${p2(arriveHM % 24)}:${p2(arriveTotalMin % 60)}`;
  const routeProvider = r.route.provider === 'BRouter'
    ? '<a href="https://brouter.de/" target="_blank" rel="noopener">BRouter</a>'
    : '<a href="https://project-osrm.org/" target="_blank" rel="noopener">OSRM</a>';
  const arriveDayOffset = Math.floor(arriveHM / 24);
  const arriveDate = addDays(r.date, arriveDayOffset);
  const arriveWeek = weekOf(arriveDate);
  const dayTag = arriveDayOffset === 0 ? '' : (arriveDayOffset === 1 ? ' · 次日' : ` · 第 ${arriveDayOffset + 1} 天`);
  const arriveText = `${arriveDate.replace(/-/g, '/')} ${arriveWeek} ${arriveClock}${dayTag}`;
  const keyIdx = r.points.length > 1 ? [0, r.points.length - 1] : [0];
  const legIdx = r.points.map((p, i) => i);
  const weatherLead = navWeatherOverviewHtml(r, stale);
  const rec = recommendationForReport(r);
  const mapPoints = r.points.map(p => {
    return Object.assign({}, p, {
      level: p.level || levelOf(Number(p.score) || 0),
      weatherText: p.weatherText || wmoText(p.code),
      pinLabel: p.pinLabel,
    });
  });

  $('#reportBody').innerHTML = `
    <nav class="report-local-nav" aria-label="报告章节">
      <button class="report-nav-back" type="button" data-view="home" aria-label="返回探索">←</button>
      <span>本次行程</span>
      <button class="on" type="button" data-report-target="routeAnalysis" aria-pressed="true">路线地图</button>
      <button type="button" data-report-target="smartReport" aria-pressed="false">智能报告</button>
      <button type="button" data-report-target="weatherDetails" aria-pressed="false">沿途天气 <span class="tab-count">${r.points.length}</span></button>
    </nav>
    <section class="report-screen is-active" id="routeAnalysis">
    ${reportScreenHeader('ROUTE WEATHER MAP', '沿途天气影响', `${escapeHtml(routeName)} · 点击路线点位查看天气`, '<button class="report-favorite" id="btnReportFavorite" type="button" aria-pressed="false">♡ <span>收藏</span></button>')}
    <div class="card map-card">
      <div class="map-wrap">
        <div id="navMap" class="map map-report"></div>
        <div class="map-tools">
          <button class="map-btn" id="mapToggle" type="button">地形</button>
          <button class="map-btn" id="mapFull" type="button">⛶ 全屏</button>
        </div>
      </div>
      <div class="map-hint">路线颜色表示该里程区间的天气影响；点击路线或采样点查看详情。</div>
    </div>
    ${routeMapConsoleHtml({ routeName, date: r.date, mode: `${modeText(r.travelMode)} · 导航`, distance: r.route.distanceKm, duration: r.route.durationMin, points: r.points, stale, note: r.route.approx ? `路线按${r.route.speedKmh} km/h 估算。` : '颜色表示天气影响程度。' })}
    </section>

    <section class="report-screen smart-report-screen nav-smart-report" id="smartReport">
      ${reportScreenHeader('WEATHER OVERVIEW', '天气总览与行程建议', `${escapeHtml(routeName)} · ${r.date}`, '<button class="report-favorite" id="btnReportFavoriteOverview" type="button" aria-pressed="false">♡ <span>收藏行程</span></button>')}
      <div class="smart-report-content">
        ${weatherLead}
        <div class="smart-report-facts"><div><small>路网距离</small><strong>${r.route.distanceKm.toFixed(0)} <i>km</i></strong></div><div><small>预计用时</small><strong>${fmtDuration(r.route.durationMin)}</strong></div><div><small>出发 / 抵达</small><strong>${minToHM(Math.round(r.departureHour * 60))} <i>→</i> ${arriveClock}</strong></div></div>
        <section class="smart-report-section travel-advice-section"><div class="smart-section-heading"><div><span>TRAVEL ADVICE</span><h3>出行建议</h3></div><button type="button" data-report-target="weatherDetails">查看沿途天气 <b>↗</b></button></div><div class="smart-note-timeline">${renderNavAdviceHtml(r)}</div></section>
        <section class="smart-report-section smart-departure-section"><div class="smart-section-heading"><div><span>DEPARTURE WINDOW</span><h3>出发时段</h3></div></div><div class="departure-intro"><div class="departure-rec-card"><small>近期推荐出发</small><button class="smart-departure-time" id="btnUseSmartRec" type="button" ${rec ? '' : 'disabled'}>${rec ? `<strong>${minToHM(rec.hour * 60)} 出发</strong><small>点击切换</small>` : '<strong>暂无可用时段</strong>'}<p>${r.recommendedMin != null ? `路线最低点位评分 ${Math.round(r.recommendedMin)} 分 · ${modeText(r.travelMode)}` : '当前预报范围内没有完整可用的出发时段'}</p></div><div class="departure-current-card"><small>当前选择 · ${escapeHtml(r.date)}</small><strong>${minToHM(Math.round(r.departureHour * 60))}</strong><span>预计 ${arriveClock} 抵达 · 路网 ${Math.round(r.route.distanceKm)} km</span>${state.departOriginal != null && Math.abs(r.departureHour - state.departOriginal) > 0.01 ? `<button class="smart-restore-time" id="btnRestoreNavDeparture" type="button">恢复原时间 ${minToHM(Math.round(state.departOriginal * 60))}</button>` : ''}</div></div><div class="departure-grid-card"><div class="weather-timeline-head"><strong>72 小时出发时段</strong><span>颜色表示全程天气影响参考</span></div><div id="navHours">${renderNavHours(r)}</div></div></section>
        <div class="smart-report-actions">${shareBarHtml()}</div>
        <details class="smart-data-details"><summary>数据来源与使用边界</summary><div class="smart-data-body"><p>天气按沿途等距采样点展示；采样点之间不逐点显示。</p><p>到达时刻按平均速度估算，未考虑堵车、休息、封路。</p><p>天气与到达时间用于行程安排；出行安全以官方预警和现场判断为准。</p><p>天气数据：<a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a>（CC BY 4.0）</p><p>路径规划：${routeProvider}（路网数据 © OpenStreetMap contributors）</p><p>更新时间：${r.fetchedAt ? new Date(r.fetchedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</p></div></details>
        ${stale ? '<p class="smart-data-note">当前显示离线缓存的预报数据，请联网后刷新。</p>' : ''}
      </div>
    </section>

    <section class="report-screen" id="weatherDetails">
      ${reportScreenHeader('WEATHER ALONG THE WAY', '沿途天气', '点位天气按预计到达时刻取数；点击卡片可切换查看逐小时变化。')}
      <div class="weather-overview-strip"><span>沿路采样 <b>${r.points.length} 个点</b></span><span>路网距离 <b>${Math.round(r.route.distanceKm)} km</b></span><span>预计行程 <b>${fmtDuration(r.route.durationMin)}</b></span></div>
      <div class="weather-screen-grid">
        <div class="weather-points-stack" id="pointCards">
          ${keyIdx.map(i => renderNavPointCard(r.points[i], i, state.expandIdx === i)).join('')}
        </div>
      </div>

    ${legIdx.length ? `
    <div class="weather-timeline-card">
      <div class="weather-timeline-head"><strong>沿线采样时间轴</strong><span>点击行项目可定位到地图</span></div>
      <details class="sample-details" open>
      <summary class="sec-title sample-summary">查看 ${legIdx.length} 个天气采样点 <span class="detail-hint">收起 / 展开</span></summary>
      <div class="card leg-list nav-leg-list">
        <div class="leg-head"><span>位置</span><span>到达</span><span>天气</span><span>温度</span><span>降水</span><span>影响</span></div>
        ${legIdx.map(i => {
          const p = r.points[i];
          const arriveTotalMin = Math.round(p.arriveAbs * 60);
          const dayOff = Math.floor(arriveTotalMin / 1440);
          const day = dayOff > 0 ? ' <sup>次日</sup>' : '';
          const pop = p.pp != null ? Math.round(p.pp) + '%' : '—';
          const mm = p.precip != null && p.precip > 0 ? ` / ${p.precip.toFixed(1)}mm` : '';
          return `<div class="leg-row route-sample-row" data-sample-index="${i}" tabindex="0" role="button" aria-label="定位 ${escapeHtml(p.name)} 天气采样点">
            <span class="lr-name">${escapeHtml(p.name)}</span>
            <span class="lr-time">${minToHM(arriveTotalMin)}${day}</span>
            <span class="lr-wx">${p.icon || ''} ${escapeHtml(p.weatherText)}</span>
            <span class="lr-temp">${p.temp != null ? Math.round(p.temp) + '°' : '—'}</span>
            <span class="lr-precip">${pop}${mm}</span>
            <span class="lr-impact">${escapeHtml(legImpact(p))}</span>
          </div>`;
        }).join('')}
        <div class="leg-note">天气取预计到达该点那一小时的逐小时预报。</div>
      </div>
      </details>
    </div>` : ''}
    </section>

  `;

  bindReportNav();
  bindReportFavorite();
  if (state.reportTab !== 'routeAnalysis') activateReportScreen(state.reportTab, false);
  $$('#pointCards .pt-card').forEach(card => bindCard(card, r, 'nav'));
  bindNavCompare(r);
  const navUseSmartRec = $('#btnUseSmartRec');
  if (navUseSmartRec) navUseSmartRec.addEventListener('click', () => {
    const next = recommendationForReport(r);
    if (!next) return;
    state.date = next.date;
    state.departHour = next.hour;
    const inp = $('#inpDate');
    if (inp) inp.value = state.date;
    toast(`已切换到 ${next.date} ${pad(next.hour)}:00 出发，重新检查…`);
    checkupNavigation();
  });
  const restoreNav = $('#btnRestoreNavDeparture');
  if (restoreNav) restoreNav.addEventListener('click', () => {
    state.departHour = state.departOriginal;
    const sel = $('#selDepart');
    if (sel) sel.value = String(state.departHour);
    toast('已恢复原出发时间，重新检查…');
    checkupNavigation();
  });

  const mapToggle = $('#mapToggle');
  if (mapToggle) {
    mapToggle.addEventListener('click', () => {
      const name = MapCtl.toggleLayer();
      if (!name) return;
      const activeIndex = TILE_LAYERS.findIndex(t => t.name === name);
      const other = TILE_LAYERS[(activeIndex + 1) % TILE_LAYERS.length];
      mapToggle.textContent = other ? other.name : '底图';
      toast('已切换到「' + name + '」底图');
    });
  }
  const mapFullBtn = $('#mapFull');
  if (mapFullBtn) mapFullBtn.addEventListener('click', () => toggleReportFullscreen());

  try {
    MapCtl.renderNavigation('navMap', r.routeCoords, mapPoints, (i) => {
      MapCtl.highlight(i);
      activateReportScreen('weatherDetails', false);
      const card = document.querySelector(`#pointCards .pt-card[data-i="${i}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.remove('flash');
        void card.offsetWidth;
        card.classList.add('flash');
      } else {
        const row = document.querySelector(`.nav-leg-list .route-sample-row[data-sample-index="${i}"]`);
        if (row) {
          activateReportScreen('weatherDetails', false);
          const details = row.closest('details');
          if (details) details.open = true;
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
          row.classList.remove('flash');
          void row.offsetWidth;
          row.classList.add('flash');
        }
      }
    });

    $$('.nav-leg-list .route-sample-row').forEach(row => {
      const locate = () => MapCtl.focusSample(Number(row.dataset.sampleIndex), true);
      row.addEventListener('click', locate);
      row.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); locate(); }
      });
    });
  } catch (e) {
    console.warn('[map] 导航地图渲染失败：', e);
    const wrap = document.querySelector('#navMap')?.parentElement;
    if (wrap) wrap.innerHTML = '<div class="map-fail"><div class="mf-title">地图渲染失败</div>'
      + '<div class="mf-sub">地图组件加载失败；天气数据正常。</div></div>';
  }

  bindShareBar(r);
  syncReportFullscreen();
}

/**
 * 推荐窗口：以基准日 00:00 为 0 的绝对小时下标。
 * 从「现在」（基准日就是今天时取下一个整点）一直到第 3 天的 24:00，共 72 小时，
 * 也就是今天 / 明天 / 后天三段。
 */
function recWindow(baseDate) {
  const isToday = baseDate === todayStr();
  const now = new Date();
  const startIdx = isToday ? Math.min(71, now.getHours() + 1) : 0;
  return { startIdx, endIdx: 72 };
}

/** 逐小时指数：今天 / 明天 / 后天三段，每格都带天气图标，点一下换一个出发时刻 */
function renderNavHours(r) {
  const rows = r.hourScores || [];
  if (!rows.length) return '<div class="cmp-err">暂时没有可用的逐小时预报，换个日期或稍后重试。</div>';

  const valid = rows.filter(x => x.valid);
  const best = valid.length ? valid.reduce((a, b) => (b.min > a.min ? b : a)) : null;

  const groups = [];
  rows.forEach(x => {
    const date = x.date || addDays(r.date, x.dayOffset);
    const last = groups[groups.length - 1];
    if (!last || last.date !== date) groups.push({ date, cells: [x] });
    else last.cells.push(x);
  });

  const tagOf = (date) => {
    const today = todayStr();
    if (date === today) return '今天';
    if (date === addDays(today, 1)) return '明天';
    if (date === addDays(today, 2)) return '后天';
    return '';
  };

  return groups.map(g => {
    const tag = tagOf(g.date);
    return `
    <div class="rec-day">
      <div class="rec-day-head">
        <span class="rec-date">${g.date.slice(5).replace('-', '/')} ${weekOf(g.date)}</span>
        ${tag ? `<span class="cmp-day-tag">${tag}</span>` : ''}
      </div>
      <div class="rec-strip">${g.cells.map(x => recCellHtml(x, r, best)).join('')}</div>
    </div>`;
  }).join('');
}

function recCellHtml(x, r, best) {
  const key = x.valid ? levelOf(x.min).key : 'off';
  const on = x.date === r.date && x.hour === r.departureHour;
  const isBest = best && x.valid && x.idx === best.idx;
  const label = `${x.date} ${String(x.hour).padStart(2, '0')}:00 出发`;
  return `<button type="button" class="rec-hour ${key}${on ? ' on' : ''}${isBest ? ' best' : ''}"
    data-hour="${x.hour}" data-date="${x.date}" ${x.valid ? '' : 'disabled'} aria-label="${label}">
    <span class="rh-hour">${String(x.hour).padStart(2, '0')}</span>
    <span class="rh-icon">${wmoIcon(x.code)}</span>
    <span class="rh-idx">${x.valid ? x.min : '·'}</span>
    <span class="rh-temp">${x.temp != null ? Math.round(x.temp) + '°' : '—'}</span>
    ${isBest ? '<span class="rh-best">推荐</span>' : ''}
  </button>`;
}

function bindNavCompare(r) {
  $$('#navHours .rec-hour').forEach(btn => {
    btn.addEventListener('click', () => {
      const date = btn.dataset.date;
      const hour = Number(btn.dataset.hour);
      const ctx = state.navCtx;
      if (!ctx) return;
      // 切到窗口里的另一天时，把已取的逐小时数据按天切片即可，不必重新请求
      const diff = Math.round((new Date(date + 'T00:00:00') - new Date(ctx.baseDate + 'T00:00:00')) / 86400000);
      const ser = diff > 0 ? ctx.series.map(s => Object.assign({}, s, { hours: s.hours.slice(diff * 24) })) : ctx.series;
      const rep = analyzeNavigation(ser, ctx.elevations, ctx.samples, ctx.route, hour, date, state.mode);
      if (!rep) { toast('该时刻的预报不完整，换一个时刻试试'); return; }
      rep.stale = ctx.stale;
      rep.fetchedAt = ctx.at;
      rep.routeCoords = ctx.route.coords;
      rep.hourScores = ctx.hourScores;
      state.date = date;
      state.departHour = hour;
      const inp = $('#inpDate');
      if (inp) inp.value = date;
      const sel = $('#selDepart');
      if (sel) sel.value = String(hour);
      state.currentReport = rep;
      state.expandIdx = -1;
      state.hourSel = {};
      renderNavReport(rep, ctx.stale);
      toast(`已切换到 ${date} ${pad(hour)}:00 出发`);
    });
  });
}

function renderNavPointCard(p, i, expanded) {
  const selHour = state.hourSel[i] != null ? state.hourSel[i] : p.hour;
  const sel = (p.hourly || []).find(h => h.hour === selHour) || null;
  const cur = sel ? Object.assign({ elev: p.elev }, sel) : p;
  const lv = cur.level || levelOf(Number(cur.score) || 0);
  const p2 = n => String(Math.floor(n)).padStart(2, '0');
  const arriveTotalMin = Math.round(p.arriveAbs * 60);
  const arriveDayOffset = Math.floor(arriveTotalMin / 1440);
  const arriveLabel = minToHM(arriveTotalMin) + (arriveDayOffset > 0 ? '<sup>次日</sup>' : '');
  const isArrival = selHour === p.hour;
  const isStart = p.ratio === 0;
  const timeLine = isArrival
    ? (isStart ? `出发时刻 ${arriveLabel}` : `预计 ${arriveLabel} 到达`)
    : `正在查看 ${p2(selHour)}:00 · ${isStart ? '出发' : '到达'} ${arriveLabel}`;
  const resetBtn = isArrival ? '' : `<button class="arr-reset" data-back="${i}">回到${isStart ? '出发' : '到达'}时刻</button>`;
  const good = cur.score >= 80;
  const chips = good ? buildHighlights(cur) : (cur.deductions || []).slice(0, 3).map(d => d.label);
  const chipHtml = chips.length
    ? chips.map(c => `<span class="ded ${good ? 'up' : lv.key}">${good ? '✓ ' : ''}${escapeHtml(c)}</span>`).join('')
    : `<span class="ded none">${good ? '天气条件良好' : '—'}</span>`;
  const meta = [
    wmoText(cur.code),
    cur.temp != null ? `${cur.temp.toFixed(1)}℃` : null,
    cur.wind != null ? `风速 ${Math.round(cur.wind)} km/h` : null,
    p.elev != null ? `${p.elev} m` : null,
  ].filter(Boolean).join(' · ');

  return `
    <div class="card pt-card" data-i="${i}" data-kind="nav">
      <div class="pt-card-head" data-i="${i}">
        <div class="pc-left">
          <div>
            <div class="pc-name">${escapeHtml(p.name)}</div>
            <div class="pc-meta">${meta || '—'}</div>
          </div>
        </div>
        <div class="pc-right">
          <span class="pc-score ${lv.key}">${cur.score}</span>
          <span class="pc-lv ${lv.key}">${lv.text}</span>
        </div>
      </div>

      <div class="pc-arrive">
        <span class="arr-time">${timeLine}</span>
        ${resetBtn}
        <span class="arr-km">${isStart ? '起点' : '距起点 ' + p.cumKm.toFixed(0) + ' km'}</span>
      </div>

      <div class="pc-deds">${chipHtml}</div>

      ${expanded ? renderHourly(p, i, selHour) : renderHourlyStrip(p, i, selHour)}
    </div>`;
}

/* ============================================================
 * 点位模式报告渲染
 * ============================================================ */

/** 规划模式：起点未来 3 天的逐小时出发指数 */
async function buildPlanHourScores(startPoint, dateStr) {
  const today = todayStr();
  const diff = Math.round((new Date(dateStr + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
  const baseDate = diff <= 13 ? today : dateStr;
  const [res, elevs] = await Promise.all([
    fetchHourly([startPoint], baseDate, 3),
    fetchElevations([startPoint]),
  ]);
  if (!res.ok || !res.series.length) return { rows: [], baseDate };
  const hours = res.series[0].hours;
  const now = new Date();
  const startAbs = baseDate === today ? Math.ceil(now.getHours() + now.getMinutes() / 60) : 0;
  const rows = [];
  for (let k = 0; k < 72; k++) {
    const idx = startAbs + k;
    const h = hours[idx];
    if (!h) break;
    const hh = idx % 24;
    if (hh < 8 || hh > 20) continue;   // 只给 08:00–20:00 的合理出发时段
    const sc = scoreHour(h, elevs[0]);
    const d = new Date(baseDate + 'T00:00:00');
    d.setDate(d.getDate() + Math.floor(idx / 24));
    rows.push({
      idx, date: fmtDate(d), hour: hh, dayOffset: Math.floor(idx / 24),
      min: sc.score, valid: true, code: h.code, temp: h.temp,
    });
  }
  return { rows, baseDate };
}

/** 规划模式：整体平移出发时刻（±2 小时），看全程分怎么变 */
function buildShiftOptions(points, times, mode, weather, elevations, dateStr) {
  const deltas = [-120, -60, 0, 60, 120];
  return deltas.map(delta => {
    const shifted = times.map(t => Math.max(0, (t == null ? 0 : t) + delta));
    const built = buildPlanSamples(points, shifted, mode, 20);
    let score = null;
    try {
      const rep = analyzePlanRoute({
        series: weather.series, elevations, samples: built.samples, legs: built.legs,
        sun: weather.sun, dateStr, mode,
      });
      score = rep ? rep.routeScore : null;
    } catch (e) { score = null; }
    return { delta, score, times: shifted };
  });
}

function shiftLabel(delta) {
  if (!delta) return '原计划';
  const h = Math.abs(delta) / 60;
  const hs = Number.isInteger(h) ? h : h.toFixed(1);
  return delta < 0 ? `提前 ${hs} 小时` : `推迟 ${hs} 小时`;
}

function renderShiftChips(r) {
  const opts = r.shiftOptions || [];
  if (!opts.length) return '<div class="cmp-err">没有可对比的时刻</div>';
  return opts.map(o => {
    const key = o.score == null ? 'off' : levelOf(o.score).key;
    return `<button type="button" class="shift-chip ${key}${o.delta === 0 ? ' on' : ''}"
      data-delta="${o.delta}" ${o.score == null ? 'disabled' : ''}>
      <span class="sc-t">${shiftLabel(o.delta)}</span>
      <span class="sc-s">${o.score == null ? '—' : o.score}</span>
    </button>`;
  }).join('');
}

function bindShiftChips(r) {
  $$('.shift-chip[data-delta]').forEach(b => {
    b.addEventListener('click', () => {
      const d = Number(b.dataset.delta);
      if (!d) return;
      ensureTimes();
      state.times = state.times.map(t => Math.max(0, t + d));
      toast(d < 0 ? `已整体提前 ${-d / 60} 小时，重新体检…` : `已整体推迟 ${d / 60} 小时，重新体检…`);
      runCheckup();
    });
  });
}

/** 沿途采样：原因说明为什么扣分，影响说明对通行意味着什么 */
function legReason(p) {
  if (p.score >= 80) return '天气良好';
  const ds = (p.deductions || []).slice(0, 2).map(d => d.label);
  return ds.length ? ds.join('；') : '综合条件一般';
}

function legImpact(p) {
  const code = Number(p.code);
  const precip = p.precip == null ? 0 : Number(p.precip);
  const pp = p.pp == null ? 0 : Number(p.pp);
  const wind = p.wind == null ? 0 : Number(p.wind);
  const temp = p.temp == null ? null : Number(p.temp);
  const out = [];

  if (code >= 95) out.push('雷暴天气影响');
  else if ([56, 57, 66, 67].includes(code) || (temp != null && temp < 0)) out.push('低温或冻雨条件，留意结冰可能');
  else if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) out.push('降雪天气影响');
  else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || precip > 0.5) {
    out.push('降水可能影响路面与能见度');
  }

  if (code === 45 || code === 48) out.push('能见度低');
  if (wind >= 40) out.push('较强风速');
  else if (wind >= 29) out.push('风速偏高');
  if (temp != null && temp >= 32) out.push('高温、体力消耗大');
  if (p.elev != null && p.elev > 3000 && temp != null && temp < 5) out.push('高海拔低温');

  const uniq = [...new Set(out)].slice(0, 2);
  if (uniq.length) return uniq.join('；');
  if (p.score >= 80) return '影响较小';
  if (pp >= 60) return '降水可能性高';
  return '天气对通行有轻度影响';
}

function currentDepartureMinute(r) {
  if (!r) return null;
  if (r.mode === 'nav' && r.departureHour != null) return Math.round(r.departureHour * 60);
  const first = r.points && r.points[0];
  return first && first.minute != null ? first.minute : null;
}

function recommendedDepartureMinute(r, it) {
  if (!r || !it) return null;
  const cur = currentDepartureMinute(r);

  if (it.apply && it.apply.type === 'navDepart' && it.apply.hour != null) {
    return Math.round(it.apply.hour * 60);
  }
  if (r.mode === 'nav' && r.recommendedHour != null) {
    return Math.round(r.recommendedHour * 60);
  }

  const shift = (it.applies || []).find(a => a.type === 'shiftAll' && Number.isFinite(a.delta));
  if (shift && cur != null) return Math.round(cur + shift.delta);

  const acts = it.actions || [];
  if (acts.some(a => a.includes('改期') || a.includes('缩短行程'))) return null;
  return cur;
}

function departureChangeText(cur, rec) {
  if (cur == null || rec == null) return '';
  const diff = Math.round(rec - cur);
  if (Math.abs(diff) < 5) return '保持当前时间';
  return (diff > 0 ? '推迟 ' : '提前 ') + fmtDuration(Math.abs(diff));
}

/** 出行建议：先给推荐出发时间，再说明这一段为什么不合适 */
function buildTripAdvice(r) {
  const items = ((r.diagnosis && r.diagnosis.items) || []).filter(x => x.severity !== 'ok');
  const cur = currentDepartureMinute(r);
  if (!items.length) return [];

  const lines = items.slice(0, 5).map(it => {
    const rec = recommendedDepartureMinute(r, it);
    if (rec != null) {
      const change = departureChangeText(cur, rec);
      const p = r.points && r.points[it.index];
      const where = p && p.name ? p.name + '：' : '';
      const evidence = (it.evidence || '').split('，').slice(0, 2).join('，');
      return `推荐 ${minToLabel(rec)} 出发${change ? '（' + change + '）' : ''}；`
        + where + (it.tag || '行程调整') + (evidence ? '；' + evidence : '');
    }
    const act = (it.actions && it.actions.length) ? it.actions[0] : (it.advice || '');
    return it.title + (act ? '：' + act : '');
  });
  return lines.slice(0, 5);
}

function renderReport(r, stale) {
  const routeName = state.points.map(p => p.name).join(' → ');
  const decisionLead = decisionLeadHtml(r, stale);
  const rec = recommendationForReport(r);
  const currentMinute = currentDepartureMinute(r);
  const same = rec && rec.date === r.date && currentMinute != null
    && Math.abs(rec.hour * 60 - (((currentMinute % 1440) + 1440) % 1440)) < 5;
  const worst = r.points[r.worstIndex];
  const keyRows = r.points.map((p, i) => ({ p, i })).filter(x => x.p.kind !== 'leg');
  const totalKm = (r.legs || []).reduce((s2, L) => s2 + L.km * 1.25, 0);
  const totalMin = r.points.length > 1 ? (r.points[r.points.length - 1].minute - r.points[0].minute) : 0;
  const legRows = r.points.map((p, i) => ({ p, i }));   // 关键点位 + 沿途采样，按行程顺序
  const riskCandidates = r.points.map((p, i) => ({ p, i }))
    .filter(x => x.p.score != null && Number.isFinite(Number(x.p.score)) && x.p.weatherText && x.p.kind === 'leg')
    .sort((a, b) => Number(a.p.score) - Number(b.p.score));
  const usedRiskSections = new Set();
  const riskRows = riskCandidates.filter(({ p }) => {
    const key = Math.floor(Number(p.cumKm || 0) / 16);
    if (usedRiskSections.has(key)) return false;
    usedRiskSections.add(key);
    return true;
  }).slice(0, 3);
  if (!riskRows.length) {
    riskRows.push(...r.points.map((p, i) => ({ p, i }))
      .filter(x => x.p.score != null && Number.isFinite(Number(x.p.score)) && x.p.weatherText)
      .sort((a, b) => Number(a.p.score) - Number(b.p.score)).slice(0, 3));
  }

  const dz = r.diagnosis || { items: [], blockCount: 0, warnCount: 0, summary: 'ok' };
  const dzText = dz.summary === 'block' ? `发现 ${dz.blockCount} 处需要调整`
    : dz.summary === 'warn' ? `${dz.warnCount} 处建议微调`
    : (r.routeScore < 80 ? `全程最低 ${r.routeScore} 分` : '行程安排合理');
  const dzNote = dz.summary === 'block' ? '按下面的建议调整后再出发'
    : dz.summary === 'warn' ? '整体可行，把时间微调一下会更稳'
    : (r.routeScore < 80 ? '有一处把总分拉低了' : '各点位的时间安排与天气都匹配');

  const planTimeChanged = !!state.planOriginalTimes && (state.planOriginalDate !== state.date || state.times.some((v, i) => Math.round(v) !== Math.round(state.planOriginalTimes[i])));

  $('#reportBody').innerHTML = `
    <nav class="report-local-nav" aria-label="报告章节">
      <button class="report-nav-back" type="button" data-view="home" aria-label="返回探索">←</button>
      <span>本次行程</span>
      <button class="on" type="button" data-report-target="routeAnalysis" aria-pressed="true">路线地图</button>
      <button type="button" data-report-target="smartReport" aria-pressed="false">智能报告</button>
      <button type="button" data-report-target="weatherDetails" aria-pressed="false">沿途天气 <span class="tab-count">${r.points.length}</span></button>
    </nav>
    <section class="report-screen is-active" id="routeAnalysis">
    ${reportScreenHeader('ROUTE WEATHER MAP', '沿途天气影响', `${escapeHtml(routeName)} · 点击路线点位查看天气`, '<button class="report-favorite" id="btnReportFavorite" type="button" aria-pressed="false">♡ <span>收藏</span></button>')}
    <div class="card map-card">
      <div class="map-wrap">
        <div id="reportMap" class="map map-report"></div>
        <div class="map-tools">
          <button class="map-btn" id="mapToggle" type="button">地形</button>
          <button class="map-btn" id="mapFull" type="button">⛶ 全屏</button>
        </div>
      </div>
      <div class="map-hint">点击地图点位查看对应天气信息。</div>
    </div>
    ${routeMapConsoleHtml({ routeName, date: r.date, mode: modeText(r.mode), distance: totalKm, duration: totalMin, points: r.points, stale, note: '颜色表示沿途天气影响。' })}
    </section>

    <section class="report-screen smart-report-screen" id="smartReport">
      ${reportScreenHeader('SMART JOURNEY REPORT', '智能行程报告', `${escapeHtml(routeName)} · ${r.date} · ${modeText(r.mode)}`, '<button class="report-favorite" id="btnReportFavoriteOverview" type="button" aria-pressed="false">♡ <span>收藏行程</span></button>')}
      <div class="smart-report-content">
        ${decisionLead}
        <div class="smart-recommendation-spotlight"><div class="recommendation-clock">◷</div><div><span>推荐出发时间</span><strong>${rec ? `${escapeHtml(rec.date.slice(5).replace('-', '/'))} · ${pad(rec.hour)}:00` : '暂无可用推荐时段'}</strong><small>${rec ? `整段天气评分 ${rec.score} 分 · ${same ? '当前时刻已是推荐时段' : '根据沿途天气窗口计算'}` : '可调整日期或路线后重新评估'}</small></div><i>✦</i></div>
        <section class="smart-report-section"><div class="smart-section-heading"><div><span>WEATHER RISKS</span><h3>重点风险提示</h3></div><button type="button" data-report-target="weatherDetails">查看沿途天气 <b>↗</b></button></div>
          <div class="diagnosis-board smart-diagnosis-board"><div class="diagnosis-board-head"><span>SMART TRIP CHECK</span><strong>${escapeHtml(dzText)}</strong><p>${escapeHtml(dzNote)}</p></div><div class="diagnosis-list">${dz.items.length ? dz.items.slice(0, 3).map(renderDx).join('') : '<div class="diagnosis-clear"><span>✓</span><b>当前没有需要调整的诊断项</b></div>'}</div></div>
        </section>
        <section class="smart-report-section smart-route-risk"><div class="smart-section-heading"><div><span>ROUTE WATCH · TOP 3</span><h3>沿途重点路段</h3></div><button type="button" data-report-target="weatherDetails">查看全部点位 <b>↗</b></button></div>
          <div class="smart-segment-timeline">${riskRows.length ? riskRows.map(({ p, i }, rank) => { const segmentLevel = levelOf(Number(p.score)); return `<button class="smart-segment-row ${segmentLevel.key}" type="button" data-risk-sample="${i}"><span class="segment-rank">0${rank + 1}</span><span class="segment-copy"><strong>${escapeHtml(p.name || `沿线采样点 ${rank + 1}`)}</strong><small>${Number.isFinite(Number(p.cumKm)) ? `${Number(p.cumKm).toFixed(0)} km · ` : ''}${escapeHtml(p.weatherText || wmoText(p.code))}${p.elev != null ? ` · ${Math.round(p.elev)} m` : ''}</small></span><span class="segment-score">${Math.round(Number(p.score))}<small>分</small></span><span class="segment-arrow">↗</span></button>`; }).join('') : '<p class="smart-empty-note">暂无沿途评分数据。</p>'}</div>
        </section>
        ${elevationProfileHtml(r.points)}
        <section class="smart-report-section smart-departure-section"><div class="smart-section-heading"><div><span>DEPARTURE WINDOW</span><h3>出发时段</h3></div></div><div class="departure-intro"><div class="departure-rec-card"><small>当前预报窗口内推荐</small><button class="smart-departure-time" id="btnUseSmartRec" type="button" ${rec ? '' : 'disabled'}>${rec ? `<strong>${escapeHtml(rec.date.slice(5).replace('-', '/'))} ${pad(rec.hour)}:00</strong><small>点击切换</small>` : '<strong>暂无可用时段</strong>'}<p>${rec ? `整条路线天气评分 ${rec.score} 分 · ${departureChangeText(currentDepartureMinute(r), rec.hour * 60) || '保持当前安排'}` : '可尝试调整日期或路线后重新分析'}</p></div><div class="departure-current-card"><small>当前行程安排</small><strong>${minToHM(Math.round((currentDepartureMinute(r) || 0)))}</strong><span>路线天气评分 ${r.routeScore} 分 · ${fmtDuration(totalMin)} 预计用时</span></div></div><div class="departure-grid-card"><div class="weather-timeline-head"><strong>未来出发时段</strong><span>点击时段即可重新检查</span></div><div id="planHours">${renderNavHours(r)}</div>${planTimeChanged ? `<div class="restore-plan"><button class="btn btn-ghost" id="btnRestorePlan" type="button">恢复原时间</button></div>` : ''}</div></section>
        <div class="smart-report-actions">${shareBarHtml()}</div>
        <details class="smart-data-details"><summary>数据来源与使用边界</summary><div class="smart-data-body"><p>沿途按约 8 km 采样，共 ${r.points.length} 处；采样点之间不逐米评估。规划路径按关键点位连线估算。</p><p>到达时刻按平均速度估算，未考虑堵车、休息、封路。</p><p>评分用于比较天气影响；出行安全以官方预警和现场判断为准。</p><p>天气数据：<a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a>（CC BY 4.0）</p><p>评分与行程结论由本产品计算生成。</p><p>更新时间：${r.fetchedAt ? new Date(r.fetchedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</p><p>预报数据缓存 1 小时。</p></div></details>
        ${stale ? '<p class="smart-data-note">当前显示离线缓存的预报数据，请联网后刷新。</p>' : ''}
      </div>
    </section>

    <section class="report-screen" id="weatherDetails">
      ${reportScreenHeader('WEATHER ALONG THE WAY', '沿途天气', '点位天气按预计到达时刻取数；展开卡片可以查看逐小时变化。')}
      <div class="weather-overview-strip"><span>天气采样 <b>${r.points.length} 个点</b></span><span>路线评分 <b>${r.routeScore} / 100</b></span><span>最低点位 <b>${escapeHtml(worst.name)}</b></span></div>
      <div class="weather-screen-grid">
        <div class="weather-points-stack" id="pointCards">
          ${keyRows.map(x => renderPointCard(x.p, x.i, state.expandIdx === x.i)).join('')}
        </div>
      </div>

    ${legRows.length ? `
    <div class="weather-timeline-card">
      <div class="weather-timeline-head"><strong>路线天气时间轴</strong><span>按行程顺序排列</span></div>
      <details class="sample-details" open>
      <summary class="sec-title sample-summary">查看 ${legRows.length} 个关键点与沿途采样 <span class="detail-hint">收起 / 展开</span></summary>
      <div class="card leg-list">
      <div class="leg-head"><span>位置</span><span>到达</span><span>天气</span><span>评分</span><span>原因</span><span>影响</span></div>
      ${legRows.map(x => `
        <div class="leg-row" data-sample-index="${x.i}">
          <span class="lr-name">${escapeHtml(x.p.name)}</span>
          <span class="lr-time">${x.p.timeLabel}</span>
          <span class="lr-wx">${x.p.icon || ''} ${escapeHtml(x.p.weatherText)}</span>
          <span class="lr-score ${x.p.level.key}">${x.p.score}</span>
          <span class="lr-why">${escapeHtml(legReason(x.p))}</span>
          <span class="lr-impact">${escapeHtml(legImpact(x.p))}</span>
        </div>`).join('')}
      <div class="leg-note">采样说明：关键点位与沿途采样点按行程顺序列出；「K6」表示距该段起点约 6 km 处。沿途点在相邻点位之间按直线等距插值，约每 8 km 一个（单段最多 12 个、全线不超过 20 个，长路段间隔会更大）；每个点取「预计到达该点那一刻」的天气，跨天时取次日预报。</div>
      </div>
      </details>
    </div>` : ''}
    </section>

  `;

  bindReportNav();
  bindReportFavorite();
  if (state.reportTab !== 'routeAnalysis') activateReportScreen(state.reportTab, false);

  // 诊断条目：点击弹出具体措施
  $$('.dx-item[data-idx]').forEach(el => {
    el.addEventListener('click', () => openDx(Number(el.dataset.idx)));
    el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openDx(Number(el.dataset.idx)); } });
  });

  $$('.smart-segment-row[data-risk-sample]').forEach(button => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.riskSample);
      activateReportScreen('weatherDetails', true);
      MapCtl.highlight(index);
      const card = document.querySelector(`#pointCards .pt-card[data-i="${index}"]`);
      const row = document.querySelector(`.leg-row[data-sample-index="${index}"]`);
      const target = card || row;
      if (target) {
        const details = target.closest('details');
        if (details) details.open = true;
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.remove('flash');
        void target.offsetWidth;
        target.classList.add('flash');
      }
    });
  });

  // 绑定卡片：展开/收起 + 点击小时切换
  $$('#pointCards .pt-card').forEach(card => bindCard(card, r));

  // 恢复原时间
  const rp = $('#btnRestorePlan');
  if (rp) rp.addEventListener('click', () => {
    if (!state.planOriginalTimes) return;
    state.times = state.planOriginalTimes.slice();
    if (state.planOriginalDate) {
      state.date = state.planOriginalDate;
      const inp = $('#inpDate');
      if (inp) inp.value = state.date;
    }
    state.planOriginalTimes = null;
    state.planOriginalDate = null;
    toast('已恢复原时间，重新体检…');
    runCheckup();
  });

  // 逐小时出发格：点击后整体平移行程
  $$('#planHours .rec-hour').forEach(btn => {
    btn.addEventListener('click', () => {
      const date = btn.dataset.date;
      const hour = Number(btn.dataset.hour);
      const ctx = state.planCtx;
      if (!ctx) return;
      toast(`已平移到 ${date} ${pad(hour)}:00 出发，重新体检…`);
      applyPlanDeparture(date, hour);
    });
  });

  // 地图：路线可视化 + 点击点位联动卡片（地图失败绝不能影响整页）
  try {
    const mapRows = r.points.map((p, i) => {
      const keyIndex = keyRows.findIndex(x => x.i === i);
      return Object.assign({}, p, {
        __i: i,
        __showMarker: keyIndex >= 0,
        level: p.score != null && Number.isFinite(Number(p.score)) ? levelOf(Number(p.score)) : p.level,
        pinLabel: keyIndex < 0 ? '' : (keyIndex === 0 ? '起' : (keyIndex === keyRows.length - 1 ? '终' : '途')),
      });
    });
    MapCtl.renderReport('reportMap', mapRows, (i) => {
      const realIdx = mapRows[i] ? mapRows[i].__i : i;
      MapCtl.highlight(i);
      activateReportScreen('weatherDetails', false);
      const card = document.querySelector(`#pointCards .pt-card[data-i="${realIdx}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.remove('flash');
        void card.offsetWidth;
        card.classList.add('flash');
      } else {
        const row = document.querySelector(`.leg-row[data-sample-index="${realIdx}"]`);
        if (row) {
          const details = row.closest('details');
          if (details) details.open = true;
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
          row.classList.remove('flash');
          void row.offsetWidth;
          row.classList.add('flash');
        }
      }
    });
  } catch (e) {
    console.warn('[map] 地图渲染失败：', e);
    const wrap = document.querySelector('#reportMap')?.parentElement;
    if (wrap) wrap.innerHTML = '<div class="map-fail"><div class="mf-title">地图渲染失败</div>'
      + '<div class="mf-sub">地图组件加载失败；天气数据与评分正常。</div></div>';
  }

  // 底图切换（按钮始终显示"另一张图"的名字）
  const mapToggle = $('#mapToggle');
  if (mapToggle) {
    mapToggle.addEventListener('click', () => {
      const name = MapCtl.toggleLayer();
      if (!name) return;
      const activeIndex = TILE_LAYERS.findIndex(t => t.name === name);
      const other = TILE_LAYERS[(activeIndex + 1) % TILE_LAYERS.length];
      mapToggle.textContent = other ? other.name : '底图';
      toast('已切换到「' + name + '」底图');
    });
  }
  const mapFullBtn = $('#mapFull');
  if (mapFullBtn) mapFullBtn.addEventListener('click', () => toggleReportFullscreen());

  bindShareBar(r);
  bindShiftChips(r);
  const useSmartRec = $('#btnUseSmartRec');
  if (useSmartRec) useSmartRec.addEventListener('click', () => {
    const rec = recommendationForReport(r);
    if (!rec) return;
    toast(`已切换到 ${rec.date} ${pad(rec.hour)}:00 出发，重新体检…`);
    applyPlanDeparture(rec.date, rec.hour);
  });
  syncReportFullscreen();

  runDiag();
}

/** 诊断条目：证据 + 影响 + 建议 */
function renderDx(it, idx) {
  const icon = it.severity === 'block' ? '⛔' : it.severity === 'warn' ? '⚠️' : '✅';
  const lines = [];
  if (it.evidence) lines.push(`<div class="dx-l"><b>证据：</b>${escapeHtml(it.evidence)}</div>`);
  if (it.impact) lines.push(`<div class="dx-l"><b>影响：</b>${escapeHtml(it.impact)}</div>`);
  const hint = (it.actions && it.actions.length)
    ? '<div class="dx-hint">查看具体措施 ›</div>' : '';
  return `<div class="dx-item ${it.severity}" data-idx="${idx}" role="button" tabindex="0">
      <div class="dx-t">${icon} ${escapeHtml(it.title)}</div>
      ${lines.join('')}
      ${hint}
    </div>`;
}

/** 天气好时展示的绿色加分项（不显示扣分） */
function buildHighlights(p) {
  const out = [];
  if (p.precip != null && p.precip === 0) out.push('无降水');
  else if (p.pp != null && p.pp <= 20) out.push('降水概率低（' + Math.round(p.pp) + '%）');
  if (p.wind != null && p.wind <= 18) out.push('风速小（' + Math.round(p.wind) + ' km/h）');
  if (p.temp != null && p.temp >= 12 && p.temp <= 26) out.push('气温舒适（' + Math.round(p.temp) + '℃）');
  if (p.code != null && p.code <= 3) out.push('天气晴好');
  if (p.elev != null && p.elev < 2500) out.push('海拔适中');
  return out.slice(0, 4);
}

function bindCard(card, r, kind) {
  const i = Number(card.dataset.i);
  kind = kind || card.dataset.kind || 'plan';
  const head = card.querySelector('.pt-card-head');
  if (head) {
    head.addEventListener('click', () => {
      state.expandIdx = state.expandIdx === i ? -1 : i;
      if (kind === 'nav') renderNavReport(r, !!r.stale);
      else renderReport(r, !!r.stale);
    });
  }
  card.querySelectorAll('[data-hour]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      state.hourSel[i] = Number(el.dataset.hour);
      refreshCard(i);
    });
  });
  const back = card.querySelector('.arr-reset');
  if (back) {
    back.addEventListener('click', (ev) => {
      ev.stopPropagation();
      delete state.hourSel[i];
      refreshCard(i);
    });
  }
}

/** 只重绘一张卡片（不重建地图） */
function refreshCard(i) {
  const r = state.currentReport;
  const old = document.querySelector(`#pointCards .pt-card[data-i="${i}"]`);
  if (!r || !old) return;
  const kind = old.dataset.kind === 'nav' ? 'nav' : 'plan';
  const tmp = document.createElement('div');
  tmp.innerHTML = kind === 'nav'
    ? renderNavPointCard(r.points[i], i, state.expandIdx === i)
    : renderPointCard(r.points[i], i, state.expandIdx === i);
  const fresh = tmp.firstElementChild;
  old.replaceWith(fresh);
  bindCard(fresh, r, kind);
}

function renderPointCard(p, i, expanded) {
  const selHour = state.hourSel[i] != null ? state.hourSel[i] : p.hour;
  const sel = (p.hourly || []).find(h => h.hour === selHour) || null;
  const cur = sel ? Object.assign({ elev: p.elev }, sel) : p;

  const lv = cur.level;
  const good = cur.score >= 80;
  const chips = good ? buildHighlights(cur) : (cur.deductions || []).slice(0, 3).map(d => d.label);
  const dedHtml = chips.length
    ? chips.map(c => `<span class="ded ${good ? 'up' : lv.key}">${good ? '✓ ' : ''}${escapeHtml(c)}</span>`).join('')
    : `<span class="ded none">${good ? '天气条件良好' : '—'}</span>`;

  const isArrival = selHour === p.hour;
  const timeLine = isArrival
    ? `${p.kind === 'point' && p.pointIdx === 0 ? '出发时刻' : '到达时刻'} ${p.timeLabel || '—'}`
    : `正在查看 ${pad(selHour)}:00 · 到达 ${p.timeLabel || '—'}`;
  const resetBtn = isArrival ? '' : `<button class="arr-reset" data-back="${i}">回到到达时刻</button>`;

  return `
    <div class="card pt-card" data-i="${i}" data-kind="plan">
      <div class="pt-card-head" data-i="${i}">
        <div class="pc-left">
          <div>
            <div class="pc-name">${escapeHtml(p.name)}</div>
            <div class="pc-meta">${wmoText(cur.code)}${cur.temp != null ? ' · ' + cur.temp.toFixed(1) + '℃' : ''}${p.elev != null ? ' · ' + p.elev + 'm' : ''}</div>
          </div>
        </div>
        <div class="pc-right">
          <span class="pc-score ${lv.key}">${cur.score}</span>
          <span class="pc-lv ${lv.key}">${lv.text}</span>
        </div>
      </div>

      <div class="pc-arrive">
        <span class="arr-time">${timeLine}</span>
        ${resetBtn}
      </div>

      <div class="pc-deds">${dedHtml}</div>

      ${expanded ? renderHourly(p, i, selHour) : renderHourlyStrip(p, i, selHour)}
    </div>`;
}

/** 始终可见的「行程日 24 小时」天气条；weatherOnly 模式不展示评分 */
function renderHourlyStrip(p, i, selHour, weatherOnly) {
  const hours = p.hourly || [];
  return `
    <div class="hourly-strip-wrap">
      <div class="hourly-strip">
        ${hours.map(h => `
          <div class="hs-col ${weatherOnly ? 'hs-weather' : 'hs-' + levelOf(h.score).key}${h.hour === selHour ? ' hs-now' : ''}" data-i="${i}" data-hour="${h.hour}" title="点击查看 ${pad(h.hour)}:00 ${wmoText(h.code)}">
            <div class="hs-hour">${pad(h.hour)}</div>
            <div class="hs-icon">${wmoIcon(h.code)}</div>
            <div class="hs-temp">${h.temp != null ? Math.round(h.temp) + '°' : '—'}</div>
            <div class="hs-pp">${h.pp != null ? Math.round(h.pp) + '%' : '—'}</div>
          </div>`).join('')}
      </div>
      <div class="ht-legend">${weatherOnly ? '时刻 / 天气 / 气温 / 降水概率（点击任意小时可切换查看）' : '行程日逐小时：时刻 / 天气 / 气温 / 降水概率；底色表示该小时适宜度（点击任意小时可切换查看）'}</div>
    </div>`;
}

function renderHourly(p, i, selHour) {
  return `
    <div class="hourly-table">
      <div class="ht-scroll">
        ${p.hourly.map(h => `
          <div class="ht-col${h.hour === selHour ? ' ht-center' : ''}" data-i="${i}" data-hour="${h.hour}">
            <div class="ht-hour">${pad(h.hour)}</div>
            <div class="ht-wx">${wmoIcon(h.code)} ${wmoText(h.code)}</div>
            <div class="ht-temp">${h.temp != null ? Math.round(h.temp) + '°' : '—'}</div>
            <div class="ht-pp">${h.pp != null ? h.pp + '%' : '—'}</div>
            <div class="ht-wind">${h.wind != null ? Math.round(h.wind) + 'km/h' : '—'}</div>
          </div>`).join('')}
      </div>
      <div class="ht-legend">时刻 / 天气 / 气温 / 降水概率 / 风速</div>
    </div>`;
}

/* ---------------- 历史行程 ---------------- */

function openTrip(id) {
  const t = getTrip(id);
  if (!t) return;
  state.reportTab = 'routeAnalysis';
  state.date = t.date;
  state.mode = t.mode;
  state.points = t.points.map(p => ({ name: p.name, lat: p.lat, lon: p.lon }));
  state.times = Array.isArray(t.times) ? t.times.slice() : [];
  state.checkMode = t.checkMode === 'nav' ? 'nav' : 'point';
  $$('#segCheckMode button').forEach(b => b.classList.toggle('on', b.dataset.check === state.checkMode));
  applyCheckModeUI();
  $('#inpDate').value = t.date;
  $$('#segMode button').forEach(b => b.classList.toggle('on', b.dataset.mode === t.mode));
  renderPointList();
  showView('report');
  runCheckup();
}

/* ---------------- 诊断建议弹层 ---------------- */

function openDx(idx) {
  const r = state.currentReport;
  if (!r || !r.diagnosis) return;
  const it = r.diagnosis.items[idx];
  if (!it) return;
  state.dxIdx = idx;
  $('#dxTitle').textContent = it.title;
  const rows = [];
  if (it.evidence) rows.push('<div class="dx-l"><b>证据：</b>' + escapeHtml(it.evidence) + '</div>');
  if (it.actions && it.actions.length) {
    rows.push('<div class="dx-sec">具体措施</div><ol class="dx-acts">'
      + it.actions.map(a => '<li>' + escapeHtml(a) + '</li>').join('') + '</ol>');
  } else if (it.severity === 'ok') {
    rows.push('<div class="dx-l">这一点的安排与天气匹配，不需要调整。</div>');
  }
  $('#dxBody').innerHTML = rows.join('');
  const box = $('#dxApplies');
  const list = (it.applies && it.applies.length)
    ? it.applies
    : (it.apply ? [Object.assign({}, it.apply, { label: it.applyLabel || '应用这条建议' })] : []);
  box.innerHTML = list.map((a, k) =>
    '<button class="btn btn-primary dx-apply" data-k="' + k + '">' + escapeHtml(a.label || '应用') + '</button>'
  ).join('');
  box.style.display = list.length ? 'flex' : 'none';
  $$('#dxApplies .dx-apply').forEach(b => {
    b.addEventListener('click', () => applyDx(Number(b.dataset.k)));
  });
  $('#dxSheet').classList.remove('hidden');
}

function closeDx() {
  $('#dxSheet').classList.add('hidden');
}

function applyDx(k) {
  const r = state.currentReport;
  const it = r && r.diagnosis ? r.diagnosis.items[state.dxIdx] : null;
  if (!it) return;
  const list = (it.applies && it.applies.length) ? it.applies : (it.apply ? [it.apply] : []);
  const a = list[k || 0];
  if (!a) return;
  ensureTimes();
  if (a.type === 'setTime') {
    setPointTime(a.index, a.minute);
  } else if (a.type === 'shiftAll') {
    state.times = state.times.map(t => Math.max(0, t + a.delta));
  } else if (a.type === 'navDepart') {
    state.departHour = a.hour;
    const sel = $('#selDepart');
    if (sel) sel.value = String(a.hour);
  }
  closeDx();
  toast('已按建议调整时间，正在重新诊断…');
  runCheckup();
}

(function initDxSheet() {
  const close = $('#dxClose');
  if (close) close.addEventListener('click', closeDx);
  const sheet = $('#dxSheet');
  if (sheet) sheet.addEventListener('click', (e) => { if (e.target === sheet) closeDx(); });

})();

/* ============================================================
 * 分享 / 导出
 * ------------------------------------------------------------
 * 链接只携带行程本身（点位、日期、方式、时刻），天气与路径在打开时重新获取，
 * 这样对方看到的一定是他打开那一刻的最新预报。
 * ============================================================ */

function b64urlEncode(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s) {
  let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  return decodeURIComponent(escape(atob(t)));
}

function buildShareUrl() {
  const payload = {
    v: 1,
    d: state.date,
    m: state.mode,
    c: state.checkMode,
    h: state.departHour,
    p: state.points.map((p, i) => [
      p.name, Number(Number(p.lat).toFixed(5)), Number(Number(p.lon).toFixed(5)),
      state.times[i] == null ? null : state.times[i],
    ]),
  };
  const u = new URL(location.href);
  u.hash = '';
  u.search = '?t=' + b64urlEncode(JSON.stringify(payload));
  return u.toString();
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* 继续走兜底 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) { return false; }
}

function reportSummaryText(r) {
  const lines = [
    `【路线天气体检】${state.points.map(p => p.name).join(' → ')}`,
    `${r.date} · ${modeText(r.travelMode || state.mode)}${r.mode === 'nav' ? ' · 导航天气' : ' · ' + levelOf(r.routeScore).text + '（' + r.routeScore + ' 分）'}`,
  ];
  if (r.route && r.route.distanceKm) {
    lines.push(`路网距离约 ${Math.round(r.route.distanceKm)} km，预计 ${fmtDuration(r.route.durationMin)}`);
  }
  if (r.mode === 'nav') {
    const texts = [...new Set((r.points || []).map(p => p.weatherText).filter(Boolean))].slice(0, 4);
    const maxPP = Math.max(...(r.points || []).map(p => p.pp == null ? 0 : p.pp));
    lines.push(`沿途天气：${texts.join('、') || '—'}；最高降水概率 ${Math.round(maxPP)}%`);
    if (r.route && r.route.approx) {
      const network = r.travelMode === 'hike' ? '徒步专用路网' : '骑行专用路网';
      lines.push(`${network}规划路线，时长按 ${r.route.speedKmh} km/h 估算`);
    }
    buildNavWeatherNotes(r).slice(0, 3).forEach(a => lines.push('· ' + a));
  } else {
    const worst = r.points && r.points[r.worstIndex];
    if (worst) lines.push(`最差时段：${worst.name} · ${worst.score} 分 · ${worst.weatherText || ''}`);
    (r.advice || []).slice(0, 3).forEach(a => lines.push('· ' + a));
  }
  lines.push('', buildShareUrl());
  return lines.join('\n');
}

/** 报告页底部的分享/导出按钮 */
function bindShareBar(r) {
  const share = $('#btnShare');
  const copy = $('#btnCopy');
  const print = $('#btnPrint');
  if (share) {
    share.addEventListener('click', async () => {
      const ok = await copyText(buildShareUrl());
      toast(ok ? '分享链接已复制，对方打开会重新取一次预报' : '复制失败，请手动复制地址栏的链接');
    });
  }
  if (copy) {
    copy.addEventListener('click', async () => {
      const ok = await copyText(reportSummaryText(r));
      toast(ok ? '报告摘要已复制' : '复制失败');
    });
  }
  if (print) print.addEventListener('click', () => window.print());
}

function shareBarHtml() {
  return `<div class="share-bar">
    <button class="btn btn-ghost" id="btnShare" type="button">🔗 复制分享链接</button>
    <button class="btn btn-ghost" id="btnCopy" type="button">📋 复制摘要</button>
    <button class="btn btn-ghost" id="btnPrint" type="button">🖨 打印 / 存 PDF</button>
  </div>`;
}

/** 从 ?t= 恢复一条分享的行程；返回是否成功 */
function restoreTrip(p) {
  if (!p || !Array.isArray(p.p) || p.p.length < 2) return false;
  const pts = p.p
    .filter(x => Array.isArray(x) && isFinite(Number(x[1])) && isFinite(Number(x[2])))
    .map(x => ({ name: String(x[0] || '点位'), lat: Number(x[1]), lon: Number(x[2]) }));
  if (pts.length < 2) return false;
  state.points = pts;
  state.times = p.p.map((x, i) => {
    const v = Array.isArray(x) ? x[3] : null;
    return v == null || !isFinite(Number(v)) ? null : Number(v);
  });
  if (p.d) state.date = String(p.d);
  if (['drive', 'hike', 'bike'].includes(p.m)) state.mode = p.m;
  if (p.c === 'nav') state.checkMode = 'nav';
  if (typeof p.h === 'number' && p.h >= -1 && p.h < 24) state.departHour = p.h;
  return true;
}

/* ---------------- 工具 ---------------- */

function pad(n) { return String(n).padStart(2, '0'); }

/** 'YYYY-MM-DD' → '周五' */
function weekOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return '';
  return '周' + ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
}

/** 分钟 → "3 小时 20 分" / "2 天 5 小时" */
function fmtDuration(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} 分钟`;
  if (m < 24 * 60) return `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
  const d = Math.floor(m / (24 * 60));
  const h = Math.floor((m % (24 * 60)) / 60);
  return `${d} 天 ${h} 小时`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 离线提示条：只在断网时出现，恢复联网后移除 */
function showNetBar(on) {
  const old = document.getElementById('netbar');
  if (!on) {
    if (old) old.remove();
    return;
  }
  if (old) return;
  const el = document.createElement('div');
  el.id = 'netbar';
  el.className = 'netbar';
  el.textContent = '当前离线：页面仍可使用，天气与路径为缓存数据（可能已过期）';
  document.body.appendChild(el);
}

/* ---------------- 启动 ---------------- */

document.addEventListener('DOMContentLoaded', () => {
  // PWA：外壳离线可开；天气/路径请求失败时回落到 localStorage 的过期缓存
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('[sw] 注册失败：', e));
  }
  window.addEventListener('offline', () => showNetBar(true));
  window.addEventListener('online', () => showNetBar(false));
  if (!navigator.onLine) showNetBar(true);

  // 底图被自动切换时给个提示（手动切换自己会 toast）
  window.__onMapLayerChange = (name) => {
    if (name) toast('底图已自动切换为「' + name + '」');
  };

  bindProductNavigation();
  initCreate();
  // Smooth horizontal wheel scrolling with inertial interpolation.
  const horizontalScrollState = new WeakMap();
  const animateHorizontalScroll = (scroller) => {
    const state = horizontalScrollState.get(scroller);
    if (!state) return;
    const diff = state.target - scroller.scrollLeft;
    if (Math.abs(diff) < 0.6) {
      scroller.scrollLeft = state.target;
      horizontalScrollState.delete(scroller);
      return;
    }
    scroller.scrollLeft += diff * 0.22;
    state.raf = requestAnimationFrame(() => animateHorizontalScroll(scroller));
  };
  document.addEventListener('wheel', (event) => {
    const scroller = event.target.closest('.hourly-strip, .ht-scroll, .rec-strip, .leg-list');
    if (!scroller) return;
    const max = scroller.scrollWidth - scroller.clientWidth;
    if (max <= 1) return;
    const raw = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (!raw) return;
    const unit = event.deltaMode === 1 ? 16 : (event.deltaMode === 2 ? scroller.clientWidth : 1);
    const delta = raw * unit;
    const state = horizontalScrollState.get(scroller);
    const baseTarget = state ? state.target : scroller.scrollLeft;
    if ((delta > 0 && baseTarget >= max - 0.5) || (delta < 0 && baseTarget <= 0.5)) return;
    event.preventDefault();
    const target = Math.max(0, Math.min(max, baseTarget + delta * 1.15));
    if (state) {
      state.target = target;
      return;
    }
    horizontalScrollState.set(scroller, { target, raf: 0 });
    animateHorizontalScroll(scroller);
  }, { passive: false });

  $('#btnNew').addEventListener('click', () => {
    state.points = [];
    state.reportTab = 'routeAnalysis';
    renderPointList();
    showView('create');
  });
  $('#sheetClose').addEventListener('click', closeSheet);
  $('#sheetSearch').addEventListener('input', () => {
    renderSheetList();
    scheduleRemoteSearch();
  });
  $('#sheet').addEventListener('click', e => {
    if (e.target.id === 'sheet') closeSheet();
  });
  renderHome();
  showView('home');

  // ---------------- 直链参数 ----------------
  const params = new URLSearchParams(location.search);

  // ?t=<base64> 分享链接：恢复整条行程并直接体检（优先于其它参数）
  const shared = params.get('t');
  if (shared) {
    try {
      if (restoreTrip(JSON.parse(b64urlDecode(shared)))) {
        const inp = $('#inpDate');
        if (inp) inp.value = state.date;
        const sel = $('#selDepart');
        if (sel) sel.value = String(state.departHour);
        $$('#segMode button').forEach(b => b.classList.toggle('on', b.dataset.mode === state.mode));
        $$('#segCheckMode button').forEach(b => b.classList.toggle('on', b.dataset.check === state.checkMode));
        applyCheckModeUI();
        renderPointList();
        showView('create');
        setTimeout(() => {
          toast('已按分享链接恢复行程，正在重新取预报…', 2400);
          runCheckup();
        }, 350);
        return;
      }
    } catch (e) {
      console.warn('[share] 分享链接解析失败：', e);
      toast('分享链接已损坏，请让对方重新复制');
    }
  }

  // 常见城市坐标兜底（内置点位库只有川西，直链里常用到这些）
  const EXTRA_CITIES = {
    '深圳': [22.5431, 114.0579], '广州': [23.1291, 113.2644], '成都': [30.5728, 104.0668],
    '重庆': [29.5630, 106.5516], '北京': [39.9042, 116.4074], '上海': [31.2304, 121.4737],
    '西安': [34.3416, 108.9398], '昆明': [25.0389, 102.7183], '武汉': [30.5928, 114.3055],
    '杭州': [30.2741, 120.1551], '兰州': [36.0611, 103.8343], '西宁': [36.6171, 101.7782],
    '拉萨': [29.6520, 91.1721], '贵阳': [26.6470, 106.6302], '长沙': [28.2282, 112.9388],
  };

  function resolveName(name) {
    const p = findPointByName(name);
    if (p) return { name: p.name, lat: p.lat, lon: p.lon };
    const c = EXTRA_CITIES[name];
    if (c) return { name, lat: c[0], lon: c[1] };
    return null;
  }

  /** 解析 ?pts= 列表；库里找不到的先跳过（下面会尝试在线搜） */
  function loadNames(str) {
    return (str || '').split(/[,，、]/).map(s => s.trim()).filter(Boolean)
      .map(resolveName).filter(Boolean);
  }

  // ?pts=雅安,天全,泸定 指定点名
  const fromPts = loadNames(params.get('pts'));
  if (fromPts.length >= 2) state.points = fromPts;

  // ?nav=1 进入导航模式；?depart=6 指定出发时刻
  if (params.get('nav') === '1') {
    state.checkMode = 'nav';
    $$('#segCheckMode button').forEach(b => b.classList.toggle('on', b.dataset.check === 'nav'));
    applyCheckModeUI();
  }
  if (params.get('depart') !== null && params.get('depart') !== '') {
    const h = Number(params.get('depart'));
    if (h >= -1 && h < 24) {
      state.departHour = h;
      $('#selDepart').value = String(h);
    }
  }

  const setDate = () => {
    const d = params.get('date') || addDays(todayStr(), 1);
    state.date = d;
    $('#inpDate').value = d;
  };

  // ?mode=hike|bike|drive 指定出行方式（便于演示与测试）
  const mq = params.get('mode');
  if (mq && ['drive', 'hike', 'bike'].includes(mq)) {
    state.mode = mq;
    $$('#segMode button').forEach(b => b.classList.toggle('on', b.dataset.mode === mq));
  }

  // ?view=create 直接进新建页
  if (params.get('view') === 'create') {
    if (!state.points.length) state.points = loadNames(DEMO_ROUTE.join(','));
    setDate();
    renderPointList();
    showView('create');
  }

  // ?demo=1 预置示例路线；链接入口仍停留在探索首页
  if (params.get('demo') === '1') {
    if (!state.points.length) state.points = loadNames(DEMO_ROUTE.join(','));
    setDate();
    renderPointList();
  }

  // ?sheet=1 直接打开点位选择弹层（便于演示与截图核对层叠顺序）
  // 可选 &q=稻城亚丁 预填搜索词，直接触发全国地名搜索
  if (params.get('sheet') === '1') {
    if (!state.points.length) state.points = loadNames(DEMO_ROUTE.join(','));
    setDate();
    renderPointList();
    showView('create');
    setTimeout(() => {
      openSheet();
      const q = params.get('q');
      if (q) {
        $('#sheetSearch').value = q;
        renderSheetList();
        scheduleRemoteSearch();
      }
    }, 250);
  }

  // 诊断模式：?demo=1&diag=1 —— 报告渲染完成后，把溢出元素显示在顶部横幅
  if (params.get('diag') === '1') {
    window.__diag = true;
  }
});

/** 报告渲染后调用：找出超出视口的元素 */
function runDiag() {
  if (!window.__diag) return;
  const old = document.getElementById('diagBox');
  if (old) old.remove();

  const vw = window.innerWidth;
  const wide = Array.from(document.querySelectorAll('body *'))
    .map(n => ({ n, r: n.getBoundingClientRect() }))
    .filter(o => o.r.right > vw + 0.5 && o.r.width > 0)
    .sort((a, b) => b.r.right - a.r.right)
    .slice(0, 8)
    .map(o => `${o.n.tagName}.${(o.n.className || '').toString().trim().split(' ')[0]} r=${Math.round(o.r.right)} w=${Math.round(o.r.width)}`);

  const box = document.createElement('div');
  box.id = 'diagBox';
  box.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#000;color:#0f0;'
    + 'font:16px/1.35 monospace;padding:6px;white-space:pre-wrap;max-height:45vh;overflow:auto';
  box.textContent = `vw=${vw} docSW=${document.documentElement.scrollWidth} bodySW=${document.body.scrollWidth} mainW=${Math.round(document.querySelector('main').getBoundingClientRect().width)}\n`
    + (wide.length ? wide.join('\n') : '(无溢出元素)');
  document.body.appendChild(box);
}
