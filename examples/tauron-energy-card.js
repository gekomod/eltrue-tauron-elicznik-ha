  _chartSvg() {
    const history=this._chartHistorySeries()||[];
    const entry=this._selectedHistoryEntry();
    const values=Array.isArray(entry?.values)?entry.values.map(Number):[];
    const valid=values.filter(Number.isFinite);
    if(!valid.length){
      return '<div class="chart-empty"><strong>Brak profilu godzinowego</strong><span>Oczekiwanie na dane godzinowe z /energia/api.</span></div>';
    }
    const W=900,H=255,left=48,right=16,top=38,bottom=34;
    const plotW=W-left-right,plotH=H-top-bottom;
    const max=Math.max(1,...valid)*1.18;
    const slot=plotW/values.length;
    const barW=Math.max(8,slot-5);
    const zoneForHour=hour=>{
      if(hour>=6&&hour<13)return{cls:"bar-t1",name:"T1"};
      if(hour>=13&&hour<15)return{cls:"bar-t2",name:"T2"};
      return{cls:"bar-t3",name:"T3"};
    };
    const bars=values.map((value,i)=>{
      if(!Number.isFinite(value))return "";
      const x=left+i*slot+(slot-barW)/2;
      const h=Math.max(2,(value/max)*plotH);
      const y=top+plotH-h;
      const zone=zoneForHour(i);
      return '<g class="hourbar" tabindex="0" data-kind="Pobór" data-label="' + String(i).padStart(2,"0") + ':00" data-value="' + value + '">' +
        '<rect class="' + zone.cls + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="4"/>' +
        '<title>' + String(i).padStart(2,"0") + ':00 · ' + zone.name + ' · ' + this._fmt(value,2) + ' kWh</title></g>';
    }).join("");
    const grid=[0,.25,.5,.75,1].map(r=>{
      const y=top+plotH-r*plotH;
      return '<line class="chart-grid" x1="' + left + '" y1="' + y + '" x2="' + (W-right) + '" y2="' + y + '"/>' +
        '<text class="chart-axis-y" x="' + (left-8) + '" y="' + (y+4) + '" text-anchor="end">' + this._fmt(max*r,1) + '</text>';
    }).join("");
    const labels=values.map((_,i)=>{
      if(values.length>12&&i%2!==0)return "";
      const x=left+i*slot+slot/2;
      return '<text class="chart-axis-x" x="' + x.toFixed(1) + '" y="' + (H-10) + '" text-anchor="middle">' + String(i).padStart(2,"0") + '</text>';
    }).join("");
    const total=Number.isFinite(entry?.value)?entry.value:NaN;
    const idx=history.findIndex(x=>x.date===entry?.date);
    const previous=idx>0?Number(history[idx-1]?.value):NaN;
    const delta=Number.isFinite(total)&&Number.isFinite(previous)&&previous>0?((total-previous)/previous)*100:NaN;
    const summary="<strong>"+(Number.isFinite(total)?this._fmt(total,1):"—")+" kWh</strong>" +
      "<span>"+this._dateLabel(entry?.date||this._selectedDate)+"</span>" +
      (Number.isFinite(delta) ? "<em class=\""+(delta<=0?"down":"up")+"\">"+(delta<=0?"↓":"↑")+" "+this._fmt(Math.abs(delta),0)+"%</em>" : "");
    return '<div class="chart-inner">' +
      '<div class="chart-summary"><div>' + summary + '</div>' +
      '<div class="chart-tabs" role="tablist" aria-label="Zakres">' +
      '<button class="chart-tab active" type="button" aria-selected="true">Dzień</button>' +
      '<button class="chart-tab" type="button" aria-selected="false">Tydzień</button>' +
      '<button class="chart-tab" type="button" aria-selected="false">Miesiąc</button></div></div>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Godzinowe zużycie energii">' +
      grid + bars + labels + '</svg>' +
      '<div class="chart-legend"><span><i class="legend-blue"></i>T1</span><span><i class="legend-orange"></i>T2</span><span><i class="legend-purple"></i>T3</span></div>' +
      '<div class="chart-tooltip" hidden></div></div>';
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

    const c=this._config;
    const consumed=this._num(c.consumed_entity,NaN);
    const exported=this._num(c.exported_entity,NaN);
    const dailyConsumed=this._todayDailyConsumed();
    const dailyExported=this._num(c.daily_exported_entity,NaN);
    const dailyAverage=this._num(c.daily_average_entity,NaN);
    const t1=this._num(c.t1_entity,NaN), t2=this._num(c.t2_entity,NaN), t3=this._num(c.t3_entity,NaN);
    const t1Daily=this._num(c.t1_daily_entity,NaN), t2Daily=this._num(c.t2_daily_entity,NaN), t3Daily=this._num(c.t3_daily_entity,NaN);
    const balance=this._num(c.balance_entity,NaN);
    const dailyBudget=this._num(c.daily_budget_entity,NaN);
    const days=this._num(c.days_entity,NaN);
    const lastReading=this._state(c.last_reading_entity)?.state;
    const lastFetch=this._state(c.last_fetch_entity)?.state;
    const tariff=this._state(c.tariff_entity)?.state||"—";
    const power=this._num(c.power_entity,NaN);
    const cost=this._num(c.cost_entity,NaN);
    const carbon=this._num(c.carbon_entity,NaN);
    const meterNumber=this._state(c.meter_number_entity)?.state||"—";
    const updated=lastFetch||lastReading;

    const budgetBase=Math.abs(dailyBudget);
    const budgetPercent=budgetBase>0&&Number.isFinite(dailyConsumed)?Math.min(100,Math.max(0,(dailyConsumed/budgetBase)*100)):0;

    const history=this._chartHistorySeries()||[];
    const selectedDate=this._selectedDate||this._dateKey(new Date());
    const selectedIndex=history.findIndex(x=>x.date===selectedDate);
    const previous=selectedIndex>0?Number(history[selectedIndex-1]?.value):NaN;
    const changePct=Number.isFinite(dailyConsumed)&&Number.isFinite(previous)&&previous>0
      ?((dailyConsumed-previous)/previous)*100:NaN;
    const changeText=Number.isFinite(changePct)
      ? (changePct<=0?"↓":"↑")+" "+this._fmt(Math.abs(changePct),0)+"%"
      : "Brak porównania";

    const statsValues=history.map(x=>Number(x.value)).filter(Number.isFinite);
    const max30=statsValues.length?Math.max(...statsValues):NaN;
    const min30=statsValues.length?Math.min(...statsValues):NaN;
    const total30=statsValues.length?statsValues.reduce((sum,v)=>sum+v,0):NaN;

    const fmtP=value=>Number.isFinite(value)?this._fmt(value,0)+" W":"— W";
    const fmtMoney=value=>Number.isFinite(value)?this._fmt(value,2)+" zł":"—";
    const fmtCo2=value=>Number.isFinite(value)?this._fmt(value,1)+" kg CO₂":"—";
    const currentDate=this._dateKey(new Date());
    const selectedLabel=this._dateLabel(selectedDate);

    this.shadowRoot.innerHTML=String.raw`
      <style>
        :host{
          display:block;width:100%;color-scheme:dark;
          --bg:#030f19;--panel:#071a28;--panel2:#0a2030;--card:#0a1e2d;
          --border:#153b53;--text:#edf8ff;--muted:#8ca7bb;
          --blue:#2ea2ff;--cyan:#61e7ff;--green:#27df85;--orange:#ff9b3d;--purple:#9b63ff;
          font-family:Inter,Roboto,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        }
        *{box-sizing:border-box}
        .dashboard{
          width:100%;padding:16px;border-radius:24px;overflow:hidden;color:var(--text);
          background:
            radial-gradient(circle at 7% 0%,rgba(46,162,255,.12),transparent 27%),
            radial-gradient(circle at 96% 0%,rgba(155,99,255,.09),transparent 22%),
            linear-gradient(180deg,#061523 0%,#030e17 100%);
          box-shadow:0 18px 55px rgba(0,0,0,.3)
        }
        .topbar{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:13px}
        .brand{display:flex;align-items:center;gap:11px;min-width:220px}
        .brand-mark{
          width:48px;height:48px;border-radius:15px;display:grid;place-items:center;
          background:linear-gradient(145deg,#18133a,#531e70);border:1px solid #693f93;
          box-shadow:0 10px 28px rgba(117,51,163,.22)
        }
        .brand-mark svg{width:34px;height:34px;filter:drop-shadow(0 0 7px rgba(255,59,145,.25))}
        .brand h1{margin:0;font-size:20px;line-height:1;font-weight:900;letter-spacing:-.03em}
        .brand h1 span{display:block;color:#ff3b91;font-size:15px;margin-top:3px}
        .brand small{display:block;color:var(--muted);font-size:8px;margin-top:5px}
        .nav{display:flex;align-items:center;gap:4px;padding:5px;border:1px solid #173b53;border-radius:999px;background:#081b2a}
        .nav b{padding:10px 24px;border-radius:999px;font-size:10px;color:#98b2c7;white-space:nowrap}
        .nav b.active{color:#fff;background:linear-gradient(180deg,#2b98f0,#176fc1);box-shadow:0 0 25px rgba(43,152,240,.34)}
        .top-actions{display:flex;align-items:center;gap:8px}
        .connection{display:flex;align-items:center;gap:8px;padding:10px 12px;min-width:220px;border:1px solid #193d54;border-radius:15px;background:rgba(8,28,42,.82)}
        .connection i{width:10px;height:10px;border-radius:50%;background:#29df83;box-shadow:0 0 0 5px rgba(41,223,131,.08)}
        .connection strong{display:block;font-size:10px}.connection span{display:block;margin-top:2px;color:var(--muted);font-size:7px}
        button{font:inherit}
        .refresh{width:36px;height:36px;border-radius:11px;border:1px solid #1b4058;background:#0a2132;color:#dff5ff;cursor:pointer;font-size:18px}
        .refresh:hover{border-color:#2c91d5;background:#0e2b40}
        button:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}
        .spin{display:inline-block;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}

        .scene{position:relative;margin-bottom:13px;border:1px solid #183e56;border-radius:17px;overflow:hidden;background:#061624;box-shadow:0 12px 35px rgba(0,0,0,.24)}
        .scene-topbar{position:absolute;z-index:7;left:16px;right:16px;top:13px;display:flex;justify-content:space-between;gap:10px;text-shadow:0 2px 12px rgba(0,0,0,.8)}
        .scene-kicker{font-size:7px;font-weight:900;letter-spacing:.15em;color:#69ddff}.scene-topbar strong{display:block;font-size:12px}.scene-topbar span{display:block;margin-top:2px;font-size:7px;color:#b7cddd}
        .scene-status{display:flex;align-items:center;gap:6px;padding:6px 9px;border:1px solid rgba(74,149,187,.35);border-radius:999px;background:rgba(3,17,27,.72);font-size:8px;font-weight:800;white-space:nowrap}
        .scene-status i{width:6px;height:6px;border-radius:50%;background:#9aacbb}.flow-live .scene-status{color:#6ef0ad;border-color:rgba(39,223,133,.35)}.flow-live .scene-status i{background:#27df85;box-shadow:0 0 10px rgba(39,223,133,.8);animation:statusPulse 1.7s ease-out infinite}
        @keyframes statusPulse{0%{box-shadow:0 0 0 0 rgba(39,223,133,.3)}70%{box-shadow:0 0 0 7px rgba(39,223,133,0)}100%{box-shadow:0 0 0 0 rgba(39,223,133,0)}
        .scene-art{position:relative;width:100%;aspect-ratio:1250/233;overflow:hidden;line-height:0}
        .scene-art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
        .scene-motion{position:absolute;inset:0;z-index:4;width:100%;height:100%;display:block;overflow:hidden;pointer-events:none}
        .scene-motion-line{fill:none;stroke:#6cddff;stroke-width:2;stroke-linecap:round;opacity:.18;stroke-dasharray:10 18}
        .flow-live .scene-motion-line{animation:flowDash 1.6s linear infinite}
        @keyframes flowDash{to{stroke-dashoffset:-56}
        .scene-arrows{display:none}.flow-live .scene-arrows{display:block}
        .energy-arrow path{fill:none;stroke:#d9fbff;stroke-width:3.2;stroke-linecap:round;stroke-linejoin:round;filter:url(#sceneArrowGlow)}
        .scene-meter-live{
          position:absolute;z-index:5;left:38.1%;top:39.5%;width:6.1%;height:17%;
          display:flex;align-items:center;justify-content:center;flex-direction:column;
          border:1px solid rgba(65,97,111,.72);border-radius:6px;
          background:linear-gradient(180deg,rgba(241,252,255,.98),rgba(205,236,241,.98));
          box-shadow:0 0 10px rgba(58,205,255,.16);color:#122b38
        }
        .scene-meter-live strong{font:800 clamp(8px,1.05vw,16px)/1 monospace;letter-spacing:.02em}.scene-meter-live span{margin-top:2px;font:800 clamp(4px,.42vw,7px)/1 system-ui;color:#526b78}
        .scene-data-strip{
          position:absolute;z-index:6;left:50%;bottom:5%;transform:translateX(-50%);
          display:flex;align-items:center;justify-content:center;gap:4px;max-width:92%;padding:4px 7px;
          border:1px solid rgba(123,200,234,.26);border-radius:999px;background:rgba(3,18,29,.72);
          backdrop-filter:blur(6px);color:#c7dbe6;font-size:6px;white-space:nowrap;line-height:1.1
        }
        .scene-data-strip span{padding:0 5px;border-right:1px solid rgba(142,191,216,.18)}.scene-data-strip span:last-child{border-right:0}.scene-data-strip b{color:#f1f8fd}
        .scene-vignette{position:absolute;z-index:2;inset:0;pointer-events:none;background:linear-gradient(90deg,rgba(2,11,20,.08),transparent 22%,transparent 78%,rgba(2,11,20,.08))}
        .scene-bottom{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 12px;border-top:1px solid #18384f;background:#06131e;color:#8da8bb;font-size:7px}
        .scene-bottom span{display:flex;align-items:center;gap:5px}.scene-bottom strong{font-size:8px;color:#e7f4fb}.flow-dot{width:6px;height:6px;border-radius:50%;background:#38d8ff;box-shadow:0 0 8px rgba(56,216,255,.65)}

        .kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px;margin-bottom:12px}
        .kpi{
          min-height:158px;padding:15px;border:1px solid #17384e;border-radius:15px;position:relative;overflow:hidden;
          background:linear-gradient(180deg,#0a1f2e,#071825);box-shadow:0 9px 22px rgba(0,0,0,.15)
        }
        .kpi.orange{background:linear-gradient(180deg,#101f2b,#081722)}.kpi.green{background:linear-gradient(180deg,#0a211d,#071921)}
        .kpi-top{display:flex;align-items:center;gap:10px}.kpi-icon{width:36px;height:36px;border-radius:11px;display:grid;place-items:center;border:1px solid #214c67;background:#0d2c43;color:#5fcfff;font-size:18px}
        .kpi.orange .kpi-icon{background:#33200d;border-color:#674720;color:#ffc04d}.kpi.green .kpi-icon{background:#092a1e;border-color:#18513a;color:#5deba8}
        .kpi-label{color:#9db5c9;font-size:10px}.kpi-value{margin-top:15px;font-size:30px;font-weight:900;letter-spacing:-.04em;line-height:1}.kpi-value small{font-size:12px;color:#9fb7ca;font-weight:700}
        .kpi-sub{margin-top:8px;color:#91aabd;font-size:8px;display:flex;flex-direction:column;gap:3px}.kpi-sub strong{color:#5febaa;font-size:9px}.kpi-sub strong.up{color:#ff9e60}.kpi-sub span{color:#809aae}
        .kpi-bar{position:absolute;left:15px;right:15px;bottom:14px;height:6px;border-radius:999px;background:#102d42;overflow:hidden}.kpi-bar i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#2ca4ff,#62e2ff)}
        .mini-trend{height:36px;margin-top:8px}.mini-trend svg{width:100%;height:100%;display:block}.mini-line{fill:none;stroke:#34dc8a;stroke-width:2.1;stroke-linecap:round}

        .main-grid{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(0,1fr);gap:12px;margin-bottom:12px}
        .panel-card{min-width:0;border:1px solid #17384f;border-radius:17px;background:linear-gradient(180deg,#091d2b,#071724);padding:15px;box-shadow:0 10px 25px rgba(0,0,0,.15)}
        .card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:11px}.card-head strong{font-size:14px;letter-spacing:-.015em}.card-head span{display:block;color:#7f9bad;font-size:8px;margin-top:2px}
        .pill{padding:7px 10px;border-radius:999px;border:1px solid #1f506d;background:#0b2b43;color:#65caff;font-size:9px;font-weight:900}
        .zone-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
        .zone{padding:12px;border:1px solid #193e57;border-radius:13px;background:linear-gradient(180deg,#0a2030,#071824);min-width:0}
        .zone .badge{display:inline-flex;align-items:center;justify-content:center;min-width:44px;height:26px;padding:0 10px;border-radius:9px;font-size:10px;font-weight:900}
        .z1 .badge{background:linear-gradient(180deg,#1686f7,#126acb);color:#fff;border:1px solid #38aaff;box-shadow:0 0 15px rgba(46,162,255,.24)}
        .z2 .badge{background:linear-gradient(180deg,#ffad43,#f27c1e);color:#fff;border:1px solid #ffc467;box-shadow:0 0 15px rgba(255,155,61,.18)}
        .z3 .badge{background:linear-gradient(180deg,#aa6aff,#7d42d8);color:#fff;border:1px solid #bb8eff;box-shadow:0 0 15px rgba(155,99,255,.2)}
        .z1{border-color:#173f64}.z2{border-color:#5c421f}.z3{border-color:#49306f}
        .zone small{display:block;color:#7d99ad;font-size:8px;margin-top:7px}.zone>b{display:block;margin-top:9px;font-size:20px;letter-spacing:-.02em}.zone>b i{font-style:normal;font-size:9px;color:#8da7ba}
        .zone-footer{display:flex;justify-content:space-between;align-items:center;gap:7px;margin-top:10px;padding-top:9px;border-top:1px solid #18364a;color:#7d98ac;font-size:8px}.zone-footer strong{font-size:10px}
        .z1 .zone-footer strong{color:#5ec2ff}.z2 .zone-footer strong{color:#ffb65f}.z3 .zone-footer strong{color:#c09aff}

        .chart-inner{position:relative;width:100%;height:252px}.chart-summary{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:3px}.chart-summary>div:first-child{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}
        .chart-summary strong{font-size:27px;letter-spacing:-.04em}.chart-summary span{font-size:8px;color:#7894aa}.chart-summary em{font-style:normal;color:#59eba7;font-size:9px;font-weight:900}.chart-summary em.up{color:#ff9e60}
        .chart-tabs{display:flex;align-items:center;gap:3px;padding:4px;background:#0a1b2a;border:1px solid #183a51;border-radius:999px}.chart-tab{border:0;background:transparent;color:#8ca6b9;border-radius:999px;padding:7px 10px;font-size:8px;cursor:pointer}.chart-tab.active{color:#fff;background:linear-gradient(180deg,#2a98f0,#176fc1);box-shadow:0 0 18px rgba(42,152,240,.28)}
        .chart-inner svg{width:100%;height:210px;display:block;overflow:visible}.chart-grid{stroke:#17364b;stroke-width:1}.chart-axis-y,.chart-axis-x{fill:#789  _chartSvg() {
    const history=this._chartHistorySeries()||[];
    const entry=this._selectedHistoryEntry();
    const values=Array.isArray(entry?.values)?entry.values.map(Number):[];
    const valid=values.filter(Number.isFinite);

    if(!valid.length){
      return \`
        <div class="chart-empty"><strong>Brak profilu godzinowego</strong><span>Oczekiwanie na dane godzinowe z /energia/api.</span></div>
      \`;
    }

    const W=900,H=255,left=48,right=16,top=38,bottom=34;
    const plotW=W-left-right,plotH=H-top-bottom;
    const max=Math.max(1,...valid)*1.18;
    const slot=plotW/values.length;
    const barW=Math.max(8,slot-5);
    const zoneForHour=hour=>{
      if(hour>=6&&hour<13)return{cls:"bar-t1",name:"T1"};
      if(hour>=13&&hour<15)return{cls:"bar-t2",name:"T2"};
      return{cls:"bar-t3",name:"T3"};
    };

    const bars=values.map((value,i)=>{
      if(!Number.isFinite(value))return"";
      const x=left+i*slot+(slot-barW)/2;
      const h=Math.max(2,(value/max)*plotH);
      const y=top+plotH-h;
      const zone=zoneForHour(i);
      return \`<g class="hourbar" tabindex="0" data-kind="Pobór" data-label="${String(i).padStart(2,"0")}:00" data-value="${value}">
        <rect class="${zone.cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="4"/>
        <title>${String(i).padStart(2,"0")}:00 · ${zone.name} · ${this._fmt(value,2)} kWh</title>
      </g>\`;
    }).join("");

    const grid=[0,.25,.5,.75,1].map(r=>{
      const y=top+plotH-r*plotH;
      return \`<line class="chart-grid" x1="${left}" y1="${y}" x2="${W-right}" y2="${y}"/>
        <text class="chart-axis-y" x="${left-8}" y="${y+4}" text-anchor="end">${this._fmt(max*r,1)}</text>\`;
    }).join("");

    const labels=values.map((_,i)=>{
      if(values.length>12&&i%2!==0)return"";
      const x=left+i*slot+slot/2;
      return \`<text class="chart-axis-x" x="${x.toFixed(1)}" y="${H-10}" text-anchor="middle">${String(i).padStart(2,"0")}</text>\`;
    }).join("");

    const total=Number.isFinite(entry?.value)?entry.value:NaN;
    const idx=history.findIndex(x=>x.date===entry?.date);
    const previous=idx>0?Number(history[idx-1]?.value):NaN;
    const delta=Number.isFinite(total)&&Number.isFinite(previous)&&previous>0?((total-previous)/previous)*100:NaN;

    return \`
      <div class="chart-inner">
        <div class="chart-summary">
          <div>
            <strong>${Number.isFinite(total)?this._fmt(total,1):"—"} kWh</strong>
            <span>${this._dateLabel(entry?.date||this._selectedDate)}</span>
            ${Number.isFinite(delta)?\`<em class="${delta<=0?"down":"up"}">${delta<=0?"↓":"↑"} ${this._fmt(Math.abs(delta),0)}%</em>\`:""}
          </div>
          <div class="chart-tabs" role="tablist" aria-label="Zakres">
            <button class="chart-tab active" type="button" aria-selected="true">Dzień</button>
            <button class="chart-tab" type="button" aria-selected="false">Tydzień</button>
            <button class="chart-tab" type="button" aria-selected="false">Miesiąc</button>
          </div>
        </div>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Godzinowe zużycie energii">
          ${grid}${bars}${labels}
        </svg>
        <div class="chart-legend">
          <span><i class="legend-blue"></i>T1</span>
          <span><i class="legend-orange"></i>T2</span>
          <span><i class="legend-purple"></i>T3</span>
        </div>
        <div class="chart-tooltip" hidden></div>
      </div>
    \`;
  }:8px 2px 0;color:#648097;font-size:7px}

        @media(prefers-reduced-motion:reduce){.flow-live .scene-status i,.flow-live .scene-motion-line,.scene-arrows,.spin{animation:none!important}
        @media(max-width:1050px){.nav b{padding:9px 15px}.connection{min-width:160px}.bottom-grid{grid-template-columns:1fr 1fr}.bottom-grid .context{grid-column:1/-1}.kpi-grid{grid-template-columns:repeat(2,1fr)}.main-grid{grid-template-columns:1fr}
        @media(max-width:700px){.dashboard{padding:10px}.topbar{align-items:flex-start}.nav{display:none}.connection{min-width:0;padding:8px}.connection span{display:none}.brand{min-width:0}.scene-topbar{left:10px;right:10px;top:9px}.scene-topbar strong{font-size:9px}.scene-status{padding:6px 7px;font-size:7px}.scene-data-strip{max-width:96%;font-size:5px}.scene-meter-live{left:38%;top:39%;width:6.4%;height:18%}.kpi-grid{grid-template-columns:1fr 1fr}.kpi{min-height:135px;padding:12px}.kpi-value{font-size:23px}.zone-grid,.pse-grid{grid-template-columns:1fr}.bottom-grid{grid-template-columns:1fr}.bottom-grid .context{grid-column:auto}.chart-tabs{display:none}.chart-inner{height:230px}.chart-inner svg{height:185px}.info-grid{grid-template-columns:1fr}.footer{flex-direction:column}
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
            <div><h1>TAURON <span>eLicznik</span></h1><small>${this._escape(c.title||"Energia")} · zużycie i analiza</small></div>
          </div>
          <nav class="nav" aria-label="Sekcje panelu"><b class="active">Energia</b><b>Analiza</b><b>Taryfa</b><b>Ustawienia</b></nav>
          <div class="top-actions">
            <div class="connection"><i></i><div><strong>Połączony</strong><span>${updated?this._date(updated):"Brak danych"}</span></div></div>
            <button class="refresh" data-refresh title="Odśwież dane Tauron" aria-label="Odśwież dane Tauron" ${this._loading?"disabled":""}><span class="${this._loading?"spin":""}">↻</span></button>
          </div>
        </header>

        ${this._energyFlowSvg(dailyConsumed)}

        <section class="kpi-grid" aria-label="Podsumowanie energii">
          <article class="kpi">
            <div class="kpi-top"><div class="kpi-icon">⌂</div><span class="kpi-label">Pobór dzisiaj</span></div>
            <div class="kpi-value">${Number.isFinite(dailyConsumed)?this._fmt(dailyConsumed,2):"—"} <small>kWh</small></div>
            <div class="kpi-sub"><strong class="${Number.isFinite(changePct)&&changePct>0?"up":""}">${this._escape(changeText)}</strong><span>porównanie z poprzednim dniem</span></div>
            <div class="kpi-bar"><i style="width:${budgetPercent}%"></i></div>
          </article>

          <article class="kpi">
            <div class="kpi-top"><div class="kpi-icon">⚡</div><span class="kpi-label">Moc chwilowa</span></div>
            <div class="kpi-value">${Number.isFinite(power)?this._fmt(power,0):"—"} <small>W</small></div>
            <div class="kpi-sub"><span>${Number.isFinite(power)?"Odczyt chwilowy z HAN":"Brak encji mocy chwilowej"}</span></div>
            <div class="mini-trend"><svg viewBox="0 0 220 40" preserveAspectRatio="none" aria-hidden="true"><polyline class="mini-line" points="0,31 16,25 31,28 47,19 63,23 79,15 95,21 111,10 127,18 143,13 159,20 175,10 191,16 207,7 220,11"/></svg></div>
          </article>

          <article class="kpi orange">
            <div class="kpi-top"><div class="kpi-icon">◉</div><span class="kpi-label">Koszt dzisiaj</span></div>
            <div class="kpi-value">${fmtMoney(cost)}</div>
            <div class="kpi-sub"><strong style="color:#ffc45c">Taryfa ${this._escape(String(tariff))}</strong><span>${Number.isFinite(cost)?"z danych Home Assistant":"Brak encji kosztu"}</span></div>
          </article>

          <article class="kpi green">
            <div class="kpi-top"><div class="kpi-icon">⌁</div><span class="kpi-label">Ślad węglowy</span></div>
            <div class="kpi-value">${fmtCo2(carbon)}</div>
            <div class="kpi-sub"><strong style="color:#58eaa6">CO₂</strong><span>${Number.isFinite(carbon)?"Wartość z Home Assistant":"Brak encji CO₂"}</span></div>
          </article>
        </section>

        <div class="main-grid">
          <section class="panel-card">
            <div class="card-head"><div><strong>Strefy taryfowe — ${this._escape(String(tariff))}</strong><span>Stan licznika i zużycie dzisiaj</span></div><div class="pill">Taryfa ${this._escape(String(tariff))}</div></div>
            <div class="zone-grid">
              <article class="zone z1"><span class="badge">T1 ☾</span><small>Strefa T1</small><b>${Number.isFinite(t1)?this._fmt(t1,0):"—"} <i>kWh</i></b><div class="zone-footer"><span>Dzisiaj</span><strong>${Number.isFinite(t1Daily)?this._fmt(t1Daily,1):"—"} kWh</strong></div></article>
              <article class="zone z2"><span class="badge">T2 ☀</span><small>Strefa T2</small><b>${Number.isFinite(t2)?this._fmt(t2,0):"—"} <i>kWh</i></b><div class="zone-footer"><span>Dzisiaj</span><strong>${Number.isFinite(t2Daily)?this._fmt(t2Daily,1):"—"} kWh</strong></div></article>
              <article class="zone z3"><span class="badge">T3 ◐</span><small>Strefa T3</small><b>${Number.isFinite(t3)?this._fmt(t3,0):"—"} <i>kWh</i></b><div class="zone-footer"><span>Dzisiaj</span><strong>${Number.isFinite(t3Daily)?this._fmt(t3Daily,1):"—"} kWh</strong></div></article>
            </div>
          </section>

          <section class="panel-card">
            <div class="card-head">
              <div><strong>Zużycie energii</strong><span>Godzinowy profil · ${selectedLabel}</span></div>
              <div style="display:flex;gap:5px">
                <button class="refresh" data-energy-today title="Dzisiaj" aria-label="Dzisiaj">⌂</button>
                <button class="refresh" data-energy-date="-1" title="Poprzedni dzień" aria-label="Poprzedni dzień">‹</button>
                <button class="refresh" data-energy-date="1" title="Następny dzień" aria-label="Następny dzień" ${currentDate===selectedDate?"disabled":""}>›</button>
              </div>
            </div>
            ${this._chartSvg()}
          </section>
        </div>

        <div class="bottom-grid">
          <section class="panel-card context">
            <div class="card-head"><div><strong>Energetyczny Kompas PSE</strong><span>Prognoza na podstawie danych PSE i taryfy ${this._escape(String(tariff))}</span></div><div class="pill">${this._escape(String(tariff))}</div></div>
            <div class="pse-grid">
              ${this._pseCard("Dzisiaj","Energetyczne godziny szczytu",c.pse_today_entity)}
              ${this._pseCard("Jutro · D+1","Planowane energetyczne godziny szczytu",c.pse_tomorrow_entity)}
            </div>
            <div class="pse-legend">
              <span><i class="legend-darkgreen"></i>Zalecane użytkowanie</span><span><i class="legend-green"></i>Normalne użytkowanie</span><span><i class="legend-yellow"></i>Zalecane oszczędzanie</span><span><i class="legend-red"></i>Wymagane ograniczenie</span>
            </div>
          </section>

          <section class="panel-card">
            <div class="card-head"><div><strong>Statystyki</strong><span>Ostatnie 30 dni</span></div></div>
            <div class="stats-list">
              <div class="stat-row"><div class="stat-left"><i>▥</i>Średnie dzienne zużycie</div><strong>${Number.isFinite(dailyAverage)?this._fmt(dailyAverage,2):"—"} kWh</strong></div>
              <div class="stat-row"><div class="stat-left"><i>↗</i>Najwyższe zużycie</div><strong>${Number.isFinite(max30)?this._fmt(max30,1):"—"} kWh</strong></div>
              <div class="stat-row"><div class="stat-left"><i>↘</i>Najniższe zużycie</div><strong>${Number.isFinite(min30)?this._fmt(min30,1):"—"} kWh</strong></div>
              <div class="stat-row"><div class="stat-left"><i>Σ</i>Łączne zużycie</div><strong>${Number.isFinite(total30)?this._fmt(total30,1):"—"} kWh</strong></div>
            </div>
          </section>

          <section class="panel-card">
            <div class="card-head"><div><strong>Informacje o liczniku</strong><span>eLicznik</span></div></div>
            <div class="info-grid">
              <div class="info"><div class="info-label">Model</div><div class="info-value">MA309M</div></div>
              <div class="info"><div class="info-label">Numer licznika</div><div class="info-value">${this._escape(String(meterNumber))}</div></div>
              <div class="info"><div class="info-label">Taryfa</div><div class="info-value">${this._escape(String(tariff))}</div></div>
              <div class="info"><div class="info-label">Ostatni odczyt</div><div class="info-value">${this._date(lastReading)}</div></div>
              <div class="info full"><div class="info-label">Status</div><div class="info-value"><span class="status-live-dot"></span>Połączony (HAN)</div></div>
            </div>
            <button class="refresh-wide" data-refresh title="Odśwież dane Tauron" aria-label="Odśwież dane Tauron" ${this._loading?"disabled":""}>↻&nbsp; Odśwież dane z eLicznik</button>
          </section>
        </div>

        <footer class="footer">
          <span>Źródło: /odczyty/api · /energia/api · PSE Energetyczny Kompas</span>
          <span>Wybrany dzień: ${selectedDate} · Auto ${this._autoRefreshMinutes} min · Aktualizacja ${updated?this._date(updated):"—"}</span>
        </footer>
      </section>
    `;
  }
}

