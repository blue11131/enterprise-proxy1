import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Ban,
  Bot,
  Database,
  Download,
  FileJson,
  LayoutDashboard,
  Pause,
  Play,
  Plus,
  Power,
  RefreshCw,
  Repeat,
  Save,
  ScrollText,
  Send,
  Sparkles,
  Server,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import "./styles.css";

const VIEWS = [
  { group: "Inspect", items: [
    ["Dashboard", LayoutDashboard],
    ["Traffic", Activity],
    ["Certificates", ShieldCheck],
  ] },
  { group: "Operate", items: [
    ["Access Control", Users],
    ["Blocks", Ban],
    ["Deployments", Server],
    ["Cache", Database],
    ["Settings", Settings],
    ["Audit Log", ScrollText],
  ] },
];

const VIEW_SLUGS = {
  Dashboard: "",
  Traffic: "traffic",
  Certificates: "certificates",
  "Access Control": "access-control",
  Blocks: "blocks",
  Deployments: "deployments",
  Cache: "cache",
  Settings: "settings",
  "Audit Log": "audit-log",
};

const SLUG_VIEWS = Object.fromEntries(Object.entries(VIEW_SLUGS).map(([name, slug]) => [slug, name]));

const NAV_LABELS = {
  Dashboard: "仪表盘",
  Traffic: "流量",
  Certificates: "证书",
  "Access Control": "访问控制",
  Blocks: "黑名单",
  Deployments: "部署",
  Cache: "缓存",
  Settings: "设置",
  "Audit Log": "审计日志",
  Inspect: "检查",
  Operate: "运维",
};

const STATUS_LABELS = {
  ok: "正常",
  checking: "检测中",
  degraded: "降级",
  error: "异常",
};

const METHOD_CLASS = {
  GET: "get",
  POST: "post",
  PUT: "put",
  PATCH: "patch",
  DELETE: "delete",
};

function currentViewFromURL() {
  const params = new URLSearchParams(location.search);
  const queryView = params.get("view");
  if (queryView && SLUG_VIEWS[queryView]) return SLUG_VIEWS[queryView];

  const path = location.pathname.replace(/\/+$/, "");
  const prefix = "/admin";
  if (path === prefix || path === "") return "Dashboard";
  if (path.startsWith(`${prefix}/`)) {
    const slug = decodeURIComponent(path.slice(prefix.length + 1).split("/")[0] || "");
    return SLUG_VIEWS[slug] || "Dashboard";
  }
  return "Dashboard";
}

function adminPathForView(view) {
  const slug = VIEW_SLUGS[view] || "";
  const params = new URLSearchParams(location.search);
  params.delete("view");
  params.delete("token");
  const query = params.toString();
  const path = slug ? `/admin/${slug}` : "/admin/";
  return query ? `${path}?${query}` : path;
}

function stripTokenFromURL() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("token")) return;
  url.searchParams.delete("token");
  const query = url.searchParams.toString();
  history.replaceState(history.state, "", `${url.pathname}${query ? `?${query}` : ""}${url.hash}`);
}

function getToken() {
  const params = new URLSearchParams(location.search);
  const urlToken = params.get("token") || "";
  const value = urlToken || localStorage.getItem("adminToken") || "";
  if (value) localStorage.setItem("adminToken", value);
  if (urlToken) stripTokenFromURL();
  return value;
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const detail = body.trim();
    throw new Error(detail ? `${res.status} ${res.statusText}: ${detail}` : `${res.status} ${res.statusText}`);
  }
  return res.json();
}

function api(path) {
  return request(path);
}

function post(path) {
  return request(path, { method: "POST" });
}

function postJSON(path, body) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function putJSON(path, body) {
  return request(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function parseJSONEditorValue(value, fallback = {}) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return JSON.parse(text);
}

function del(path) {
  return request(path, { method: "DELETE" });
}

function authenticatedHref(path) {
  const url = new URL(path, window.location.origin);
  const token = getToken();
  if (token) url.searchParams.set("token", token);
  return `${url.pathname}${url.search}${url.hash}`;
}

function flowMatchesSearch(flow, search) {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  return [
    flow.method,
    flow.host,
    flow.url,
    flow.protocol,
    flow.mime_type,
    flow.rule_id,
    flow.status ? String(flow.status) : "",
  ].some((value) => String(value || "").toLowerCase().includes(term));
}

function useAsync(factory, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, data: null, error: null });
    factory()
      .then((data) => !cancelled && setState({ loading: false, data, error: null }))
      .catch((error) => !cancelled && setState({ loading: false, data: null, error }));
    return () => { cancelled = true; };
  }, deps);
  return state;
}

function useAsyncStale(factory, deps, initialData = null, resetKey = "") {
  const [state, setState] = useState({ loading: true, data: initialData, error: null });
  const resetKeyRef = useRef(resetKey);
  useEffect(() => {
    let cancelled = false;
    const shouldReset = resetKeyRef.current !== resetKey;
    resetKeyRef.current = resetKey;
    setState((prev) => shouldReset ? { loading: true, data: initialData, error: null } : { ...prev, loading: true, error: null });
    factory()
      .then((data) => !cancelled && setState({ loading: false, data, error: null }))
      .catch((error) => !cancelled && setState((prev) => ({ ...prev, loading: false, error })));
    return () => { cancelled = true; };
  }, deps);
  return state;
}

