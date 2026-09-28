// Tauron eLicznik card — Chart API summary
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
        value: delta
      });
    }

    return days;
  }

  _chartHistorySeries() {
    const state = this._state(this._config.daily_consumed_entity);
    const history = state?.attributes?.chart_history;
    if (!Array.isArray(history)) return null;

    return history.map(day => ({
      label: new Intl.DateTimeFormat("pl-PL", {
        day: "2-digit",
        month: "2-digit"
      }).format(new Date(day.date + "T12:00:00")),
      value: Number(day.total) || 0,
      date: day.date,
      values: Array.isArray(day.values) ? day.values : []
    }));
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
    const dailyConsumed = this._num(c.daily_consumed_entity, NaN);
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
      <style>
        :host {
          display: block;
          --te-bg: var(--ha-card-background, var(--card-background-color, #fff));
          --te-text: var(--primary-text-color, #172033);
          --te-muted: var(--secondary-text-color, #697386);
          --te-border: var(--divider-color, rgba(30,40,60,.10));
          --te-blue: #4f67e8;
          --te-green: #32a852;
          --te-purple: #8d68d8;
          --te-red: #df5961;
        }

        * { box-sizing: border-box; }

        .panel {
          position: relative;
          overflow: hidden;
          border-radius: 28px;
          background:
            radial-gradient(circle at 90% 0%, rgba(79,103,232,.11), transparent 32%),
            radial-gradient(circle at 0% 100%, rgba(50,168,82,.07), transparent 30%),
            var(--te-bg);
          color: var(--te-text);
          border: 1px solid var(--te-border);
          box-shadow: 0 14px 40px rgba(30,40,60,.09);
          padding: 26px;
        }

        .top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          margin-bottom: 24px;
        }

        .title-wrap {
          display: flex;
          gap: 15px;
          align-items: flex-start;
        }

        .energy-icon {
          width: 50px;
          height: 50px;
          border-radius: 16px;
          display: grid;
          place-items: center;
          font-size: 25px;
          background: linear-gradient(135deg, rgba(79,103,232,.15), rgba(79,103,232,.05));
          color: var(--te-blue);
        }

        h1 {
          margin: 0;
          font-size: 25px;
          line-height: 1.1;
          font-weight: 750;
          letter-spacing: -.02em;
        }

        .subtitle {
          margin-top: 6px;
          color: var(--te-muted);
          font-size: 13px;
        }

        .refresh {
          border: 0;
          cursor: pointer;
          border-radius: 13px;
          width: 42px;
          height: 42px;
          display: grid;
          place-items: center;
          background: rgba(79,103,232,.09);
          color: var(--te-blue);
          font-size: 20px;
        }

        .refresh:disabled {
          opacity: .55;
          cursor: wait;
        }

        .spin { animation: spin 1s linear infinite; }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .tauron-summary {
          display: grid;
          grid-template-columns: minmax(0, 1.45fr) minmax(260px, .75fr);
          gap: 16px;
        }

        .summary-main,
        .summary-side {
          border: 1px solid var(--te-border);
          border-radius: 22px;
          background: linear-gradient(145deg, rgba(79,103,232,.09), rgba(79,103,232,.025));
        }

        .summary-main { padding: 24px 26px 20px; }

        .summary-label {
          color: var(--te-blue);
          font-size: 15px;
          font-weight: 750;
        }

        .summary-value {
          font-size: clamp(38px, 5vw, 56px);
          line-height: 1;
          font-weight: 800;
          letter-spacing: -.045em;
        }

        .summary-value small {
          font-size: .38em;
          font-weight: 700;
          letter-spacing: 0;
        }

        .summary-meta {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin-top: 17px;
          margin-right: 18px;
          color: var(--te-muted);
          font-size: 13px;
        }

        .summary-chip {
          color: var(--te-blue);
          font-size: 11px;
          font-weight: 800;
          letter-spacing: .04em;
        }

        .summary-side {
          padding: 20px;
          background: rgba(120,130,150,.035);
        }

        .side-title {
          color: var(--te-muted);
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: .06em;
        }

        .side-date {
          margin-top: 5px;
          margin-bottom: 15px;
          font-size: 16px;
          font-weight: 750;
        }

        .side-row {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          padding-top: 10px;
          margin-top: 10px;
          border-top: 1px solid var(--te-border);
          color: var(--te-muted);
          font-size: 13px;
        }

        .side-row strong { color: var(--te-text); }

        .section {
          margin-top: 20px;
          border-top: 1px solid var(--te-border);
          padding-top: 20px;
        }

        .section-title {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 12px;
        }

        .section-title strong { font-size: 15px; }
        .section-title span { font-size: 12px; color: var(--te-muted); }

        .balance {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 18px;
          align-items: center;
        }

        .balance-number {
          font-size: 28px;
          font-weight: 760;
        }

        .negative { color: var(--te-red); }
        .positive { color: var(--te-green); }

        .balance-bar {
          height: 8px;
          margin-top: 12px;
          background: rgba(120,130,150,.13);
          border-radius: 99px;
          overflow: hidden;
        }

        .balance-bar > div {
          height: 100%;
          width: ${progress}%;
          background: linear-gradient(90deg, var(--te-blue), var(--te-purple));
          border-radius: inherit;
        }

        .days { text-align: right; }
        .days strong { display: block; font-size: 26px; }
        .days span { color: var(--te-muted); font-size: 11px; }

        .chart {
          border-radius: 20px;
          border: 1px solid var(--te-border);
          padding: 14px 14px 4px;
          background: rgba(120,130,150,.025);
        }

        .chart svg {
          display: block;
          width: 100%;
          height: 250px;
        }

        .grid {
          stroke: var(--te-border);
          stroke-dasharray: 4 6;
          stroke-width: 1;
        }

        .axis {
          fill: var(--te-muted);
          font-size: 11px;
        }

        .line-consumed {
          fill: none;
          stroke: var(--te-blue);
          stroke-width: 4;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        .line-exported {
          fill: none;
          stroke: var(--te-green);
          stroke-width: 3;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        .area-consumed {
          fill: var(--te-blue);
          opacity: .06;
        }

        .dot-consumed { fill: var(--te-blue); }
        .dot-exported { fill: var(--te-green); }

        .legend {
          display: flex;
          gap: 18px;
          margin: 5px 3px 2px;
          color: var(--te-muted);
          font-size: 12px;
        }

        .legend i {
          width: 8px;
          height: 8px;
          display: inline-block;
          border-radius: 50%;
          margin-right: 5px;
        }

        .legend .c { background: var(--te-blue); }
        .legend .e { background: var(--te-green); }

        .info-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }

        .info {
          padding: 15px;
          border-radius: 17px;
          border: 1px solid var(--te-border);
          background: rgba(120,130,150,.035);
        }

        .info-label {
          color: var(--te-muted);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: .07em;
          font-weight: 700;
        }

        .info-value {
          margin-top: 6px;
          font-size: 18px;
          font-weight: 720;
        }

        .footer {
          margin-top: 18px;
          color: var(--te-muted);
          font-size: 11px;
          display: flex;
          justify-content: space-between;
          gap: 12px;
        }

        @media (max-width: 700px) {
          .panel { padding: 18px; border-radius: 22px; }
          .tauron-summary { grid-template-columns: 1fr; }
          .balance { grid-template-columns: 1fr; }
          .days { text-align: left; }
        }
      </style>

      <section class="panel">
        <header class="top">
          <div class="title-wrap">
            <div class="energy-icon">⚡</div>
            <div>
              <h1>${this._escape(c.title)}</h1>
              <div class="subtitle">
                Tauron eLicznik · zużycie, oddanie i okres rozliczeniowy
              </div>
            </div>
          </div>

          <button
            class="refresh"
            title="Odśwież dane Tauron"
            aria-label="Odśwież dane Tauron"
            ${this._loading ? "disabled" : ""}
          >
            <span class="${this._loading ? "spin" : ""}">↻</span>
          </button>
        </header>

        <div class="tauron-summary">
          <div class="summary-main">
            <div class="summary-label">Pobór</div>

            <div class="summary-value">
              ${Number.isFinite(dailyConsumed) ? this._fmt(dailyConsumed, 2) : "—"}
              <small>kWh</small>
            </div>

            <div class="summary-meta">
              <span class="summary-chip">SUMA</span>
              <strong>
                ${Number.isFinite(dailyConsumed) ? this._fmt(dailyConsumed, 2) : "—"} kWh
              </strong>
            </div>

            <div class="summary-meta">
              <span class="summary-chip">ŚREDNIA</span>
              <strong>
                ${Number.isFinite(dailyAverage) ? this._fmt(dailyAverage, 1) : "—"} kWh/h
              </strong>
            </div>
          </div>

          <div class="summary-side">
            <div class="side-title">Ostatni kompletny dzień</div>
            <div class="side-date">${this._date(lastReading)}</div>

            <div class="side-row">
              <span>Pobór</span>
              <strong>
                ${Number.isFinite(dailyConsumed) ? this._fmt(dailyConsumed, 2) : "—"} kWh
              </strong>
            </div>

            <div class="side-row">
              <span>Oddanie</span>
              <strong>
                ${Number.isFinite(dailyExported) ? this._fmt(dailyExported, 2) : "—"} kWh
              </strong>
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
              <div class="balance-number ${balanceClass}">
                ${this._fmt(balance, 1)} kWh
              </div>

              <div class="balance-bar">
                <div></div>
              </div>
            </div>

            <div class="days">
              <strong>
                ${Number.isFinite(days) ? this._fmt(days, 0) : "—"}
              </strong>
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
              <div class="info-value">
                ${Number.isFinite(daily) ? this._fmt(daily, 2) : "—"} kWh
              </div>
            </div>

            <div class="info">
              <div class="info-label">Miesięcznie</div>
              <div class="info-value">
                ${Number.isFinite(monthly) ? this._fmt(monthly, 2) : "—"} kWh
              </div>
            </div>

            <div class="info">
              <div class="info-label">Początek poboru</div>
              <div class="info-value">
                ${Number.isFinite(billingStartConsumed) ? this._fmt(billingStartConsumed, 2) : "—"} kWh
              </div>
            </div>

            <div class="info">
              <div class="info-label">Początek oddania</div>
              <div class="info-value">
                ${Number.isFinite(billingStartExported) ? this._fmt(billingStartExported, 2) : "—"} kWh
              </div>
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
              <div class="info-value ${balanceClass}">
                ${this._fmt(balance, 2)} kWh
              </div>
            </div>

            <div class="info">
              <div class="info-label">Odczyt</div>
              <div class="info-value">${this._date(lastReading)}</div>
            </div>
          </div>
        </div>

        <div class="footer">
          <span>
            Ostatnia aktualizacja:
            ${updated ? this._date(updated) : "—"}
          </span>

          <span>
            ${updated ? this._relative(updated) : ""}
          </span>
        </div>
      </section>
    `;

    this.shadowRoot
      .querySelector(".refresh")
      ?.addEventListener("click", () => this._refresh());
  }
}

customElements.define("tauron-energy-card", TauronEnergyCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "tauron-energy-card",
  name: "Tauron Energy Card",
  description: "Nowoczesny panel Tauron eLicznik."
});