customElements.define("tauron-energy-card", TauronEnergyCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "tauron-energy-card",
  name: "Tauron Energy Card",
  description: "Nowoczesny panel Tauron eLicznik."
});
  _chartSvg() {
    const history=this._chartHistorySeries()||[];
    const entry=this._selectedHistoryEntry();
    const values=Array.isArray(entry?.values)?entry.values.map(Number):[];
    const valid=values.filter(Number.isFinite);
    if(!valid.length){
      return `
        <div class="chart-empty"><strong>Brak profilu godzinowego</strong><span>Oczekiwanie na dane godzinowe z /energia/api.</span></div>
      `;
    }

    const W=900,H=255,left=48,right=16,top=42,bottom=34;
    const plotW=W-left-right,plotH=H-top-bottom;
    const max=Math.max(1,...valid)*1.16;
    const slot=plotW/values.length;
    const barW=Math.max(8,slot-5);

    const zoneForHour=hour=>{
      if(hour>=6&&hour<13)return{cls:"bar-t1",name:"T1"};
      if(hour>=13&&hour<15)return{cls:"bar-t2",name:"T2"};
      return{cls:"bar-t3",name:"T3"};
    };

    const bars=values.map((value,i)=>{
      if(!Number.isFinite(value))return"";
      const x=left+i*slot+(slot-barW)/2;
      const h=Math.max(2,(value/max)*plotH);
      const y=top+plotH-h;
      const zone=zoneForHour(i);
      return `<g class="hourbar" tabindex="0" data-kind="Pobór" data-label="{{String(i).padStart(2,"0")}}:00" data-value="{{value}}">
        <rect class="{{zone.cls}}" x="{{x.toFixed(1)}}" y="{{y.toFixed(1)}}" width="{{barW.toFixed(1)}}" height="{{h.toFixed(1)}}" rx="4"/>
        <title>{{String(i).padStart(2,"0")}}:00 · {{zone.name}} · {{this._fmt(value,2)}} kWh</title>
      </g>`;
    }).join("");

    const grid=[0,.25,.5,.75,1].map(r=>{
      const y=top+plotH-r*plotH;
      return `<line class="chart-grid" x1="{{left}}" y1="{{y}}" x2="{{W-right}}" y2="{{y}}"/>
        <text class="chart-axis-y" x="{{left-8}}" y="{{y+4}}" text-anchor="end">{{this._fmt(max*r,1)}}</text>`;
    }).join("");

    const labels=values.map((_,i)=>{
      if(values.length>12&&i%2!==0)return"";
      const x=left+i*slot+slot/2;
      return `<text class="chart-axis-x" x="{{x.toFixed(1)}}" y="{{H-10}}" text-anchor="middle">{{String(i).padStart(2,"0")}}</text>`;
    }).join("");

    const idx=history.findIndex(x=>x.date===entry?.date);
    const previous=idx>0?Number(history[idx-1]?.value):NaN;
    const delta=Number.isFinite(entry?.value)&&Number.isFinite(previous)&&previous>0
      ?((entry.value-previous)/previous)*100:NaN;

    return `
      <div class="chart-inner">
        <div class="chart-summary">
          <div><strong>{{Number.isFinite(entry?.value)?this._fmt(entry.value,1):"—"}} kWh</strong>
          <span>{{this._dateLabel(entry?.date||this._selectedDate)}}</span>
          {{Number.isFinite(delta)?`<em class="{{delta<=0?"down":"up"}}">{{delta<=0?"↓":"↑"}} {{this._fmt(Math.abs(delta),0)}}%</em>`:""}}</div>
          <div class="chart-tabs" role="tablist" aria-label="Zakres">
            <button class="chart-tab active" type="button">Dzień</button>
            <button class="chart-tab" type="button">Tydzień</button>
            <button class="chart-tab" type="button">Miesiąc</button>
          </div>
        </div>
        <svg viewBox="0 0 {{W}} {{H}}" preserveAspectRatio="none" role="img" aria-label="Godzinowe zużycie energii">
          {{grid}}{{bars}}{{labels}}
        </svg>
        <div class="chart-legend"><span><i class="legend-blue"></i>T1</span><span><i class="legend-orange"></i>T2</span><span><i class="legend-purple"></i>T3</span></div>
      </div>
    `.replaceAll("{{",").replaceAll(}","}");
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

    const c=this._config;
    const consumed=this._num(c.consumed_entity,NaN);
    const exported=this._num(c.exported_entity,NaN);
    const dailyConsumed=this._todayDailyConsumed();
    const dailyExported=this._num(c.daily_exported_entity,NaN);
    const dailyAverage=this._num(c.daily_average_entity,NaN);
    const t1=this._num(c.t1_entity,NaN), t2=this._num(c.t2_entity,NaN), t3=this._num(c.t3_entity,NaN);
    const t1Daily=this._num(c.t1_daily_entity,NaN), t2Daily=this._num(c.t2_daily_entity,NaN), t3Daily=this._num(c.t3_daily_entity,NaN);
    const balance=this._num(c.balance_entity,NaN);
    const dailyBudget=this._num(c.daily_budget_entity,NaN);
    const days=this._num(c.days_entity,NaN);
    const lastReading=this._state(c.last_reading_entity)?.state;
    const lastFetch=this._state(c.last_fetch_entity)?.state;
    const tariff=this._state(c.tariff_entity)?.state||"—";
    const power=this._num(c.power_entity,NaN);
    const cost=this._num(c.cost_entity,NaN);
    const carbon=this._num(c.carbon_entity,NaN);
    const meterNumber=this._state(c.meter_number_entity)?.state||"—";
    const updated=lastFetch||lastReading;

    const budgetBase=Math.abs(dailyBudget);
    const budgetPercent=budgetBase>0&&Number.isFinite(dailyConsumed)?Math.min(100,Math.max(0,(dailyConsumed/budgetBase)*100)):0;

    const history=this._chartHistorySeries()||[];
    const selectedDate=this._selectedDate||this._dateKey(new Date());
    const selectedIndex=history.findIndex(x=>x.date===selectedDate);
    const previous=selectedIndex>0?Number(history[selectedIndex-1]?.value):NaN;
    const changePct=Number.isFinite(dailyConsumed)&&Number.isFinite(previous)&&previous>0
      ?((dailyConsumed-previous)/previous)*100:NaN;
    const changeText=Number.isFinite(changePct)
      ? (changePct<=0?"↓":"↑")+" "+this._fmt(Math.abs(changePct),0)+"%"
      : "Brak porównania";

    const statsValues=history.map(x=>Number(x.value)).filter(Number.isFinite);
    const max30=statsValues.length?Math.max(...statsValues):NaN;
    const min30=statsValues.length?Math.min(...statsValues):NaN;
    const total30=statsValues.length?statsValues.reduce((sum,v)=>sum+v,0):NaN;

    const fmtP=value=>Number.isFinite(value)?this._fmt(value,0)+" W":"— W";
    const fmtMoney=value=>Number.isFinite(value)?this._fmt(value,2)+" zł":"—";
    const fmtCo2=value=>Number.isFinite(value)?this._fmt(value,1)+" kg CO₂":"—";
    const currentDate=this._dateKey(new Date());
    const selectedLabel=this._dateLabel(selectedDate);

    this.shadowRoot.innerHTML=String.raw`
      <style>
        :host{
          display:block;width:100%;color-scheme:dark;
          --bg:#030f19;--panel:#071a28;--panel2:#0a2030;--card:#0a1e2d;
          --border:#153b53;--text:#edf8ff;--muted:#8ca7bb;
          --blue:#2ea2ff;--cyan:#61e7ff;--green:#27df85;--orange:#ff9b3d;--purple:#9b63ff;
          font-family:Inter,Roboto,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        }
        *{box-sizing:border-box}
        .dashboard{
          width:100%;padding:16px;border-radius:24px;overflow:hidden;color:var(--text);
          background:
            radial-gradient(circle at 7% 0%,rgba(46,162,255,.12),transparent 27%),
            radial-gradient(circle at 96% 0%,rgba(155,99,255,.09),transparent 22%),
            linear-gradient(180deg,#061523 0%,#030e17 100%);
          box-shadow:0 18px 55px rgba(0,0,0,.3)
        }
        .topbar{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:13px}
        .brand{display:flex;align-items:center;gap:11px;min-width:220px}
        .brand-mark{
          width:48px;height:48px;border-radius:15px;display:grid;place-items:center;
          background:linear-gradient(145deg,#18133a,#531e70);border:1px solid #693f93;
          box-shadow:0 10px 28px rgba(117,51,163,.22)
        }
        .brand-mark svg{width:34px;height:34px;filter:drop-shadow(0 0 7px rgba(255,59,145,.25))}
        .brand h1{margin:0;font-size:20px;line-height:1;font-weight:900;letter-spacing:-.03em}
        .brand h1 span{display:block;color:#ff3b91;font-size:15px;margin-top:3px}
        .brand small{display:block;color:var(--muted);font-size:8px;margin-top:5px}
        .nav{display:flex;align-items:center;gap:4px;padding:5px;border:1px solid #173b53;border-radius:999px;background:#081b2a}
        .nav b{padding:10px 24px;border-radius:999px;font-size:10px;color:#98b2c7;white-space:nowrap}
        .nav b.active{color:#fff;background:linear-gradient(180deg,#2b98f0,#176fc1);box-shadow:0 0 25px rgba(43,152,240,.34)}
        .top-actions{display:flex;align-items:center;gap:8px}
        .connection{display:flex;align-items:center;gap:8px;padding:10px 12px;min-width:220px;border:1px solid #193d54;border-radius:15px;background:rgba(8,28,42,.82)}
        .connection i{width:10px;height:10px;border-radius:50%;background:#29df83;box-shadow:0 0 0 5px rgba(41,223,131,.08)}
        .connection strong{display:block;font-size:10px}.connection span{display:block;margin-top:2px;color:var(--muted);font-size:7px}
        button{font:inherit}
        .refresh{width:36px;height:36px;border-radius:11px;border:1px solid #1b4058;background:#0a2132;color:#dff5ff;cursor:pointer;font-size:18px}
        .refresh:hover{border-color:#2c91d5;background:#0e2b40}
        button:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}
        .spin{display:inline-block;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}

        .scene{position:relative;margin-bottom:13px;border:1px solid #183e56;border-radius:17px;overflow:hidden;background:#061624;box-shadow:0 12px 35px rgba(0,0,0,.24)}
        .scene-topbar{position:absolute;z-index:7;left:16px;right:16px;top:13px;display:flex;justify-content:space-between;gap:10px;text-shadow:0 2px 12px rgba(0,0,0,.8)}
        .scene-kicker{font-size:7px;font-weight:900;letter-spacing:.15em;color:#69ddff}.scene-topbar strong{display:block;font-size:12px}.scene-topbar span{display:block;margin-top:2px;font-size:7px;color:#b7cddd}
        .scene-status{display:flex;align-items:center;gap:6px;padding:6px 9px;border:1px solid rgba(74,149,187,.35);border-radius:999px;background:rgba(3,17,27,.72);font-size:8px;font-weight:800;white-space:nowrap}
        .scene-status i{width:6px;height:6px;border-radius:50%;background:#9aacbb}.flow-live .scene-status{color:#6ef0ad;border-color:rgba(39,223,133,.35)}.flow-live .scene-status i{background:#27df85;box-shadow:0 0 10px rgba(39,223,133,.8);animation:statusPulse 1.7s ease-out infinite}
        @keyframes statusPulse{0%{box-shadow:0 0 0 0 rgba(39,223,133,.3)}70%{box-shadow:0 0 0 7px rgba(39,223,133,0)}100%{box-shadow:0 0 0 0 rgba(39,223,133,0)}
        .scene-art{position:relative;width:100%;aspect-ratio:1250/233;overflow:hidden;line-height:0}
        .scene-art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
        .scene-motion{position:absolute;inset:0;z-index:4;width:100%;height:100%;display:block;overflow:hidden;pointer-events:none}
        .scene-motion-line{fill:none;stroke:#6cddff;stroke-width:2;stroke-linecap:round;opacity:.18;stroke-dasharray:10 18}
        .flow-live .scene-motion-line{animation:flowDash 1.6s linear infinite}
        @keyframes flowDash{to{stroke-dashoffset:-56}
        .scene-arrows{display:none}.flow-live .scene-arrows{display:block}
        .energy-arrow path{fill:none;stroke:#d9fbff;stroke-width:3.2;stroke-linecap:round;stroke-linejoin:round;filter:url(#sceneArrowGlow)}
        .scene-meter-live{
          position:absolute;z-index:5;left:38.1%;top:39.5%;width:6.1%;height:17%;
          display:flex;align-items:center;justify-content:center;flex-direction:column;
          border:1px solid rgba(65,97,111,.72);border-radius:6px;
          background:linear-gradient(180deg,rgba(241,252,255,.98),rgba(205,236,241,.98));
          box-shadow:0 0 10px rgba(58,205,255,.16);color:#122b38
        }
        .scene-meter-live strong{font:800 clamp(8px,1.05vw,16px)/1 monospace;letter-spacing:.02em}.scene-meter-live span{margin-top:2px;font:800 clamp(4px,.42vw,7px)/1 system-ui;color:#526b78}
        .scene-data-strip{
          position:absolute;z-index:6;left:50%;bottom:5%;transform:translateX(-50%);
          display:flex;align-items:center;justify-content:center;gap:4px;max-width:92%;padding:4px 7px;
          border:1px solid rgba(123,200,234,.26);border-radius:999px;background:rgba(3,18,29,.72);
          backdrop-filter:blur(6px);color:#c7dbe6;font-size:6px;white-space:nowrap;line-height:1.1
        }
        .scene-data-strip span{padding:0 5px;border-right:1px solid rgba(142,191,216,.18)}.scene-data-strip span:last-child{border-right:0}.scene-data-strip b{color:#f1f8fd}
        .scene-vignette{position:absolute;z-index:2;inset:0;pointer-events:none;background:linear-gradient(90deg,rgba(2,11,20,.08),transparent 22%,transparent 78%,rgba(2,11,20,.08))}
        .scene-bottom{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 12px;border-top:1px solid #18384f;background:#06131e;color:#8da8bb;font-size:7px}
        .scene-bottom span{display:flex;align-items:center;gap:5px}.scene-bottom strong{font-size:8px;color:#e7f4fb}.flow-dot{width:6px;height:6px;border-radius:50%;background:#38d8ff;box-shadow:0 0 8px rgba(56,216,255,.65)}

        .kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px;margin-bottom:12px}
        .kpi{
          min-height:158px;padding:15px;border:1px solid #17384e;border-radius:15px;position:relative;overflow:hidden;
          background:linear-gradient(180deg,#0a1f2e,#071825);box-shadow:0 9px 22px rgba(0,0,0,.15)
        }
        .kpi.orange{background:linear-gradient(180deg,#101f2b,#081722)}.kpi.green{background:linear-gradient(180deg,#0a211d,#071921)}
        .kpi-top{display:flex;align-items:center;gap:10px}.kpi-icon{width:36px;height:36px;border-radius:11px;display:grid;place-items:center;border:1px solid #214c67;background:#0d2c43;color:#5fcfff;font-size:18px}
        .kpi.orange .kpi-icon{background:#33200d;border-color:#674720;color:#ffc04d}.kpi.green .kpi-icon{background:#092a1e;border-color:#18513a;color:#5deba8}
        .kpi-label{color:#9db5c9;font-size:10px}.kpi-value{margin-top:15px;font-size:30px;font-weight:900;letter-spacing:-.04em;line-height:1}.kpi-value small{font-size:12px;color:#9fb7ca;font-weight:700}
        .kpi-sub{margin-top:8px;color:#91aabd;font-size:8px;display:flex;flex-direction:column;gap:3px}.kpi-sub strong{color:#5febaa;font-size:9px}.kpi-sub strong.up{color:#ff9e60}.kpi-sub span{color:#809aae}
        .kpi-bar{position:absolute;left:15px;right:15px;bottom:14px;height:6px;border-radius:999px;background:#102d42;overflow:hidden}.kpi-bar i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#2ca4ff,#62e2ff)}
        .mini-trend{height:36px;margin-top:8px}.mini-trend svg{width:100%;height:100%;display:block}.mini-line{fill:none;stroke:#34dc8a;stroke-width:2.1;stroke-linecap:round}

        .main-grid{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(0,1fr);gap:12px;margin-bottom:12px}
        .panel-card{min-width:0;border:1px solid #17384f;border-radius:17px;background:linear-gradient(180deg,#091d2b,#071724);padding:15px;box-shadow:0 10px 25px rgba(0,0,0,.15)}
        .card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:11px}.card-head strong{font-size:14px;letter-spacing:-.015em}.card-head span{display:block;color:#7f9bad;font-size:8px;margin-top:2px}
        .pill{padding:7px 10px;border-radius:999px;border:1px solid #1f506d;background:#0b2b43;color:#65caff;font-size:9px;font-weight:900}
        .zone-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
        .zone{padding:12px;border:1px solid #193e57;border-radius:13px;background:linear-gradient(180deg,#0a2030,#071824);min-width:0}
        .zone .badge{display:inline-flex;align-items:center;justify-content:center;min-width:44px;height:26px;padding:0 10px;border-radius:9px;font-size:10px;font-weight:900}
        .z1 .badge{background:linear-gradient(180deg,#1686f7,#126acb);color:#fff;border:1px solid #38aaff;box-shadow:0 0 15px rgba(46,162,255,.24)}
        .z2 .badge{background:linear-gradient(180deg,#ffad43,#f27c1e);color:#fff;border:1px solid #ffc467;box-shadow:0 0 15px rgba(255,155,61,.18)}
        .z3 .badge{background:linear-gradient(180deg,#aa6aff,#7d42d8);color:#fff;border:1px solid #bb8eff;box-shadow:0 0 15px rgba(155,99,255,.2)}
        .z1{border-color:#173f64}.z2{border-color:#5c421f}.z3{border-color:#49306f}
        .zone small{display:block;color:#7d99ad;font-size:8px;margin-top:7px}.zone>b{display:block;margin-top:9px;font-size:20px;letter-spacing:-.02em}.zone>b i{font-style:normal;font-size:9px;color:#8da7ba}
        .zone-footer{display:flex;justify-content:space-between;align-items:center;gap:7px;margin-top:10px;padding-top:9px;border-top:1px solid #18364a;color:#7d98ac;font-size:8px}.zone-footer strong{font-size:10px}
        .z1 .zone-footer strong{color:#5ec2ff}.z2 .zone-footer strong{color:#ffb65f}.z3 .zone-footer strong{color:#c09aff}

        .chart-inner{position:relative;width:100%;height:252px}.chart-summary{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:3px}.chart-summary>div:first-child{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}
        .chart-summary strong{font-size:27px;letter-spacing:-.04em}.chart-summary span{font-size:8px;color:#7894aa}.chart-summary em{font-style:normal;color:#59eba7;font-size:9px;font-weight:900}.chart-summary em.up{color:#ff9e60}
        .chart-tabs{display:flex;align-items:center;gap:3px;padding:4px;background:#0a1b2a;border:1px solid #183a51;border-radius:999px}.chart-tab{border:0;background:transparent;color:#8ca6b9;border-radius:999px;padding:7px 10px;font-size:8px;cursor:pointer}.chart-tab.active{color:#fff;background:linear-gradient(180deg,#2a98f0,#176fc1);box-shadow:0 0 18px rgba(42,152,240,.28)}
        .chart-inner svg{width:100%;height:210px;display:block;overflow:visible}.chart-grid{stroke:#17364b;stroke-width:1}.chart-axis-y,.chart-axis-x{fill:#7894a9;font-size:8px}
        .hourbar{outline:none}.hourbar rect{transition:filter .15s ease,transform .15s ease;transform-box:fill-box;transform-origin:center bottom}.hourbar:hover rect,.hourbar:focus rect{filter:brightness(1.2);transform:scaleY(1.025)}
        .bar-t1{fill:#2e9fff;filter:drop-shadow(0 0 4px rgba(46,159,255,.22))}.bar-t2{fill:#ff9b3d;filter:drop-shadow(0 0 4px rgba(255,155,61,.18))}.bar-t3{fill:#9b63ff;filter:drop-shadow(0 0 4px rgba(155,99,255,.20))}
        .chart-legend{display:flex;gap:16px;margin-top:-2px;color:#819bad;font-size:8px}.chart-legend span{display:inline-flex;align-items:center;gap:5px}.chart-legend i{width:7px;height:7px;border-radius:50%;display:inline-block}.legend-blue{background:#2e9fff}.legend-orange{background:#ff9b3d}.legend-purple{background:#9b63ff}
        .chart-empty{height:220px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#7d98aa;gap:5px}.chart-empty strong{color:#dceaf4;font-size:11px}.chart-empty span{font-size:8px}

        .context{height:100%;margin:0}.pse-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.pse-card{padding:10px;border:1px solid #193b52;border-radius:12px;background:#081b2a}.pse-card-head strong{font-size:10px}.pse-card-head span{font-size:7px}.pse-card-head>b{padding:5px 7px;font-size:7px}.pse-timeline{gap:2px;margin-top:9px}.pse-hour span{font-size:5px}.pse-hour i{width:12px;height:12px;border-radius:50%}
        .pse-hour.pse-darkgreen i{background:#25c17a}.pse-hour.pse-green i{background:#71c493}.pse-hour.pse-yellow i{background:#e9b63f}.pse-hour.pse-red i{background:#dd5968}
        .pse-legend{display:flex;gap:9px;flex-wrap:wrap;margin-top:8px;color:#7792a6;font-size:7px}.pse-legend i{width:6px;height:6px;border-radius:50%}.legend-darkgreen{background:#25c17a}.legend-green{background:#71c493}.legend-yellow{background:#e9b63f}.legend-red{background:#dd5968}

        .bottom-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(230px,.88fr) minmax(230px,.92fr);gap:12px;align-items:stretch}
        .stats-list{display:grid;gap:2px}.stat-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 0;border-bottom:1px solid #143247}.stat-row:last-child{border-bottom:0}.stat-left{display:flex;align-items:center;gap:8px;color:#89a2b5;font-size:8px}.stat-left i{width:28px;height:28px;border-radius:9px;background:#0c2a3d;display:grid;place-items:center;color:#55c7ff;font-size:12px}.stat-row:nth-child(2) .stat-left i{color:#62e4ff}.stat-row:nth-child(3) .stat-left i{color:#ff7e91}.stat-row:nth-child(4) .stat-left i{color:#c587ff}.stat-row strong{font-size:10px;white-space:nowrap}
        .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.info{padding:9px;border:1px solid #17384d;background:#081b2a;border-radius:10px}.info-label{color:#728da2;font-size:6px;text-transform:uppercase;letter-spacing:.09em}.info-value{margin-top:5px;color:#e6f3fb;font-size:9px;font-weight:800}.status-live-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#27df85;box-shadow:0 0 8px rgba(39,223,133,.7);margin-right:4px}.full{grid-column:1/-1}
        .refresh-wide{width:100%;height:38px;margin-top:9px;border:1px solid #20537a;border-radius:10px;background:#0a2d48;color:#d8effc;font-weight:800;font-size:9px;cursor:pointer}
        .footer{display:flex;justify-content:space-between;gap:12px;padding:8px 2px 0;color:#648097;font-size:7px}

        @media(prefers-reduced-motion:reduce){.flow-live .scene-status i,.flow-live .scene-motion-line,.scene-arrows,.spin{animation:none!important}
        @media(max-width:1050px){.nav b{padding:9px 15px}.connection{min-width:160px}.bottom-grid{grid-template-columns:1fr 1fr}.bottom-grid .context{grid-column:1/-1}.kpi-grid{grid-template-columns:repeat(2,1fr)}.main-grid{grid-template-columns:1fr}
        @media(max-width:700px){.dashboard{padding:10px}.topbar{align-items:flex-start}.nav{display:none}.connection{min-width:0;padding:8px}.connection span{display:none}.brand{min-width:0}.scene-topbar{left:10px;right:10px;top:9px}.scene-topbar strong{font-size:9px}.scene-status{padding:6px 7px;font-size:7px}.scene-data-strip{max-width:96%;font-size:5px}.scene-meter-live{left:38%;top:39%;width:6.4%;height:18%}.kpi-grid{grid-template-columns:1fr 1fr}.kpi{min-height:135px;padding:12px}.kpi-value{font-size:23px}.zone-grid,.pse-grid{grid-template-columns:1fr}.bottom-grid{grid-template-columns:1fr}.bottom-grid .context{grid-column:auto}.chart-tabs{display:none}.chart-inner{height:230px}.chart-inner svg{height:185px}.info-grid{grid-template-columns:1fr}.footer{flex-direction:column}
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
            <div><h1>TAURON <span>eLicznik</span></h1><small>${this._escape(c.title||"Energia")} · zużycie i analiza</small></div>
          </div>
          <nav class="nav" aria-label="Sekcje panelu"><b class="active">Energia</b><b>Analiza</b><b>Taryfa</b><b>Ustawienia</b></nav>
          <div class="top-actions">
            <div class="connection"><i></i><div><strong>Połączony</strong><span>${updated?this._date(updated):"Brak danych"}</span></div></div>
            <button class="refresh" data-refresh title="Odśwież dane Tauron" aria-label="Odśwież dane Tauron" ${this._loading?"disabled":""}><span class="${this._loading?"spin":""}">↻</span></button>
          </div>
        </header>

        ${this._energyFlowSvg(dailyConsumed)}

        <section class="kpi-grid" aria-label="Podsumowanie energii">
          <article class="kpi">
            <div class="kpi-top"><div class="kpi-icon">⌂</div><span class="kpi-label">Pobór dzisiaj</span></div>
            <div class="kpi-value">${Number.isFinite(dailyConsumed)?this._fmt(dailyConsumed,2):"—"} <small>kWh</small></div>
            <div class="kpi-sub"><strong class="${Number.isFinite(changePct)&&changePct>0?"up":""}">${this._escape(changeText)}</strong><span>porównanie z poprzednim dniem</span></div>
            <div class="kpi-bar"><i style="width:${budgetPercent}%"></i></div>
          </article>

          <article class="kpi">
            <div class="kpi-top"><div class="kpi-icon">⚡</div><span class="kpi-label">Moc chwilowa</span></div>
            <div class="kpi-value">${Number.isFinite(power)?this._fmt(power,0):"—"} <small>W</small></div>
            <div class="kpi-sub"><span>${Number.isFinite(power)?"Odczyt chwilowy z HAN":"Brak encji mocy chwilowej"}</span></div>
            <div class="mini-trend"><svg viewBox="0 0 220 40" preserveAspectRatio="none" aria-hidden="true"><polyline class="mini-line" points="0,31 16,25 31,28 47,19 63,23 79,15 95,21 111,10 127,18 143,13 159,20 175,10 191,16 207,7 220,11"/></svg></div>
          </article>

          <article class="kpi orange">
            <div class="kpi-top"><div class="kpi-icon">◉</div><span class="kpi-label">Koszt dzisiaj</span></div>
            <div class="kpi-value">${fmtMoney(cost)}</div>
            <div class="kpi-sub"><strong style="color:#ffc45c">Taryfa ${this._escape(String(tariff))}</strong><span>${Number.isFinite(cost)?"z danych Home Assistant":"Brak encji kosztu"}</span></div>
          </article>

          <article class="kpi green">
            <div class="kpi-top"><div class="kpi-icon">⌁</div><span class="kpi-label">Ślad węglowy</span></div>
            <div class="kpi-value">${fmtCo2(carbon)}</div>
            <div class="kpi-sub"><strong style="color:#58eaa6">CO₂</strong><span>${Number.isFinite(carbon)?"Wartość z Home Assistant":"Brak encji CO₂"}</span></div>
          </article>
        </section>

        <div class="main-grid">
          <section class="panel-card">
            <div class="card-head"><div><strong>Strefy taryfowe — ${this._escape(String(tariff))}</strong><span>Stan licznika i zużycie dzisiaj</span></div><div class="pill">Taryfa ${this._escape(String(tariff))}</div></div>
            <div class="zone-grid">
              <article class="zone z1"><span class="badge">T1 ☾</span><small>Strefa T1</small><b>${Number.isFinite(t1)?this._fmt(t1,0):"—"} <i>kWh</i></b><div class="zone-footer"><span>Dzisiaj</span><strong>${Number.isFinite(t1Daily)?this._fmt(t1Daily,1):"—"} kWh</strong></div></article>
              <article class="zone z2"><span class="badge">T2 ☀</span><small>Strefa T2</small><b>${Number.isFinite(t2)?this._fmt(t2,0):"—"} <i>kWh</i></b><div class="zone-footer"><span>Dzisiaj</span><strong>${Number.isFinite(t2Daily)?this._fmt(t2Daily,1):"—"} kWh</strong></div></article>
              <article class="zone z3"><span class="badge">T3 ◐</span><small>Strefa T3</small><b>${Number.isFinite(t3)?this._fmt(t3,0):"—"} <i>kWh</i></b><div class="zone-footer"><span>Dzisiaj</span><strong>${Number.isFinite(t3Daily)?this._fmt(t3Daily,1):"—"} kWh</strong></div></article>
            </div>
          </section>

          <section class="panel-card">
            <div class="card-head">
              <div><strong>Zużycie energii</strong><span>Godzinowy profil · ${selectedLabel}</span></div>
              <div style="display:flex;gap:5px">
                <button class="refresh" data-energy-today title="Dzisiaj" aria-label="Dzisiaj">⌂</button>
                <button class="refresh" data-energy-date="-1" title="Poprzedni dzień" aria-label="Poprzedni dzień">‹</button>
                <button class="refresh" data-energy-date="1" title="Następny dzień" aria-label="Następny dzień" ${currentDate===selectedDate?"disabled":""}>›</button>
              </div>
            </div>
            ${this._chartSvg()}
          </section>
        </div>

        <div class="bottom-grid">
          <section class="panel-card context">
            <div class="card-head"><div><strong>Energetyczny Kompas PSE</strong><span>Prognoza na podstawie danych PSE i taryfy ${this._escape(String(tariff))}</span></div><div class="pill">${this._escape(String(tariff))}</div></div>
            <div class="pse-grid">
              ${this._pseCard("Dzisiaj","Energetyczne godziny szczytu",c.pse_today_entity)}
              ${this._pseCard("Jutro · D+1","Planowane energetyczne godziny szczytu",c.pse_tomorrow_entity)}
            </div>
            <div class="pse-legend">
              <span><i class="legend-darkgreen"></i>Zalecane użytkowanie</span><span><i class="legend-green"></i>Normalne użytkowanie</span><span><i class="legend-yellow"></i>Zalecane oszczędzanie</span><span><i class="legend-red"></i>Wymagane ograniczenie</span>
            </div>
          </section>

          <section class="panel-card">
            <div class="card-head"><div><strong>Statystyki</strong><span>Ostatnie 30 dni</span></div></div>
            <div class="stats-list">
              <div class="stat-row"><div class="stat-left"><i>▥</i>Średnie dzienne zużycie</div><strong>${Number.isFinite(dailyAverage)?this._fmt(dailyAverage,2):"—"} kWh</strong></div>
              <div class="stat-row"><div class="stat-left"><i>↗</i>Najwyższe zużycie</div><strong>${Number.isFinite(max30)?this._fmt(max30,1):"—"} kWh</strong></div>
              <div class="stat-row"><div class="stat-left"><i>↘</i>Najniższe zużycie</div><strong>${Number.isFinite(min30)?this._fmt(min30,1):"—"} kWh</strong></div>
              <div class="stat-row"><div class="stat-left"><i>Σ</i>Łączne zużycie</div><strong>${Number.isFinite(total30)?this._fmt(total30,1):"—"} kWh</strong></div>
            </div>
          </section>

          <section class="panel-card">
            <div class="card-head"><div><strong>Informacje o liczniku</strong><span>eLicznik</span></div></div>
            <div class="info-grid">
              <div class="info"><div class="info-label">Model</div><div class="info-value">MA309M</div></div>
              <div class="info"><div class="info-label">Numer licznika</div><div class="info-value">${this._escape(String(meterNumber))}</div></div>
              <div class="info"><div class="info-label">Taryfa</div><div class="info-value">${this._escape(String(tariff))}</div></div>
              <div class="info"><div class="info-label">Ostatni odczyt</div><div class="info-value">${this._date(lastReading)}</div></div>
              <div class="info full"><div class="info-label">Status</div><div class="info-value"><span class="status-live-dot"></span>Połączony (HAN)</div></div>
            </div>
            <button class="refresh-wide" data-refresh title="Odśwież dane Tauron" aria-label="Odśwież dane Tauron" ${this._loading?"disabled":""}>↻&nbsp; Odśwież dane z eLicznik</button>
          </section>
        </div>

        <footer class="footer">
          <span>Źródło: /odczyty/api · /energia/api · PSE Energetyczny Kompas</span>
          <span>Wybrany dzień: ${selectedDate} · Auto ${this._autoRefreshMinutes} min · Aktualizacja ${updated?this._date(updated):"—"}</span>
        </footer>
      </section>
    `;
  }
}

customElements.define("tauron-energy-card", TauronEnergyCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "tauron-energy-card",
  name: "Tauron Energy Card",
  description: "Nowoczesny panel Tauron eLicznik."
});
