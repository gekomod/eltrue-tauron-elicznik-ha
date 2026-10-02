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
      tariff_entity: "sensor.serwerownia_tauron_elicznik_taryfa",
      t1_entity: "sensor.serwerownia_tauron_elicznik_t1_licznik",
      t2_entity: "sensor.serwerownia_tauron_elicznik_t2_licznik",
      t3_entity: "sensor.serwerownia_tauron_elicznik_t3_licznik",
      t1_daily_entity: "sensor.serwerownia_tauron_elicznik_t1_dzisiaj",
      t2_daily_entity: "sensor.serwerownia_tauron_elicznik_t2_dzisiaj",
      t3_daily_entity: "sensor.serwerownia_tauron_elicznik_t3_dzisiaj",
      pse_today_entity: "sensor.serwerownia_tauron_elicznik_energetyczny_kompas_dzisiaj",
      pse_tomorrow_entity: "sensor.serwerownia_tauron_elicznik_energetyczny_kompas_jutro",
      title: "Energia",
      days_history: 14,
      auto_refresh_minutes: 60
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
    this._autoRefreshTimer = null;
    this._selectedDate = null;
    this._autoRefreshMinutes = 60;
  }

  setConfig(config) {
    this._config = { ...TauronEnergyCard.getStubConfig(), ...config };
    this._autoRefreshMinutes = [60, 120].includes(Number(this._config.auto_refresh_minutes))
      ? Number(this._config.auto_refresh_minutes)
      : 60;
    this._render();
    this._startAutoRefresh();
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
    if (this._autoRefreshTimer) clearInterval(this._autoRefreshTimer);
  }


  _dateKey(date) {
    const d = date instanceof Date ? date : new Date(date);
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0")
    ].join("-");
  }

  _historyDateKeys() {
    const history = this._chartHistorySeries();
    return history ? history.map(entry => entry.date).filter(Boolean).sort() : [];
  }

  _selectedHistoryEntry() {
    const history = this._chartHistorySeries();
    if (!history?.length) return null;

    if (!this._selectedDate) {
      const today = this._dateKey(new Date());
      this._selectedDate = history.some(entry => entry.date === today)
        ? today
        : history[history.length - 1].date;
    }

    return history.find(entry => entry.date === this._selectedDate)
      || history[history.length - 1]
      || null;
  }

  _dateLabel(dateKey) {
    if (!dateKey) return "Brak daty";
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    if (dateKey === this._dateKey(today)) return "Dzisiaj";
    if (dateKey === this._dateKey(yesterday)) return "Wczoraj";

    const parts = dateKey.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString("pl-PL", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
  }

  _changeDate(offset) {
    const keys = this._historyDateKeys();
    if (!keys.length) return;

    const current = keys.indexOf(this._selectedDate);
    const next = (current < 0 ? keys.length - 1 : current) + offset;

    if (next < 0 || next >= keys.length) return;

    this._selectedDate = keys[next];
    this._render();
  }

  _goToday() {
    const today = this._dateKey(new Date());
    const keys = this._historyDateKeys();
    this._selectedDate = keys.includes(today) ? today : (keys[keys.length - 1] || today);
    this._render();
  }

  _setAutoRefreshMinutes(value) {
    this._autoRefreshMinutes = Number(value) === 120 ? 120 : 60;
    this._config.auto_refresh_minutes = this._autoRefreshMinutes;
    this._startAutoRefresh();
    this._render();
  }

  _startAutoRefresh() {
    if (this._autoRefreshTimer) clearInterval(this._autoRefreshTimer);

    this._autoRefreshTimer = setInterval(async () => {
      if (this._loading || !this._hass) return;

      try {
        if (this._config.refresh_entity) {
          await this._hass.callService("button", "press", {
            entity_id: this._config.refresh_entity
          });
        }

        await new Promise(resolve => setTimeout(resolve, 1500));
        await this._loadHistory();
      } catch (err) {
        console.warn("Tauron Energy Card: automatic refresh failed", err);
      }
    }, this._autoRefreshMinutes * 60 * 1000);
  }

  _scheduleHistoryRefresh() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this._loadHistory(), 250);
  }

  _state(entity) {
    if (!entity || !this._hass?.states) return undefined;
    if (this._hass.states[entity]) return this._hass.states[entity];

    // Backward compatibility with the temporary entity ids used before
    // Home Assistant generated ids from the translated names.
    const aliases = {
      "sensor.serwerownia_tauron_elicznik_pse_today":
        "sensor.serwerownia_tauron_elicznik_energetyczny_kompas_dzisiaj",
      "sensor.serwerownia_tauron_elicznik_pse_tomorrow":
        "sensor.serwerownia_tauron_elicznik_energetyczny_kompas_jutro",
    };
    const resolved = aliases[entity];
    return resolved ? this._hass.states[resolved] : undefined;
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
    const entry = this._selectedHistoryEntry();
    return entry ? entry.value : null;
  }

  _todayDailyConsumed() {
    const historyValue = this._todayHistoryValue();
    if (Number.isFinite(historyValue)) return historyValue;

    if (this._selectedDate === this._dateKey(new Date())) {
      const value = this._num(this._config.daily_consumed_entity, NaN);
      return Number.isFinite(value) ? value : NaN;
    }

    return NaN;
  }


  _pseStatusClass(value) {
    const text = String(value || "").toLowerCase();
    if (text.includes("wymagane")) return "pse-red";
    if (text.includes("oszczędzanie")) return "pse-yellow";
    if (text.includes("normalne")) return "pse-green";
    if (text.includes("zalecane użytkowanie")) return "pse-darkgreen";
    return "pse-neutral";
  }

  _pseTimeline(entityId) {
    const hours = this._state(entityId)?.attributes?.hours;
    if (!Array.isArray(hours)) return "";
    return hours.map(item => {
      const time = String(item.dtime || "").slice(11, 16);
      const status = String(item.state || "Nieznany status");
      return `<div class="pse-hour ${this._pseStatusClass(status)}" title="${this._escape(status)}"><span>${time}</span><i></i></div>`;
    }).join("");
  }

  _pseCard(title, subtitle, entityId) {
    const state = this._state(entityId);
    const status = state?.state && !["unknown","unavailable"].includes(state.state)
      ? state.state
      : "Brak opublikowanych danych";
    const timeline = this._pseTimeline(entityId);
    return `<div class="pse-card">
      <div class="pse-card-head">
        <div><strong>${title}</strong><span>${subtitle}</span></div>
        <b class="${this._pseStatusClass(status)}">${this._escape(status)}</b>
      </div>
      <div class="pse-timeline">${timeline || '<div class="pse-empty">PSE nie opublikowało jeszcze godzin dla tego dnia.</div>'}</div>
    </div>`;
  }

  _hourlyProfileSvg() {
    const history = this._chartHistorySeries();
    if (!history?.length) return "";
    const entry = this._selectedHistoryEntry();
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
        <div class="section-title"><strong>Godzinowy profil zużycia · ${this._dateLabel(entry?.date || this._selectedDate)}</strong><span>24 godziny</span></div>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Godzinowy profil dzisiejszego zużycia">
          <line class="hour-grid" x1="${left}" y1="${top+plotH}" x2="${W-right}" y2="${top+plotH}"></line>
          ${bars}
        </svg>
      </div>
    `;
  }

  _energyFlowSvg(dailyConsumed) {
    const active = Number.isFinite(dailyConsumed) && dailyConsumed > 0;
    const status = active ? "Przepływ aktywny" : "Brak dzisiejszego poboru";
    const statusClass = active ? "flow-live" : "flow-idle";

    return `
      <div class="energy-flow ${statusClass}">
        <div class="flow-head">
          <div>
            <div class="flow-kicker">PRZEPŁYW ENERGII</div>
            <strong>Sieć → instalacja</strong>
            <span>Wizualizacja kierunku zasilania</span>
          </div>
          <div class="flow-status"><i></i>${status}</div>
        </div>

        <div class="flow-diagram" role="img" aria-label="Przepływ energii od słupa energetycznego przez skrzynię zabezpieczeń głównych do domu">
          <div class="flow-node pole">
            <div class="node-icon">
              <svg viewBox="0 0 64 64" aria-hidden="true">
                <path class="icon-stroke" d="M18 55L32 8l14 47M24 36h16M21 45h22M32 8v47M18 17h28"/>
              </svg>
            </div>
            <b>Słup energetyczny</b>
            <span>Sieć Tauron</span>
          </div>

          <div class="flow-track">
            <div class="track-line"></div>
            <div class="track-glow"></div>
            <div class="flow-particles"><i></i><i></i><i></i><i></i><i></i></div>
            <span class="flow-label">zasilanie</span>
          </div>

          <div class="flow-node fuse">
            <div class="node-icon">
              <svg viewBox="0 0 64 64" aria-hidden="true">
                <rect class="icon-stroke" x="10" y="8" width="44" height="48" rx="7"/>
                <path class="icon-stroke" d="M21 20h22M21 31h22M21 42h12M42 40v8M38 44h8"/>
                <circle class="icon-dot" cx="39" cy="21" r="3"/>
              </svg>
            </div>
            <b>Skrzynia zabezpieczeń</b>
            <span>Rozdzielnia główna</span>
          </div>

          <div class="flow-track">
            <div class="track-line"></div>
            <div class="track-glow"></div>
            <div class="flow-particles"><i></i><i></i><i></i><i></i><i></i></div>
            <span class="flow-label">instalacja</span>
          </div>

          <div class="flow-node house">
            <div class="node-icon">
              <svg viewBox="0 0 64 64" aria-hidden="true">
                <path class="icon-stroke" d="M8 29L32 10l24 19v27H8z"/>
                <path class="icon-stroke" d="M25 56V39h14v17M16 31h32"/>
                <path class="icon-stroke" d="M48 14v9"/>
              </svg>
            </div>
            <b>Dom</b>
            <span>Instalacja odbiorcza</span>
          </div>
        </div>

        <div class="flow-foot">
          <span><i class="flow-dot"></i> Animacja pokazuje kierunek przepływu</span>
          <strong>${Number.isFinite(dailyConsumed) ? `Dzisiaj · ${this._fmt(dailyConsumed,2)} kWh` : "Brak danych dziennych"}</strong>
        </div>
      </div>
    `;
  }

  _chartSvg() {
    const chartHistory = this._chartHistorySeries();
    const consumed = chartHistory || this._dailySeries(this._config.consumed_entity);
    const exported = this._dailySeries(this._config.exported_entity);
    const all = [...consumed.map(x => x.value), ...exported.map(x => x.value)];
    const max = Math.max(1, ...all) * 1.15;

    const W = 900, H = 280;
    const left = 46, right = 18, top = 22, bottom = 42;
    const plotW = W - left - right, plotH = H - top - bottom;

    const path = data => data.map((p, i) => {
      const x = left + (i / Math.max(1, data.length - 1)) * plotW;
      const y = top + plotH - (p.value / max) * plotH;
      return `${i ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ");

    const points = (data, cls, kind) => data.map((p, i) => {
      const x = left + (i / Math.max(1, data.length - 1)) * plotW;
      const y = top + plotH - (p.value / max) * plotH;
      return `<circle class="chart-point ${cls}" data-kind="${kind}" data-label="${this._escape(p.label)}" data-value="${p.value}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5"></circle>`;
    }).join("");

    const grid = [0, .25, .5, .75, 1].map(r => {
      const y = top + plotH - r * plotH;
      const value = max * r;
      return `<line class="grid" x1="${left}" y1="${y}" x2="${W-right}" y2="${y}"></line>
        <text class="y-axis" x="${left-10}" y="${y+4}" text-anchor="end">${this._fmt(value,1)}</text>`;
    }).join("");

    const labels = consumed.map((p, i) => {
      if (consumed.length > 8 && i % 2 !== 0) return "";
      const x = left + (i / Math.max(1, consumed.length - 1)) * plotW;
      return `<text class="axis" x="${x}" y="${H-12}" text-anchor="middle">${p.label}</text>`;
    }).join("");

    return `
      <div class="chart-wrap">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Zużycie energii z ostatnich dni">
          <defs>
            <linearGradient id="energyFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#4f7cff" stop-opacity=".22"></stop>
              <stop offset="100%" stop-color="#4f7cff" stop-opacity=".02"></stop>
            </linearGradient>
          </defs>
          ${grid}
          <path class="area-consumed" d="${path(consumed)} L ${W-right} ${top+plotH} L ${left} ${top+plotH} Z"></path>
          <path class="line-consumed" d="${path(consumed)}"></path>
          <path class="line-exported" d="${path(exported)}"></path>
          ${points(consumed, "dot-consumed", "Pobór")}
          ${points(exported, "dot-exported", "Oddanie")}
          ${labels}
        </svg>
        <div class="chart-tooltip" hidden></div>
      </div>
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
    const t1 = this._num(c.t1_entity, NaN);
    const t2 = this._num(c.t2_entity, NaN);
    const t3 = this._num(c.t3_entity, NaN);
    const t1Daily = this._num(c.t1_daily_entity, NaN);
    const t2Daily = this._num(c.t2_daily_entity, NaN);
    const t3Daily = this._num(c.t3_daily_entity, NaN);
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
      <style>
        :host {
          display:block;
          width:100%;
          color-scheme:light;
          --te-bg:#f4f7fb;
          --te-panel:#ffffff;
          --te-card:#ffffff;
          --te-border:#e5eaf2;
          --te-text:#172033;
          --te-muted:#738096;
          --te-blue:#4f7cff;
          --te-blue-2:#735cff;
          --te-green:#22a66f;
          --te-red:#e05260;
          font-family:Inter,Roboto,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        }
        *{box-sizing:border-box}
        .panel{
          width:100%;
          padding:22px;
          border:1px solid #e4e9f1;
          border-radius:20px;
          background:#f7f9fc;
          color:var(--te-text);
          box-shadow:0 10px 30px rgba(35,55,85,.08);
        }
        .top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px}
        .brand{display:flex;align-items:center;gap:12px}
        .energy-icon{
          width:42px;height:42px;border-radius:12px;display:grid;place-items:center;
          font-size:21px;background:#edf3ff;color:var(--te-blue);border:1px solid #dce7ff
        }
        h1{margin:0;font-size:22px;line-height:1.15;letter-spacing:-.02em}
        .subtitle{margin-top:4px;color:var(--te-muted);font-size:12px}
        .top-actions{display:flex;align-items:center;gap:10px}
        .connection{display:flex;align-items:center;gap:7px;color:var(--te-muted);font-size:11px;white-space:nowrap}
        .connection-dot{width:8px;height:8px;border-radius:50%;background:#25b87a;box-shadow:0 0 0 4px #e5f8ef}
        button{
          border:1px solid #dfe5ee;color:#33415a;background:#fff;cursor:pointer;
          transition:.16s ease
        }
        button:hover{background:#f2f6ff;border-color:#bfcfff}
        button:focus-visible{outline:2px solid var(--te-blue);outline-offset:2px}
        button:disabled{opacity:.55;cursor:wait}
        .refresh{width:38px;height:38px;border-radius:11px;font-size:19px;display:grid;place-items:center}
        .spin{display:inline-block;animation:spin 1s linear infinite}
        @keyframes spin{to{transform:rotate(360deg)}}

        .hero-grid{
          display:grid;grid-template-columns:minmax(0,1.6fr) minmax(220px,1fr) minmax(220px,1fr);
          gap:12px;margin-bottom:12px
        }
        .hero,.card,.stat,.section,.hourly{
          background:var(--te-panel);border:1px solid var(--te-border);
          box-shadow:0 5px 18px rgba(35,55,85,.055)
        }
        .hero{min-height:220px;border-radius:16px;padding:22px;position:relative;overflow:hidden}
        .hero::after{
          content:"";position:absolute;width:250px;height:250px;right:-90px;top:-120px;border-radius:50%;
          background:radial-gradient(circle,#edf3ff 0,rgba(237,243,255,0) 70%);pointer-events:none
        }
        .budget-ring{
          position:absolute;right:22px;top:22px;width:86px;height:86px;border-radius:50%;
          display:grid;place-items:center;
          background:conic-gradient(var(--te-blue) var(--budget),#edf0f5 0)
        }
        .budget-ring::before{content:"";position:absolute;inset:7px;border-radius:50%;background:#fff}
        .budget-ring>div{position:relative;z-index:1;text-align:center;font-weight:800;font-size:16px}
        .budget-ring span{display:block;margin-top:2px;color:var(--te-muted);font-size:7px;font-weight:600}
        .eyebrow{color:var(--te-muted);font-size:11px;text-transform:uppercase;letter-spacing:.11em;font-weight:700}
        .eyebrow-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--te-blue);margin-left:5px}
        .big-value{margin-top:7px;font-size:clamp(36px,4vw,50px);line-height:1;font-weight:800;letter-spacing:-.045em}
        .big-value small{font-size:16px;color:var(--te-muted);font-weight:600;letter-spacing:0}
        .hero-meta{display:flex;gap:34px;margin-top:28px}
        .hero-meta span{display:flex;flex-direction:column;gap:5px}
        .hero-meta b{font-size:9px;letter-spacing:.08em;color:var(--te-blue)!important}
        .hero-meta strong{font-size:13px}
        .card{border-radius:16px;padding:19px;min-height:220px}
        .card-title,.section-title{color:var(--te-muted);font-size:10px;text-transform:uppercase;letter-spacing:.08em}
        .card-date{margin-top:7px;color:var(--te-text);font-size:12px;font-weight:700}
        .metric-row{display:flex;justify-content:space-between;gap:10px;padding:13px 0;border-bottom:1px solid #eef1f5;color:var(--te-muted);font-size:12px}
        .metric-row:last-child{border-bottom:0}
        .metric-row strong{color:var(--te-text)}
        .billing-days{margin-top:22px;display:flex;align-items:baseline;gap:7px}
        .billing-days strong{font-size:36px;letter-spacing:-.04em}
        .billing-days span{color:var(--te-muted);font-size:11px}
        .progress{height:7px;margin-top:15px;border-radius:99px;background:#edf0f5;overflow:hidden}
        .progress>div{height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--te-blue),var(--te-blue-2))}
        .balance-small{margin-top:17px;font-size:17px;font-weight:800}
        .negative{color:var(--te-red)}.positive{color:var(--te-green)}

        .stat-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:12px}
        .stat{min-width:0;border-radius:14px;padding:15px}
        .stat-icon{color:var(--te-blue);font-size:16px;margin-bottom:10px}
        .stat-label{color:var(--te-muted);font-size:10px;line-height:1.35;min-height:27px}
        .stat-value{margin-top:6px;font-size:16px;font-weight:800}

        .section,.hourly{border-radius:16px;padding:17px;margin-bottom:12px}
        .section-title{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:11px}
        .energy-context{margin-bottom:12px;padding:17px;border-radius:16px;background:#fff;border:1px solid var(--te-border);box-shadow:0 5px 18px rgba(35,55,85,.055)}
        .context-head{display:flex;justify-content:space-between;align-items:center;gap:15px;margin-bottom:12px}
        .context-kicker{color:var(--te-blue);font-size:9px;font-weight:800;letter-spacing:.08em}
        .context-head h2{margin:4px 0 0;font-size:15px}
        .context-head p{margin:4px 0 0;color:var(--te-muted);font-size:10px}
        .tariff-pill{border:1px solid #dce6f3;background:#f7faff;border-radius:12px;padding:9px 12px;color:var(--te-muted);font-size:9px}
        .tariff-pill span{margin-right:6px}.tariff-pill strong{font-size:18px;color:var(--te-blue)}
        .energy-flow{margin:12px 0;padding:17px 18px;border:1px solid #dfe7f2;border-radius:17px;background:radial-gradient(circle at 50% -20%,rgba(79,124,255,.10),transparent 55%),linear-gradient(180deg,#fcfdff 0%,#f6f9fd 100%);box-shadow:0 8px 24px rgba(35,55,85,.055);overflow:hidden}
        .flow-head{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:15px}
        .flow-head>div:first-child{display:flex;flex-direction:column;gap:3px}
        .flow-kicker{font-size:8px;font-weight:900;letter-spacing:.12em;color:var(--te-blue)}
        .flow-head strong{font-size:13px;color:var(--te-text)}
        .flow-head span{font-size:9px;color:var(--te-muted)}
        .flow-status{display:flex;align-items:center;gap:6px;padding:7px 10px;border-radius:99px;background:#f0f3f7;color:#7a8799;font-size:9px;font-weight:800;white-space:nowrap}
        .flow-status i{width:7px;height:7px;border-radius:50%;background:#aab4c2;display:block}
        .flow-live .flow-status{background:#eaf8f1;color:#23805d}
        .flow-live .flow-status i{background:#32b47b;box-shadow:0 0 0 0 rgba(50,180,123,.35);animation:flowStatusPulse 1.8s ease-out infinite}
        .flow-diagram{display:grid;grid-template-columns:minmax(120px,1fr) minmax(90px,1.4fr) minmax(150px,1.05fr) minmax(90px,1.4fr) minmax(120px,1fr);align-items:center;gap:10px;min-height:154px;padding:12px 2px}
        .flow-node{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;z-index:2}
        .node-icon{width:56px;height:56px;display:grid;place-items:center;border-radius:16px;background:#fff;border:1px solid #e3eaf3;box-shadow:0 8px 20px rgba(35,55,85,.08);transition:transform .25s ease,box-shadow .25s ease,border-color .25s ease}
        .node-icon svg{width:36px;height:36px;overflow:visible}
        .icon-stroke{fill:none;stroke:#4d6d97;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
        .icon-dot{fill:#4f7cff}
        .flow-node b{margin-top:9px;color:var(--te-text);font-size:10px}
        .flow-node>span{margin-top:3px;color:var(--te-muted);font-size:8px}
        .flow-track{position:relative;height:62px;display:flex;align-items:center;justify-content:center;min-width:0}
        .track-line{height:3px;width:100%;border-radius:99px;background:linear-gradient(90deg,#d9e2ee,#bfcfe3,#d9e2ee);box-shadow:inset 0 0 0 1px rgba(65,95,135,.06)}
        .track-glow{position:absolute;left:0;top:50%;width:100%;height:9px;transform:translateY(-50%);border-radius:99px;background:linear-gradient(90deg,transparent,rgba(79,124,255,.18),transparent);filter:blur(6px);opacity:.55}
        .flow-particles{position:absolute;inset:0;display:flex;align-items:center;justify-content:space-between;padding:0 2px}
        .flow-particles i{display:block;width:7px;height:7px;border-radius:50%;background:#4f7cff;box-shadow:0 0 9px rgba(79,124,255,.65);opacity:.15}
        .flow-live .flow-particles i{animation:flowParticle 2.1s linear infinite}
        .flow-live .flow-particles i:nth-child(2){animation-delay:.42s}
        .flow-live .flow-particles i:nth-child(3){animation-delay:.84s}
        .flow-live .flow-particles i:nth-child(4){animation-delay:1.26s}
        .flow-live .flow-particles i:nth-child(5){animation-delay:1.68s}
        .flow-label{position:absolute;top:calc(50% + 15px);font-size:7px;color:#94a1b3;text-transform:uppercase;letter-spacing:.08em}
        .flow-live .node-icon{border-color:#d5e3ff;box-shadow:0 8px 22px rgba(79,124,255,.10)}
        .flow-live .flow-node:hover .node-icon{transform:translateY(-3px);box-shadow:0 12px 28px rgba(79,124,255,.15)}
        .flow-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:7px;padding-top:10px;border-top:1px solid #e9edf3;color:var(--te-muted);font-size:8px}
        .flow-foot>span{display:flex;align-items:center;gap:5px}
        .flow-foot strong{font-size:9px;color:var(--te-text)}
        .flow-dot{width:6px;height:6px;border-radius:50%;background:#4f7cff;display:inline-block}
        @keyframes flowParticle{0%{transform:translateX(0) scale(.75);opacity:.12}18%{opacity:.95}70%{opacity:.95}100%{transform:translateX(10px) scale(1);opacity:.12}}
        @keyframes flowStatusPulse{0%{box-shadow:0 0 0 0 rgba(50,180,123,.32)}70%{box-shadow:0 0 0 8px rgba(50,180,123,0)}100%{box-shadow:0 0 0 0 rgba(50,180,123,0)}}
        @keyframes flowParticleVertical{0%{transform:translateY(0) scale(.75);opacity:.12}18%{opacity:.95}70%{opacity:.95}100%{transform:translateY(10px) scale(1);opacity:.12}}
        @media(prefers-reduced-motion:reduce){.flow-live .flow-particles i,.flow-live .flow-status i{animation:none!important}}
        .zones-panel{margin-top:12px;padding:16px 17px;border:1px solid #dfe7f2;border-radius:16px;background:linear-gradient(180deg,#fbfdff 0%,#f6f9fd 100%);box-shadow:0 6px 20px rgba(35,55,85,.045)}
        .zones-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
        .zones-head>div:first-child{display:flex;flex-direction:column;gap:3px}
        .zones-head b{font-size:12px;color:var(--te-text);letter-spacing:.01em}
        .zones-head span{font-size:9px;color:var(--te-muted)}
        .zones-tariff{padding:7px 11px;border-radius:10px;background:#edf3ff;border:1px solid #d5e2ff;color:var(--te-blue);font-size:11px;font-weight:800;letter-spacing:.03em}
        .zones-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
        .zone-box{position:relative;min-width:0;padding:13px 13px 11px;border-radius:13px;background:#fff;border:1px solid #e4eaf2;box-shadow:0 2px 8px rgba(35,55,85,.035)}
        .zone-top{display:flex;align-items:center;gap:7px}
        .zone-top small{color:var(--te-muted);font-size:8px}
        .zone-badge{display:inline-flex;align-items:center;justify-content:center;min-width:25px;height:20px;padding:0 6px;border-radius:7px;background:#eef3fb;color:#47617f;font-size:9px;font-weight:900;letter-spacing:.03em}
        .zone-box strong{display:block;margin-top:9px;font-size:20px;line-height:1.05;color:var(--te-text);white-space:nowrap}
        .zone-box strong i{font-style:normal;font-size:10px;font-weight:700;color:var(--te-muted)}
        .zone-bottom{display:flex;justify-content:space-between;gap:8px;margin-top:11px;padding-top:9px;border-top:1px solid #eef1f5;align-items:center}
        .zone-bottom span{font-size:8px;color:var(--te-muted)}
        .zone-bottom b{font-size:11px;color:var(--te-text);white-space:nowrap}
        .zone-t1 .zone-badge{background:#edf3ff;color:#3f6acb}
        .zone-t2 .zone-badge{background:#edf9f4;color:#328267}
        .zone-t3 .zone-badge{background:#fff6e6;color:#a87516}
        .pse-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
        .pse-card{padding:13px;border:1px solid #e5eaf2;border-radius:13px;background:#fbfcfe}
        .pse-card-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
        .pse-card-head strong{display:block;font-size:12px;color:var(--te-text)}
        .pse-card-head span{display:block;margin-top:2px;font-size:9px;color:var(--te-muted)}
        .pse-card-head>b{padding:5px 8px;border-radius:99px;font-size:8px;white-space:nowrap;background:#f1f3f6;color:#6e7b8e}
        .pse-card-head>b.pse-darkgreen{background:#e5f8ee;color:#108956}
        .pse-card-head>b.pse-green{background:#edf8f1;color:#397b5c}
        .pse-card-head>b.pse-yellow{background:#fff4d8;color:#a87800}
        .pse-card-head>b.pse-red{background:#ffe8eb;color:#b84450}
        .pse-timeline{display:grid;grid-template-columns:repeat(24,minmax(0,1fr));gap:3px;margin-top:12px}
        .pse-hour{text-align:center;min-width:0}.pse-hour span{display:block;color:#8a96a8;font-size:7px;margin-bottom:3px}.pse-hour i{display:block;height:20px;border-radius:4px;background:#dfe5ec}
        .pse-hour.pse-darkgreen i{background:#27ae71}.pse-hour.pse-green i{background:#8bcfac}.pse-hour.pse-yellow i{background:#f0c04d}.pse-hour.pse-red i{background:#df5b66}
        .pse-empty{grid-column:1/-1;padding:12px 0;color:var(--te-muted);font-size:10px}
        .pse-legend{display:flex;gap:13px;flex-wrap:wrap;margin-top:9px;color:var(--te-muted);font-size:8px}
        .pse-legend span{display:inline-flex;align-items:center;gap:5px}.pse-legend i{width:7px;height:7px;border-radius:50%}.legend-darkgreen{background:#27ae71}.legend-green{background:#8bcfac}.legend-yellow{background:#f0c04d}.legend-red{background:#df5b66}
        .chart-header{align-items:center}
        .energy-controls{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
        .date-nav,.date-current,.auto-select{height:30px;border:1px solid #dfe6ef;background:#fff;color:var(--te-text);border-radius:8px;font-size:10px}
        .date-nav{width:31px;padding:0;font-size:18px;line-height:1;cursor:pointer}
        .date-nav:hover:not(:disabled){background:#edf3ff;border-color:#c8d9ff;color:var(--te-blue)}
        .date-nav:disabled{opacity:.35;cursor:not-allowed}
        .date-current{min-width:110px;padding:0 10px;font-weight:700;cursor:pointer}
        .date-current:hover{background:#edf3ff;border-color:#c8d9ff;color:var(--te-blue)}
        .auto-select{padding:0 8px;color:var(--te-muted);cursor:pointer}
        .section-title strong{color:var(--te-text);font-size:14px;text-transform:none;letter-spacing:0}
        .section-title>span{font-size:10px}
        .chart-wrap{position:relative;width:100%;height:280px}
        .chart-wrap svg{width:100%;height:100%;display:block;overflow:visible}
        .grid,.hour-grid{stroke:#edf0f5;stroke-width:1}
        .axis,.y-axis,.hour-axis{fill:#8a96a8;font-size:10px}
        .y-axis{font-size:9px}
        .area-consumed{fill:url(#energyFill)}
        .line-consumed{fill:none;stroke:#4f7cff;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
        .line-exported{fill:none;stroke:#22a66f;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
        .chart-point{cursor:pointer;transition:r .12s ease,stroke-width .12s ease}
        .chart-point:hover{r:7}
        .dot-consumed{fill:#4f7cff;stroke:#fff;stroke-width:2.5}
        .dot-exported{fill:#22a66f;stroke:#fff;stroke-width:2.5}
        .chart-tooltip{
          position:absolute;z-index:5;min-width:135px;padding:9px 11px;border-radius:10px;
          background:#172033;color:#fff;box-shadow:0 8px 24px rgba(22,32,51,.22);
          pointer-events:none;font-size:11px
        }
        .chart-tooltip[hidden]{display:none}
        .chart-tooltip strong,.chart-tooltip span,.chart-tooltip b{display:block}
        .chart-tooltip span{margin-top:3px;color:#c5cfdd}.chart-tooltip b{margin-top:4px;font-size:13px}
        .hourly{min-height:225px}
        .hour-bar{fill:#4f7cff;opacity:.78}
        .hour-bar:hover{fill:#735cff;opacity:1}
        .legend{display:flex;gap:18px;color:var(--te-muted);font-size:10px;margin-top:5px}
        .legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}
        .legend .c{background:#4f7cff}.legend .e{background:#22a66f}

        .details-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        .detail-row{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #eef1f5;color:var(--te-muted);font-size:11px}
        .detail-row strong{color:var(--te-text);white-space:nowrap}
        .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}
        .info{border-radius:11px;padding:11px;background:#f7f9fc}
        .info-label{color:var(--te-muted);font-size:9px;text-transform:uppercase;letter-spacing:.06em}
        .info-value{margin-top:5px;color:var(--te-text);font-size:11px;font-weight:700}
        .wide-refresh{width:100%;margin-top:13px;min-height:40px;border-radius:10px;font-size:12px;font-weight:700}
        .footer{display:flex;justify-content:space-between;gap:12px;color:#8c98a9;font-size:9px;padding:3px 2px 0}
        @media(max-width:1050px){.hero-grid{grid-template-columns:1fr 1fr}.hero{grid-column:1/-1}.stat-grid{grid-template-columns:repeat(3,1fr)}}
        @media(max-width:700px){.panel{padding:13px;border-radius:14px}.top{align-items:flex-start}.connection{display:none}.hero-grid,.details-grid,.pse-grid,.zones-grid{grid-template-columns:1fr}.hero{grid-column:auto;min-height:210px}.stat-grid{grid-template-columns:repeat(2,1fr)}.hero-meta{gap:18px}.footer{flex-direction:column}.chart-wrap{height:230px}.context-head{align-items:flex-start;flex-direction:column}.zone-box strong{font-size:18px}.flow-head{align-items:flex-start;flex-direction:column}.flow-diagram{grid-template-columns:1fr;grid-template-rows:auto 58px auto 58px auto;gap:4px}.flow-track{height:58px}.flow-track .track-line{width:3px;height:100%;background:linear-gradient(180deg,#d9e2ee,#bfcfe3,#d9e2ee)}.flow-track .track-glow{width:9px;height:100%;left:50%;top:0;transform:translateX(-50%);background:linear-gradient(180deg,transparent,rgba(79,124,255,.18),transparent)}.flow-particles{flex-direction:column;padding:2px 0;left:50%;right:auto;top:0;bottom:0;transform:translateX(-50%)}.flow-live .flow-particles i{animation:flowParticleVertical 2.1s linear infinite}.flow-live .flow-particles i:nth-child(2){animation-delay:.42s}.flow-live .flow-particles i:nth-child(3){animation-delay:.84s}.flow-live .flow-particles i:nth-child(4){animation-delay:1.26s}.flow-live .flow-particles i:nth-child(5){animation-delay:1.68s}.flow-label{top:50%;left:calc(50% + 12px);transform:translateY(-50%)}.flow-foot{align-items:flex-start;flex-direction:column}.zones-head{align-items:flex-start}.zones-tariff{align-self:flex-start}}
      </style>
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
            <div class="eyebrow">POBÓR · ${this._dateLabel(this._selectedDate)} <span class="eyebrow-dot"></span></div>
            <div class="big-value">${Number.isFinite(dailyConsumed) ? this._fmt(dailyConsumed,2) : "—"} <small>kWh</small></div>
            <div class="hero-meta">
              <span><b style="color:#89a9ff">SUMA · ${this._dateLabel(this._selectedDate).toUpperCase()}</b><strong>${Number.isFinite(dailyConsumed) ? this._fmt(dailyConsumed,2) : "—"} kWh</strong></span>
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

        ${this._energyFlowSvg(dailyConsumed)}

        <div class="zones-panel">
          <div class="zones-head">
            <div>
              <b>Strefy taryfowe</b>
              <span>Stan licznika i zużycie dzisiaj</span>
            </div>
            <div class="zones-tariff">${this._escape(this._state(c.tariff_entity)?.state || "—")}</div>
          </div>
          <div class="zones-grid">
            <div class="zone-box zone-t1">
              <div class="zone-top"><span class="zone-badge">T1</span><small>Strefa 1</small></div>
              <strong>${Number.isFinite(t1) ? this._fmt(t1,0) : "—"} <i>kWh</i></strong>
              <div class="zone-bottom"><span>Dzisiaj</span><b>${Number.isFinite(t1Daily) ? this._fmt(t1Daily,1) : "—"} kWh</b></div>
            </div>
            <div class="zone-box zone-t2">
              <div class="zone-top"><span class="zone-badge">T2</span><small>Strefa 2</small></div>
              <strong>${Number.isFinite(t2) ? this._fmt(t2,0) : "—"} <i>kWh</i></strong>
              <div class="zone-bottom"><span>Dzisiaj</span><b>${Number.isFinite(t2Daily) ? this._fmt(t2Daily,1) : "—"} kWh</b></div>
            </div>
            <div class="zone-box zone-t3">
              <div class="zone-top"><span class="zone-badge">T3</span><small>Strefa 3</small></div>
              <strong>${Number.isFinite(t3) ? this._fmt(t3,0) : "—"} <i>kWh</i></strong>
              <div class="zone-bottom"><span>Dzisiaj</span><b>${Number.isFinite(t3Daily) ? this._fmt(t3Daily,1) : "—"} kWh</b></div>
            </div>
          </div>
        </div>

        <div class="stat-grid">
          <div class="stat"><div class="stat-icon">⚡</div><div class="stat-label">Dzienny budżet</div><div class="stat-value">${Number.isFinite(dailyBudget) ? this._fmt(dailyBudget,2) : "—"} kWh</div></div>
          <div class="stat"><div class="stat-icon">▣</div><div class="stat-label">Miesięczny budżet</div><div class="stat-value">${Number.isFinite(monthlyBudget) ? this._fmt(monthlyBudget,2) : "—"} kWh</div></div>
          <div class="stat"><div class="stat-icon">⌁</div><div class="stat-label">Średnie zużycie dzienne</div><div class="stat-value">${Number.isFinite(dailyAverage) ? this._fmt(dailyAverage,2) : "—"} kWh</div></div>
          <div class="stat"><div class="stat-icon">↗</div><div class="stat-label">Łącznie pobrano</div><div class="stat-value">${this._fmt(consumed,1)} kWh</div></div>
          <div class="stat"><div class="stat-icon">↙</div><div class="stat-label">Łącznie oddano</div><div class="stat-value">${this._fmt(exported,1)} kWh</div></div>
        </div>

        <div class="energy-context">
          <div class="context-head">
            <div>
              <div class="context-kicker">TARYFA I SYSTEM ENERGETYCZNY</div>
              <h2>Informacje energetyczne</h2>
              <p>Informacja pobrana ze strony Energetycznego Kompasu Polskich Sieci Elektroenergetycznych (PSE).</p>
            </div>
            <div class="tariff-pill"><span>TARYFA</span><strong>${this._escape(this._state(c.tariff_entity)?.state || "—")}</strong></div>
          </div>
          <div class="pse-grid">
            ${this._pseCard("Dzisiaj", "Energetyczne godziny szczytu", c.pse_today_entity)}
            ${this._pseCard("Jutro · D+1", "Planowane energetyczne godziny szczytu", c.pse_tomorrow_entity)}
          </div>
          <div class="pse-legend">
            <span><i class="legend-darkgreen"></i>Zalecane użytkowanie</span>
            <span><i class="legend-green"></i>Normalne użytkowanie</span>
            <span><i class="legend-yellow"></i>Zalecane oszczędzanie</span>
            <span><i class="legend-red"></i>Wymagane ograniczenie</span>
          </div>
        </div>

        <div class="section">
          <div class="section-title chart-header">
          <div><strong>Zużycie energii</strong><span style="margin-left:8px">ostatnie ${Number(c.days_history || 14)} dni</span></div>
          <div class="energy-controls">
            <button class="date-nav" data-energy-date="-1" title="Poprzedni dzień" aria-label="Poprzedni dzień">‹</button>
            <button class="date-current" data-energy-today>${this._dateLabel(this._selectedDate)}</button>
            <button class="date-nav" data-energy-date="1" title="Następny dzień" aria-label="Następny dzień" ${this._dateKey(new Date()) === this._selectedDate ? "disabled" : ""}>›</button>
            <select class="auto-select" aria-label="Automatyczne odświeżanie danych">
              <option value="60" ${this._autoRefreshMinutes === 60 ? "selected" : ""}>Auto 60 min</option>
              <option value="120" ${this._autoRefreshMinutes === 120 ? "selected" : ""}>Auto 120 min</option>
            </select>
          </div>
        </div>
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
          <span>Wybrany dzień: ${this._selectedDate || "—"} · Auto ${this._autoRefreshMinutes} min · ${updated ? "Aktualizacja " + this._date(updated) + " · " + this._relative(updated) : "Brak aktualizacji"}</span>
        </div>
      </section>
    `;

    this.shadowRoot.querySelectorAll("[data-energy-date]").forEach(button => {
      button.addEventListener("click", () => this._changeDate(Number(button.dataset.energyDate)));
    });

    const todayButton = this.shadowRoot.querySelector("[data-energy-today]");
    if (todayButton) todayButton.addEventListener("click", () => this._goToday());

    const autoSelect = this.shadowRoot.querySelector(".auto-select");
    if (autoSelect) {
      autoSelect.addEventListener("change", event => this._setAutoRefreshMinutes(event.target.value));
    }

    this.shadowRoot.querySelectorAll(".refresh, .wide-refresh").forEach(button => {
      button.addEventListener("click", () => this._refresh());
    });

    const chart = this.shadowRoot.querySelector(".chart-wrap");
    const tooltip = this.shadowRoot.querySelector(".chart-tooltip");
    if (chart && tooltip) {
      chart.querySelectorAll(".chart-point").forEach(point => {
        point.addEventListener("mouseenter", () => {
          tooltip.hidden = false;
          tooltip.innerHTML = `<strong>${point.dataset.kind}</strong><span>${point.dataset.label}</span><b>${this._fmt(Number(point.dataset.value), 2)} kWh</b>`;
        });
        point.addEventListener("mousemove", event => {
          const rect = chart.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const y = event.clientY - rect.top;
          tooltip.style.left = `${Math.max(8, Math.min(x + 12, rect.width - 150))}px`;
          tooltip.style.top = `${Math.max(8, y - 70)}px`;
        });
        point.addEventListener("mouseleave", () => {
          tooltip.hidden = true;
        });
      });
    }
  }
}

customElements.define("tauron-energy-card", TauronEnergyCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "tauron-energy-card",
  name: "Tauron Energy Card",
  description: "Nowoczesny panel Tauron eLicznik."
});
