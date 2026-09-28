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


  _hourlyProfileSvg() {
    const history = this._chartHistorySeries();
    if (!history?.length) return "";
    const today = new Date().toISOString().slice(0, 10);
    const entry = history.find(day => day.date === today);
    const values = Array.isArray(entry?.values) ? entry.values.map(Number).filter(Number.isFinite) : [];
    if (!values.length) return "";

    const W = 900, H = 190, left = 42, right = 18, top = 18, bottom = 32;
    const plotW = W - left - right, plotH = H - top - bottom;
    const max = Math.max(1, ...values) * 1.12;

    const bars = values.map((value, i) => {
      const slot = plotW / values.length, gap = 4, width = Math.max(4, slot - gap);
      const x = left + i * slot + gap / 2;
      const height = Math.max(1, (value / max) * plotH);
      const y = top + plotH - height;
      const label = String(i).padStart(2, "0");
      return `<rect class="hour-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" rx="3"><title>${label}:00 — ${this._fmt(value,2)} kWh</title></rect><text class="hour-axis" x="${(x+width/2).toFixed(1)}" y="${H-8}" text-anchor="middle">${label}</text>`;
    }).join("");

    return `
      <div class="hourly">
        <div class="section-title"><strong>Godzinowy profil dzisiejszego zużycia</strong><span>24 godziny</span></div>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Godzinowy profil dzisiejszego zużycia">
          <line class="hour-grid" x1="${left}" y1="${top+plotH}" x2="${W-right}" y2="${top+plotH}"></line>
          ${bars}
        </svg>
      </div>
    `;
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
    const dailyBudget = this._num(c.daily_budget_entity, NaN);
    const monthlyBudget = this._num(c.monthly_budget_entity, NaN);
    const days = this._num(c.days_entity, NaN);
    const billingStartConsumed = this._num(c.billing_start_consumed_entity, NaN);
    const billingStartExported = this._num(c.billing_start_exported_entity, NaN);
    const lastReading = this._state(c.last_reading_entity)?.state;
    const lastFetch = this._state(c.last_fetch_entity)?.state;
    const updated = lastFetch || lastReading;
    const balanceClass = balance < 0 ? "negative" : balance > 0 ? "positive" : "";
    const budgetBase = Math.abs(dailyBudget);
    const budgetPercent = budgetBase > 0 && Number.isFinite(dailyConsumed)
      ? Math.min(100, Math.max(0, (dailyConsumed / budgetBase) * 100))
      : 0;
    const daysPercent = Number.isFinite(days) ? Math.max(0, Math.min(100, (days / 365) * 100)) : 0;

    this.shadowRoot.innerHTML = `
      <section class="panel" aria-label="Tauron eLicznik">
        <header class="top">
          <div class="brand">
            <div class="energy-icon">⚡</div>
            <div>
              <h1>${this._escape(c.title)}</h1>
              <div class="subtitle">Tauron eLicznik · zużycie, oddanie i okres rozliczeniowy</div>
            </div>
          </div>
          <div class="top-actions">
            <div class="connection"><span class="connection-dot"></span><span>Połączony · ${updated ? this._relative(updated) : "brak danych"}</span></div>
            <button class="refresh" title="Odśwież dane Tauron" aria-label="Odśwież dane Tauron" ${this._loading ? "disabled" : ""}><span class="${this._loading ? "spin" : ""}">↻</span></button>
          </div>
        </header>

        <div class="hero-grid">
          <div class="hero">
            <div class="budget-ring" style="--budget:${budgetPercent}%"><div>${this._fmt(budgetPercent,0)}%<span>dziennego budżetu</span></div></div>
            <div class="eyebrow">Pobór dzisiaj <span class="eyebrow-dot"></span></div>
            <div class="big-value">${Number.isFinite(dailyConsumed) ? this._fmt(dailyConsumed,2) : "—"} <small>kWh</small></div>
            <div class="hero-meta">
              <span><b style="color:#89a9ff">SUMA DZISIAJ</b><strong>${Number.isFinite(dailyConsumed) ? this._fmt(dailyConsumed,2) : "—"} kWh</strong></span>
              <span><b style="color:#89a9ff">ŚREDNIA</b><strong>${Number.isFinite(dailyAverage) ? this._fmt(dailyAverage,2) : "—"} kWh/h</strong></span>
            </div>
          </div>

          <div class="card">
            <div class="card-title">Ostatni odczyt z Taurona</div>
            <div class="card-date">${this._date(lastReading)}</div>
            <div class="metric-row"><span>Pobór</span><strong>${Number.isFinite(dailyConsumed) ? this._fmt(dailyConsumed,2) : "—"} kWh</strong></div>
            <div class="metric-row"><span>Oddanie</span><strong>${Number.isFinite(dailyExported) ? this._fmt(dailyExported,2) : "—"} kWh</strong></div>
          </div>

          <div class="card">
            <div class="card-title">Okres rozliczeniowy</div>
            <div class="billing-days"><strong>${Number.isFinite(days) ? this._fmt(days,0) : "—"}</strong><span>dni do końca</span></div>
            <div class="progress"><div style="width:${daysPercent}%"></div></div>
            <div class="balance-small ${balanceClass}">${this._fmt(balance,1)} kWh</div>
            <div style="color:var(--te-muted);font-size:11px">Bilans okresu</div>
          </div>
        </div>

        <div class="stat-grid">
          <div class="stat"><div class="stat-icon">⚡</div><div class="stat-label">Dzienny budżet</div><div class="stat-value">${Number.isFinite(dailyBudget) ? this._fmt(dailyBudget,2) : "—"} kWh</div></div>
          <div class="stat"><div class="stat-icon">▣</div><div class="stat-label">Miesięczny budżet</div><div class="stat-value">${Number.isFinite(monthlyBudget) ? this._fmt(monthlyBudget,2) : "—"} kWh</div></div>
          <div class="stat"><div class="stat-icon">⌁</div><div class="stat-label">Średnie zużycie dzienne</div><div class="stat-value">${Number.isFinite(dailyAverage) ? this._fmt(dailyAverage,2) : "—"} kWh</div></div>
          <div class="stat"><div class="stat-icon">↗</div><div class="stat-label">Łącznie pobrano</div><div class="stat-value">${this._fmt(consumed,1)} kWh</div></div>
          <div class="stat"><div class="stat-icon">↙</div><div class="stat-label">Łącznie oddano</div><div class="stat-value">${this._fmt(exported,1)} kWh</div></div>
        </div>

        <div class="section">
          <div class="section-title"><div><strong>Zużycie energii</strong><span style="margin-left:8px">ostatnie ${Number(c.days_history || 14)} dni</span></div><span>▦ ${Number(c.days_history || 14)} dni</span></div>
          <div class="chart">${this._chartSvg()}</div>
          <div class="legend"><span><i class="c"></i>Pobór (kWh)</span><span><i class="e"></i>Oddanie (kWh)</span></div>
        </div>

        ${this._hourlyProfileSvg()}

        <div class="details-grid">
          <div class="section">
            <div class="section-title"><strong>Szczegóły licznika</strong><span>stan</span></div>
            <div class="detail-row"><span>Stan licznika — pobrana</span><strong>${this._fmt(consumed,1)} kWh</strong></div>
            <div class="detail-row"><span>Stan licznika — oddana</span><strong>${this._fmt(exported,1)} kWh</strong></div>
            <div class="detail-row"><span>Stan na początku okresu (pobór)</span><strong>${Number.isFinite(billingStartConsumed) ? this._fmt(billingStartConsumed,1) : "—"} kWh</strong></div>
            <div class="detail-row"><span>Stan na początku okresu (oddanie)</span><strong>${Number.isFinite(billingStartExported) ? this._fmt(billingStartExported,1) : "—"} kWh</strong></div>
          </div>

          <div class="section">
            <div class="section-title"><strong>Informacje</strong><span>eLicznik</span></div>
            <div class="info-grid">
              <div class="info"><div class="info-label">Data ostatniego odczytu</div><div class="info-value">${this._date(lastReading)}</div></div>
              <div class="info"><div class="info-label">Ostatnie pobranie danych</div><div class="info-value">${this._date(lastFetch)}</div></div>
            </div>
            <button class="wide-refresh" title="Odśwież dane Tauron" aria-label="Odśwież dane Tauron" ${this._loading ? "disabled" : ""}>↻ &nbsp; Odśwież dane z eLicznik</button>
          </div>
        </div>

        <div class="section">
          <div class="section-title"><strong>Okres rozliczeniowy</strong><span>budżet</span></div>
          <div class="info-grid">
            <div class="info"><div class="info-label">Dziennie</div><div class="info-value">${Number.isFinite(dailyBudget) ? this._fmt(dailyBudget,2) : "—"} kWh</div></div>
            <div class="info"><div class="info-label">Miesięcznie</div><div class="info-value">${Number.isFinite(monthlyBudget) ? this._fmt(monthlyBudget,2) : "—"} kWh</div></div>
          </div>
        </div>

        <div class="footer">
          <span>Źródło dzisiaj: /odczyty/api · historia: /energia/api</span>
          <span>${updated ? "Aktualizacja " + this._date(updated) + " · " + this._relative(updated) : "Brak aktualizacji"}</span>
        </div>
      </section>
    `;

    this.shadowRoot.querySelectorAll(".refresh, .wide-refresh").forEach(button => {
      button.addEventListener("click", () => this._refresh());
    });
  }

customElements.define("tauron-energy-card", TauronEnergyCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "tauron-energy-card",
  name: "Tauron Energy Card",
  description: "Nowoczesny panel Tauron eLicznik."
});
