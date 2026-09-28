// Tauron eLicznik card — Chart API history + current-day meter reading
class TauronEnergyCard extends HTMLElement {
  static getStubConfig() {
    return {
      consumed_entity: "sensor.serwerownia_tauron_elicznik_energia_pobrana",
      exported_entity: "sensor.serwerownia_tauron_elicznik_energia_oddana",
      daily_consumed_entity: "sensor.serwerownia_tauron_elicznik_dzienne_zuzycie_energii_chart_api",
      daily_exported_entity: "sensor.serwerownia_tauron_elicznik_dzienne_oddanie_energii_chart_api",
      daily_average_entity: "sensor.serwerownia_tauron_elicznik_srednie_zuzycie_dzienne",
      balance_entity: "sensor.serwerownia_tauron_elicznik_bilans_energii",
      daily_budget_entity: "sensor.serwerownia_tauron_elicznik_dzienny_budzet_energii",
      monthly_budget_entity: "sensor.serwerownia_tauron_elicznik_miesieczny_budzet_energii",
      days_entity: "sensor.serwerownia_tauron_elicznik_dni_do_rozliczenia",
      billing_start_consumed_entity: "sensor.serwerownia_tauron_elicznik_energia_pobrana_na_poczatku_okresu",
      billing_start_exported_entity: "sensor.serwerownia_tauron_elicznik_energia_oddana_na_poczatku_okresu",
      last_reading_entity: "sensor.serwerownia_tauron_elicznik_data_ostatniego_odczytu",
      last_fetch_entity: "sensor.serwerownia_tauron_elicznik_ostatnie_pobranie_danych",
      refresh_entity: "button.tauron_elicznik_odswiez_dane",
      title: "Energia",
      days_history: 14
    };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = null;
    this._history = [];
    this._loading = false;
    this._timer = null;
  }