function App() {
  const [current, setCurrent] = useState(currentViewFromURL);
  const [refreshKey, setRefreshKey] = useState(0);
  const [status, setStatus] = useState("checking");
  const [confirmed, setConfirmed] = useState(localStorage.getItem("responsibleUseConfirmed") === "true");
  const refresh = () => setRefreshKey((v) => v + 1);

  useEffect(() => {
    const onPopState = () => setCurrent(currentViewFromURL());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    getToken();
    const nextPath = adminPathForView(current);
    const currentPath = `${location.pathname}${location.search}`;
    if (nextPath !== currentPath) {
      history.pushState({ view: current }, "", nextPath);
    }
  }, [current]);

  const body = useMemo(() => {
    const props = { refreshKey, refresh, setCurrent };
    switch (current) {
      case "Traffic": return <TrafficView {...props} />;
      case "Certificates": return <CertificatesView {...props} />;
      case "Access Control": return <AccessControlView {...props} />;
      case "Blocks": return <BlocksView {...props} />;
      case "Deployments": return <DeploymentsView {...props} />;
      case "Cache": return <CacheView {...props} />;
      case "Settings": return <SettingsView {...props} />;
      case "Audit Log": return <AuditLogView {...props} />;
      default: return <DashboardView refreshKey={refreshKey} setStatus={setStatus} setCurrent={setCurrent} />;
    }
  }, [current, refreshKey]);

  return (
    <>
      <header className="topbar">
        <div className="brand"><img className="brand-mark" src="./logo-mark.svg" alt="" aria-hidden="true" />MITM 代理管理端</div>
        <span className="env-pill">研究控制台</span>
        <span id="status" className="status-pill">{STATUS_LABELS[status] || status}</span>
      </header>
      <main className="shell">
        <nav className="sidebar">
          {VIEWS.map((group) => (
            <div key={group.group}>
              <div className="navgroup">{NAV_LABELS[group.group] || group.group}</div>
              {group.items.map(([name, Icon]) => (
                <button key={name} className={name === current ? "active" : ""} onClick={() => setCurrent(name)}>
                  <Icon aria-hidden="true" />
                  <span>{NAV_LABELS[name] || name}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <section className="page">{body}</section>
      </main>
      {!confirmed && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="consent-title">
            <h2 id="consent-title">责任使用确认</h2>
            <p>我确认此代理仅用于我有权检查的系统与网络。</p>
            <button className="primary" onClick={() => {
              localStorage.setItem("responsibleUseConfirmed", "true");
              setConfirmed(true);
            }}>确认</button>
          </div>
        </div>
      )}
    </>
  );
}

function PageState({ state }) {
  if (state.loading) return <div className="panel muted">加载中...</div>;
  if (state.error) return <div className="panel error">加载失败：<code>{state.error.message || String(state.error)}</code></div>;
  return null;
}

function DashboardView({ refreshKey, setStatus, setCurrent }) {
  const [restartState, setRestartState] = useState({ status: "idle", message: "" });
  const [liveKey, setLiveKey] = useState(0);
  const liveTimerRef = useRef(null);
  const state = useAsync(async () => {
    const [health, version, trafficStats, recentTraffic, audit, cache] = await Promise.all([
      api("/api/health"),
      api("/api/version"),
      api("/api/traffic/stats"),
      api("/api/traffic?limit=40"),
      api("/api/audit"),
      api("/api/cache?limit=1"),
    ]);
    return { health, version, trafficStats, recentTraffic, audit, cache };
  }, [refreshKey, liveKey]);

  useEffect(() => {
    const source = new EventSource(`/api/traffic/stream?token=${encodeURIComponent(getToken())}`);
    const scheduleRefresh = () => {
      if (liveTimerRef.current) return;
      liveTimerRef.current = setTimeout(() => {
        liveTimerRef.current = null;
        setLiveKey((value) => value + 1);
      }, 650);
    };
    [
      "traffic.request.started",
      "traffic.response.completed",
      "traffic.tunnel.opened",
      "traffic.blocked",
      "cache.hit",
      "cache.miss",
      "config.updated",
    ].forEach((topic) => source.addEventListener(topic, scheduleRefresh));
    source.onerror = () => source.close();
    return () => {
      source.close();
      if (liveTimerRef.current) {
        clearTimeout(liveTimerRef.current);
        liveTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (state.data?.health?.status) setStatus(state.data.health.status);
  }, [state.data, setStatus]);

  if (state.loading || state.error) return <PageState state={state} />;
  const { health, version, trafficStats, recentTraffic, audit, cache } = state.data;
  const totalTraffic = Number(trafficStats.total || 0);
  const cacheHits = Number(trafficStats.cache_hit || cache?.hits || 0);
  const blockedTraffic = Number(trafficStats.blocked || 0);
  const recentFlows = recentTraffic || [];
  const recentStatusBuckets = statusBuckets(recentFlows);
  const methodBuckets = methodBucketsFromFlows(recentFlows);
  const latencySeries = recentFlows.slice().reverse().map((flow) => Number(flow.duration_ms || 0)).filter((value) => value >= 0);
  const uptime = formatDuration(Number(health.uptime_seconds || 0));
  const reloadConfig = async () => {
    await post("/api/deployments/current/reload");
    location.reload();
  };
  const restartProxy = async () => {
    setRestartState({ status: "pending", message: "已请求重启，等待进程响应..." });
    try {
      await post("/api/deployments/current/restart");
      setRestartState({ status: "success", message: "已成功请求重启。" });
    } catch (error) {
      setRestartState({ status: "error", message: error.message });
    }
  };
  return (
    <div className="page-stack">
      <PageTitle
        title="Dashboard"
        subtitle={`代理控制平面 - 上次同步 ${new Date(health.time).toLocaleTimeString()}`}
        actions={(
          <>
            <button className="secondary" onClick={reloadConfig}><RefreshCw />重新加载配置</button>
            <button className="primary" onClick={restartProxy}><Power />重启代理</button>
          </>
        )}
      />
      <div className="grid metrics-grid">
        <Metric label="代理" value={health.proxy.listen_addr} />
        <Metric label="MITM" value={health.proxy.mitm_enabled ? "启用" : "禁用"} tone={health.proxy.mitm_enabled ? "success" : ""} />
        <Metric label="管理端" value={health.admin.addr} />
        <Metric label="版本" value={version.version} />
      </div>
      <div className="grid metrics-grid">
        <Metric label="捕获请求数" value={totalTraffic} />
        <Metric label="已拦截请求" value={blockedTraffic} />
        <Metric label="缓存命中率" value={`${cacheHits} / ${totalTraffic}`} />
        <Metric label="运行时长" value={uptime} hint="时:分" />
      </div>
      <div className="dashboard-charts">
        <ChartPanel title="流量构成" subtitle="最近 HTTP 状态">
          <DonutChart segments={recentStatusBuckets} centerLabel={`${recentFlows.length}`} centerSub="最近" />
        </ChartPanel>
        <ChartPanel title="请求方法" subtitle="最近请求方法">
          <BarList data={methodBuckets} />
        </ChartPanel>
        <ChartPanel title="延迟" subtitle="最近响应耗时">
          <Sparkline values={latencySeries} />
        </ChartPanel>
      </div>
      {restartState.message && <div className={`restart-feedback ${restartState.status}`}>{restartState.message}</div>}
      <div className="dashboard-panels">
        <SummaryPanel title="最近流量" action={<button className="rowbutton" onClick={() => setCurrent("Traffic")}>查看全部</button>}>
          <TrafficSummaryList flows={recentFlows.slice(0, 5)} />
        </SummaryPanel>
        <SummaryPanel title="审计日志" action={<button className="rowbutton" onClick={() => setCurrent("Audit Log")}>打开</button>}>
          <AuditSummaryList entries={(audit || []).slice(0, 4)} />
        </SummaryPanel>
      </div>
    </div>
  );
}

function SummaryPanel({ title, action, children }) {
  return (
    <div className="panel summary-panel">
      <div className="summary-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function TrafficSummaryList({ flows }) {
  if (!flows.length) return <div className="empty-list">尚未捕获流量。</div>;
  return (
    <div className="summary-list">
      {flows.map((flow) => (
        <div className="summary-row traffic-summary-row" key={flow.id}>
          <MethodPill method={flow.method || "REQ"} />
          <div className="summary-main">
            <strong>{flow.host || "(未知主机)"}</strong>
            <span>{flow.url || flow.id}</span>
          </div>
          <span className={`status-code ${statusCodeClass(flow.status)}`}>{flow.status || "..."}</span>
        </div>
      ))}
    </div>
  );
}

function AuditSummaryList({ entries }) {
  if (!entries.length) return <div className="empty-list">暂无审计事件。</div>;
  return (
    <table className="summary-table">
      <thead><tr><th>时间</th><th>操作者</th><th>动作</th></tr></thead>
      <tbody>
        {entries.map((entry, index) => (
          <tr key={`${entry.created_at}-${entry.action}-${index}`}>
            <td>{timeOnly(entry.created_at)}</td>
            <td><span className={`scope-badge ${entry.actor === "system" ? "" : "out"}`}>{entry.actor || "admin"}</span></td>
            <td><code>{entry.action}</code></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChartPanel({ title, subtitle, children }) {
  return (
    <div className="panel chart-panel">
      <div className="chart-head">
        <h2>{title}</h2>
        <span>{subtitle}</span>
      </div>
      {children}
    </div>
  );
}

function DonutChart({ segments, centerLabel, centerSub }) {
  const total = segments.reduce((sum, item) => sum + item.value, 0);
  let offset = 0;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="donut-wrap">
      <svg className="donut-chart" viewBox="0 0 120 120" role="img" aria-label="流量构成图">
        <circle className="donut-track" cx="60" cy="60" r={radius} />
        {total > 0 && segments.map((segment) => {
          const length = (segment.value / total) * circumference;
          const currentOffset = offset;
          offset += length;
          return <circle key={segment.label} className={`donut-segment ${segment.tone || ""}`} cx="60" cy="60" r={radius} strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-currentOffset} />;
        })}
        <text x="60" y="57" textAnchor="middle" className="donut-center">{centerLabel}</text>
        <text x="60" y="73" textAnchor="middle" className="donut-sub">{centerSub}</text>
      </svg>
      <div className="chart-legend">
        {segments.map((segment) => <div key={segment.label}><span className={`legend-dot ${segment.tone || ""}`} />{segment.label}<strong>{segment.value}</strong></div>)}
      </div>
    </div>
  );
}

function BarList({ data }) {
  const max = Math.max(1, ...data.map((item) => item.value));
  if (!data.length) return <div className="empty-list">暂无数据。</div>;
  return (
    <div className="bar-list">
      {data.map((item) => (
        <div className="bar-row" key={item.label}>
          <div className="bar-label"><span>{item.label}</span><strong>{item.value}</strong></div>
          <div className="bar-track"><div className={`bar-fill ${item.tone || ""}`} style={{ width: `${Math.max(6, (item.value / max) * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function Sparkline({ values }) {
  const width = 280;
  const height = 104;
  const clean = values.length ? values : [0];
  const max = Math.max(1, ...clean);
  const points = clean.map((value, index) => {
    const x = clean.length === 1 ? width / 2 : (index / (clean.length - 1)) * width;
    const y = height - (value / max) * (height - 18) - 9;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const latest = values.length ? values[values.length - 1] : 0;
  return (
    <div className="sparkline-wrap">
      <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="延迟走势图">
        <polyline points={points} />
      </svg>
      <div className="sparkline-meta"><strong>{latest} 毫秒</strong><span>最新</span><span>最大 {Math.max(0, ...values)} 毫秒</span></div>
    </div>
  );
}

function statusBuckets(flows) {
  const buckets = [
    { label: "2xx", value: 0, tone: "ok" },
    { label: "3xx", value: 0, tone: "info" },
    { label: "4xx", value: 0, tone: "warn" },
    { label: "5xx", value: 0, tone: "danger" },
    { label: "Other", value: 0, tone: "" },
  ];
  for (const flow of flows || []) {
    const status = Number(flow.status || 0);
    if (status >= 200 && status < 300) buckets[0].value += 1;
    else if (status >= 300 && status < 400) buckets[1].value += 1;
    else if (status >= 400 && status < 500) buckets[2].value += 1;
    else if (status >= 500) buckets[3].value += 1;
    else buckets[4].value += 1;
  }
  return buckets.filter((bucket) => bucket.value > 0);
}

function methodBucketsFromFlows(flows) {
  const counts = new Map();
  for (const flow of flows || []) {
    const method = String(flow.method || "REQ").toUpperCase();
    counts.set(method, (counts.get(method) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, value]) => ({ label, value, tone: METHOD_CLASS[label] || "" }));
}


function statusCodeClass(status) {
  const code = Number(status || 0);
  if (code >= 200 && code < 300) return "ok";
  if (code >= 300 && code < 400) return "redirect";
  if (code >= 400) return "error";
  return "";
}

function timeOnly(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(11, 19) || String(value);
  return date.toLocaleTimeString([], { hour12: false });
}

function formatDuration(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}


function TrafficView({ refreshKey, refresh, setCurrent }) {
  const pageSize = 10;
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState("");
  const [search, setSearch] = useState("");
  const [live, setLive] = useState(false);
  const [flows, setFlows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [listError, setListError] = useState(null);
  const loadingRef = useRef(false);
  const requestRef = useRef(0);
  const searchRef = useRef(search);
  const selectedRef = useRef(selected);

  useEffect(() => { searchRef.current = search; }, [search]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const trafficPagePath = (offset) => {
    const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    if (search.trim()) params.set("q", search.trim());
    return `/api/traffic?${params.toString()}`;
  };

  const loadPage = async (offset, replace = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    const requestID = ++requestRef.current;
    if (replace) setLoading(true);
    else setLoadingMore(true);
    setListError(null);
    try {
      const next = await api(trafficPagePath(offset));
      if (requestID !== requestRef.current) return;
      setFlows((current) => replace ? next : [...current, ...next]);
      setHasMore(next.length === pageSize);
    } catch (error) {
      if (requestID === requestRef.current) setListError(error);
    } finally {
      if (requestID === requestRef.current) {
        setLoading(false);
        setLoaded(true);
        setLoadingMore(false);
        loadingRef.current = false;
      }
    }
  };

  useEffect(() => {
    requestRef.current += 1;
    loadingRef.current = false;
    setSelected("");
    setDetail(null);
    setHasMore(true);
    loadPage(0, true);
  }, [refreshKey, search]);

  useEffect(() => {
    if (!live) return undefined;
    const source = new EventSource(`/api/traffic/stream?token=${encodeURIComponent(getToken())}`);
    const trafficTopics = [
      "traffic.request.started",
      "traffic.response.completed",
      "traffic.tunnel.opened",
      "traffic.blocked",
      "traffic.body.captured",
    ];
    let cancelled = false;
    const handleLiveEvent = async (event) => {
      try {
        const payload = JSON.parse(event.data || "{}");
        const id = payload.request_id || payload.id;
        if (!id) return;
        const flow = await api(`/api/traffic/${encodeURIComponent(id)}`);
        if (cancelled || !flowMatchesSearch(flow, searchRef.current)) return;
        setFlows((current) => {
          const without = current.filter((item) => item.id !== flow.id);
          return [flow, ...without].slice(0, Math.max(pageSize, without.length + 1));
        });
        if (selectedRef.current === id) {
          setDetail(flow);
        }
        setHasMore(true);
      } catch {
        // Live updates are opportunistic; the paged list remains the source of truth.
      }
    };
    trafficTopics.forEach((topic) => source.addEventListener(topic, handleLiveEvent));
    source.onerror = () => {
      source.close();
      if (!cancelled) setLive(false);
    };
    return () => {
      cancelled = true;
      source.close();
    };
  }, [live]);

  useEffect(() => {
    if (!selected && flows.length) setSelected(flows[0].id);
  }, [flows, selected]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setDetailError("");
    const loadDetail = () => api(`/api/traffic/${encodeURIComponent(selected)}`)
      .then((flow) => {
        if (!cancelled) setDetail(flow);
        return flow;
      })
      .catch((err) => {
        if (!cancelled) setDetailError(err.message);
        return null;
      });
    loadDetail().then((flow) => {
      if (cancelled || flow?.request_body || flow?.response_body) return;
      const delays = [500, 1500, 3000];
      delays.forEach((delay) => {
        setTimeout(() => {
          if (!cancelled) loadDetail();
        }, delay);
      });
    });
    return () => { cancelled = true; };
  }, [selected, refreshKey]);

  const handleScroll = (event) => {
    const el = event.currentTarget;
    if (!hasMore || loading || loadingMore || listError) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 64) {
      loadPage(flows.length, false);
    }
  };

  if (!loaded && loading && !flows.length) return <PageState state={{ loading: true }} />;
  if (!loaded && listError && !flows.length) return <PageState state={{ error: listError }} />;
  return (
    <div className="workbench">
      <aside className="workbench-sidebar">
        <div className="workbench-head">
          <div>
            <h2>Traffic</h2>
            <p>捕获的请求与响应。</p>
          </div>
          <div className="actions">
            <button className={live ? "primary" : "secondary"} title={live ? "暂停实时更新" : "启用实时更新"} onClick={() => setLive((value) => !value)}>
              {live ? <Pause /> : <Play />}{live ? "暂停" : "实时"}
            </button>
            <button className="secondary" onClick={async () => { await del("/api/traffic"); setSelected(""); refresh(); }}><Trash2 />清空</button>
            <a className="secondary" download="traffic.json" href={`/api/traffic/export?token=${encodeURIComponent(getToken())}`}><FileJson />JSON</a>
            <a className="secondary" download="traffic.har" href={`/api/traffic/export?format=har&token=${encodeURIComponent(getToken())}`}><Download />HAR</a>
          </div>
          <div className="list-filter">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder='搜索：host:example.com method:POST status:>=400 header:auth body:"token"' />
          </div>
        </div>
        <div className="workbench-list" onScroll={handleScroll}>
          {flows.length ? flows.map((flow) => (
            <FlowRow key={flow.id} flow={flow} active={flow.id === selected} onSelect={() => setSelected(flow.id)} />
          )) : <EmptyList>尚未捕获流量。</EmptyList>}
          {loading && flows.length > 0 && <div className="list-status">筛选过滤中...</div>}
          {loadingMore && <div className="list-status">加载更多...</div>}
          {!hasMore && flows.length > 0 && <div className="list-status">已到流量末尾</div>}
          {listError && flows.length > 0 && <div className="list-status error">无法加载更多。</div>}
        </div>
      </aside>
      <section className="workbench-main">
        {detailError && <div className="detail-shell error">{detailError}</div>}
        {!detail && !detailError && <EmptyDetail title="请求详情" body="选择一条捕获的流量，查看请求头、参数与请求体。" />}
        {detail && <TrafficDetail flow={detail} setCurrent={setCurrent} refresh={refresh} />}
      </section>
    </div>
  );
}

function FlowRow({ flow, active, onSelect }) {
  const method = flow.method || "REQ";
  return (
    <button className={`list-row ${active ? "active" : ""}`} onClick={onSelect}>
      <div className="list-row-title">
        <MethodPill method={method} />
        <span>{flow.host || "(未知主机)"}</span>
        <ProxyUserBadge username={flow.proxy_user} />
      </div>
      <div className="list-row-meta">{flow.status ? `状态 ${flow.status}` : "等待中"} · {flow.duration_ms !== undefined ? `${flow.duration_ms} 毫秒` : "耗时未知"} · {flow.created_at || ""}</div>
      <div className="list-row-meta">{flow.url || flow.id}</div>
    </button>
  );
}

function TrafficDetail({ flow, setCurrent, refresh }) {
  const reqHeaders = (flow.headers || []).filter((h) => h.direction === "request");
  const respHeaders = (flow.headers || []).filter((h) => h.direction === "response");
  return (
    <div className="detail-shell">
      <div className="detail-topbar traffic-detail-head">
        <div className="detail-title">
          <div className="detail-heading-line">
            <h2>{flow.method || "请求"} {flow.host || hostFromURL(flow.url) || "详情"}</h2>
            <ProxyUserBadge username={flow.proxy_user} />
          </div>
          <div className="url-line" title={flow.url || ""}>{flow.url || ""}</div>
        </div>
        <div className="detail-actions">
          <a className="secondary" download={`traffic-${flow.id}.json`} href={`/api/traffic/${encodeURIComponent(flow.id)}/export?token=${encodeURIComponent(getToken())}`}><FileJson />JSON</a>
          <a className="secondary" download={`traffic-${flow.id}.har`} href={`/api/traffic/${encodeURIComponent(flow.id)}/export?format=har&token=${encodeURIComponent(getToken())}`}><Download />HAR</a>
        </div>
      </div>
      <div className="grid metrics-grid compact">
        <Metric label="方法" value={flow.method || ""} />
        <Metric label="状态" value={flow.status || ""} />
        <Metric label="耗时" value={`${flow.duration_ms || 0} ms`} />
        <Metric label="缓存" value={flow.cache_hit ? "命中" : "未命中"} />
        <Metric label="协议" value={flow.protocol || ""} />
        <Metric label="字节" value={flow.bytes || 0} />
      </div>
      <div className="split-grid">
        <CodeCard title="查询参数" value={flow.query_params || {}} />
        <CodeCard title="Cookie" value={flow.cookies || {}} />
      </div>
      <HeaderTable title="请求头" rows={reqHeaders} />
      <HeaderTable title="响应头" rows={respHeaders} />
      <div className="split-grid">
        <TextCard title="请求体示例" value={flow.request_body || ""} />
        <TextCard title="响应体示例" value={flow.response_body || ""} />
      </div>
    </div>
  );
}

function headerRecordValue(headers, name) {
  const target = String(name || "").toLowerCase();
  const found = (headers || []).find((header) => String(header.name || "").toLowerCase() === target);
  return found?.value || "";
}

function hostFromURL(rawURL) {
  try {
    return new URL(rawURL).host;
  } catch {
    return "";
  }
}

function CertificatesView({ refreshKey, refresh }) {
  const state = useAsync(() => api("/api/certificates/ca"), [refreshKey]);
  const [paths, setPaths] = useState({ cert_path: "", key_path: "" });
  const [search, setSearch] = useState("");
  const [leaf, setLeaf] = useState([]);
  const [leafTotal, setLeafTotal] = useState(0);
  const [leafHasMore, setLeafHasMore] = useState(false);
  const [leafLoading, setLeafLoading] = useState(true);
  const [leafLoadingMore, setLeafLoadingMore] = useState(false);
  const [leafError, setLeafError] = useState("");
  const leafRequestRef = useRef(0);
  const pageSize = 10;

  const leafPagePath = (offset, term = search) => {
    const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    if (term.trim()) params.set("q", term.trim());
    return `/api/certificates/leaf?${params.toString()}`;
  };

  const loadLeafPage = async (offset, replace = false, term = search) => {
    const requestID = ++leafRequestRef.current;
    replace ? setLeafLoading(true) : setLeafLoadingMore(true);
    setLeafError("");
    try {
      const page = await api(leafPagePath(offset, term));
      if (requestID !== leafRequestRef.current) return;
      const nextItems = page.items || [];
      setLeaf((current) => replace ? nextItems : [...current, ...nextItems]);
      setLeafTotal(page.total || 0);
      setLeafHasMore(Boolean(page.has_more));
    } catch (err) {
      if (requestID === leafRequestRef.current) setLeafError(err.message);
    } finally {
      if (requestID === leafRequestRef.current) {
        setLeafLoading(false);
        setLeafLoadingMore(false);
      }
    }
  };

  useEffect(() => {
    setLeaf([]);
    setLeafHasMore(false);
    loadLeafPage(0, true, search);
  }, [refreshKey, search]);

  if (state.loading || state.error) return <PageState state={state} />;
  const ca = state.data;
  return (
    <div className="page-stack">
      <PageTitle title="Certificates" subtitle="CA 信任材料与已生成的叶证书。" />
      <div className="grid metrics-grid"><Metric label="主题" value={ca.subject} /><Metric label="过期时间" value={ca.expires_at} /><Metric label="路径" value={ca.path} /></div>
      <div className="panel"><h2>指纹</h2><code>{ca.fingerprint}</code><div className="actions"><a className="primary" href={`/api/certificates/ca/download?token=${encodeURIComponent(getToken())}`}><Download />下载 CA</a><button className="secondary" onClick={async () => { await post("/api/certificates/ca/rotate"); refresh(); }}><RefreshCw />轮换 CA</button></div><div className="actions"><input placeholder="证书路径" value={paths.cert_path} onChange={(e) => setPaths({ ...paths, cert_path: e.target.value })} /><input placeholder="密钥路径" value={paths.key_path} onChange={(e) => setPaths({ ...paths, key_path: e.target.value })} /><button className="secondary" onClick={async () => { await postJSON("/api/certificates/ca/import", paths); refresh(); }}>导入 CA</button></div></div>
      <div className="panel"><h2>信任说明</h2><table><tbody><tr><td>Windows</td><td>导入到受信任的根证书颁发机构。</td></tr><tr><td>macOS</td><td>导入钥匙串访问并设为始终信任。</td></tr><tr><td>Linux</td><td>安装到系统 CA 存储或浏览器专用存储。</td></tr><tr><td>Firefox</td><td>在隐私与安全 → 证书 → 证书颁发机构中导入。</td></tr></tbody></table></div>
      <div className="panel"><div className="detail-topbar"><div><h2>叶证书</h2><p className="muted">显示 {leafTotal} 条匹配证书中的 {leaf.length} 条。</p></div><div className="list-filter"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索主机、主题、指纹..." /></div></div>{leafError && <p className="error-text">{leafError}</p>}<table><thead><tr><th>Host</th><th>Subject</th><th>Expires</th><th>Fingerprint</th></tr></thead><tbody>{leaf.length ? leaf.map((cert) => <tr key={cert.id || cert.host}><td>{cert.host}</td><td>{cert.subject}</td><td>{cert.expires_at}</td><td><code>{cert.fingerprint}</code></td></tr>) : <tr><td colSpan="4">{leafLoading ? "正在加载证书..." : "未找到叶证书。"}</td></tr>}</tbody></table><div className="list-status">{leafLoading && leaf.length > 0 ? "刷新中..." : leafLoadingMore ? "加载更多..." : leafHasMore ? <button className="secondary" onClick={() => loadLeafPage(leaf.length)}>再加载 10 条</button> : leaf.length ? "已到证书末尾。" : ""}</div></div>
    </div>
  );
}

function AccessControlView({ refreshKey, refresh }) {
  const state = useAsync(async () => {
    const [users, rules] = await Promise.all([api("/api/proxy-auth/users"), api("/api/proxy-acl/rules")]);
    return { users, rules };
  }, [refreshKey]);
  const [userForm, setUserForm] = useState({ username: "", password: "", role: "guest", enabled: true });
  const emptyRule = { priority: 100, enabled: true, action: "deny", name: "", description: "", users: [], roles: [], source_ips: [], host_patterns: [], port_patterns: [], method_patterns: [] };
  const [ruleForm, setRuleForm] = useState(emptyRule);
  const [selectedRuleID, setSelectedRuleID] = useState("");
  const [passwords, setPasswords] = useState({});
  const [testForm, setTestForm] = useState({ username: "", remote_ip: "127.0.0.1", method: "GET", url: "https://example.com/" });
  const [testResult, setTestResult] = useState(null);
  useEffect(() => {
    const rule = (state.data?.rules || []).find((item) => item.id === selectedRuleID);
    if (rule) setRuleForm(rule);
  }, [selectedRuleID, state.data]);
  if (state.loading || state.error) return <PageState state={state} />;
  const { users, rules } = state.data;
  const saveRule = async () => {
    if (selectedRuleID) await putJSON(`/api/proxy-acl/rules/${encodeURIComponent(selectedRuleID)}`, ruleForm);
    else {
      const created = await postJSON("/api/proxy-acl/rules", ruleForm);
      setSelectedRuleID(created.id);
    }
    refresh();
  };
  return <div className="page-stack">
    <PageTitle title="Access Control" subtitle="代理用户、认证与有序的允许/拒绝规则。" />
    <div className="split-grid">
      <div className="panel">
        <h2>代理用户</h2>
        <div className="settings-grid">
          <label>用户名<input value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} /></label>
          <label>密码<input type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} /></label>
          <label>角色<select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}><option value="guest">guest</option><option value="admin">admin</option></select></label>
          <label><input type="checkbox" checked={userForm.enabled} onChange={(e) => setUserForm({ ...userForm, enabled: e.target.checked })} /> 启用</label>
        </div>
        <button className="secondary" onClick={async () => { await postJSON("/api/proxy-auth/users", userForm); setUserForm({ username: "", password: "", role: "guest", enabled: true }); refresh(); }}><Plus />添加用户</button>
        <table><thead><tr><th>用户</th><th>角色</th><th>启用</th><th>上次使用</th><th>重置</th><th /></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td>{user.username}</td><td>{user.role || "guest"}</td><td><input type="checkbox" checked={!!user.enabled} onChange={async (e) => { await putJSON(`/api/proxy-auth/users/${user.id}`, { username: user.username, enabled: e.target.checked }); refresh(); }} /></td><td>{user.last_used_at || ""}</td><td><input type="password" className="compact-input" value={passwords[user.id] || ""} onChange={(e) => setPasswords({ ...passwords, [user.id]: e.target.value })} placeholder="新密码" /></td><td><button className="rowbutton" onClick={async () => { await postJSON(`/api/proxy-auth/users/${user.id}/reset-password`, { password: passwords[user.id] || "" }); setPasswords({ ...passwords, [user.id]: "" }); refresh(); }}>重置</button> <button className="rowbutton" onClick={async () => { await del(`/api/proxy-auth/users/${user.id}`); refresh(); }}>删除</button></td></tr>)}</tbody></table>
      </div>
      <div className="panel">
        <h2>ACL 测试</h2>
        <div className="settings-grid">
          <label>用户<input value={testForm.username} onChange={(e) => setTestForm({ ...testForm, username: e.target.value })} /></label>
          <label>来源 IP<input value={testForm.remote_ip} onChange={(e) => setTestForm({ ...testForm, remote_ip: e.target.value })} /></label>
          <label>方法<input value={testForm.method} onChange={(e) => setTestForm({ ...testForm, method: e.target.value })} /></label>
          <label>URL<input value={testForm.url} onChange={(e) => setTestForm({ ...testForm, url: e.target.value })} /></label>
        </div>
        <button className="secondary" onClick={async () => setTestResult(await postJSON("/api/proxy-acl/test", testForm))}>测试规则</button>
        {testResult && <CodeCard title="ACL 测试结果" value={testResult} />}
      </div>
    </div>
    <div className="workbench">
      <aside className="workbench-sidebar">
        <div className="workbench-head"><div><h2>ACL 规则</h2><p>按优先级匹配第一个启用的规则。</p></div><button className="secondary" onClick={() => { setSelectedRuleID(""); setRuleForm(emptyRule); }}><Plus />新建</button></div>
        <div className="workbench-list">{rules.length ? rules.map((rule) => <button key={rule.id} className={`list-row ${rule.id === selectedRuleID ? "active" : ""}`} onClick={() => setSelectedRuleID(rule.id)}><div className="list-row-title"><span className={`badge ${rule.action === "allow" ? "allow" : "block"}`}>{rule.action}</span><span>{rule.name}</span></div><div className="list-row-meta">优先级 {rule.priority} - {rule.enabled ? "启用" : "禁用"}</div></button>) : <EmptyList>暂无 ACL 规则。</EmptyList>}</div>
      </aside>
      <section className="workbench-main">
        <div className="detail-shell">
          <div className="detail-topbar"><div className="detail-title"><h2>{selectedRuleID ? "编辑 ACL 规则" : "新建 ACL 规则"}</h2></div><div className="detail-actions"><button className="primary" onClick={saveRule}><Save />保存</button>{selectedRuleID && <button className="secondary danger-button" onClick={async () => { await del(`/api/proxy-acl/rules/${selectedRuleID}`); setSelectedRuleID(""); setRuleForm(emptyRule); refresh(); }}><Trash2 />删除</button>}</div></div>
          <div className="settings-grid">
            <label>名称<input value={ruleForm.name || ""} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} /></label>
            <label>优先级<input type="number" value={ruleForm.priority || 100} onChange={(e) => setRuleForm({ ...ruleForm, priority: Number(e.target.value) })} /></label>
            <label>动作<select value={ruleForm.action || "deny"} onChange={(e) => setRuleForm({ ...ruleForm, action: e.target.value })}><option value="allow">允许</option><option value="deny">拒绝</option></select></label>
            <label><input type="checkbox" checked={ruleForm.enabled !== false} onChange={(e) => setRuleForm({ ...ruleForm, enabled: e.target.checked })} /> 启用</label>
          </div>
          <label className="stacked-label">描述<textarea value={ruleForm.description || ""} onChange={(e) => setRuleForm({ ...ruleForm, description: e.target.value })} /></label>
          <div className="split-grid">
            <PatternEditor title="用户" placeholder={"alice\nbob"} values={ruleForm.users || []} onChange={(values) => setRuleForm({ ...ruleForm, users: values })} />
            <PatternEditor title="角色" placeholder={"admin\nguest"} values={ruleForm.roles || []} onChange={(values) => setRuleForm({ ...ruleForm, roles: values })} />
            <PatternEditor title="来源 IP" placeholder={"127.0.0.1\n10.0.0.0/8"} values={ruleForm.source_ips || []} onChange={(values) => setRuleForm({ ...ruleForm, source_ips: values })} />
            <PatternEditor title="主机" placeholder={"example.com\n*.example.com"} values={ruleForm.host_patterns || []} onChange={(values) => setRuleForm({ ...ruleForm, host_patterns: values })} />
            <PatternEditor title="端口" placeholder={"443\n8000-8999"} values={ruleForm.port_patterns || []} onChange={(values) => setRuleForm({ ...ruleForm, port_patterns: values })} />
            <PatternEditor title="方法" placeholder={"GET\nPOST"} values={ruleForm.method_patterns || []} onChange={(values) => setRuleForm({ ...ruleForm, method_patterns: values })} />
          </div>
        </div>
      </section>
    </div>
  </div>;
}

function BlocksView({ refreshKey, refresh }) {
  const state = useAsync(async () => {
    const [ports, domains, ips] = await Promise.all([api("/api/blocks/ports"), api("/api/blocks/domains"), api("/api/blocks/ips")]);
    return { ports, domains, ips };
  }, [refreshKey]);
  const [form, setForm] = useState({ port: "", domain: "", ip: "", host: "", testPort: "", testIP: "" });
  const [testResult, setTestResult] = useState({});
  if (state.loading || state.error) return <PageState state={state} />;
  const { ports, domains, ips } = state.data;
  return (
    <div className="page-stack">
      <PageTitle title="Blocks" subtitle="本地拒绝规则与匹配器验证。" />
      <div className="grid metrics-grid"><Metric label="端口" value={ports.length} /><Metric label="域名" value={domains.length} /><Metric label="IP" value={ips.length} /></div>
      <BlockPanel title="端口" value={form.port} placeholder="25" setValue={(port) => setForm({ ...form, port })} add={async () => { await postJSON("/api/blocks/ports", { port: Number(form.port) }); refresh(); }} rows={ports.map((p) => [p, () => del(`/api/blocks/ports/${p}`).then(refresh)])} />
      <BlockPanel title="域名" value={form.domain} placeholder="*.tracking.example" setValue={(domain) => setForm({ ...form, domain })} add={async () => { await postJSON("/api/blocks/domains", { pattern: form.domain }); refresh(); }} rows={domains.map((d) => [d, () => del(`/api/blocks/domains/${encodeURIComponent(d)}`).then(refresh)])} />
      <BlockPanel title="IP" value={form.ip} placeholder="203.0.113.0/24" setValue={(ip) => setForm({ ...form, ip })} add={async () => { await postJSON("/api/blocks/ips", { pattern: form.ip }); refresh(); }} rows={ips.map((ip) => [ip, () => del(`/api/blocks/ips/${encodeURIComponent(ip)}`).then(refresh)])} />
      <div className="panel"><h2>匹配器测试</h2><div className="actions"><input placeholder="主机" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} /><input type="number" placeholder="443" value={form.testPort} onChange={(e) => setForm({ ...form, testPort: e.target.value })} /><input placeholder="IP" value={form.testIP} onChange={(e) => setForm({ ...form, testIP: e.target.value })} /><button className="secondary" onClick={async () => setTestResult(await postJSON("/api/blocks/test", { host: form.host, port: Number(form.testPort), ip: form.testIP }))}>测试</button></div><pre>{JSON.stringify(testResult, null, 2)}</pre></div>
    </div>
  );
}

function BlockPanel({ title, value, placeholder, setValue, add, rows }) {
  return <div className="panel"><h2>{title}</h2><div className="actions"><input value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} /><button className="secondary" onClick={add}><Plus />添加</button></div><table><tbody>{rows.map(([label, remove]) => <tr key={label}><td>{label}</td><td><button className="rowbutton" onClick={remove}>删除</button></td></tr>)}</tbody></table></div>;
}

function DeploymentsView({ refreshKey, refresh }) {
  const state = useAsync(async () => {
    const [deployment, logs] = await Promise.all([api("/api/deployments/current"), api("/api/logs")]);
    return { deployment, logs };
  }, [refreshKey]);
  const [restartState, setRestartState] = useState({ status: "idle", message: "" });
  if (state.loading || state.error) return <PageState state={state} />;
  const { deployment, logs } = state.data;
  const restarting = restartState.status === "pending";
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const restart = async () => {
    const previousStarted = deployment.started_at || "";
    setRestartState({ status: "pending", message: "已请求重启，等待进程恢复..." });
    try {
      await post("/api/deployments/current/restart");
    } catch (error) {
      setRestartState({ status: "error", message: `重启请求失败：${error.message}` });
      return;
    }
    const deadline = Date.now() + 30000;
    let sawUnavailable = false;
    while (Date.now() < deadline) {
      await delay(900);
      try {
        const next = await api(`/api/deployments/current?restart_poll=${Date.now()}`);
        if (next.started_at && next.started_at !== previousStarted) {
          setRestartState({ status: "success", message: "重启完成，新进程已响应。" });
          refresh();
          return;
        }
        setRestartState({ status: "pending", message: sawUnavailable ? "进程已重新响应，等待新的启动时间..." : "已接受重启，等待旧进程交接..." });
      } catch {
        sawUnavailable = true;
        setRestartState({ status: "pending", message: "重启期间进程暂时不可用..." });
      }
    }
    setRestartState({ status: "error", message: "重启状态超时，请刷新页面确认进程是否已恢复。" });
  };
  return <div className="page-stack"><PageTitle title="Deployments" subtitle="运行时控制、配置档与最近日志输出。" /><div className="grid metrics-grid"><Metric label="状态" value={deployment.status} /><Metric label="监听地址" value={deployment.listen_addr} /><Metric label="MITM" value={deployment.mitm_enabled ? "启用" : "禁用"} /><Metric label="配置" value={deployment.config_path || "defaults"} /></div><div className="panel"><h2>控制</h2><div className="actions"><button className="secondary" disabled={restarting} onClick={async () => { await post("/api/deployments/current/reload"); refresh(); }}><RefreshCw />重新加载配置</button><button className="secondary" disabled={restarting} onClick={restart}><RefreshCw />{restarting ? "重启中..." : "重启"}</button></div>{restartState.message && <div className={`restart-feedback ${restartState.status}`}>{restartState.message}</div>}</div><TextCard title="日志" value={(logs || []).join("\n")} /><div className="panel"><h2>配置档</h2><table><thead><tr><th>名称</th><th>类型</th><th>描述</th></tr></thead><tbody>{(deployment.profiles || []).map((p) => <tr key={p.name}><td>{p.name}</td><td>{p.kind}</td><td>{p.description}</td></tr>)}</tbody></table></div></div>;
}

function CacheView({ refreshKey, refresh }) {
  const [domain, setDomain] = useState("");
  const [search, setSearch] = useState("");
  const [cache, setCache] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [itemsTotal, setItemsTotal] = useState(0);
  const requestRef = useRef(0);
  const pageSize = 10;

  const cachePagePath = (offset, term = search) => {
    const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    if (term.trim()) params.set("q", term.trim());
    return `/api/cache?${params.toString()}`;
  };

  const loadCachePage = async (offset, replace = false, term = search) => {
    const requestID = ++requestRef.current;
    replace ? setLoading(true) : setLoadingMore(true);
    setError("");
    try {
      const page = await api(cachePagePath(offset, term));
      if (requestID !== requestRef.current) return;
      setCache(page);
      setItems((current) => replace ? (page.items || []) : [...current, ...(page.items || [])]);
      setHasMore(Boolean(page.has_more));
      setItemsTotal(page.items_total || 0);
    } catch (err) {
      if (requestID === requestRef.current) setError(err.message);
    } finally {
      if (requestID === requestRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  useEffect(() => {
    setHasMore(false);
    setItems([]);
    loadCachePage(0, true, search);
  }, [refreshKey, search]);

  if (!cache && loading) return <PageState state={{ loading: true }} />;
  if (!cache && error) return <PageState state={{ error }} />;

  return <div className="page-stack"><PageTitle title="Cache" subtitle="HTTP 响应缓存清单与清理控制。" /><div className="grid metrics-grid"><Metric label="启用" value={cache.enabled ? "是" : "否"} /><Metric label="存储" value={cache.directory} /><Metric label="TTL" value={`${cache.ttl}s`} /><Metric label="条目数" value={cache.entries} /><Metric label="命中率" value={`${cache.hits || 0}/${(cache.hits || 0) + (cache.misses || 0)}`} /><Metric label="大小" value={`${cache.size} 字节`} /></div><div className="panel"><h2>清理</h2><div className="actions"><input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="可选域名" /><button className="secondary" onClick={async () => { await postJSON("/api/cache/purge", { domain }); setDomain(""); refresh(); }}>清理</button></div></div><div className="panel"><div className="detail-topbar"><div><h2>缓存条目</h2><p className="muted">显示 {itemsTotal} 条匹配条目中的 {items.length} 条。</p></div><div className="list-filter"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索 URL、键、状态、大小..." /></div></div>{error && <p className="error-text">{error}</p>}<table><thead><tr><th>URL</th><th>Status</th><th>Expires</th><th>Size</th><th>命中</th></tr></thead><tbody>{items.length ? items.map((i) => <tr key={i.key || i.url}><td><a className="cache-link" href={authenticatedHref(i.view_url || `/api/cache/resource?key=${encodeURIComponent(i.key || "")}`)} target="_blank" rel="noreferrer">{i.url || i.key}</a></td><td>{i.status}</td><td>{i.expires_at}</td><td>{i.size || 0}</td><td>{i.hits || 0}</td></tr>) : <tr><td colSpan="5">{loading ? "正在加载缓存条目..." : "未找到缓存条目。"}</td></tr>}</tbody></table><div className="list-status">{loading && items.length > 0 ? "刷新中..." : loadingMore ? "加载更多..." : hasMore ? <button className="secondary" onClick={() => loadCachePage(items.length)}>再加载 10 条</button> : items.length ? "已到缓存条目末尾。" : ""}</div></div></div>;
}

function PatternEditor({ title, placeholder, values, onChange }) {
  const serializedValues = (values || []).join("\n");
  const [text, setText] = useState(serializedValues);

  useEffect(() => {
    setText(serializedValues);
  }, [serializedValues]);

  return (
    <div className="section-card">
      <h3>{title}</h3>
      <textarea
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          onChange(next.split("\n").map((value) => value.trim()).filter(Boolean));
        }}
      />
    </div>
  );
}

function SettingsView({ refreshKey, refresh }) {
  const state = useAsync(() => api("/api/settings"), [refreshKey]);
  const [form, setForm] = useState(null);
  const [saveError, setSaveError] = useState("");
  useEffect(() => { if (state.data) setForm(state.data); }, [state.data]);
  if (state.loading || state.error || !form) return <PageState state={state} />;
  const capture = form.traffic_capture || {};
  const proxyAuth = form.proxy_auth || {};
  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
  const setCapture = (patch) => set({ traffic_capture: { ...capture, ...patch } });
  const setProxyAuth = (patch) => set({ proxy_auth: { ...proxyAuth, ...patch } });
  const danger = async (action, message) => {
    if (!confirm(message)) return;
    await postJSON("/api/settings/danger", { action, confirm: true });
    refresh();
  };
  return (
    <div className="page-stack">
      <PageTitle title="Settings" subtitle="运行时行为与捕获策略。" />
      <div className="panel">
        <div className="detail-topbar">
          <h2>设置</h2>
          <button className="primary" onClick={async () => { setSaveError(""); try { await putJSON("/api/settings", form); refresh(); } catch (err) { setSaveError(err.message); } }}><Save />保存</button>
        </div>
        {saveError && <p className="error-text">{saveError}</p>}
        <h3>运行时</h3>
        <div className="settings-grid">
          <label><input type="checkbox" checked={!!form.enable_mitm} onChange={(e) => set({ enable_mitm: e.target.checked })} /> 启用 MITM</label>
          <label><input type="checkbox" checked={!!form.verbose_logging} onChange={(e) => set({ verbose_logging: e.target.checked })} /> 详细日志</label>
          <label><input type="checkbox" checked={!!form.log_requests} onChange={(e) => set({ log_requests: e.target.checked })} /> 请求日志</label>
          <label>最低 TLS 版本<input value={form.min_tls_version || ""} onChange={(e) => set({ min_tls_version: e.target.value })} /></label>
          <label>空闲超时<input type="number" value={form.idle_timeout_seconds || 0} onChange={(e) => set({ idle_timeout_seconds: Number(e.target.value) })} /></label>
        </div>
        <h3>流量捕获</h3>
        <div className="settings-grid">
          <label><input type="checkbox" checked={!!capture.store_bodies} onChange={(e) => setCapture({ store_bodies: e.target.checked })} /> 保存请求体示例</label>
          <label><input type="checkbox" checked={capture.redact_bodies !== false} onChange={(e) => setCapture({ redact_bodies: e.target.checked })} /> 请求体脱敏</label>
          <label><input type="checkbox" checked={capture.store_headers !== false} onChange={(e) => setCapture({ store_headers: e.target.checked })} /> 保存请求头</label>
          <label><input type="checkbox" checked={capture.store_cookies !== false} onChange={(e) => setCapture({ store_cookies: e.target.checked })} /> 保存 Cookie</label>
          <label>最大请求体字节数<input type="number" value={capture.max_body_bytes || 32768} onChange={(e) => setCapture({ max_body_bytes: Number(e.target.value) })} /></label>
        </div>
        <div className="split-grid">
          <PatternEditor title="脱敏请求头" placeholder={"Authorization\nCookie\nSet-Cookie\nX-Api-Key"} values={capture.redacted_headers || []} onChange={(values) => setCapture({ redacted_headers: values })} />
          <PatternEditor title="脱敏 Cookie" placeholder={"session\ncsrf_token"} values={capture.redacted_cookies || []} onChange={(values) => setCapture({ redacted_cookies: values })} />
        </div>
        <h3>代理认证</h3>
        <div className="settings-grid">
          <label><input type="checkbox" checked={!!proxyAuth.enabled} onChange={(e) => setProxyAuth({ enabled: e.target.checked, default_action: e.target.checked ? "deny" : (proxyAuth.default_action || "allow") })} /> 要求代理认证</label>
          <label>领域<input value={proxyAuth.realm || "MITM Proxy"} onChange={(e) => setProxyAuth({ realm: e.target.value })} /></label>
          <label>默认动作<select value={proxyAuth.default_action || "allow"} onChange={(e) => setProxyAuth({ default_action: e.target.value })}><option value="allow">允许</option><option value="deny">拒绝</option></select></label>
          <label><input type="checkbox" checked={!!proxyAuth.require_auth_for_loopback} onChange={(e) => setProxyAuth({ require_auth_for_loopback: e.target.checked })} /> 要求回环客户端认证</label>
        </div>
        <p className="muted">在“访问控制”中管理代理用户与有序 ACL 规则；密码存储前会进行哈希处理。</p>
        <h3>排除域名</h3>
        <textarea value={(form.excluded_domains || []).join("\n")} onChange={(e) => set({ excluded_domains: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} />
        <CodeCard title="缓存" value={form.cache || {}} />
      </div>
      <div className="panel danger-zone">
        <div className="detail-topbar"><div><h2>危险操作</h2><p className="muted">破坏性维护操作，每项操作都需要确认。</p></div></div>
        <div className="actions">
          <button className="secondary danger-button" onClick={() => danger("all", "确定清除所有已存储的面板数据、缓存、代理用户与 ACL 规则？此操作不可撤销。")}><Trash2 />清除全部数据</button>
          <button className="secondary danger-button" onClick={() => danger("except_cache", "确定清除除缓存外的所有已存储面板数据？此操作不可撤销。")}><Trash2 />清除除缓存外的全部数据</button>
          <button className="secondary danger-button" onClick={() => danger("cache", "确定清除所有缓存响应？此操作不可撤销。")}><Trash2 />清除缓存</button>
        </div>
      </div>
    </div>
  );
}

function AuditLogView({ refreshKey }) {
  const state = useAsync(() => api("/api/audit"), [refreshKey]);
  if (state.loading || state.error) return <PageState state={state} />;
  return <div className="page-stack"><PageTitle title="Audit Log" subtitle="管理操作与系统事件。" /><div className="panel"><table><thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>详情</th></tr></thead><tbody>{state.data.map((e) => <tr key={`${e.created_at}-${e.action}`}><td>{e.created_at}</td><td>{e.actor}</td><td>{e.action}</td><td><code>{e.details ? JSON.stringify(e.details) : ""}</code></td></tr>)}</tbody></table></div></div>;
}

function PageTitle({ title, subtitle, actions }) {
  return <div className="page-title"><div><h1>{NAV_LABELS[title] || title}</h1><p>{subtitle}</p></div>{actions && <div className="page-actions">{actions}</div>}</div>;
}

function Metric({ label, value, tone, hint }) {
  return <div className={`metric ${tone ? `metric-${tone}` : ""}`}><span>{label}</span><strong>{value}{hint && <> <small>{hint}</small></>}</strong></div>;
}

function MethodPill({ method }) {
  const upper = String(method || "").toUpperCase();
  return <span className={`method-pill ${METHOD_CLASS[upper] || ""}`}>{upper}</span>;
}

function ProxyUserBadge({ username }) {
  if (!username) return null;
  return <span className="scope-badge user">{username}</span>;
}

function EmptyList({ children }) {
  return <div className="empty-list">{children}</div>;
}

function EmptyDetail({ title, body }) {
  return <div className="detail-shell"><h2>{title}</h2><p className="muted">{body}</p></div>;
}

function HeaderTable({ title, rows }) {
  return <div className="section-card"><h3>{title}</h3><table className="kv-table"><tbody>{rows.length ? rows.map((h, idx) => <tr key={`${h.name}-${idx}`}><td>{h.name}</td><td><code>{h.value}</code></td></tr>) : <tr><td colSpan="2">未捕获到头部。</td></tr>}</tbody></table></div>;
}

function CodeCard({ title, value }) {
  return <div className="section-card"><h3>{title}</h3><pre>{JSON.stringify(value, null, 2)}</pre></div>;
}

function JsonEditor({ title, value, onChange, minHeight = 220 }) {
  const [error, setError] = useState("");
  const textareaRef = useRef(null);
  const lines = String(value || "").split("\n").length;
  const lineNumbers = Array.from({ length: Math.max(lines, 1) }, (_, index) => index + 1).join("\n");
  const update = (next) => {
    onChange(next);
    try {
      parseJSONEditorValue(next, {});
      setError("");
    } catch (err) {
      setError(err.message);
    }
  };
  const setValueAndSelection = (next, start, end = start) => {
    update(next);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.selectionStart = start;
      textarea.selectionEnd = end;
    });
  };
  const insertAroundSelection = (open, close = open) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const text = String(value || "");
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = text.slice(start, end);
    if (!selected && text[start] === close) {
      textarea.selectionStart = start + 1;
      textarea.selectionEnd = start + 1;
      return;
    }
    const next = text.slice(0, start) + open + selected + close + text.slice(end);
    if (selected) setValueAndSelection(next, start + 1, end + 1);
    else setValueAndSelection(next, start + 1);
  };
  const handleKeyDown = (event) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const text = String(value || "");
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (event.key === "Tab") {
      event.preventDefault();
      const lineStart = text.lastIndexOf("\n", start - 1) + 1;
      const selectionEndLineBreak = text.indexOf("\n", end);
      const blockEnd = selectionEndLineBreak === -1 ? text.length : selectionEndLineBreak;
      const hasMultiLineSelection = text.slice(start, end).includes("\n");
      if (!hasMultiLineSelection) {
        if (event.shiftKey) {
          if (text.slice(lineStart, lineStart + 2) === "  ") {
            setValueAndSelection(text.slice(0, lineStart) + text.slice(lineStart + 2), Math.max(lineStart, start - 2), Math.max(lineStart, end - 2));
          }
          return;
        }
        setValueAndSelection(text.slice(0, start) + "  " + text.slice(end), start + 2);
        return;
      }
      const before = text.slice(0, lineStart);
      const block = text.slice(lineStart, blockEnd);
      const after = text.slice(blockEnd);
      const linesInBlock = block.split("\n");
      let deltaStart = 0;
      let deltaEnd = 0;
      const nextLines = linesInBlock.map((line, index) => {
        if (event.shiftKey) {
          if (line.startsWith("  ")) {
            if (index === 0 && start >= lineStart + 2) deltaStart -= 2;
            deltaEnd -= 2;
            return line.slice(2);
          }
          return line;
        }
        if (index === 0) deltaStart += 2;
        deltaEnd += 2;
        return "  " + line;
      });
      setValueAndSelection(before + nextLines.join("\n") + after, start + deltaStart, end + deltaEnd);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const lineStart = text.lastIndexOf("\n", start - 1) + 1;
      const currentLine = text.slice(lineStart, start);
      const baseIndent = currentLine.match(/^\s*/)?.[0] || "";
      const extraIndent = /[\{\[]\s*$/.test(currentLine) ? "  " : "";
      const nextChar = text[end] || "";
      if ((nextChar === "}" || nextChar === "]") && extraIndent) {
        const insert = "\n" + baseIndent + extraIndent + "\n" + baseIndent;
        setValueAndSelection(text.slice(0, start) + insert + text.slice(end), start + baseIndent.length + extraIndent.length + 1);
        return;
      }
      const insert = "\n" + baseIndent + extraIndent;
      setValueAndSelection(text.slice(0, start) + insert + text.slice(end), start + insert.length);
      return;
    }
    if ((event.key === "\"" || event.key === "'") && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      insertAroundSelection("\"", "\"");
      return;
    }
    const pairs = { "{": "}", "[": "]", "(": ")" };
    if (pairs[event.key] && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      insertAroundSelection(event.key, pairs[event.key]);
      return;
    }
    if ((event.key === "}" || event.key === "]" || event.key === ")") && text[start] === event.key && start === end) {
      event.preventDefault();
      textarea.selectionStart = start + 1;
      textarea.selectionEnd = start + 1;
      return;
    }
    if (event.key === "Backspace" && start === end && start > 0) {
      const prev = text[start - 1];
      const next = text[start];
      if ((prev === "\"" && next === "\"") || (prev === "{" && next === "}") || (prev === "[" && next === "]") || (prev === "(" && next === ")")) {
        event.preventDefault();
        setValueAndSelection(text.slice(0, start - 1) + text.slice(start + 1), start - 1);
      }
    }
  };
  const format = () => {
    try {
      const parsed = parseJSONEditorValue(value, {});
      const next = JSON.stringify(parsed, null, 2);
      onChange(next);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  };
  const compact = () => {
    try {
      const parsed = parseJSONEditorValue(value, {});
      const next = JSON.stringify(parsed);
      onChange(next);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <div className="section-card json-editor-card">
      <div className="json-editor-head">
        <h3>{title}</h3>
        <div className="actions">
          <button className="rowbutton" type="button" onClick={format}>格式化</button>
          <button className="rowbutton" type="button" onClick={compact}>压缩</button>
        </div>
      </div>
      <div className={`json-editor ${error ? "invalid" : ""}`} style={{ minHeight }}>
        <pre className="json-editor-lines" aria-hidden="true">{lineNumbers}</pre>
        <textarea
          ref={textareaRef}
          spellCheck="false"
          value={value || ""}
          onChange={(e) => update(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{ minHeight }}
        />
      </div>
      <div className={`json-editor-status ${error ? "error-text" : "muted"}`}>{error || "JSON 格式正确"}</div>
    </div>
  );
}

function TextCard({ title, value, onChange }) {
  if (onChange) {
    return <div className="section-card"><h3>{title}</h3><textarea value={value || ""} onChange={(e) => onChange(e.target.value)} /></div>;
  }
  return <div className="section-card"><h3>{title}</h3>{value ? <pre>{value}</pre> : <div className="empty-sample">未捕获请求体示例。</div>}</div>;
}

createRoot(document.getElementById("root")).render(<App />);
