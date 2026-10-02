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
      days_history: 30,
      auto_refresh_minutes: 60,
      power_entity: "",
      cost_entity: "",
      carbon_entity: "",
      meter_number_entity: "",
      flow_image_url: "/local/tauron-energy-flow-clean2.jpg"
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

  _energyFlowSvg(dailyConsumed){
    const active=Number.isFinite(dailyConsumed)&&dailyConsumed>0;
    const imageUrl=this._config.flow_image_url||"/local/tauron-energy-flow-clean2.jpg";
    const total=this._num(this._config.consumed_entity,NaN);
    const meter=Number.isFinite(total)?String(Math.round(total)).padStart(6,"0"):"------";
    const power=this._num(this._config.power_entity,NaN);
    const t1=this._num(this._config.t1_entity,NaN);
    const t2=this._num(this._config.t2_entity,NaN);
    const t3=this._num(this._config.t3_entity,NaN);

    const a1="M166 91 C250 86 348 103 446 127";
    const a2="M595 135 C646 136 688 131 735 128";
    const a3="M910 130 C963 135 1008 157 1050 167";
    const arrow=(path,delay)=>\`
      <g class="energy-arrow">
        <path d="M0 0 L16 9 L0 18"/>
        <animateMotion dur="2.8s" begin="{{delay}}s" repeatCount="indefinite" rotate="auto" path="{{path}}"/>
      </g>\`.replaceAll("{{",").replaceAll(}","}");

    return \`
      <section class="scene {{active?"flow-live":"flow-idle"}}" aria-label="Przepływ energii">
        <div class="scene-topbar">
          <div>
            <div class="scene-kicker">PRZEPŁYW ENERGII</div>
            <strong>Sieć → licznik → rozdzielnica → dom</strong>
            <span>Animowany kierunek przepływu</span>
          </div>
          <div class="scene-status"><i></i>{{active?"Przepływ aktywny":"Brak dzisiejszego poboru"}}</div>
        </div>
        <div class="scene-art">
          <img src="{{this._escape(imageUrl)}}" alt="Słup energetyczny, licznik MA309M, rozdzielnica główna i dom" loading="eager" decoding="async">
          <svg class="scene-motion" viewBox="0 0 1250 233" preserveAspectRatio="none" aria-hidden="true">
            <defs><filter id="sceneArrowGlow"><feGaussianBlur stdDeviation="3.2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
            <path class="scene-motion-line" d="{{a1}}"/><path class="scene-motion-line" d="{{a2}}"/><path class="scene-motion-line" d="{{a3}}"/>
            <g class="scene-arrows">{{arrow(a1,0)}}{{arrow(a1,.47)}}{{arrow(a2,.94)}}{{arrow(a2,1.41)}}{{arrow(a3,1.88)}}{{arrow(a3,2.35)}}</g>
          </svg>
          <div class="scene-meter-live" aria-label="Rzeczywisty stan licznika z Home Assistant"><strong>{{meter}}</strong><span>kWh</span></div>
          <div class="scene-data-strip">
            <span><b>Pobór dzisiaj</b> {{Number.isFinite(dailyConsumed)?this._fmt(dailyConsumed,2):"—"}} kWh</span>
            {{Number.isFinite(power)?\`<span><b>Moc chwilowa</b> {{this._fmt(power,0)}} W</span>\`:"<span><b>Moc chwilowa</b> —</span>"}}
            {{Number.isFinite(t1)?\`<span><b>T1</b> {{this._fmt(t1,0)}} kWh</span>\`:""}}
            {{Number.isFinite(t2)?\`<span><b>T2</b> {{this._fmt(t2,0)}} kWh</span>\`:""}}
            {{Number.isFinite(t3)?\`<span><b>T3</b> {{this._fmt(t3,0)}} kWh</span>\`:""}}
          </div>
          <div class="scene-vignette" aria-hidden="true"></div>
        </div>
        <div class="scene-bottom"><span><i class="flow-dot"></i>{{active?"Animowany przepływ aktywny":"Brak dzisiejszego poboru"}} · dane rzeczywiste z Home Assistant</span><strong>{{Number.isFinite(dailyConsumed)?\`Dzisiaj · {{this._fmt(dailyConsumed,2)}} kWh\`:"Brak danych dziennych"}}</strong></div>
      </section>
    \`.replaceAll("{{",").replaceAll(}","}");
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
  const tariff = this._state(c.tariff_entity)?.state || "—";
  const power = this._num(c.power_entity, NaN);
  const cost = this._num(c.cost_entity, NaN);
  const carbon = this._num(c.carbon_entity, NaN);
  const updated = lastFetch || lastReading;
  const balanceClass = balance < 0 ? "negative" : balance > 0 ? "positive" : "";
  const budgetBase = Math.abs(dailyBudget);
  const budgetPercent = budgetBase > 0 && Number.isFinite(dailyConsumed)
    ? Math.min(100, Math.max(0, (dailyConsumed / budgetBase) * 100))
    : 0;
  const daysPercent = Number.isFinite(days) ? Math.max(0, Math.min(100, (days / 365) * 100)) : 0;

  const fmtPower = value => Number.isFinite(value)
    ? `${this._fmt(value,0)} W`
    : "—";
  const fmtCost = value => Number.isFinite(value) ? `${this._fmt(value,2)} zł` : "—";
  const fmtCarbon = value => Number.isFinite(value) ? `${this._fmt(value,1)} kg CO₂` : "—";

  const currentDate = this._dateKey(new Date());
  const selectedDate = this._selectedDate || currentDate;
  const selectedLabel = this._dateLabel(selectedDate);
  const historyForStats = this._chartHistorySeries() || [];
  const historyValues = historyForStats.map(x => Number(x.value)).filter(Number.isFinite);
  const minCandidates = historyValues.filter(v => v >= 0);
  const maxDaily30 = historyValues.length ? Math.max(...historyValues) : NaN;
  const minDaily30 = minCandidates.length ? Math.min(...minCandidates) : NaN;
  const total30 = historyValues.length ? historyValues.reduce((sum, v) => sum + v, 0) : NaN;
  const status = Number.isFinite(dailyConsumed) && dailyConsumed > 0 ? "W porządku" : "Brak danych";

  this.shadowRoot.innerHTML = `
    <style>
      :host{
        display:block;width:100%;color-scheme:dark;
        --te-bg:#04111d;--te-panel:#081826;--te-card:#0b1d2c;--te-card2:#0e2234;
        --te-border:#17354b;--te-border-2:#204864;--te-text:#edf7ff;--te-muted:#8ca7bd;
        --te-blue:#299cff;--te-cyan:#5ee7ff;--te-green:#27dc84;--te-orange:#ff9b3d;
        --te-purple:#9d63ff;--te-red:#ff5e70;--te-shadow:0 18px 50px rgba(0,0,0,.28);
        font-family:Inter,Roboto,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      }
      *{box-sizing:border-box}
      .dashboard{
        width:100%;padding:18px;border-radius:24px;
        background:
          radial-gradient(circle at 8% 0%,rgba(41,156,255,.13),transparent 28%),
          radial-gradient(circle at 98% 12%,rgba(157,99,255,.10),transparent 22%),
          linear-gradient(180deg,#061523 0%,#03101a 100%);
        color:var(--te-text);box-shadow:var(--te-shadow);overflow:hidden;
      }
      .topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px}
      .brand{display:flex;align-items:center;gap:10px;min-width:220px}
      .brand-mark{
        width:48px;height:48px;border-radius:15px;display:grid;place-items:center;
        background:linear-gradient(145deg,#21153b,#471e69);border:1px solid #683e8f;
        box-shadow:0 10px 30px rgba(123,73,255,.26)
      }
      .brand-mark svg{width:34px;height:34px;filter:drop-shadow(0 0 7px rgba(255,59,145,.28))}
      .brand h1{margin:0;font-size:21px;letter-spacing:-.03em;line-height:1}
      .brand h1 span{display:block;color:#ff3b93;font-size:16px;margin-top:2px}
      .brand small{display:block;color:var(--te-muted);margin-top:5px;font-size:9px}
      .nav{
        display:flex;align-items:center;gap:5px;padding:5px;border:1px solid #19384e;
        border-radius:999px;background:rgba(10,28,44,.8);box-shadow:inset 0 1px 0 rgba(255,255,255,.02)
      }
      .nav b{
        padding:9px 24px;border-radius:999px;font-size:11px;color:#9bb4ca;font-weight:700;white-space:nowrap
      }
      .nav b.active{color:#fff;background:linear-gradient(180deg,#278fe9,#1972c5);box-shadow:0 0 28px rgba(41,156,255,.38)}
      .connection{
        min-width:220px;display:flex;align-items:center;justify-content:center;gap:9px;
        padding:10px 14px;border:1px solid #1a3b51;border-radius:16px;background:rgba(11,30,45,.72)
      }
      .connection i{width:10px;height:10px;border-radius:50%;background:#26dd7d;box-shadow:0 0 0 5px rgba(38,221,125,.10)}
      .connection strong{font-size:11px;color:#f4fbff}
      .connection span{display:block;font-size:8px;color:var(--te-muted);margin-top:2px}
      .refresh{
        width:34px;height:34px;border:1px solid #1b3d55;background:#0b2235;color:#d9edff;border-radius:11px;
        font-size:18px;cursor:pointer;transition:.18s ease
      }
      .refresh:hover{border-color:#318fd5;background:#102d43}
      .refresh:focus-visible,button:focus-visible,select:focus-visible{outline:2px solid var(--te-cyan);outline-offset:2px}
      .spin{display:inline-block;animation:spin 1s linear infinite}
      @keyframes spin{to{transform:rotate(360deg)}}

      .scene{position:relative;margin-bottom:14px;overflow:hidden;border:1px solid #173b55;border-radius:18px;background:#061624;box-shadow:0 14px 40px rgba(0,0,0,.22)}
      .scene-topbar{position:absolute;z-index:6;left:18px;right:18px;top:14px;display:flex;justify-content:space-between;gap:12px;align-items:flex-start;text-shadow:0 2px 12px rgba(0,0,0,.7)}
      .scene-topbar>div:first-child{display:flex;flex-direction:column;gap:2px}
      .scene-kicker{font-size:8px;font-weight:900;letter-spacing:.15em;color:#6dd7ff}.scene-topbar strong{font-size:13px;color:#eef9ff}.scene-topbar span{font-size:8px;color:#b2c8dc}
      .scene-status{display:flex;align-items:center;gap:7px;padding:7px 10px;border-radius:999px;background:rgba(3,17,28,.78);border:1px solid rgba(87,145,180,.35);font-size:9px;font-weight:800;white-space:nowrap}
      .scene-status i{width:7px;height:7px;border-radius:50%;background:#a8b9c8}.flow-live .scene-status{color:#71efad;border-color:rgba(39,220,132,.35)}
      .flow-live .scene-status i{background:#27dc84;box-shadow:0 0 12px rgba(39,220,132,.8);animation:sceneStatusPulse 1.8s ease-out infinite}
      @keyframes sceneStatusPulse{0%{transform:scale(.85);box-shadow:0 0 0 0 rgba(39,220,132,.35)}70%{transform:scale(1);box-shadow:0 0 0 8px rgba(39,220,132,0)}100%{box-shadow:0 0 0 0 rgba(39,220,132,0)}}
      .scene-art{position:relative;width:100%;aspect-ratio:1250/233;overflow:hidden;background:#061624;isolation:isolate}
      .scene-art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;display:block}
      .scene-cover{position:absolute;inset:0;z-index:2;width:100%;height:100%;pointer-events:none;overflow:hidden}
      .scene-cover path{fill:none;stroke:#061623;stroke-width:15;stroke-linecap:round;opacity:.96;filter:blur(2px)}
      .scene-motion{position:absolute;inset:0;z-index:4;width:100%;height:100%;display:block;pointer-events:none;overflow:hidden}
      .scene-motion-line{fill:none;stroke:#62d9ff;stroke-width:2.1;stroke-linecap:round;opacity:.22;filter:url(#sceneArrowGlow)}
      .scene-arrows{display:none}.flow-live .scene-arrows{display:block}
      .energy-arrow{opacity:0}.flow-live .energy-arrow{opacity:1}
      .energy-arrow path{fill:none;stroke:#d8fbff;stroke-width:3.2;stroke-linecap:round;stroke-linejoin:round;filter:url(#sceneArrowGlow)}
      .scene-meter-live{position:absolute;z-index:5;left:38.1%;top:39.5%;width:6.1%;height:17%;display:flex;align-items:center;justify-content:center;flex-direction:column;background:linear-gradient(180deg,rgba(238,250,255,.98),rgba(207,237,242,.97));border:1px solid rgba(54,93,112,.68);border-radius:7px;box-shadow:0 0 10px rgba(58,205,255,.18);color:#132b3a;line-height:1}
      .scene-meter-live strong{font:800 clamp(7px,1vw,15px)/1 monospace;letter-spacing:.02em}.scene-meter-live span{margin-top:2px;font:800 clamp(4px,.4vw,7px)/1 system-ui;color:#516b79}
      .scene-data-strip{position:absolute;z-index:6;left:50%;bottom:8%;transform:translateX(-50%);display:flex;align-items:center;justify-content:center;gap:7px;max-width:94%;padding:5px 8px;border:1px solid rgba(111,193,231,.3);border-radius:999px;background:rgba(3,18,29,.72);backdrop-filter:blur(6px);box-shadow:0 5px 16px rgba(0,0,0,.24);color:#c4d9e6;font-size:7px;white-space:nowrap}
      .scene-data-strip span{padding:0 5px;border-right:1px solid rgba(142,191,216,.2)}.scene-data-strip span:last-child{border-right:0}.scene-data-strip b{color:#f0f8fc;margin-right:2px}
      .scene-vignette{position:absolute;z-index:1;inset:0;pointer-events:none;background:linear-gradient(90deg,rgba(2,11,20,.07),transparent 24%,transparent 76%,rgba(2,11,20,.07))}
      .scene-bottom{position:relative;z-index:6;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 14px;border-top:1px solid #17384e;background:#06131e;font-size:8px;color:#91aabd}
      .scene-bottom span{display:flex;align-items:center;gap:6px}.scene-bottom strong{color:#e8f5ff;font-size:9px}.flow-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#36d8ff;box-shadow:0 0 8px rgba(54,216,255,.65)}
      .kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}
      .kpi{
        min-height:150px;padding:16px;border-radius:16px;border:1px solid #17354b;
        background:linear-gradient(180deg,#0a1d2c,#071827);box-shadow:0 10px 24px rgba(0,0,0,.16);overflow:hidden;position:relative
      }
      .kpi::after{content:"";position:absolute;width:130px;height:130px;right:-55px;top:-55px;border-radius:50%;background:radial-gradient(circle,rgba(41,156,255,.10),transparent 70%)}
      .kpi-top{display:flex;align-items:center;justify-content:space-between;gap:9px}
      .kpi-icon{
        width:36px;height:36px;border-radius:12px;display:grid;place-items:center;font-size:18px;
        background:#0d2b43;border:1px solid #1f4a67;color:#64ceff;box-shadow:inset 0 0 20px rgba(41,156,255,.08)
      }
      .kpi.orange .kpi-icon{background:#30200e;border-color:#64451f;color:#ffc04b}.kpi.green .kpi-icon{background:#082a1d;border-color:#174e37;color:#5deca8}.kpi.purple .kpi-icon{background:#211536;border-color:#50327a;color:#bf91ff}
      .kpi-label{color:#9db6ca;font-size:11px}
      .kpi-value{margin-top:13px;font-size:31px;font-weight:900;letter-spacing:-.035em;line-height:1}
      .kpi-value small{font-size:13px;color:#9fb7cb;font-weight:700;letter-spacing:0}
      .kpi-sub{margin-top:9px;color:#a7bdd0;font-size:9px}
      .kpi-sub strong{display:block;color:#65ebaa;font-size:9px;margin-top:3px}
      .kpi-bar{position:absolute;left:16px;right:16px;bottom:15px;height:6px;border-radius:99px;background:#102c41;overflow:hidden}
      .kpi-bar i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#31a6ff,#6de5ff);max-width:100%}
      .kpi.orange .kpi-bar i{background:linear-gradient(90deg,#ff9c3a,#ffd071)}.kpi.green .kpi-bar i{background:linear-gradient(90deg,#28d883,#83f4bd)}
      .kpi.purple .kpi-bar i{background:linear-gradient(90deg,#9554ff,#c49aff)}

      .main-grid{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(0,1fr);gap:12px;margin-bottom:12px}
      .panel-card{border:1px solid #17354b;border-radius:17px;background:linear-gradient(180deg,#091b29,#071725);padding:16px;box-shadow:0 10px 26px rgba(0,0,0,.16)}
      .card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:13px}
      .card-head strong{font-size:15px;letter-spacing:-.015em}
      .card-head span{display:block;color:#859fb4;font-size:9px;margin-top:2px}
      .pill{padding:7px 10px;border:1px solid #204966;border-radius:999px;background:#0c2b45;color:#61c8ff;font-size:9px;font-weight:900}
      .zone-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}
      .zone{
        border:1px solid #193c53;border-radius:14px;padding:13px;background:linear-gradient(180deg,#0a2030,#071825);min-width:0
      }
      .zone .badge{
        display:inline-flex;align-items:center;justify-content:center;min-width:42px;height:25px;padding:0 10px;
        border-radius:9px;font-size:10px;font-weight:900
      }
      .z1 .badge{background:#14365e;color:#69c3ff;border:1px solid #225b94}.z2 .badge{background:#3c2a10;color:#ffc45c;border:1px solid #795421}.z3 .badge{background:#312052;color:#bf96ff;border:1px solid #65419b}
      .zone small{display:block;color:#7994aa;font-size:8px;margin-top:7px}.zone>b{display:block;margin-top:8px;font-size:20px}.zone>b i{font-style:normal;font-size:10px;color:#8ba5ba}
      .zone-footer{display:flex;justify-content:space-between;gap:8px;margin-top:12px;padding-top:9px;border-top:1px solid #17354a;color:#7993a9;font-size:8px}
      .zone-footer strong{color:#e3f1fb;font-size:11px}

      .chart-wrap{position:relative;width:100%;height:250px}
      .chart-wrap svg{display:block;width:100%;height:100%;overflow:visible}
      .grid{stroke:#163349;stroke-width:1}.axis,.y-axis{fill:#7894aa;font-size:9px}.area-consumed{fill:url(#energyFill)}
      .line-consumed{fill:none;stroke:#32a5ff;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 0 5px rgba(50,165,255,.28))}
      .line-exported{fill:none;stroke:#2dd787;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
      .dot-consumed{fill:#38a7ff;stroke:#071726;stroke-width:3}.dot-exported{fill:#35d88b;stroke:#071726;stroke-width:3}
      .chart-point{cursor:pointer;transition:r .12s ease}.chart-point:hover{r:7}
      .chart-tooltip{
        position:absolute;z-index:5;min-width:145px;padding:9px 11px;border-radius:10px;
        background:#0a1a29;color:#fff;border:1px solid #234864;box-shadow:0 12px 28px rgba(0,0,0,.36);pointer-events:none;font-size:11px
      }
      .chart-tooltip[hidden]{display:none}.chart-tooltip strong,.chart-tooltip span,.chart-tooltip b{display:block}
      .chart-tooltip span{margin-top:3px;color:#9eb6ca}.chart-tooltip b{margin-top:4px;font-size:13px}
      .legend{display:flex;gap:18px;flex-wrap:wrap;color:#86a0b5;font-size:9px;margin-top:4px}
      .legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}.legend .c{background:#38a7ff}.legend .e{background:#35d88b}

      .context{margin-bottom:12px}
      .pse-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .pse-card{padding:13px;border:1px solid #19394f;border-radius:14px;background:#081b2a}
      .pse-card-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
      .pse-card-head strong{display:block;font-size:11px;color:#e8f5ff}.pse-card-head span{display:block;margin-top:2px;font-size:8px;color:#7d98ad}
      .pse-card-head>b{padding:5px 8px;border-radius:999px;font-size:8px;white-space:nowrap;background:#10283a;color:#91a8ba}
      .pse-card-head>b.pse-darkgreen{background:#093523;color:#6ce7ab}.pse-card-head>b.pse-green{background:#0f3023;color:#8dd9af}
      .pse-card-head>b.pse-yellow{background:#3b2d0b;color:#ffd15f}.pse-card-head>b.pse-red{background:#3a1720;color:#ff8797}
      .pse-timeline{display:grid;grid-template-columns:repeat(24,minmax(0,1fr));gap:3px;margin-top:11px}
      .pse-hour{text-align:center;min-width:0}.pse-hour span{display:block;color:#708ca2;font-size:6px;margin-bottom:3px}.pse-hour i{display:block;height:18px;border-radius:4px;background:#1a3141}
      .pse-hour.pse-darkgreen i{background:#25be79}.pse-hour.pse-green i{background:#6ebe92}.pse-hour.pse-yellow i{background:#e9b63f}.pse-hour.pse-red i{background:#dd5968}
      .pse-empty{grid-column:1/-1;padding:11px 0;color:#7893a8;font-size:9px}
      .pse-legend{display:flex;gap:13px;flex-wrap:wrap;margin-top:9px;color:#7893a8;font-size:8px}.pse-legend span{display:inline-flex;align-items:center;gap:5px}.pse-legend i{width:7px;height:7px;border-radius:50%}
      .legend-darkgreen{background:#25be79}.legend-green{background:#6ebe92}.legend-yellow{background:#e9b63f}.legend-red{background:#dd5968}

      .bottom-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:12px}
      .stats-list{display:grid;gap:4px}
      .stat-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid #153247}
      .stat-row:last-child{border-bottom:0}.stat-left{display:flex;align-items:center;gap:9px;color:#87a1b6;font-size:10px}.stat-left i{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;background:#0d2c40;color:#59c7ff}
      .stat-row:nth-child(2) .stat-left i{color:#3fe8ff}.stat-row:nth-child(3) .stat-left i{color:#ff7a8b}.stat-row:nth-child(4) .stat-left i{color:#c285ff}
      .stat-row strong{font-size:12px;color:#e7f3fb;white-space:nowrap}
      .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .info{padding:10px;border:1px solid #17364b;background:#081b2a;border-radius:11px}.info-label{color:#748fa4;font-size:7px;text-transform:uppercase;letter-spacing:.08em}.info-value{margin-top:5px;color:#e6f3fc;font-size:10px;font-weight:800}
      .status-live-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#27dc84;box-shadow:0 0 9px rgba(39,220,132,.7);margin-right:5px}
      .full{grid-column:1/-1}
      .refresh-wide{width:100%;margin-top:10px;height:39px;border-radius:10px;border:1px solid #20527a;background:#0b2b44;color:#cdeaff;font-weight:800;cursor:pointer}
      .refresh-wide:hover{background:#0e3755}
      .footer{display:flex;justify-content:space-between;gap:12px;color:#668399;font-size:8px;padding:9px 2px 0}
      .muted{color:#7f99ad}.data-missing{color:#778fa3;font-weight:700}
      .mini-trend{height:40px;margin-top:11px}.mini-trend svg{width:100%;height:100%;display:block}
      .mini-line{fill:none;stroke:#33dc8b;stroke-width:2.2;stroke-linecap:round}.mini-fill{fill:url(#miniFill)}
      .cost-note,.carbon-note{margin-top:6px;font-size:8px;color:#718b9f}
      .budget-ring{display:none}
      .budget-ring::before{content:"";position:absolute;inset:5px;background:#091a29;border-radius:50%}.budget-ring span{position:relative;font-size:9px;font-weight:900}

      @media(prefers-reduced-motion:reduce){
        .flow-live .scene-status i,.scene-pulses .pulse,.motion-pulses circle,.scene-arrows .energy-arrow,.scene-shine,.spin{animation:none!important}
      }
      @media(max-width:1050px){
        .nav b{padding:9px 16px}.connection{min-width:170px}.kpi-grid{grid-template-columns:repeat(2,1fr)}
        .main-grid,.bottom-grid{grid-template-columns:1fr}
      }
      @media(max-width:700px){
        .dashboard{padding:10px;border-radius:18px}.topbar{align-items:flex-start}.nav{display:none}.connection{min-width:0;padding:8px}.connection span{display:none}
        .brand{min-width:0}.brand-mark{width:42px;height:42px}.brand h1{font-size:18px}.brand h1 span{font-size:14px}
        .scene-topbar{left:12px;right:12px;top:10px}.scene-topbar strong{font-size:10px}.scene-status{padding:6px 8px;font-size:8px}.scene-art{min-height:0}.scene-data-strip{bottom:6%;gap:2px;padding:4px 5px;font-size:5.2px}.scene-data-strip span{padding:0 3px}.scene-meter-live{top:30%;height:22%}
        .scene-bottom{align-items:flex-start;flex-direction:column}.kpi-grid{grid-template-columns:1fr 1fr}.kpi{min-height:135px;padding:13px}.kpi-value{font-size:24px}
        .zone-grid,.pse-grid{grid-template-columns:1fr}.info-grid{grid-template-columns:1fr}.footer{flex-direction:column}.chart-wrap{height:220px}
      }
    </style>

    <section class="dashboard" aria-label="Tauron eLicznik">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 48 48">
              <path d="M8 19c7-10 14-14 21-14 5 0 8 2 11 5-8-2-13 0-17 5 6 0 11 3 15 8-7-2-13-2-18 2 5 2 8 5 9 10-8-1-15-5-19-12-3-5-3-9-2-14z" fill="#ff3b91"/>
              <path d="M8 19c4 5 10 8 18 8 5 0 10-1 14-4-2 7-8 12-16 14-6-1-11-4-15-9-3-4-3-6-1-9z" fill="#7b49ff" opacity=".92"/>
            </svg>
          </div>
          <div>
            <h1>TAURON <span>eLicznik</span></h1>
            <small>${this._escape(c.title || "Energia")} · zużycie i analiza</small>
          </div>
        </div>

        <nav class="nav" aria-label="Sekcje panelu">
          <b class="active">Energia</b><b>Analiza</b><b>Taryfa</b><b>Ustawienia</b>
        </nav>

        <div class="top-actions" style="display:flex;align-items:center;gap:8px">
          <div class="connection">
            <i></i>
            <div><strong>Połączony</strong><span>Ostatnia aktualizacja · ${updated ? this._date(updated) : "brak danych"}</span></div>
          </div>
          <button class="refresh" title="Odśwież dane Tauron" aria-label="Odśwież dane Tauron" ${this._loading ? "disabled" : ""}><span class="${this._loading ? "spin" : ""}">↻</span></button>
        </div>
      </header>

      ${this._energyFlowSvg(dailyConsumed)}

      <section class="kpi-grid" aria-label="Podsumowanie energii">
        <article class="kpi">
          <div class="kpi-top"><div class="kpi-icon">♧</div><span class="kpi-label">Pobór dzisiaj</span></div>
          <div class="kpi-value">${Number.isFinite(dailyConsumed) ? this._fmt(dailyConsumed,2) : "—"} <small>kWh</small></div>
          <div class="kpi-sub">${selectedLabel}<strong>${status === "W porządku" ? "↓ w normie" : "Brak danych"}</strong></div>
          <div class="kpi-bar"><i style="width:${budgetPercent}%"></i></div>
        </article>

        <article class="kpi">
          <div class="kpi-top"><div class="kpi-icon">⚡</div><span class="kpi-label">Moc chwilowa</span></div>
          <div class="kpi-value">${Number.isFinite(power) ? this._fmt(power,0) : "—"} <small>W</small></div>
          <div class="kpi-sub">${Number.isFinite(power) ? "Odczyt chwilowy z HAN" : "Brak encji mocy chwilowej"}</div>
          <div class="mini-trend">
            <svg viewBox="0 0 220 40" preserveAspectRatio="none" aria-hidden="true">
              <polyline class="mini-line" points="0,30 16,24 31,28 47,18 63,23 79,14 95,20 111,9 127,18 143,12 159,20 175,10 191,16 207,6 220,10"/>
            </svg>
          </div>
        </article>

        <article class="kpi orange">
          <div class="kpi-top"><div class="kpi-icon">◉</div><span class="kpi-label">Koszt dzisiaj</span></div>
          <div class="kpi-value">${fmtCost(cost)}</div>
          <div class="kpi-sub">Taryfa <strong style="color:#ffc45c">${this._escape(String(tariff))}</strong></div>
          <div class="cost-note">${Number.isFinite(cost) ? "Koszt z encji Home Assistant" : "Brak skonfigurowanej encji kosztu"}</div>
        </article>

        <article class="kpi green">
          <div class="kpi-top"><div class="kpi-icon">⌁</div><span class="kpi-label">Ślad węglowy</span></div>
          <div class="kpi-value">${fmtCarbon(carbon)}</div>
          <div class="kpi-sub">na podstawie danych energetycznych</div>
          <div class="carbon-note">${Number.isFinite(carbon) ? "Wartość z encji Home Assistant" : "Brak skonfigurowanej encji CO₂"}</div>
        </article>
      </section>

      <div class="main-grid">
        <section class="panel-card">
          <div class="card-head">
            <div><strong>Strefy taryfowe — ${this._escape(String(tariff))}</strong><span>Stan licznika i zużycie dzisiaj</span></div>
            <div class="pill">${this._escape(String(tariff))}</div>
          </div>
          <div class="zone-grid">
            <article class="zone z1">
              <span class="badge">T1 ☾</span><small>Strefa T1</small>
              <b>${Number.isFinite(t1) ? this._fmt(t1,0) : "—"} <i>kWh</i></b>
              <div class="zone-footer"><span>Dzisiaj</span><strong>${Number.isFinite(t1Daily) ? this._fmt(t1Daily,1) : "—"} kWh</strong></div>
            </article>
            <article class="zone z2">
              <span class="badge">T2 ☀</span><small>Strefa T2</small>
              <b>${Number.isFinite(t2) ? this._fmt(t2,0) : "—"} <i>kWh</i></b>
              <div class="zone-footer"><span>Dzisiaj</span><strong>${Number.isFinite(t2Daily) ? this._fmt(t2Daily,1) : "—"} kWh</strong></div>
            </article>
            <article class="zone z3">
              <span class="badge">T3 ◐</span><small>Strefa T3</small>
              <b>${Number.isFinite(t3) ? this._fmt(t3,0) : "—"} <i>kWh</i></b>
              <div class="zone-footer"><span>Dzisiaj</span><strong>${Number.isFinite(t3Daily) ? this._fmt(t3Daily,1) : "—"} kWh</strong></div>
            </article>
          </div>
        </section>

        <section class="panel-card">
          <div class="card-head">
            <div><strong>Zużycie energii</strong><span>${selectedLabel} · ostatnie ${Number(c.days_history || 14)} dni</span></div>
            <div class="pill">${Number.isFinite(dailyConsumed) ? this._fmt(dailyConsumed,1) : "—"} kWh</div>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:5px;margin:-5px 0 6px">
            <button class="refresh" data-energy-today title="Pokaż dzisiaj" aria-label="Pokaż dzisiaj">⌂</button>
            <button class="refresh" data-energy-date="-1" title="Poprzedni dzień" aria-label="Poprzedni dzień">‹</button>
            <button class="refresh" data-energy-date="1" title="Następny dzień" aria-label="Następny dzień" ${this._dateKey(new Date()) === selectedDate ? "disabled" : ""}>›</button>
          </div>
          ${this._chartSvg()}
          <div class="legend"><span><i class="c"></i>Pobór (kWh)</span><span><i class="e"></i>Oddanie (kWh)</span></div>
        </section>
      </div>

      <section class="panel-card context">
        <div class="card-head">
          <div><strong>Energetyczny Kompas</strong><span>Prognoza na podstawie danych PSE</span></div>
          <div class="pill">Taryfa ${this._escape(String(tariff))}</div>
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
      </section>

      <div class="bottom-grid">
        <section class="panel-card">
          <div class="card-head"><div><strong>Statystyki</strong><span>Na podstawie historii zużycia</span></div></div>
          <div class="stats-list">
            <div class="stat-row"><div class="stat-left"><i>▥</i>Średnie dzienne zużycie</div><strong>${Number.isFinite(dailyAverage) ? this._fmt(dailyAverage,2) + " kWh" : "—"}</strong></div>
            <div class="stat-row"><div class="stat-left"><i>↗</i>Najwyższe zużycie (30 dni)</div><strong>${Number.isFinite(maxDaily30) ? this._fmt(maxDaily30,1) + " kWh" : "—"}</strong></div>
            <div class="stat-row"><div class="stat-left"><i>↘</i>Najniższe zużycie (30 dni)</div><strong>${Number.isFinite(minDaily30) ? this._fmt(minDaily30,1) + " kWh" : "—"}</strong></div>
            <div class="stat-row"><div class="stat-left"><i>Σ</i>Łączne zużycie (30 dni)</div><strong>${Number.isFinite(total30) ? this._fmt(total30,1) + " kWh" : "—"}</strong></div>
          </div>
        </section>

        <section class="panel-card">
          <div class="card-head"><div><strong>Informacje o liczniku</strong><span>eLicznik</span></div></div>
          <div class="info-grid">
            <div class="info"><div class="info-label">Model</div><div class="info-value">MA309M</div></div>
            <div class="info"><div class="info-label">Numer licznika</div><div class="info-value">${this._escape(this._state(c.meter_number_entity)?.state || "—")}</div></div>
            <div class="info"><div class="info-label">Taryfa</div><div class="info-value">${this._escape(String(tariff))}</div></div>
            <div class="info"><div class="info-label">Ostatni odczyt</div><div class="info-value">${this._date(lastReading)}</div></div>
            <div class="info full"><div class="info-label">Status</div><div class="info-value"><span class="status-live-dot"></span> Połączony (eLicznik)</div></div>
          </div>
          <button class="refresh-wide" title="Odśwież dane Tauron" aria-label="Odśwież dane Tauron" ${this._loading ? "disabled" : ""}>↻ &nbsp; Odśwież dane z eLicznik</button>
        </section>
      </div>

      <section class="panel-card" style="margin-top:12px">
        <div class="card-head"><div><strong>Okres rozliczeniowy</strong><span>Budżet i stan początkowy</span></div><div class="pill">${Number.isFinite(days) ? this._fmt(days,0) + " dni" : "—"}</div></div>
        <div class="info-grid">
          <div class="info"><div class="info-label">Dzienny budżet</div><div class="info-value">${Number.isFinite(dailyBudget) ? this._fmt(dailyBudget,2) : "—"} kWh</div></div>
          <div class="info"><div class="info-label">Miesięczny budżet</div><div class="info-value">${Number.isFinite(monthlyBudget) ? this._fmt(monthlyBudget,2) : "—"} kWh</div></div>
          <div class="info"><div class="info-label">Początek okresu · pobór</div><div class="info-value">${Number.isFinite(billingStartConsumed) ? this._fmt(billingStartConsumed,1) : "—"} kWh</div></div>
          <div class="info"><div class="info-label">Początek okresu · oddanie</div><div class="info-value">${Number.isFinite(billingStartExported) ? this._fmt(billingStartExported,1) : "—"} kWh</div></div>
        </div>
      </section>

      <footer class="footer">
        <span>Źródło dzisiaj: /odczyty/api · historia: /energia/api · PSE: Energetyczny Kompas</span>
        <span>Wybrany dzień: ${selectedDate} · Auto ${this._autoRefreshMinutes} min</span>
      </footer>
    </section>
  `;

  this.shadowRoot.querySelectorAll("[data-energy-date]").forEach(button => {
    button.addEventListener("click", () => this._changeDate(Number(button.dataset.energyDate)));
  });
  const todayButton = this.shadowRoot.querySelector("[data-energy-today]");
  if (todayButton) todayButton.addEventListener("click", () => this._goToday());

  this.shadowRoot.querySelectorAll(".refresh, .refresh-wide").forEach(button => {
    if (button.dataset.energyDate !== undefined || button.dataset.energyToday !== undefined) return;
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
      point.addEventListener("mouseleave", () => { tooltip.hidden = true; });
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