  setConfig(config) {
    this._config = { ...TauronEnergyCard.getStubConfig(), ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
    this._scheduleHistoryRefresh();
  }

  connectedCallback() {
    this._scheduleHistoryRefresh();
  }

  disconnectedCallback() {
    if (this._timer) clearTimeout(this._timer);
  }

  _scheduleHistoryRefresh() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this._loadHistory(), 250);
  }

  _state(entity) {
    return entity && this._hass?.states?.[entity];
  }

  _num(entity, fallback = 0) {
    const n = Number(this._state(entity)?.state);
    return Number.isFinite(n) ? n : fallback;
  }

  _fmt(value, decimals = 2) {
    if (!Number.isFinite(value)) return "—";
    return new Intl.NumberFormat("pl-PL", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(value);
  }

  _escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  _date(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("pl-PL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(d);
  }

  _relative(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    const minutes = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
    if (minutes < 1) return "przed chwilą";
    if (minutes < 60) return `${minutes} min temu`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} godz. temu`;
    return `${Math.round(hours / 24)} dni temu`;
  }

  _historyPoints(entityId) {
    return (this._history || [])
      .flatMap(group => Array.isArray(group) ? group : (group.states || []))
      .filter(x => x.entity_id === entityId)
      .map(x => ({
        t: new Date(x.last_changed || x.last_updated).getTime(),
        v: Number(x.state)
      }))
      .filter(x => Number.isFinite(x.t) && Number.isFinite(x.v))
      .sort((a, b) => a.t - b.t);
  }

  async _loadHistory() {
    if (!this._hass || !this._config.consumed_entity) return;

    const end = new Date();
    const start = new Date(
      end.getTime() - Number(this._config.days_history || 14) * 86400000
    );

    try {
      const result = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entity_ids: [
          this._config.consumed_entity,
          this._config.exported_entity
        ],
        minimal_response: false,
        no_attributes: true,
        significant_changes_only: false
      });

      this._history = Object.entries(result || {}).flatMap(
        ([entity_id, states]) =>
          (Array.isArray(states) ? states : []).map(state => ({
            entity_id,
            ...state
          }))
      );

      this._render();
    } catch (err) {
      console.warn("Tauron Energy Card: history unavailable", err);
      this._history = [];
      this._render();
    }
  }

  _dailySeries(entityId) {
    const source = this._historyPoints(entityId);
    const days = [];
    const now = new Date();

    for (let i = Number(this._config.days_history || 14) - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);

      const beforeStart = source.filter(p => p.t < d.getTime()).pop();
      const beforeEnd = source.filter(p => p.t < next.getTime()).pop();

      let delta = 0;
      if (beforeStart && beforeEnd) {
        delta = beforeEnd.v - beforeStart.v;
      } else if (beforeEnd) {
        const first = source.find(p => p.t >= d.getTime() && p.t < next.getTime());
        delta = first ? beforeEnd.v - first.v : 0;
      }

      if (delta < 0 || !Number.isFinite(delta)) delta = 0;

      days.push({
        label: new Intl.DateTimeFormat("pl-PL", {
          day: "2-digit",
          month: "2-digit"
        }).format(d),
        value: delta,
        date: d.toISOString().slice(0, 10)
      });
    }

    return days;
  }

  _chartHistorySeries() {
    const state = this._state(this._config.daily_consumed_entity);
    const history = state?.attributes?.chart_history;
    if (!Array.isArray(history) || !history.length) return null;

    return history
      .filter(day => day && day.date)
      .map(day => ({
        label: new Intl.DateTimeFormat("pl-PL", {
          day: "2-digit",
          month: "2-digit"
        }).format(new Date(day.date + "T12:00:00")),
        value: Number(day.total),
        date: day.date,
        values: Array.isArray(day.values) ? day.values : [],
        source: day.source || "energia/api"
      }))
      .filter(day => Number.isFinite(day.value));
  }

  _todayHistoryValue() {
    const history = this._chartHistorySeries();
    if (!history) return null;

    const today = new Date().toISOString().slice(0, 10);
    const entry = history.find(day => day.date === today);
    return entry ? entry.value : null;
  }

  _todayDailyConsumed() {
    // Prefer today's value from chart_history. The coordinator replaces the
    // stale /energia/api value for today with the cumulative /odczyty/api delta.
    const historyValue = this._todayHistoryValue();
    if (Number.isFinite(historyValue)) return historyValue;

    const value = this._num(this._config.daily_consumed_entity, NaN);
    return Number.isFinite(value) ? value : NaN;
  }

  _chartSvg() {
    const chartHistory = this._chartHistorySeries();
    const consumed = chartHistory || this._dailySeries(this._config.consumed_entity);
    const exported = this._dailySeries(this._config.exported_entity);
    const all = [...consumed.map(x => x.value), ...exported.map(x => x.value)];
    const max = Math.max(1, ...all) * 1.15;

    const W = 900;
    const H = 250;
    const left = 42;
    const right = 18;
    const top = 22;
    const bottom = 34;
    const plotW = W - left - right;
    const plotH = H - top - bottom;

    const path = data => data.map((p, i) => {
      const x = left + (i / Math.max(1, data.length - 1)) * plotW;
      const y = top + plotH - (p.value / max) * plotH;
      return `${i ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ");

    const points = (data, cls) => data.map((p, i) => {
      const x = left + (i / Math.max(1, data.length - 1)) * plotW;
      const y = top + plotH - (p.value / max) * plotH;
      return `<circle class="${cls}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2"><title>${p.label}: ${this._fmt(p.value, 2)} kWh</title></circle>`;
    }).join("");

    const grid = [0, .25, .5, .75, 1].map(r => {
      const y = top + plotH - r * plotH;
      return `<line class="grid" x1="${left}" y1="${y}" x2="${W-right}" y2="${y}"></line>`;
    }).join("");

    const labels = consumed.map((p, i) => {
      if (i % 2 !== 0 && consumed.length > 8) return "";
      const x = left + (i / Math.max(1, consumed.length - 1)) * plotW;
      return `<text class="axis" x="${x}" y="${H-8}" text-anchor="middle">${p.label}</text>`;
    }).join("");

    return `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Zużycie energii z ostatnich dni">
        ${grid}
        <path class="area-consumed" d="${path(consumed)} L ${W-right} ${top+plotH} L ${left} ${top+plotH} Z"></path>
        <path class="line-consumed" d="${path(consumed)}"></path>
        <path class="line-exported" d="${path(exported)}"></path>
        ${points(consumed, "dot-consumed")}
        ${points(exported, "dot-exported")}
        ${labels}
      </svg>
    `;
  }

  async _refresh() {
    const entity = this._config.refresh_entity;
    if (!this._hass || !entity || this._loading) return;

    this._loading = true;
    this._render();

    try {
      await this._hass.callService("button", "press", { entity_id: entity });
      await new Promise(r => setTimeout(r, 1200));
      await this._loadHistory();
    } catch (err) {
      console.error("Tauron Energy Card: refresh failed", err);
    } finally {
      this._loading = false;
      this._render();
    }
  }

  _render() {
    if (!this.shadowRoot || !this._hass || !this._config.consumed_entity) return;

    const c = this._config;
    const consumed = this._num(c.consumed_entity);
    const exported = this._num(c.exported_entity);
    const dailyConsumed = this._todayDailyConsumed();
    const dailyExported = this._num(c.daily_exported_entity, NaN);
    const dailyAverage = this._num(c.daily_average_entity, NaN);
    const balance = this._num(c.balance_entity);
    const daily = this._num(c.daily_budget_entity, NaN);
    const monthly = this._num(c.monthly_budget_entity, NaN);
    const days = this._num(c.days_entity, NaN);

    const billingStartConsumed = this._num(
      c.billing_start_consumed_entity,
      NaN
    );
    const billingStartExported = this._num(
      c.billing_start_exported_entity,
      NaN
    );

    const lastReading = this._state(c.last_reading_entity)?.state;
    const lastFetch = this._state(c.last_fetch_entity)?.state;
    const updated = lastFetch || lastReading;

    const balanceClass =
      balance < 0 ? "negative" :
      balance > 0 ? "positive" : "";

    const progress = Number.isFinite(days)
      ? Math.max(0, Math.min(100, 100 - (days / 365) * 100))
      : 0;

    this.shadowRoot.innerHTML = `
      <style>\n
        :host {
          display:block;
          --te-bg:#08111f;
          --te-text:#f4f7ff;
          --te-muted:#93a4bd;
          --te-border:rgba(145,170,210,.15);
          --te-blue:#4295ff;
          --te-purple:#7a5cff;
          --te-green:#29dc91;
          --te-red:#ff626b;
        }
        * { box-sizing:border-box; }

        .panel {
          position:relative;
          overflow:hidden;
          border-radius:26px;
          padding:22px;
          color:var(--te-text);
          background:
            radial-gradient(circle at 10% -10%,rgba(39,120,255,.22),transparent 32%),
            radial-gradient(circle at 92% 0%,rgba(116,65,255,.18),transparent 30%),
            linear-gradient(145deg,#07101d,#0b1728 58%,#091423);
          border:1px solid var(--te-border);
          box-shadow:0 18px 55px rgba(0,0,0,.30);
        }

        .top {
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:18px;
          margin-bottom:18px;
        }

        .title-wrap { display:flex;gap:14px;align-items:center; }
        .energy-icon {
          width:52px;height:52px;border-radius:16px;
          display:grid;place-items:center;font-size:27px;color:#fff;
          background:linear-gradient(145deg,#1876ff,#583eff);
          box-shadow:0 10px 30px rgba(66,112,255,.30);
        }
        h1 { margin:0;font-size:25px;line-height:1.1;font-weight:800;letter-spacing:-.03em; }
        .subtitle { margin-top:5px;color:var(--te-muted);font-size:12px; }

        .refresh {
          border:1px solid var(--te-border);
          cursor:pointer;
          border-radius:13px;
          width:44px;height:44px;
          display:grid;place-items:center;
          background:rgba(77,111,255,.13);
          color:#9ab0ff;
          font-size:20px;
        }
        .refresh:hover { background:rgba(77,111,255,.22); }
        .refresh:disabled { opacity:.55;cursor:wait; }
        .spin { animation:spin 1s linear infinite; }
        @keyframes spin { to { transform:rotate(360deg); } }

        .tauron-summary {
          display:grid;
          grid-template-columns:minmax(0,1.55fr) minmax(280px,.85fr);
          gap:14px;
        }

        .summary-main,
        .summary-side {
          min-height:184px;
          border:1px solid var(--te-border);
          border-radius:20px;
          background:
            linear-gradient(145deg,rgba(18,45,87,.96),rgba(14,24,57,.96));
          box-shadow:0 12px 30px rgba(0,0,0,.16);
        }

        .summary-main {
          padding:22px 24px;
          background:
            radial-gradient(circle at 95% 10%,rgba(56,117,255,.22),transparent 35%),
            linear-gradient(145deg,#102c58,#111c4b 58%,#0d1731);
        }

        .summary-label {
          color:#8db2ff;
          font-size:14px;
          font-weight:780;
        }

        .summary-value {
          margin-top:7px;
          font-size:clamp(44px,6vw,62px);
          line-height:1;
          font-weight:850;
          letter-spacing:-.055em;
        }

        .summary-value small {
          font-size:.32em;
          letter-spacing:0;
          font-weight:700;
        }

        .summary-meta {
          display:inline-flex;
          align-items:center;
          gap:7px;
          margin-top:20px;
          margin-right:20px;
          color:var(--te-muted);
          font-size:12px;
        }

        .summary-chip {
          color:#8eabff;
          font-size:10px;
          font-weight:850;
          letter-spacing:.06em;
        }

        .summary-side {
          padding:20px;
          background:linear-gradient(145deg,rgba(16,31,52,.98),rgba(10,22,38,.98));
        }

        .side-title {
          color:var(--te-muted);
          font-size:11px;
          font-weight:750;
          text-transform:uppercase;
          letter-spacing:.08em;
        }

        .side-date {
          margin-top:6px;
          margin-bottom:15px;
          font-size:16px;
          font-weight:780;
        }

        .side-row {
          display:flex;
          justify-content:space-between;
          gap:12px;
          padding-top:11px;
          margin-top:10px;
          border-top:1px solid var(--te-border);
          color:#aab8cc;
          font-size:12px;
        }

        .side-row strong { color:#fff; }

        .section {
          margin-top:14px;
          border:1px solid var(--te-border);
          border-radius:20px;
          padding:18px;
          background:rgba(9,23,39,.88);
        }

        .section-title {
          display:flex;
          justify-content:space-between;
          align-items:baseline;
          margin-bottom:12px;
        }

        .section-title strong { font-size:15px; }
        .section-title span { font-size:11px;color:var(--te-muted); }

        .balance {
          display:grid;
          grid-template-columns:1fr auto;
          gap:18px;
          align-items:center;
        }

        .balance-number { font-size:29px;font-weight:820; }
        .negative { color:var(--te-red); }
        .positive { color:var(--te-green); }

        .balance-bar {
          height:8px;
          margin-top:12px;
          background:rgba(140,165,205,.14);
          border-radius:99px;
          overflow:hidden;
        }

        .balance-bar > div {
          height:100%;
          background:linear-gradient(90deg,var(--te-purple),var(--te-blue));
          border-radius:inherit;
        }

        .days { text-align:right; }
        .days strong { display:block;font-size:30px; }
        .days span { color:var(--te-muted);font-size:11px; }

        .chart {
          border-radius:17px;
          border:1px solid var(--te-border);
          padding:12px 12px 3px;
          background:rgba(5,15,28,.45);
        }

        .chart svg { display:block;width:100%;height:250px; }
        .grid { stroke:rgba(150,175,215,.12);stroke-dasharray:4 7;stroke-width:1; }
        .axis { fill:#788aa4;font-size:11px; }

        .line-consumed {
          fill:none;
          stroke:var(--te-blue);
          stroke-width:4;
          stroke-linecap:round;
          stroke-linejoin:round;
        }

        .line-exported {
          fill:none;
          stroke:var(--te-green);
          stroke-width:3;
          stroke-linecap:round;
          stroke-linejoin:round;
        }

        .area-consumed { fill:var(--te-blue);opacity:.09; }
        .dot-consumed { fill:#6ab4ff; }
        .dot-exported { fill:var(--te-green); }

        .legend {
          display:flex;
          gap:18px;
          margin:5px 3px 2px;
          color:var(--te-muted);
          font-size:11px;
        }

        .legend i {
          width:8px;height:8px;display:inline-block;border-radius:50%;margin-right:5px;
        }
        .legend .c { background:var(--te-blue); }
        .legend .e { background:var(--te-green); }

        .info-grid {
          display:grid;
          grid-template-columns:repeat(4,minmax(0,1fr));
          gap:10px;
        }

        .info {
          padding:14px;
          border-radius:15px;
          border:1px solid var(--te-border);
          background:rgba(255,255,255,.025);
        }

        .info-label {
          color:var(--te-muted);
          font-size:10px;
          text-transform:uppercase;
          letter-spacing:.07em;
          font-weight:700;
        }

        .info-value {
          margin-top:6px;
          font-size:16px;
          font-weight:750;
        }

        .footer {
          margin-top:14px;
          color:#71839d;
          font-size:10px;
          display:flex;
          justify-content:space-between;
          gap:12px;
        }

        @media (max-width:900px) {
          .tauron-summary { grid-template-columns:1fr; }
          .info-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
        }

        @media (max-width:600px) {
          .panel { padding:14px;border-radius:20px; }
          .top { align-items:flex-start; }
          .summary-main,.summary-side { min-height:auto; }
          .balance { grid-template-columns:1fr; }
          .days { text-align:left; }
          .info-grid { grid-template-columns:1fr 1fr; }
        }
      </style>

      <section class="panel" aria-label="Tauron eLicznik">
        <header class="top">
          <div class="title-wrap">
            <div class="energy-icon">⚡</div>
            <div>
              <h1>${this._escape(c.title)}</h1>
              <div class="subtitle">Tauron eLicznik · zużycie, oddanie i okres rozliczeniowy</div>
            </div>
          </div>

          <button class="refresh" title="Odśwież dane Tauron" aria-label="Odśwież dane Tauron" ${this._loading ? "disabled" : ""}>
            <span class="${this._loading ? "spin" : ""}">↻</span>
          </button>
        </header>

        <div class="tauron-summary">
          <div class="summary-main">
            <div class="summary-label">Pobór dzisiaj</div>

            <div class="summary-value">
              ${Number.isFinite(dailyConsumed) ? this._fmt(dailyConsumed, 2) : "—"}
              <small>kWh</small>
            </div>

            <div class="summary-meta">
              <span class="summary-chip">SUMA DZISIAJ</span>
              <strong>${Number.isFinite(dailyConsumed) ? this._fmt(dailyConsumed, 2) : "—"} kWh</strong>
            </div>

            <div class="summary-meta">
              <span class="summary-chip">ŚREDNIA</span>
              <strong>${Number.isFinite(dailyAverage) ? this._fmt(dailyAverage, 1) : "—"} kWh/h</strong>
            </div>
          </div>

          <div class="summary-side">
            <div class="side-title">Dane Taurona</div>
            <div class="side-date">${this._date(lastReading)}</div>

            <div class="side-row">
              <span>Pobór dzisiaj</span>
              <strong>${Number.isFinite(dailyConsumed) ? this._fmt(dailyConsumed, 2) : "—"} kWh</strong>
            </div>

            <div class="side-row">
              <span>Oddanie</span>
              <strong>${Number.isFinite(dailyExported) ? this._fmt(dailyExported, 2) : "—"} kWh</strong>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">
            <strong>Bilans okresu</strong>
            <span>eLicznik</span>
          </div>

          <div class="balance">
            <div>
              <div class="balance-number ${balanceClass}">${this._fmt(balance, 1)} kWh</div>
              <div class="balance-bar"><div></div></div>
            </div>

            <div class="days">
              <strong>${Number.isFinite(days) ? this._fmt(days, 0) : "—"}</strong>
              <span>dni do końca</span>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">
            <strong>Zużycie energii</strong>
            <span>ostatnie ${Number(c.days_history || 14)} dni</span>
          </div>

          <div class="chart">
            ${this._chartSvg()}
            <div class="legend">
              <span><i class="c"></i>Pobrano</span>
              <span><i class="e"></i>Oddano</span>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">
            <strong>Okres rozliczeniowy</strong>
            <span>budżet i prognoza</span>
          </div>

          <div class="info-grid">
            <div class="info">
              <div class="info-label">Dziennie</div>
              <div class="info-value">${Number.isFinite(daily) ? this._fmt(daily, 2) : "—"} kWh</div>
            </div>
            <div class="info">
              <div class="info-label">Miesięcznie</div>
              <div class="info-value">${Number.isFinite(monthly) ? this._fmt(monthly, 2) : "—"} kWh</div>
            </div>
            <div class="info">
              <div class="info-label">Początek poboru</div>
              <div class="info-value">${Number.isFinite(billingStartConsumed) ? this._fmt(billingStartConsumed, 2) : "—"} kWh</div>
            </div>
            <div class="info">
              <div class="info-label">Początek oddania</div>
              <div class="info-value">${Number.isFinite(billingStartExported) ? this._fmt(billingStartExported, 2) : "—"} kWh</div>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">
            <strong>Stan licznika</strong>
            <span>aktualne dane</span>
          </div>

          <div class="info-grid">
            <div class="info">
              <div class="info-label">Całkowicie pobrano</div>
              <div class="info-value">${this._fmt(consumed, 2)} kWh</div>
            </div>
            <div class="info">
              <div class="info-label">Całkowicie oddano</div>
              <div class="info-value">${this._fmt(exported, 2)} kWh</div>
            </div>
            <div class="info">
              <div class="info-label">Bilans</div>
              <div class="info-value ${balanceClass}">${this._fmt(balance, 2)} kWh</div>
            </div>
            <div class="info">
              <div class="info-label">Odczyt</div>
              <div class="info-value">${this._date(lastReading)}</div>
            </div>
          </div>
        </div>

        <div class="footer">
          <span>Ostatnia aktualizacja: ${updated ? this._date(updated) : "—"}</span>
          <span>${updated ? this._relative(updated) : ""}</span>
        </div>
      </section>
    `;

    this.shadowRoot.querySelector(".refresh")?.addEventListener("click", () => this._refresh());
  }
}

customElements.define("tauron-energy-card", TauronEnergyCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "tauron-energy-card",
  name: "Tauron Energy Card",
  description: "Nowoczesny panel Tauron eLicznik."
});
