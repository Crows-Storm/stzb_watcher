function shouldEmitRiskEvent({
  risk,
  selectedWid,
  wid,
  eventKey,
  lastEventKey,
} = {}) {
  return (
    risk?.level === 'high'
    && Number(selectedWid) === Number(wid)
    && Boolean(eventKey)
    && eventKey !== lastEventKey
  );
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {shouldEmitRiskEvent};
}

(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const DEFAULT_BOUNDS = {rowUp: 1, rowDown: 20, colLeft: 1, colRight: 20};
  const FAVORITES_KEY = 'stzb.intelligence.favorites';
  const MODE_LABELS = {far: '全域热区', middle: '战区轮廓', near: '战术镜头'};
  const state = {
    bounds: {...DEFAULT_BOUNDS},
    summary: null,
    activeView: 'map',
    mode: 'near',
    tiles: [],
    buckets: [],
    radarBuckets: [],
    risks: new Map(),
    selectedWid: 0,
    stageDetailOpen: false,
    detail: null,
    events: [],
    render: null,
    radarRender: null,
    drag: null,
    suppressMapClick: false,
    radarDrag: null,
    reloadTimer: null,
    streamReloadTimer: null,
    streamDirty: false,
    frame: null,
    aggregateBusyOwner: 0,
    detailLoading: false,
    navigationRevision: 0,
    navigationController: null,
    history: null,
    lastEmittedRiskKey: '',
    initialized: false,
    layerRevision: 0,
    sceneRows: {march: null, army: null, entity: null},
    sceneCompatibility: {march: null, army: null, entity: null},
    favorites: new Set(readFavorites()),
    layers: {ownership: true, freshness: true, paths: true, armies: true},
    viewer: null,
    liveArmies: []
  };
  let aggregateLoader = null;
  let detailOwner = null;

  function getDetailOwner() {
    detailOwner ||= window.IntelligenceLoader
      ?.createIntelligenceDetailOwner?.();
    return detailOwner;
  }

  async function loadIntelligenceCenter(force) {
    if (!modulesReady()) {
      showState('地图模块加载中…');
      setTimeout(() => loadIntelligenceCenter(force), 80);
      return null;
    }
    aggregateLoader ||= createAggregateLoader();
    return aggregateLoader.load({force: Boolean(force)});
  }

  function createAggregateLoader() {
    return window.IntelligenceLoader.createIntelligenceLoaderCoordinator({
      captureContext: aggregateContext,
      isContextCurrent: isAggregateContextCurrent,
      hasContent: hasAggregateContent,
      perform: performAggregateLoad,
      commit: commitAggregateLoad,
      renderState: renderAggregateState,
      AbortControllerClass: AbortController,
    });
  }

  function aggregateContext() {
    return {
      activeView: state.activeView,
      bounds: {...state.bounds},
      selectedWid: Number(state.selectedWid) || 0,
      initialized: state.initialized,
    };
  }

  function isAggregateContextCurrent(snapshot) {
    return window.IntelligenceLoader.isIntelligenceContextCurrent(
      snapshot,
      aggregateContext(),
    );
  }

  function hasAggregateContent() {
    if (state.activeView === 'map') {
      return Boolean(
        state.summary
        && (state.tiles.length || state.buckets.length || state.radarBuckets.length)
      );
    }
    return Array.isArray(state.sceneRows[state.activeView]);
  }

  async function performAggregateLoad({context, signal, abort}) {
    const summary = await fetchJson(
      '/api/intelligence/world/summary',
      signal,
    );
    if (!summary?.ok) throw new Error(summary?.error || '世界状态尚未初始化');
    assertAggregateVersions(summary, []);
    if (!summary.dataBounds) {
      return {
        status: 'empty',
        message: '等待 5026 基线或已知地块数据',
        activeView: context.activeView,
        summary,
        events: [],
        navigation: null,
      };
    }
    const navigation = navigationForSummary(summary, context);
    const eventsPromise = fetchJson(
      '/api/intelligence/world/events?limit=8',
      signal,
    ).then(response => requireResponse(response, '世界事件加载失败'));
    if (context.activeView !== 'map') {
      const endpoint = {
        march: '/api/world/marches',
        army: '/api/world/armies',
        entity: '/api/world/entities',
      }[context.activeView];
      const [scene, events] = await Promise.all([
        fetchJson(endpoint, signal)
          .then(response => requireResponse(response, '场景情报加载失败')),
        eventsPromise,
      ]);
      assertAggregateVersions(summary, [
        {name: 'events', response: events},
      ]);
      const rows = context.activeView === 'march'
        ? (scene?.marches || [])
        : context.activeView === 'army'
          ? (scene?.armies || [])
          : (scene?.entities || []);
      const sceneCompatibility = window.IntelligenceLoader
        .createUnversionedSceneCompatibility(context.activeView, rows);
      return {
        status: summary.freshness === 'stale'
          ? 'stale'
          : rows.length ? 'success' : 'empty',
        message: summary.freshness === 'stale'
          ? '后端 WorldState 真值已陈旧，当前结果仅供核对'
          : rows.length ? '' : sceneEmptyMessage(context.activeView),
        activeView: context.activeView,
        summary,
        navigation,
        sceneCompatibility,
        events: events?.events || [],
      };
    }
    return performMapAggregate({
      context,
      navigation,
      summary,
      eventsPromise,
      signal,
      abort,
    });
  }

  function navigationForSummary(summary, context) {
    if (context.initialized) {
      return {
        bounds: {...context.bounds},
        selectedWid: Number(context.selectedWid) || 0,
        initialize: false,
      };
    }
    const fallback = mapState(
      summary.dataBounds,
      summary.focusWid,
      state.layers,
    );
    const restored = window.IntelligenceMapNavigation.parseMapState(
      location.hash,
      fallback
    );
    const initial = window.IntelligenceMapNavigation.isBoundsUseful(
      restored.bounds,
      summary.dataBounds
    ) ? restored : fallback;
    return {
      bounds: {...initial.bounds},
      selectedWid: Number(initial.selectedWid) || 0,
      layers: {...state.layers, ...initial.layers},
      layerRevision: state.layerRevision,
      initialize: true,
    };
  }

  async function performMapAggregate({
    navigation,
    summary,
    eventsPromise,
    signal,
    abort,
  }) {
    const mode = chooseMode(navigation.bounds);
    const mainPromise = mode === 'near'
      ? loadNearViewport(navigation.bounds, signal)
      : loadOverviewBuckets(navigation.bounds, signal);
    const radarPromise = loadRadarBuckets(summary.dataBounds, signal);
    const livePromise = fetchJson(
      '/api/intelligence/live-armies?offlineMinutes=10',
      signal,
    ).then(response => response?.ok ? response : null).catch(() => null);
    const aggregateDetailOwner = navigation.selectedWid
      ? beginDetailRequest('aggregate', abort)
      : null;
    const detailPromise = navigation.selectedWid
      ? fetchJson(
        `/api/intelligence/world/tile/${navigation.selectedWid}`,
        signal,
      ).then(response => requireResponse(response, '地块详情加载失败'))
      : Promise.resolve(null);
    try {
      const [main, radar, events, detail, live] = await Promise.all([
        mainPromise,
        radarPromise,
        eventsPromise,
        detailPromise,
        livePromise,
      ]);
      assertAggregateVersions(summary, [
        ...(main.versionedResponses || []),
        {name: 'radar', response: radar.response},
        {name: 'events', response: events},
        ...(detail ? [{name: 'detail', response: detail}] : []),
      ]);
      return {
        status: summary.freshness === 'stale' ? 'stale' : 'success',
        message: summary.freshness === 'stale'
          ? '后端 WorldState 真值已陈旧，地图保留最后观测证据'
          : '',
        activeView: 'map',
        summary,
        navigation,
        mode,
        ...main,
        radarBuckets: radar.buckets,
        events: events?.events || [],
        detail,
        viewer: live?.viewer || null,
        liveArmies: [
          ...(live?.current || []),
          ...(live?.recentOffline || []),
        ],
      };
    } finally {
      finishDetailRequest(aggregateDetailOwner);
    }
  }

  function chooseMode(bounds = state.bounds) {
    const canvas = document.getElementById('intel-map-canvas');
    return window.IntelligenceMapOverview.semanticMapMode(
      bounds,
      canvas?.clientWidth || 800,
      canvas?.clientHeight || 560
    );
  }

  async function loadNearViewport(bounds, signal) {
    const query = boundsQuery(bounds);
    const [viewport, risks] = await Promise.all([
      fetchJson(`/api/intelligence/world/viewport?${query}`, signal)
        .then(response => requireResponse(response, '视窗加载失败')),
      fetchJson(`/api/intelligence/world/risks?${query}`, signal)
        .then(response => requireResponse(response, '风险加载失败'))
    ]);
    const riskMap = new Map(
      (risks.risks || []).map(item => [Number(item.wid), item]),
    );
    const tiles = (viewport.tiles || []).map(tile => {
      const risk = riskMap.get(Number(tile.wid));
      return {
        ...tile,
        relation: risk?.ownership?.relation || 'unknown',
        armies: ['enemy', 'ally', 'self', 'unknown'].reduce(
          (total, key) => total + Number(risk?.incomingArmyRelations?.[key] || 0),
          0,
        )
      };
    });
    return {
      tiles,
      buckets: [],
      risks: riskMap,
      versionedResponses: [
        {name: 'viewport', response: viewport},
        {name: 'risks', response: risks},
      ],
    };
  }

  async function loadOverviewBuckets(bounds, signal) {
    const canvas = document.getElementById('intel-map-canvas');
    const grid = window.IntelligenceMapOverview.bucketGridForBounds(
      bounds,
      canvas?.clientWidth || 800,
      canvas?.clientHeight || 560
    );
    const query = `${boundsQuery(bounds)}&bucketRows=${grid.bucketRows}&bucketCols=${grid.bucketCols}`;
    const overview = requireResponse(
      await fetchJson(`/api/intelligence/world/overview?${query}`, signal),
      '热区加载失败',
    );
    return {
      buckets: overview.buckets || [],
      tiles: [],
      risks: new Map(),
      versionedResponses: [
        {name: 'overview', response: overview},
      ],
    };
  }

  async function loadRadarBuckets(bounds, signal) {
    const grid = window.IntelligenceMapOverview.bucketGridForBounds(
      bounds,
      190,
      126,
      600
    );
    const query = `${boundsQuery(bounds)}&bucketRows=${grid.bucketRows}&bucketCols=${grid.bucketCols}`;
    const overview = requireResponse(
      await fetchJson(`/api/intelligence/world/overview?${query}`, signal),
      '全域雷达加载失败',
    );
    return {
      buckets: overview.buckets || [],
      response: overview,
    };
  }

  function assertAggregateVersions(summary, members) {
    return window.IntelligenceLoader.assertIntelligenceAggregateVersions(
      summary,
      members,
    );
  }

  function requireResponse(response, fallbackMessage) {
    return window.IntelligenceLoader.requireIntelligenceResponse(
      response,
      fallbackMessage,
    );
  }

  function commitAggregateLoad(result) {
    state.summary = result.summary;
    state.events = result.events || [];
    if (result.navigation) {
      state.bounds = {...result.navigation.bounds};
      state.selectedWid = Number(result.navigation.selectedWid) || 0;
      if (
        result.navigation.initialize
        && result.navigation.layerRevision === state.layerRevision
      ) {
        state.layers = {...result.navigation.layers};
      }
      if (result.navigation.initialize) {
        state.history = window.IntelligenceMapNavigation
          .createViewportHistory(currentMapState(), 30);
        state.initialized = true;
      }
    }
    if (!result.summary?.dataBounds) {
      state.tiles = [];
      state.buckets = [];
      state.radarBuckets = [];
      state.risks = new Map();
      state.selectedWid = 0;
      state.detail = null;
      renderEmpty();
      renderTimeline();
      updateMeta();
      renderDetail('risk');
      resetDetailHeading();
      renderDetailLoadState('empty', '选择地块查看情报', true);
      return;
    }
    if (result.activeView !== 'map') {
      state.sceneCompatibility[result.activeView] = result.sceneCompatibility;
      state.sceneRows[result.activeView] = result.sceneCompatibility?.rows || [];
      renderSceneRows(
        result.activeView,
        result.sceneCompatibility?.rows || [],
      );
      renderTimeline();
      updateMeta();
      return;
    }
    state.mode = result.mode;
    state.tiles = result.tiles || [];
    state.buckets = result.buckets || [];
    state.radarBuckets = result.radarBuckets || [];
    state.risks = result.risks || new Map();
    state.viewer = result.viewer || null;
    state.liveArmies = result.liveArmies || [];
    state.detail = result.detail?.ok ? result.detail : null;
    updateMapHelp();
    renderMainMap();
    renderRadar();
    renderTimeline();
    updateMeta();
    updateNavigationControls();
    renderDetail(state.detail ? 'risk' : 'risk');
    renderDetailLoadState(state.detail ? 'success' : 'empty');
    persistCurrentState();
  }

  function renderAggregateState(model) {
    const ownerToken = Number(model.ownerToken) || 0;
    if (model.busy) {
      state.aggregateBusyOwner = ownerToken;
    } else if (
      state.aggregateBusyOwner
      && state.aggregateBusyOwner !== ownerToken
    ) {
      return null;
    } else {
      state.aggregateBusyOwner = 0;
    }
    const view = state.activeView;
    const panel = document.getElementById(`intel-view-${view}`);
    const host = document.getElementById(
      view === 'map'
        ? 'intel-loader-state'
        : `intel-scene-${view}-status`,
    );
    if (model.busy) panel?.setAttribute('aria-busy', 'true');
    else panel?.removeAttribute('aria-busy');
    if (view === 'map' && model.kind === 'error') {
      showState(`情报加载失败：${model.message}`, true);
    }
    return window.HudSystem?.renderState(host, model);
  }

  function renderSceneRows(view, rows) {
    if (view === 'march') window.WorldScenePanel?.renderMarches(rows);
    else if (view === 'army') window.WorldScenePanel?.renderArmies(rows);
    else window.WorldScenePanel?.renderEntities(rows);
  }

  function loadSceneCompatibility(view, force = false) {
    const normalized = ['map', 'march', 'army', 'entity'].includes(view)
      ? view
      : 'march';
    if (state.activeView !== normalized) return openView(normalized);
    return loadIntelligenceCenter(force);
  }

  function sceneEmptyMessage(view) {
    return ({
      march: '暂无实时行军，可刷新等待新的 WorldState 增量',
      army: '暂无活跃部队，可刷新等待新的 WorldState 增量',
      entity: '暂无协议实体，可刷新等待新的 WorldState 增量',
    })[view] || '暂无情报数据';
  }

  function renderMainMap() {
    const canvas = document.getElementById('intel-map-canvas');
    if (!canvas) return;
    if (state.mode === 'near') {
      const selected = state.selectedWid;
      const tiles = state.tiles.map(tile => ({
        ...tile,
        relation: window.IntelligenceMap.relationFor?.(
          tile.user_id,
          tile.union_id,
          state.viewer,
        ) || tile.relation || 'unknown',
        selected: Number(tile.wid) === selected,
        favorite: state.favorites.has(Number(tile.wid)),
        risk: state.risks.get(Number(tile.wid))
      }));
      state.render = window.IntelligenceMap.drawIntelligenceMap(
        canvas,
        tiles,
        {
          bounds: state.bounds,
          layers: state.layers,
          viewer: state.viewer,
          routes: state.mode === 'near'
            ? window.IntelligenceMap.routesFromArmies?.(
              state.liveArmies,
              state.viewer,
            ) || []
            : []
        }
      );
    } else {
      state.render = window.IntelligenceMapOverview.drawOverviewMap(
        canvas,
        state.buckets,
        {bounds: state.bounds, mode: state.mode}
      );
    }
    updateSelectedRiskLock();
    showState(`视窗 ${formatBounds(state.bounds)} · ${MODE_LABELS[state.mode]}`);
  }

  function renderRadar() {
    const canvas = document.getElementById('intel-radar-canvas');
    if (!canvas) return;
    if (!state.summary?.dataBounds) {
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      state.radarRender = null;
      return;
    }
    state.radarRender = window.IntelligenceMapOverview.drawRadar(
      canvas,
      state.radarBuckets,
      {
        dataBounds: state.summary.dataBounds,
        viewBounds: state.bounds,
        selectedWid: state.selectedWid
      }
    );
  }

  async function openView(view) {
    const normalized = ['map', 'march', 'army', 'entity'].includes(view)
      ? view
      : 'map';
    aggregateLoader?.invalidate();
    if (normalized !== 'map') {
      invalidateDetailRequest();
      setMapStage(false);
    }
    state.activeView = normalized;
    document.querySelectorAll('[data-intel-view]').forEach(button => {
      const active = button.dataset.intelView === normalized;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.intel-primary-view').forEach(panel => {
      const active = panel.id === `intel-view-${normalized}`;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });
    return loadIntelligenceCenter();
  }

  function renderEmpty() {
    state.tiles = [];
    state.buckets = [];
    renderMainMap();
    renderRadar();
  }

  let battleRefreshToken = 0;

  async function refreshBattleStats() {
    const wid = Number(state.selectedWid);
    const token = ++battleRefreshToken;
    renderDetail('battles');
    if (!wid) return;
    try {
      const data = await fetchJson(`/api/intelligence/world/tile/${wid}`);
      if (token !== battleRefreshToken || Number(state.selectedWid) !== wid) return;
      if (!data?.ok) return;
      state.detail = data;
      renderDetail('battles');
      renderDetailLoadState('success');
    } catch (error) {
      if (token !== battleRefreshToken) return;
      renderDetailLoadState('error', error?.message || '战报加载失败', false);
    }
  }

  async function selectWid(wid, rerender = true) {
    const requestedWid = Number(wid) || 0;
    aggregateLoader?.invalidate();
    const changed = requestedWid !== Number(state.selectedWid);
    if (changed) clearDetail();
    const controller = new AbortController();
    const owner = beginDetailRequest(
      'standalone',
      () => controller.abort(),
    );
    state.selectedWid = requestedWid;
    state.stageDetailOpen = requestedWid > 0;
    syncStageDetail();
    if (rerender) {
      renderMainMap();
      renderRadar();
    }
    const hadDetail = Boolean(state.detail);
    state.detailLoading = true;
    renderDetailLoadState(hadDetail ? 'refreshing' : 'loading');
    try {
      const data = await fetchJson(
        `/api/intelligence/world/tile/${requestedWid}`,
        controller.signal,
      );
      if (
        !getDetailOwner()?.isCurrent(owner)
        || Number(requestedWid) !== Number(state.selectedWid)
      ) return null;
      state.detail = data?.ok ? data : null;
      renderDetail('risk');
      updateSelectedRiskLock();
      renderDetailLoadState(state.detail ? 'success' : 'empty');
      return state.detail;
    } catch (error) {
      if (error?.name === 'AbortError') return null;
      if (
        !getDetailOwner()?.isCurrent(owner)
        || Number(requestedWid) !== Number(state.selectedWid)
      ) return null;
      renderDetailLoadState(
        'error',
        error?.message || '地块详情加载失败',
        !hadDetail,
      );
      return null;
    } finally {
      if (finishDetailRequest(owner)) {
        state.detailLoading = false;
      }
    }
  }

  function invalidateDetailRequest({clear = false} = {}) {
    const invalidated = getDetailOwner()?.invalidate();
    state.detailLoading = false;
    document.getElementById('intel-detail-panel')?.removeAttribute('aria-busy');
    if (clear) clearDetail();
    return invalidated?.token || 0;
  }

  function beginDetailRequest(source, abort) {
    const owner = getDetailOwner()?.begin({source, abort});
    state.detailLoading = true;
    document.getElementById('intel-detail-panel')?.setAttribute('aria-busy', 'true');
    return owner;
  }

  function finishDetailRequest(owner) {
    if (!getDetailOwner()?.finish(owner)) return false;
    state.detailLoading = false;
    document.getElementById('intel-detail-panel')?.removeAttribute('aria-busy');
    return true;
  }

  function clearDetail() {
    state.detail = null;
    renderDetail('risk');
    resetDetailHeading();
    renderDetailLoadState('empty', '选择地块查看情报', true);
  }

  function renderDetailLoadState(kind, message, replace) {
    const panel = document.getElementById('intel-detail-panel');
    const host = document.getElementById('intel-detail-status');
    if (['loading', 'refreshing'].includes(kind)) {
      panel?.setAttribute('aria-busy', 'true');
    } else {
      panel?.removeAttribute('aria-busy');
    }
    return window.HudSystem?.renderState(host, {
      kind,
      message,
      replace,
      actionLabel: kind === 'error' ? '重试' : '',
      action: kind === 'error'
        ? () => selectWid(state.selectedWid, false)
        : undefined,
    });
  }

  function updateSelectedRiskLock() {
    const lock = document.getElementById('intel-risk-lock');
    const wid = Number(state.selectedWid) || 0;
    const risk = state.risks.get(wid) || (
      Number(state.detail?.tile?.wid) === wid ? state.detail?.risk : null
    );
    const hitArea = state.mode === 'near'
      ? state.render?.hitAreas?.find(item => Number(item.wid) === wid)
      : null;
    const riskKey = risk ? `risk:${wid}:${risk.level}` : '';
    const selectedHighRisk = shouldEmitRiskEvent({
      risk,
      selectedWid: state.selectedWid,
      wid,
      eventKey: riskKey,
      lastEventKey: '',
    });
    const activeRiskKey = selectedHighRisk ? riskKey : '';
    if (
      state.lastEmittedRiskKey
      && state.lastEmittedRiskKey !== activeRiskKey
    ) {
      window.HudSystem?.resolveEvent(state.lastEmittedRiskKey);
      state.lastEmittedRiskKey = '';
    }
    const locked = selectedHighRisk && Boolean(hitArea);
    lock?.classList.toggle('intel-risk-lock', locked);
    if (lock) {
      lock.hidden = !locked;
      if (locked) {
        lock.style.left = `${hitArea.x}px`;
        lock.style.top = `${hitArea.y}px`;
        lock.style.width = `${hitArea.size}px`;
        lock.style.height = `${hitArea.size}px`;
      }
    }
    if (!shouldEmitRiskEvent({
      risk,
      selectedWid: state.selectedWid,
      wid,
      eventKey: riskKey,
      lastEventKey: state.lastEmittedRiskKey,
    })) return;
    state.lastEmittedRiskKey = riskKey;
    window.HudSystem?.emit({
      type: 'intelligence:risk-detected',
      target: '#intel-detail-panel',
      domain: 'intelligence',
      severity: 'critical',
      message: `WID ${wid} 风险 ${risk.score}`,
      timestamp: Date.now(),
      dedupeKey: `risk:${wid}:${risk.level}`,
      cooldownMs: 10_000,
    });
  }

  function renderDetail(tab) {
    document.querySelectorAll('.intel-detail-tabs button').forEach(button => {
      button.classList.toggle('active', button.dataset.intelTab === tab);
    });
    const body = document.getElementById('intel-detail-body');
    if (!state.detail) {
      body.innerHTML = '<div class="intel-empty">选择热区或真实地块查看情报</div>';
      return;
    }
    const data = state.detail;
    const tile = data.tile;
    const risk = data.risk || {};
    const armies = data.incomingArmies || [];
    document.getElementById('intel-detail-title').textContent =
      `WID ${tile.wid} · ${tile.landLevel ? `土地 Lv.${tile.landLevel}` : (tile.name || '未知地块')}`;
    document.getElementById('intel-risk-pill').textContent =
      `风险 ${risk.score || 0} · ${risk.level || 'unknown'}`;
    if (tab === 'risk') {
      body.innerHTML = card(
        '风险解释',
        Object.entries(risk.components || {}).map(([key, value]) => row(key, value)).join('')
        + ownershipRows(risk.ownership, state.viewer)
        + row('置信度', `${Math.round((risk.confidence || 0) * 100)}%`)
        + row('未知分量', (risk.unknownComponents || []).join(', ') || '无')
      ) + card(
        '地块状态',
        row('名称', tile.name || '-')
        + row('等级', tile.landLevel ?? '未知')
        + row('资源种类', tile.resourceKind ?? '未知')
        + row('情报', tile.freshness)
        + `<button class="btn ${state.favorites.has(Number(tile.wid)) ? 'btn-primary' : ''}" type="button" data-intel-action="toggle-favorite">${state.favorites.has(Number(tile.wid)) ? '取消关注' : '关注地块'}</button>`
      );
    } else if (tab === 'armies') {
      body.innerHTML = armies.length
        ? armies.map(army => card(
          `部队 ${army.army_id}`,
          row('玩家', army.owner_name || army.user_id)
          + row('同盟', army.owner_union_name || '-')
          + row('目标 WID', army.wid_to)
          + row('到达', fmtTime(army.end_time))
        )).join('')
        : '<div class="intel-empty">暂无关联行军</div>';
    } else if (tab === 'battles') {
      renderBattleStats(body, data.battleStats || {});
    } else {
      body.innerHTML = card(
        '状态证据',
        row('WorldState', data.worldStateVersion)
        + row('完整性', data.completeness)
        + row('新鲜度', data.freshness)
        + row('最后基线', data.latestBaseline?.latest_baseline_order_id ?? '-')
        + row('最近增量', data.latestDelta?.version ?? '-')
      );
    }
  }

  function resetDetailHeading() {
    const title = document.getElementById('intel-detail-title');
    const pill = document.getElementById('intel-risk-pill');
    if (title) title.textContent = '未选择地块';
    if (pill) pill.textContent = '风险 --';
  }

  function battleResultLabel(result) {
    const value = Number(result);
    if (value === 1 || value === 7 || value === 11) return '攻胜';
    if (value === 2 || value === 6 || value === 12) return '守胜';
    return '平';
  }

  function renderBattleRow(item) {
    const battleId = Number(item.battle_id);
    const place = item.wid_name ? ` · ${item.wid_name}` : '';
    const time = fmtTime(item.time);
    
    // 格式化队伍显示：武将名(红度)
    function formatTeam(prefix) {
      const heroes = [];
      for (let i = 1; i <= 3; i++) {
        const heroId = item[`${prefix}_hero${i}_id`];
        const star = item[`${prefix}_hero${i}_star`] || 0;
        if (heroId) {
          const hero = (typeof HERO_CFG !== 'undefined') ? (HERO_CFG[heroId] || HERO_CFG[String(heroId)]) : null;
          const name = hero?.name || (typeof getHero === 'function' ? getHero(heroId)?.name : null) || `武将${heroId}`;
          heroes.push(`${name}(${star})`);
        }
      }
      return heroes.join('-') || '—';
    }
    
    const atkTeam = formatTeam('atk');
    const defTeam = formatTeam('def');
    
    return `<button class="intel-battle-row intel-battle-row-compact" type="button" data-intel-action="open-battle" data-battle-id="${battleId}">
      <div class="intel-battle-time">${esc(time)}</div>
      <div class="intel-battle-side">
        <div class="intel-battle-name">${esc(item.atk_name || '-')}</div>
        <div class="intel-battle-team">${esc(atkTeam)}</div>
      </div>
      <div class="intel-battle-vs">VS</div>
      <div class="intel-battle-side">
        <div class="intel-battle-name">${esc(item.def_name || '-')}</div>
        <div class="intel-battle-team">${esc(defTeam)}</div>
      </div>
    </button>`;
  }

  function renderBattleStats(body, stats) {
    const recent = stats.recentBattles || [];
    const neighbors = stats.neighborBattles || [];
    const lineups = stats.commonLineups || [];
    const selectedWid = Number(state.selectedWid || state.detail?.tile?.wid || 0);
    const neighborHtml = neighbors.map(group => (
      `<div class="intel-row"><span>相邻 WID ${esc(group.wid)}</span><b>${group.sampleSize || 0} 场</b></div>`
      + (group.recentBattles || []).map(renderBattleRow).join('')
      + `<button class="btn" type="button" data-intel-action="open-battles" data-wid="${Number(group.wid)}">查看 WID ${esc(group.wid)} 全部战报</button>`
    )).join('');
    body.innerHTML =
      '<div class="research-section-title"><div><span class="evidence-badge evidence-stat">BATTLE STAT</span><h3>地块历史战报</h3></div></div>'
      + card(
        '最近战报',
        recent.length
          ? recent.map(renderBattleRow).join('')
          : (neighborHtml || '<div class="intel-empty">这块地没有采集到战报</div>')
      )
      + card(
        '历史样本',
        row('总样本', stats.sampleSize || 0)
        + row('攻方胜率', `${stats.attackWinRate || 0}%`)
        + row('胜 / 平 / 负', `${stats.attackWins || 0} / ${stats.attackDraws || 0} / ${stats.attackLosses || 0}`)
      )
      + card(
        '常见攻方阵容',
        lineups.length
          ? lineups.map((item, index) => `<button class="intel-lineup-link" type="button" data-intel-action="open-lineup" data-lineup-index="${index}"><b>${esc((item.names || []).join(' / ') || item.key)}</b><small>${item.sampleSize} 场</small></button>`).join('')
          : '<div class="intel-empty">暂无完整三人阵容</div>'
      )
      + `<button class="btn" type="button" data-intel-action="open-battles" data-wid="${selectedWid}">筛选该 WID 全部战报</button>`;
  }

  function focusBucket(bucket) {
    if (!bucket) return;
    const wid = Number(bucket.focusWid || 0);
    const row = wid ? Math.floor(wid / 10000) : Math.round((bucket.rowUp + bucket.rowDown) / 2);
    const col = wid ? wid % 10000 : Math.round((bucket.colLeft + bucket.colRight) / 2);
    navigateTo(centeredBounds(row, col, 20), wid, true);
  }

  function moveFromRadar(point, commit = true) {
    if (!state.radarRender?.radarRect || !state.summary?.dataBounds) return;
    const world = window.IntelligenceMapOverview.radarToWorld(
      point.x,
      point.y,
      state.summary.dataBounds,
      state.radarRender.radarRect
    );
    const rows = state.bounds.rowDown - state.bounds.rowUp + 1;
    const cols = state.bounds.colRight - state.bounds.colLeft + 1;
    state.bounds = centeredBounds(world.row, world.col, Math.max(rows, cols));
    renderMainMap();
    renderRadar();
    if (commit) commitNavigation(true);
  }

  function navigateTo(bounds, selectedWid = state.selectedWid, push = true) {
    const nextSelectedWid = Number(selectedWid || 0);
    if (nextSelectedWid !== Number(state.selectedWid)) {
      invalidateDetailRequest({clear: true});
    }
    aggregateLoader?.invalidate();
    state.bounds = {...bounds};
    state.selectedWid = nextSelectedWid;
    if (push) commitNavigation(false);
    animateOrLoad();
  }

  function commitNavigation(load = true) {
    const next = currentMapState();
    state.history?.push(next);
    persistCurrentState();
    updateNavigationControls();
    if (load) loadIntelligenceCenter();
  }

  function animateOrLoad() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      loadIntelligenceCenter();
      return;
    }
    requestAnimationFrame(() => {
      renderMainMap();
      renderRadar();
      loadIntelligenceCenter();
    });
  }

  function goHome() {
    if (!state.summary?.suggestedBounds) return;
    navigateTo(state.summary.suggestedBounds, state.summary.focusWid, true);
  }

  function goBack() {
    if (!state.history?.canBack()) return;
    applyHistoryState(state.history.back());
  }

  function goForward() {
    if (!state.history?.canForward()) return;
    applyHistoryState(state.history.forward());
  }

  function applyHistoryState(next) {
    aggregateLoader?.invalidate();
    if (Number(next.selectedWid) !== Number(state.selectedWid)) {
      invalidateDetailRequest({clear: true});
    }
    state.bounds = {...next.bounds};
    state.selectedWid = next.selectedWid;
    state.layers = {...state.layers, ...next.layers};
    persistCurrentState();
    updateNavigationControls();
    animateOrLoad();
  }

  function zoomIn() {
    zoomMap(-1);
  }

  function zoomOut() {
    zoomMap(1);
  }

  function zoomMap(direction) {
    const center = boundsCenter(state.bounds);
    state.bounds = window.IntelligenceMap.zoomBounds(
      state.bounds,
      center.row,
      center.col,
      direction
    );
    commitNavigation(true);
  }

  async function searchPlayers() {
    const input = document.getElementById('intel-player-input');
    const name = input?.value.trim() || '';
    if (!name) {
      showState('请输入玩家名', true);
      return;
    }
    try {
      const data = await fetchJson(
        `/api/intelligence/world/search/players?name=${encodeURIComponent(name)}`,
      );
      const players = data.players || [];
      renderSearchResults(
        players.length ? `主城 ${players.length} 座` : '没有收录到这位玩家的主城',
        players.map(player => ({
          wid: player.wid,
          title: player.name || '未命名',
          detail: [
            '主城',
            `${player.row},${player.col}`,
            `WID ${player.wid}`,
            player.unionName,
          ].filter(Boolean).join(' · '),
        })),
      );
      showState(
        players.length
          ? `找到 ${players.length} 座主城，点击结果定位`
          : `「${name}」没有已收录的主城坐标`,
        !players.length,
      );
    } catch (error) {
      showState(`玩家检索失败：${error.message}`, true);
    }
  }

  async function searchHighLand() {
    try {
      const data = await fetchJson('/api/intelligence/world/search/land?minLevel=7');
      const lands = data.lands || [];
      const total = Number(data.total || lands.length);
      renderSearchResults(
        total ? `七级及以上 ${total} 块${total > lands.length ? `，显示前 ${lands.length} 块` : ''}` : '已收录的土地里没有七级及以上',
        lands.map(land => ({
          wid: land.wid,
          title: `Lv.${land.landLevel}${land.name ? ` · ${land.name}` : ''}`,
          detail: `${land.row},${land.col} · WID ${land.wid}`,
        })),
      );
      showState(
        total
          ? `七级及以上 ${total} 块，点击结果定位`
          : '已收录的土地里没有七级及以上',
        !total,
      );
    } catch (error) {
      showState(`土地检索失败：${error.message}`, true);
    }
  }

  function renderSearchResults(title, items) {
    const host = document.getElementById('intel-search-results');
    if (!host) return;
    const hits = items.map(item => `
      <button class="intel-search-hit" type="button" data-search-wid="${Number(item.wid)}">
        <b>${esc(item.title)}</b>
        <small>${esc(item.detail)}</small>
      </button>
    `).join('');
    host.hidden = false;
    host.innerHTML = `<p>${esc(title)}</p>${hits}`;
  }

  async function openSearchHit(wid) {
    const located = await locateWid(wid);
    if (located) return;
    const row = Math.floor(Number(wid) / 10000);
    const col = Number(wid) % 10000;
    navigateTo(centeredBounds(row, col, 20), Number(wid), true);
    showState(`已把镜头移到 ${row},${col}`);
  }

  async function locateWid(value) {
    const input = document.getElementById('intel-wid-input');
    const wid = Number(value ?? input?.value);
    if (!Number.isInteger(wid) || wid <= 0) {
      showState('请输入有效 WID', true);
      return;
    }
    const row = Math.floor(wid / 10000);
    const col = wid % 10000;
    const revision = ++state.navigationRevision;
    state.navigationController?.abort();
    const controller = new AbortController();
    state.navigationController = controller;
    try {
      const detail = await fetchJson(
        `/api/intelligence/world/tile/${wid}`,
        controller.signal,
      );
      if (
        revision !== state.navigationRevision
        || state.navigationController !== controller
      ) return null;
      if (!detail?.ok) {
        showState(`WID ${wid} 不在当前已知地块中`, true);
        return null;
      }
      if (input) input.value = String(wid);
      navigateTo(centeredBounds(row, col, 20), wid, true);
      return detail;
    } catch (error) {
      if (error?.name !== 'AbortError' && revision === state.navigationRevision) {
        showState(`WID ${wid} 定位失败：${error.message}`, true);
      }
      return null;
    } finally {
      if (state.navigationController === controller) {
        state.navigationController = null;
      }
    }
  }

  function renderTimeline() {
    const element = document.getElementById('intel-timeline');
    element.innerHTML = state.events.length
      ? state.events.map((event, index) => `<button class="intel-event" data-event-index="${index}"><strong>${esc(event.event_type)}</strong>v${event.state_version} · ${new Date(event.observed_at_ms).toLocaleTimeString('zh-CN', {hour12: false})}</button>`).join('')
      : '<div class="intel-empty">暂无 WorldState 变化事件</div>';
  }

  function updateMeta() {
    document.getElementById('intel-map-mode').textContent = MODE_LABELS[state.mode];
    document.getElementById('intel-state-meta').textContent =
      `WorldState v${state.summary.worldStateVersion} · ${state.summary.freshness} · ${state.summary.completeness}`;
    const freshness = document.getElementById('hud-world-freshness');
    if (freshness) {
      const status = state.summary.freshness === 'fresh' ? 'live' : 'degraded';
      freshness.textContent =
        `${String(state.summary.freshness || 'unknown').toUpperCase()} · v${state.summary.worldStateVersion}`;
      freshness.dataset.status = status;
    }
  }

  function updateNavigationControls() {
    document.getElementById('intel-map-back').disabled = !state.history?.canBack();
    document.getElementById('intel-map-forward').disabled = !state.history?.canForward();
  }

  function persistCurrentState() {
    const hash = window.IntelligenceMapNavigation.serializeMapState(currentMapState());
    history.replaceState(null, '', hash);
  }

  function currentMapState() {
    return {
      bounds: {...state.bounds},
      selectedWid: state.selectedWid,
      layers: {...state.layers}
    };
  }

  function mapState(bounds, selectedWid, layers = state.layers) {
    return {
      bounds: {...bounds},
      selectedWid: Number(selectedWid || 0),
      layers: {...layers}
    };
  }

  function boundsEqual(left, right) {
    return (
      Number(left?.rowUp) === Number(right?.rowUp)
      && Number(left?.rowDown) === Number(right?.rowDown)
      && Number(left?.colLeft) === Number(right?.colLeft)
      && Number(left?.colRight) === Number(right?.colRight)
    );
  }

  function scheduleReload(commit = true) {
    aggregateLoader?.invalidate();
    clearTimeout(state.reloadTimer);
    state.reloadTimer = setTimeout(() => {
      if (commit) commitNavigation(false);
      loadIntelligenceCenter();
    }, 140);
  }

  function scheduleRender() {
    if (state.frame) return;
    state.frame = requestAnimationFrame(() => {
      state.frame = null;
      renderMainMap();
      renderRadar();
    });
  }

  function updateMapHelp() {
    const line = document.getElementById('intel-map-help-self');
    if (!line) return;
    const viewer = state.viewer;
    const userId = Number(viewer?.userId) || 0;
    const unionId = Number(viewer?.unionId) || 0;
    if (userId) {
      line.textContent = unionId
        ? `当前账号玩家 ID ${userId}，同盟 ID ${unionId}。玩家 ID 相同是我，同盟 ID 相同是友。`
        : `当前账号玩家 ID ${userId}。玩家 ID 相同是我；还没有同盟 ID 时，其他人先标成未知。`;
      return;
    }
    line.textContent = '还没有对上当前账号的玩家 ID，路线先标成未知，不会画成敌军。';
  }

  function bindMapHelp() {
    const button = document.getElementById('intel-map-help');
    const panel = document.getElementById('intel-map-help-panel');
    if (!button || !panel || button.dataset.bound === '1') return;
    button.dataset.bound = '1';
    button.addEventListener('click', () => {
      const willOpen = panel.hasAttribute('hidden');
      panel.toggleAttribute('hidden', !willOpen);
      button.setAttribute('aria-expanded', String(willOpen));
    });
  }

  function bindGentleWheel(canvas, {onPan, onZoom}) {
    let queued = null;
    let gestureScale = 1;
    let pinchWheelAt = 0;
    const queue = (action, clientX, clientY) => {
      if (!queued) {
        queued = {
          panX: 0,
          panY: 0,
          zoom: 0,
          source: action.source,
          clientX: 0,
          clientY: 0,
          zooming: false,
        };
        requestAnimationFrame(() => {
          const frame = queued;
          queued = null;
          if (!frame) return;
          frame.panX = Math.max(-72, Math.min(72, frame.panX));
          frame.panY = Math.max(-72, Math.min(72, frame.panY));
          frame.zoom = Math.max(-160, Math.min(160, frame.zoom));
          if (frame.zooming && frame.zoom) onZoom(frame);
          else if (frame.panX || frame.panY) {
            onPan({x: frame.panX, y: frame.panY, clientX: frame.clientX, clientY: frame.clientY});
          }
        });
      }
      queued.clientX = clientX;
      queued.clientY = clientY;
      if (action.type === 'zoom') {
        queued.zooming = true;
        queued.source = action.source;
        queued.zoom += action.zoom;
      } else {
        queued.panX += action.dx;
        queued.panY += action.dy;
      }
    };
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      const action = window.IntelligenceMap.wheelAction?.(event) || {
        type: event.ctrlKey || event.metaKey ? 'zoom' : 'pan',
        source: event.ctrlKey || event.metaKey ? 'pinch' : 'trackpad',
        dx: Number(event.deltaX) || 0,
        dy: Number(event.deltaY) || 0,
        zoom: Number(event.deltaY) || 0,
      };
      if (action.source === 'pinch') pinchWheelAt = Date.now();
      queue(action, Number(event.clientX) || 0, Number(event.clientY) || 0);
    }, {passive: false});
    canvas.addEventListener('gesturestart', event => {
      gestureScale = Number(event.scale) || 1;
      event.preventDefault();
    }, {passive: false});
    canvas.addEventListener('gesturechange', event => {
      event.preventDefault();
      if (Date.now() - pinchWheelAt < 80) return;
      const scale = Number(event.scale) || gestureScale;
      const ratio = gestureScale > 0 ? scale / gestureScale : 1;
      gestureScale = scale;
      if (!Number.isFinite(ratio) || Math.abs(ratio - 1) < 0.002) return;
      queue({
        type: 'zoom',
        source: 'pinch',
        dx: 0,
        dy: 0,
        zoom: Math.log(ratio) / 0.0032,
      }, Number(event.clientX) || 0, Number(event.clientY) || 0);
    }, {passive: false});
  }

  function bindMainCanvas(canvas) {
    canvas.addEventListener('click', event => {
      if (state.suppressMapClick) {
        state.suppressMapClick = false;
        return;
      }
      if (state.drag?.moved) return;
      const point = canvasPoint(canvas, event);
      if (state.mode === 'near') {
        const wid = window.IntelligenceMap.hitTestMap(point.x, point.y, state.render);
        if (!wid) {
          closeStageDetail();
          return;
        }
        if (event.shiftKey) toggleFavorite(wid);
        else selectWid(wid);
      } else {
        const bucket = window.IntelligenceMapOverview.hitTestBucket(
          point.x,
          point.y,
          state.render
        );
        if (bucket) focusBucket(bucket);
      }
    });
    canvas.addEventListener('dblclick', event => {
      if (state.mode === 'near') return;
      const point = canvasPoint(canvas, event);
      focusBucket(window.IntelligenceMapOverview.hitTestBucket(
        point.x,
        point.y,
        state.render
      ));
    });
    bindGentleWheel(canvas, {
      onPan(frame) {
        const shift = panPixels(canvas, state.bounds, frame.x, frame.y, 0.55);
        state.bounds = window.IntelligenceMap.panBounds(
          state.bounds,
          shift.rowDelta,
          shift.colDelta
        );
        scheduleRender();
        scheduleReload(true);
      },
      onZoom(frame) {
        const point = worldPoint(canvas, canvasPoint(canvas, frame));
        const factor = window.IntelligenceMap.wheelZoomFactor?.(frame.zoom, frame.source)
          ?? (Number(frame.zoom) < 0 ? 0.8 : 1.25);
        state.zoomPending = (Number(state.zoomPending) || 1) * factor;
        const next = window.IntelligenceMap.zoomBounds(
          state.bounds,
          point.row,
          point.col,
          state.zoomPending,
          'anchor'
        );
        const unchanged = next.rowUp === state.bounds.rowUp
          && next.rowDown === state.bounds.rowDown
          && next.colLeft === state.bounds.colLeft
          && next.colRight === state.bounds.colRight;
        if (unchanged) {
          const span = state.bounds.rowDown - state.bounds.rowUp + 1;
          if ((span <= 5 && state.zoomPending < 1) || (span >= 160 && state.zoomPending > 1)) {
            state.zoomPending = 1;
          }
          return;
        }
        state.zoomPending = 1;
        state.bounds = next;
        scheduleRender();
        scheduleReload(true);
      }
    });
    canvas.addEventListener('pointerdown', event => {
      state.drag = {
        x: event.clientX,
        y: event.clientY,
        bounds: {...state.bounds},
        moved: false
      };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
      if (!state.drag) return;
      const dx = event.clientX - state.drag.x;
      const dy = event.clientY - state.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 5 && !state.drag.moved) {
        state.drag.moved = true;
        aggregateLoader?.invalidate();
      }
      const shift = panPixels(canvas, state.drag.bounds, -dx, -dy, 1);
      state.bounds = window.IntelligenceMap.panBounds(
        state.drag.bounds,
        shift.rowDelta,
        shift.colDelta
      );
      scheduleRender();
    });
    canvas.addEventListener('pointerup', event => {
      finishMainDrag(canvas, event, true);
    });
    canvas.addEventListener('pointercancel', event => {
      finishMainDrag(canvas, event, false);
    });
    canvas.addEventListener('lostpointercapture', event => {
      finishMainDrag(canvas, event, false);
    });
  }

  function bindRadar(canvas) {
    canvas.addEventListener('click', event => {
      moveFromRadar(canvasPoint(canvas, event), true);
    });
    canvas.addEventListener('dblclick', event => {
      const bucket = window.IntelligenceMapOverview.hitTestBucket(
        canvasPoint(canvas, event).x,
        canvasPoint(canvas, event).y,
        state.radarRender
      );
      if (bucket) focusBucket(bucket);
    });
    canvas.addEventListener('pointerdown', event => {
      aggregateLoader?.invalidate();
      clearTimeout(state.reloadTimer);
      state.radarDrag = {
        pointerId: event.pointerId,
        bounds: {...state.bounds},
      };
      canvas.setPointerCapture(event.pointerId);
      moveFromRadar(canvasPoint(canvas, event), false);
    });
    canvas.addEventListener('pointermove', event => {
      if (!state.radarDrag) return;
      moveFromRadar(canvasPoint(canvas, event), false);
      scheduleRender();
    });
    canvas.addEventListener('pointerup', event => {
      finishRadarDrag(canvas, event, true);
    });
    canvas.addEventListener('pointercancel', event => {
      finishRadarDrag(canvas, event, false);
    });
    canvas.addEventListener('lostpointercapture', event => {
      finishRadarDrag(canvas, event, false);
    });
  }

  function finishMainDrag(canvas, event, commit) {
    const drag = state.drag;
    if (!drag) return;
    state.drag = null;
    if (!commit) {
      state.bounds = {...drag.bounds};
      scheduleRender();
    }
    state.suppressMapClick = commit && drag.moved;
    try { canvas.releasePointerCapture(event.pointerId); } catch {}
    if (commit && drag.moved) scheduleReload(true);
  }

  function finishRadarDrag(canvas, event, commit) {
    const drag = state.radarDrag;
    if (!drag) return;
    state.radarDrag = null;
    if (!commit) {
      state.bounds = {...drag.bounds};
      scheduleRender();
    }
    try { canvas.releasePointerCapture(event.pointerId); } catch {}
    if (commit) commitNavigation(true);
  }

  function init() {
    const canvas = document.getElementById('intel-map-canvas');
    const radar = document.getElementById('intel-radar-canvas');
    if (!canvas || !radar) return;
    if (window.WorldScenePanel) {
      window.WorldScenePanel.load = loadSceneCompatibility;
    }
    bindMainCanvas(canvas);
    bindRadar(radar);
    bindMapHelp();
    bindMapStage();
    document.querySelectorAll('[data-intel-view]').forEach(button => {
      button.addEventListener('click', () => openView(button.dataset.intelView));
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        const buttons = [...document.querySelectorAll('[data-intel-view]')];
        const current = buttons.indexOf(button);
        const delta = event.key === 'ArrowRight' ? 1 : -1;
        const next = buttons[(current + delta + buttons.length) % buttons.length];
        event.preventDefault();
        next.focus();
        openView(next.dataset.intelView);
      });
    });
    document.querySelectorAll('.intel-layer').forEach(button => {
      button.addEventListener('click', () => {
        const layer = button.dataset.layer;
        if (layer && layer !== 'all') {
          state.layers[layer] = !state.layers[layer];
          state.layerRevision += 1;
          button.classList.toggle('active', state.layers[layer]);
          state.history?.replace(currentMapState());
          renderMainMap();
        }
      });
    });
    document.querySelectorAll('.intel-detail-tabs button').forEach(button => {
      button.addEventListener('click', () => {
        const tab = button.dataset.intelTab;
        if (tab === 'battles') refreshBattleStats();
        else renderDetail(tab);
      });
    });
    document.getElementById('intel-detail-body')?.addEventListener('click', event => {
      const button = event.target.closest('[data-intel-action]');
      if (!button) return;
      if (button.dataset.intelAction === 'toggle-favorite') {
        toggleFavorite(state.detail?.tile?.wid);
      } else if (button.dataset.intelAction === 'open-battles') {
        const wid = Number(button.dataset.wid);
        openBattles(Number.isSafeInteger(wid) && wid > 0 ? wid : state.selectedWid);
      } else if (button.dataset.intelAction === 'open-battle') {
        const battleId = Number(button.dataset.battleId);
        if (battleId && typeof showBattleDetail === 'function') showBattleDetail(battleId);
      } else if (button.dataset.intelAction === 'open-lineup') {
        const index = Number(button.dataset.lineupIndex);
        const lineups = state.detail?.battleStats?.commonLineups || [];
        if (Number.isSafeInteger(index) && lineups[index]) openLineup(lineups[index].key);
      }
    });
    document.getElementById('intel-timeline')?.addEventListener('click', event => {
      const button = event.target.closest('[data-event-index]');
      const index = Number(button?.dataset.eventIndex);
      const wid = Number(Number.isSafeInteger(index) ? state.events[index]?.entity_id : 0);
      if (wid) locateWid(wid);
    });
    document.getElementById('intel-wid-input')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') locateWid();
    });
    document.getElementById('intel-player-search')?.addEventListener('click', () => {
      searchPlayers();
    });
    document.getElementById('intel-player-input')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') searchPlayers();
    });
    document.getElementById('intel-land-search')?.addEventListener('click', () => {
      searchHighLand();
    });
    document.getElementById('intel-search-results')?.addEventListener('click', event => {
      const hit = event.target.closest('[data-search-wid]');
      const wid = Number(hit?.dataset.searchWid);
      if (wid) openSearchHit(wid);
    });
    document.getElementById('intel-radar-toggle')?.addEventListener('click', () => {
      document.getElementById('intel-radar')?.classList.toggle('is-collapsed');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        state.streamDirty = true;
        clearTimeout(state.reloadTimer);
        clearTimeout(state.streamReloadTimer);
        aggregateLoader?.invalidate();
        invalidateDetailRequest();
        state.navigationRevision += 1;
        state.navigationController?.abort();
        state.navigationController = null;
        return;
      }
      scheduleRender();
      if (
        state.streamDirty
        && document.getElementById('tab33')?.classList.contains('active')
      ) {
        state.streamDirty = false;
        loadIntelligenceCenter(true);
      }
    });
    window.addEventListener('stzb:tab-changed', event => {
      if (Number(event.detail?.tabId) !== 33) {
        clearTimeout(state.reloadTimer);
        clearTimeout(state.streamReloadTimer);
        aggregateLoader?.invalidate();
        invalidateDetailRequest();
        state.navigationRevision += 1;
        state.navigationController?.abort();
        state.navigationController = null;
      } else if (state.streamDirty && document.visibilityState === 'visible') {
        state.streamDirty = false;
        loadIntelligenceCenter(true);
      }
    });
    window.addEventListener('stzb:stream-event', event => {
      const type = String(event.detail?.type || '');
      if (![
        'world_snapshot_complete',
        'world_scene_delta',
        'world_state_delta',
      ].includes(type)) return;
      state.streamDirty = true;
      window.WorldScenePanel?.markDirty();
      if (
        document.visibilityState !== 'visible'
        || !document.getElementById('tab33')?.classList.contains('active')
      ) return;
      clearTimeout(state.streamReloadTimer);
      state.streamReloadTimer = setTimeout(() => {
        state.streamReloadTimer = null;
        state.streamDirty = false;
        loadIntelligenceCenter(true);
      }, 350);
    });
    window.addEventListener('resize', scheduleRender);
  }

  async function fetchJson(url, signal) {
    const response = await fetch(url, {cache: 'no-store', signal});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  function modulesReady() {
    return window.IntelligenceLoader?.createIntelligenceLoaderCoordinator
      && window.IntelligenceMap
      && window.IntelligenceMapOverview
      && window.IntelligenceMapNavigation;
  }

  function centeredBounds(row, col, size) {
    const span = Math.max(5, Math.min(160, Number(size) || 20));
    const rowUp = Math.max(0, Math.round(row - span / 2));
    const colLeft = Math.max(0, Math.round(col - span / 2));
    return {
      rowUp,
      rowDown: rowUp + span - 1,
      colLeft,
      colRight: colLeft + span - 1
    };
  }

  function boundsCenter(bounds) {
    return {
      row: (bounds.rowUp + bounds.rowDown) / 2,
      col: (bounds.colLeft + bounds.colRight) / 2
    };
  }

  function boundsQuery(bounds) {
    return new URLSearchParams(bounds).toString();
  }

  function canvasPoint(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    return {x: event.clientX - rect.left, y: event.clientY - rect.top};
  }

  function worldPoint(canvas, point) {
    const size = state.mode === 'near' ? Number(state.render?.size) || 0 : 0;
    if (size > 0) {
      return {
        row: state.bounds.rowUp + (point.y - (Number(state.render.originY) || 0)) / size,
        col: state.bounds.colLeft + (point.x - (Number(state.render.originX) || 0)) / size
      };
    }
    const rows = state.bounds.rowDown - state.bounds.rowUp + 1;
    const cols = state.bounds.colRight - state.bounds.colLeft + 1;
    return {
      row: state.bounds.rowUp + (point.y / Math.max(1, canvas.clientHeight)) * rows,
      col: state.bounds.colLeft + (point.x / Math.max(1, canvas.clientWidth)) * cols
    };
  }

  function panPixels(canvas, bounds, dx, dy, scale) {
    const size = state.mode === 'near' ? Number(state.render?.size) || 0 : 0;
    const factor = Number(scale) || 1;
    if (size > 0) {
      return {rowDelta: dy / size * factor, colDelta: dx / size * factor};
    }
    const rows = bounds.rowDown - bounds.rowUp + 1;
    const cols = bounds.colRight - bounds.colLeft + 1;
    return {
      rowDelta: (dy / Math.max(1, canvas.clientHeight)) * rows * factor,
      colDelta: (dx / Math.max(1, canvas.clientWidth)) * cols * factor
    };
  }

  function syncStageDetail() {
    const view = document.getElementById('intel-view-map');
    if (!view) return;
    const open = view.classList.contains('is-map-stage')
      && state.stageDetailOpen
      && Number(state.selectedWid) > 0;
    view.classList.toggle('is-detail-open', open);
  }

  function closeStageDetail() {
    if (!document.getElementById('intel-view-map')?.classList.contains('is-map-stage')) return;
    state.stageDetailOpen = false;
    syncStageDetail();
  }

  function setMapStage(open) {
    const view = document.getElementById('intel-view-map');
    const next = Boolean(open);
    document.body.classList.toggle('intel-map-stage', next);
    view?.classList.toggle('is-map-stage', next);
    const button = document.getElementById('intel-map-stage');
    if (button) {
      button.textContent = next ? '返回' : '全图';
      button.setAttribute('aria-pressed', String(next));
      button.setAttribute('aria-label', next ? '返回指挥台' : '打开全图');
    }
    if (!next) {
      view?.classList.remove('is-detail-open');
      const detail = document.getElementById('intel-detail-panel');
      if (detail) {
        detail.style.top = '';
        detail.style.maxHeight = '';
      }
    } else {
      syncStageDetail();
    }
    requestAnimationFrame(() => {
      renderMainMap();
      renderRadar();
      placeStageDetail();
    });
  }

  function placeStageDetail() {
    const view = document.getElementById('intel-view-map');
    const map = view?.querySelector('.intel-map-wrap');
    const detail = document.getElementById('intel-detail-panel');
    if (!view?.classList.contains('is-map-stage') || !map || !detail) return;
    const top = map.offsetTop + 12;
    detail.style.top = `${top}px`;
    detail.style.maxHeight = `${Math.max(180, map.clientHeight - 24)}px`;
  }

  function bindMapStage() {
    const openButton = document.getElementById('intel-map-stage');
    const backButton = document.getElementById('intel-stage-back');
    const closeButton = document.getElementById('intel-detail-close');
    if (openButton && openButton.dataset.bound !== '1') {
      openButton.dataset.bound = '1';
      openButton.addEventListener('click', () => {
        setMapStage(!document.body.classList.contains('intel-map-stage'));
      });
    }
    if (backButton && backButton.dataset.bound !== '1') {
      backButton.dataset.bound = '1';
      backButton.addEventListener('click', () => setMapStage(false));
    }
    if (closeButton && closeButton.dataset.bound !== '1') {
      closeButton.dataset.bound = '1';
      closeButton.addEventListener('click', () => closeStageDetail());
    }
    if (document.body.dataset.intelStageKeys === '1') return;
    document.body.dataset.intelStageKeys = '1';
    window.addEventListener('resize', () => {
      if (document.body.classList.contains('intel-map-stage')) placeStageDetail();
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const view = document.getElementById('intel-view-map');
      if (!view?.classList.contains('is-map-stage')) return;
      if (view.classList.contains('is-detail-open')) {
        closeStageDetail();
        return;
      }
      setMapStage(false);
    });
  }

  function formatBounds(bounds) {
    return bounds
      ? `row ${bounds.rowUp}–${bounds.rowDown} / col ${bounds.colLeft}–${bounds.colRight}`
      : '未知';
  }

  function ownershipRows(ownership, viewer) {
    const name = String(ownership?.ownerName || '').trim();
    const unionName = String(ownership?.ownerUnionName || '').trim();
    const user = Number(ownership?.ownerUserId) || 0;
    const union = Number(ownership?.ownerUnionId) || 0;
    const selfUser = Number(viewer?.userId) || 0;
    const selfUnion = Number(viewer?.unionId) || 0;
    let relation = String(ownership?.relation || '');
    if (!relation || relation === 'unknown') {
      if (!user && !union) relation = 'unowned';
      else if (selfUser && user === selfUser) relation = 'self';
      else if (selfUnion && union && union === selfUnion) relation = 'ally';
      else if (
        user
        && selfUser
        && selfUnion
        && union
        && union !== selfUnion
      ) relation = 'enemy';
      else if (!user && selfUnion && union && union !== selfUnion) relation = 'enemy';
      else relation = 'unknown';
    }
    const labels = {
      self: '我',
      ally: '我方',
      enemy: '敌方',
      unowned: '无主',
      unknown: '未知',
    };
    const relationText = labels[relation] || '未知';
    const side = unionName && relation !== 'unowned'
      ? `${relationText} · ${unionName}`
      : relationText;
    return row('占领玩家', name || (user ? `玩家 ${user}` : '无主'))
      + row('归属关系', side);
  }

  function card(title, content) {
    return `<details class="hud-detail-section intel-info-card" open>
      <summary>${esc(title)}</summary>
      <div class="hud-detail-section-body">${content}</div>
    </details>`;
  }

  function row(label, value) {
    return `<div class="intel-row"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
  }

  function fmtTime(value) {
    return value
      ? new Date(Number(value) * 1000).toLocaleString('zh-CN', {hour12: false})
      : '-';
  }

  function showState(text, error = false) {
    const element = document.getElementById('intel-map-status');
    if (element) {
      element.textContent = text;
      element.classList.toggle('intel-error', error);
    }
  }

  function readFavorites() {
    try {
      return JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]')
        .map(Number)
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  function toggleFavorite(wid) {
    wid = Number(wid);
    if (state.favorites.has(wid)) state.favorites.delete(wid);
    else state.favorites.add(wid);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favorites]));
    renderMainMap();
    if (state.detail?.tile?.wid === wid) renderDetail('risk');
  }

  function openBattles(wid = state.selectedWid) {
    const input = document.getElementById('ba-wid');
    if (input) input.value = String(wid || '');
    const button = [...document.querySelectorAll('nav button')].find(candidate =>
      String(candidate.getAttribute('onclick')).includes('switchTab(10,')
    );
    switchTab(10, button);
  }

  function openLineup(key) {
    const button = [...document.querySelectorAll('nav button')].find(candidate =>
      String(candidate.getAttribute('onclick')).includes('switchTab(34,')
    );
    switchTab(34, button);
    window.ResearchCenter?.openLineup(key);
  }

  window.loadIntelligenceCenter = loadIntelligenceCenter;
  window.IntelligenceCenter = {
    load: loadIntelligenceCenter,
    openView,
    selectWid,
    locateWid,
    searchPlayers,
    searchHighLand,
    focusBucket,
    moveFromRadar,
    goHome,
    goBack,
    goForward,
    zoomIn,
    zoomOut,
    openBattles,
    openLineup,
    toggleFavorite,
    state
  };
  document.addEventListener('DOMContentLoaded', init);
})();
