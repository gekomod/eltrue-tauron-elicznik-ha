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
  const selectedLabel=this._dateLabel(selectedDate);
  const selectedIndex=history.findIndex(x=>x.date===selectedDate);
  const previous=selectedIndex>0?Number(history[selectedIndex-1]?.value):NaN;
  const changePct=Number.isFinite(dailyConsumed)&&Number.isFinite(previous)&&previous>0?((dailyConsumed-previous)/previous)*100:NaN;
  const changeText=Number.isFinite(changePct)
    ? (changePct<=0?"↓":"↑")+" "+this._fmt(Math.abs(changePct),0)+"%"
    : "Brak porównania";

  const values30=history.map(x=>Number(x.value)).filter(Number.isFinite);
  const max30=values30.length?Math.max(...values30):NaN;
  const min30=values30.length?Math.min(...values30):NaN;
  const total30=values30.length?values30.reduce((s,v)=>s+v,0):NaN;

  const fmtPower=v=>Number.isFinite(v)?this._fmt(v,0):"—";
  const fmtMoney=v=>Number.isFinite(v)?this._fmt(v,2):"—";
  const fmtCarbon=v=>Number.isFinite(v)?this._fmt(v,1):"—";
  const currentDate=this._dateKey(new Date());

  this.shadowRoot.innerHTML=`
    <style>
      :host{
        display:block;width:100%;color-scheme:dark;
        --bg:#030f19;--panel:#071a28;--card:#0a1d2c;--card2:#0c2132;
        --border:#173a51;--text:#edf8ff;--muted:#8da8bc;
        --blue:#2d9fff;--cyan:#62e8ff;--green:#28df86;--orange:#ff9b3d;--purple:#9d63ff;
        font-family:Inter,Roboto,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      }
      *{box-sizing:border-box}
      .dashboard{
        width:100%;padding:16px;border-radius:24px;overflow:hidden;color:var(--text);
        background:
          radial-gradient(circle at 8% 0%,rgba(45,159,255,.13),transparent 27%),
          radial-gradient(circle at 95% 4%,rgba(157,99,255,.10),transparent 23%),
          linear-gradient(180deg,#061623 0%,#030e17 100%);
        box-shadow:0 18px 52px rgba(0,0,0,.32)
      }
      .topbar{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:13px}
      .brand{display:flex;align-items:center;gap:10px;min-width:220px}
      .brand-mark{
        width:48px;height:48px;border-radius:15px;display:grid;place-items:center;
        background:linear-gradient(145deg,#171239,#55206f);border:1px solid #70429a;box-shadow:0 10px 28px rgba(118,50,163,.24)
      }
      .brand-mark svg{width:34px;height:34px;filter:drop-shadow(0 0 8px rgba(255,59,145,.28))}
      .brand h1{margin:0;font-size:20px;line-height:1;font-weight:900;letter-spacing:-.03em}.brand h1 span{display:block;color:#ff3b91;font-size:15px;margin-top:3px}.brand small{display:block;color:var(--muted);font-size:8px;margin-top:5px}
      .nav{display:flex;align-items:center;gap:4px;padding:5px;border:1px solid #183b53;border-radius:999px;background:#081a29}
      .nav b{padding:10px 24px;border-radius:999px;font-size:10px;color:#98b1c6;font-weight:700}.nav b.active{color:#fff;background:linear-gradient(180deg,#2c98ef,#176ec0);box-shadow:0 0 26px rgba(44,152,239,.34)}
      .top-actions{display:flex;align-items:center;gap:8px}
      .connection{display:flex;align-items:center;gap:8px;min-width:220px;padding:9px 12px;border:1px solid #193c53;border-radius:15px;background:rgba(8,27,41,.86)}
      .connection i{width:10px;height:10px;border-radius:50%;background:#29df83;box-shadow:0 0 0 5px rgba(41,223,131,.08)}.connection strong{display:block;font-size:10px}.connection span{display:block;font-size:7px;color:var(--muted);margin-top:2px}
      .refresh{width:36px;height:36px;border:1px solid #1b4058;background:#0a2132;border-radius:11px;color:#dff5ff;font-size:18px;cursor:pointer;transition:.16s}.refresh:hover{border-color:#2e91d5;background:#0d2a40}.refresh:focus-visible,.refresh-wide:focus-visible,.chart-tab:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}
      .spin{display:inline-block;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}

      .scene{position:relative;margin-bottom:12px;border:1px solid #18405a;border-radius:17px;overflow:hidden;background:#061624;box-shadow:0 14px 36px rgba(0,0,0,.24)}
      .scene-topbar{position:absolute;z-index:8;left:16px;right:16px;top:12px;display:flex;justify-content:space-between;gap:10px;align-items:flex-start;text-shadow:0 2px 10px rgba(0,0,0,.82)}
      .scene-kicker{font-size:7px;font-weight:900;letter-spacing:.15em;color:#70ddff}.scene-topbar strong{display:block;font-size:12px}.scene-topbar span{display:block;color:#bdd0df;font-size:7px;margin-top:2px}
      .scene-status{display:flex;align-items:center;gap:6px;padding:6px 9px;border:1px solid rgba(91,168,205,.38);border-radius:999px;background:rgba(3,16,27,.72);font-size:8px;font-weight:800;white-space:nowrap}.scene-status i{width:6px;height:6px;border-radius:50%;background:#9eb0bf}
      .flow-live .scene-status{color:#6ef0ad;border-color:rgba(39,223,133,.34)}.flow-live .scene-status i{background:#28df86;box-shadow:0 0 10px rgba(39,223,134,.8);animation:statusPulse 1.8s ease-out infinite}
      @keyframes statusPulse{0%{box-shadow:0 0 0 0 rgba(39,223,134,.32)}70%{box-shadow:0 0 0 7px rgba(39,223,134,0)}100%{box-shadow:0 0 0 0 rgba(39,223,134,0)}}
      .scene-art{position:relative;width:100%;aspect-ratio:1250/233;overflow:hidden;background:#071625;line-height:0}.scene-art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
      .scene-motion{position:absolute;inset:0;z-index:4;width:100%;height:100%;pointer-events:none;overflow:hidden}.scene-motion-line{fill:none;stroke:#68e1ff;stroke-width:2.1;stroke-linecap:round;opacity:.22;stroke-dasharray:12 18}
      .flow-live .scene-motion-line{animation:flowDash 1.4s linear infinite}@keyframes flowDash{to{stroke-dashoffset:-60}}
      .scene-arrows{display:none}.flow-live .scene-arrows{display:block}.energy-arrow path{fill:none;stroke:#d8fbff;stroke-width:3.4;stroke-linecap:round;stroke-linejoin:round;filter:url(#sceneArrowGlow)}
      .scene-meter-live{position:absolute;z-index:6;left:38.1%;top:39.4%;width:6.1%;height:17%;display:flex;align-items:center;justify-content:center;flex-direction:column;background:linear-gradient(180deg,rgba(242,252,255,.98),rgba(208,238,242,.98));border:1px solid rgba(66,97,112,.76);border-radius:6px;color:#132b38;box-shadow:0 0 10px rgba(58,205,255,.16);line-height:1}
      .scene-meter-live strong{font:900 clamp(8px,1.08vw,16px)/1 monospace;letter-spacing:.02em}.scene-meter-live span{margin-top:2px;font:900 clamp(4px,.42vw,7px)/1 system-ui;color:#526b78}
      .scene-data-strip{position:absolute;z-index:7;left:50%;bottom:5%;transform:translateX(-50%);display:flex;align-items:center;gap:3px;max-width:92%;padding:5px 8px;border:1px solid rgba(124,202,235,.28);border-radius:999px;background:rgba(3,18,29,.72);backdrop-filter:blur(7px);color:#c9dce8;font-size:6px;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.24)}.scene-data-strip span{padding:0 5px;border-right:1px solid rgba(142,191,216,.18)}.scene-data-strip span:last-child{border-right:0}.scene-data-strip b{color:#f1f8fd;margin-right:2px}
      .scene-vignette{position:absolute;z-index:3;inset:0;pointer-events:none;background:linear-gradient(90deg,rgba(2,11,20,.10),transparent 24%,transparent 76%,rgba(2,11,20,.10))}
      .scene-bottom{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 12px;border-top:1px solid #17384f;background:#06131f;color:#8da8bc;font-size:7px}.scene-bottom span{display:flex;align-items:center;gap:5px}.scene-bottom strong{font-size:8px;color:#e7f4fb}.flow-dot{width:6px;height:6px;border-radius:50%;background:#39d8ff;box-shadow:0 0 8px rgba(57,216,255,.7)}

      .kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px;margin-bottom:12px}.kpi{min-height:156px;position:relative;overflow:hidden;padding:15px;border:1px solid #17384e;border-radius:15px;background:linear-gradient(180deg,#0a1f2f,#071824);box-shadow:0 9px 22px rgba(0,0,0,.16)}
      .kpi:nth-child(3){background:linear-gradient(180deg,#10202b,#081722)}.kpi:nth-child(4){background:linear-gradient(180deg,#0a211e,#071820)}
      .kpi-top{display:flex;align-items:center;gap:10px}.kpi-icon{width:36px;height:36px;border-radius:11px;display:grid;place-items:center;background:#0e2c43;border:1px solid #214c67;color:#66d1ff;font-size:18px}.kpi:nth-child(3) .kpi-icon{background:#35210d;border-color:#68471e;color:#ffc252}.kpi:nth-child(4) .kpi-icon{background:#092b1f;border-color:#18523a;color:#5eeaa7}
      .kpi-label{font-size:10px;color:#9fb7c9}.kpi-value{margin-top:14px;font-size:30px;font-weight:900;letter-spacing:-.04em;line-height:1}.kpi-value small{font-size:12px;color:#9fb8ca;font-weight:700}.kpi-sub{display:flex;flex-direction:column;gap:3px;margin-top:8px;font-size:8px;color:#849eaf}.kpi-sub strong{font-size:10px;color:#5eecaa}.kpi-sub strong.up{color:#ff9f63}.kpi-sub span{color:#7f98aa}
      .kpi-bar{position:absolute;left:15px;right:15px;bottom:14px;height:6px;background:#102c41;border-radius:999px;overflow:hidden}.kpi-bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#2da4ff,#60e0ff)}.kpi:nth-child(3) .kpi-bar i{background:linear-gradient(90deg,#ff9636,#ffd06b)}.kpi:nth-child(4) .kpi-bar i{background:linear-gradient(90deg,#28d881,#83f2b9)}
      .mini-trend{height:34px;margin-top:8px}.mini-trend svg{width:100%;height:100%;display:block}.mini-line{fill:none;stroke:#34db88;stroke-width:2.1;stroke-linecap:round}

      .main-grid{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(0,1fr);gap:12px;margin-bottom:12px}.panel-card{min-width:0;border:1px solid #17384f;border-radius:17px;background:linear-gradient(180deg,#091d2b,#071724);padding:15px;box-shadow:0 10px 25px rgba(0,0,0,.16)}
      .card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:11px}.card-head strong{font-size:14px;letter-spacing:-.015em}.card-head span{display:block;color:#829bad;font-size:8px;margin-top:2px}.pill{padding:7px 10px;border:1px solid #20506e;background:#0b2c45;color:#65caff;border-radius:999px;font-size:9px;font-weight:900}
      .zone-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.zone{padding:12px;border:1px solid #1a3c55;border-radius:13px;background:linear-gradient(180deg,#0a2131,#071824)}.zone .badge{display:inline-flex;align-items:center;justify-content:center;min-width:45px;height:27px;padding:0 10px;border-radius:9px;font-size:10px;font-weight:900}
      .z1{border-color:#174365}.z2{border-color:#604520}.z3{border-color:#4b3272}.z1 .badge{background:linear-gradient(180deg,#1687f7,#126bcc);border:1px solid #39aaff;color:#fff;box-shadow:0 0 16px rgba(45,159,255,.24)}.z2 .badge{background:linear-gradient(180deg,#ffad42,#f57c1f);border:1px solid #ffca70;color:#fff;box-shadow:0 0 16px rgba(255,155,61,.20)}.z3 .badge{background:linear-gradient(180deg,#a967ff,#7d43d7);border:1px solid #bd91ff;color:#fff;box-shadow:0 0 16px rgba(157,99,255,.22)}
      .zone small{display:block;margin-top:7px;color:#7f99ab;font-size:8px}.zone>b{display:block;margin-top:9px;font-size:20px;letter-spacing:-.02em}.zone>b i{font-style:normal;color:#90a9ba;font-size:9px}.zone-footer{display:flex;align-items:center;justify-content:space-between;gap:7px;margin-top:10px;padding-top:9px;border-top:1px solid #17364a;color:#7e98aa;font-size:8px}.zone-footer strong{font-size:10px}.z1 .zone-footer strong{color:#61c5ff}.z2 .zone-footer strong{color:#ffb65f}.z3 .zone-footer strong{color:#c39cff}

      .chart-inner{position:relative;width:100%;height:252px}.chart-summary{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:4px}.chart-summary>div:first-child{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.chart-summary strong{font-size:27px;letter-spacing:-.04em}.chart-summary span{font-size:8px;color:#7894a8}.chart-summary em{font-style:normal;color:#5aeba6;font-size:9px;font-weight:900}.chart-summary em.up{color:#ff9f63}.chart-tabs{display:flex;align-items:center;gap:3px;padding:4px;background:#0a1b2a;border:1px solid #183a51;border-radius:999px}.chart-tab{border:0;background:transparent;color:#91a8ba;border-radius:999px;padding:7px 10px;font-size:8px;cursor:pointer}.chart-tab.active{color:#fff;background:linear-gradient(180deg,#2b98f0,#176fc1);box-shadow:0 0 18px rgba(43,152,240,.28)}
      .chart-inner svg{display:block;width:100%;height:208px;overflow:visible}.chart-grid{stroke:#17364b;stroke-width:1}.chart-axis-y,.chart-axis-x{fill:#7894a8;font-size:8px}.hourbar rect{transition:filter .15s ease,transform .15s ease;transform-box:fill-box;transform-origin:center bottom}.hourbar:hover rect,.hourbar:focus rect{filter:brightness(1.22);transform:scaleY(1.025)}.bar-t1{fill:#319fff;filter:drop-shadow(0 0 4px rgba(49,159,255,.24))}.bar-t2{fill:#ff9b3d;filter:drop-shadow(0 0 4px rgba(255,155,61,.18))}.bar-t3{fill:#9b63ff;filter:drop-shadow(0 0 4px rgba(155,99,255,.24))}
      .chart-legend{display:flex;gap:16px;margin-top:-2px;color:#819bad;font-size:8px}.chart-legend span{display:inline-flex;align-items:center;gap:5px}.chart-legend i{width:7px;height:7px;border-radius:50%;display:inline-block}.legend-blue{background:#319fff}.legend-orange{background:#ff9b3d}.legend-purple{background:#9b63ff}.chart-empty{height:220px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;color:#7d98aa}.chart-empty strong{color:#dceaf4;font-size:11px}.chart-empty span{font-size:8px}

      .bottom-grid{display:grid;grid-template-columns:minmax(0,1.48fr) minmax(230px,.88fr) minmax(230px,.92fr);gap:12px;align-items:stretch}.context{height:100%;margin:0}.pse-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.pse-card{padding:10px;border:1px solid #193b52;border-radius:12px;background:#081b2a}.pse-card-head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.pse-card-head strong{display:block;font-size:10px}.pse-card-head span{display:block;margin-top:2px;color:#7793a6;font-size:7px}.pse-card-head>b{padding:5px 7px;border-radius:999px;font-size:7px;white-space:nowrap;background:#10283a;color:#90a8ba}.pse-card-head>b.pse-darkgreen{background:#093523;color:#6ce8aa}.pse-card-head>b.pse-green{background:#103024;color:#91d9b1}.pse-card-head>b.pse-yellow{background:#3d2f0b;color:#ffd060}.pse-card-head>b.pse-red{background:#3b1820;color:#ff8798}
      .pse-timeline{display:grid;grid-template-columns:repeat(24,minmax(0,1fr));gap:2px;margin-top:9px}.pse-hour{text-align:center;min-width:0}.pse-hour span{display:block;color:#708ba0;font-size:5px;margin-bottom:3px}.pse-hour i{display:block;width:12px;height:12px;margin:0 auto;border-radius:50%;background:#1a3142}.pse-hour.pse-darkgreen i{background:#25c17a}.pse-hour.pse-green i{background:#71c493}.pse-hour.pse-yellow i{background:#e9b63f}.pse-hour.pse-red i{background:#dd5968}.pse-empty{grid-column:1/-1;padding:10px 0;color:#7893a8;font-size:8px}.pse-legend{display:flex;flex-wrap:wrap;gap:9px;margin-top:8px;color:#7892a5;font-size:7px}.pse-legend span{display:inline-flex;align-items:center;gap:5px}.pse-legend i{width:6px;height:6px;border-radius:50%}.legend-darkgreen{background:#25c17a}.legend-green{background:#71c493}.legend-yellow{background:#e9b63f}.legend-red{background:#dd5968}

      .stats-list{display:grid;gap:2px}.stat-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 0;border-bottom:1px solid #143247}.stat-row:last-child{border-bottom:0}.stat-left{display:flex;align-items:center;gap:8px;color:#89a2b5;font-size:8px}.stat-left i{width:28px;height:28px;border-radius:9px;background:#0d2b3e;display:grid;place-items:center;color:#5ecbff;font-size:12px}.stat-row:nth-child(2) .stat-left i{color:#4ce2ff}.stat-row:nth-child(3) .stat-left i{color:#ff7e91}.stat-row:nth-child(4) .stat-left i{color:#c788ff}.stat-row strong{font-size:10px;white-space:nowrap}
      .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.info{padding:9px;border:1px solid #17384d;border-radius:10px;background:#081b2a}.info-label{color:#728da2;font-size:6px;text-transform:uppercase;letter-spacing:.09em}.info-value{margin-top:5px;color:#e6f3fb;font-size:9px;font-weight:800}.status-live-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#28df85;box-shadow:0 0 8px rgba(40,223,133,.7);margin-right:4px}.full{grid-column:1/-1}.refresh-wide{width:100%;height:38px;margin-top:9px;border:1px solid #20537a;border-radius:10px;background:#0a2d48;color:#d8effc;font-weight:800;font-size:9px;cursor:pointer}.refresh-wide:hover{background:#0e3755}
      .footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 2px 0;color:#658198;font-size:7px}

      @media(prefers-reduced-motion:reduce){
        .flow-live .scene-status i,.flow-live .scene-motion-line,.scene-arrows .energy-arrow,.spin{animation:none!important}
      }
      @media(max-width:1050px){
        .nav b{padding:9px 15px}.connection{min-width:160px}.main-grid{grid-template-columns:1fr}.bottom-grid{grid-template-columns:1fr 1fr}.bottom-grid .context{grid-column:1/-1}.kpi-grid{grid-template-columns:repeat(2,1fr)}
      }
      @media(max-width:700px){
        .dashboard{padding:10px;border-radius:18px}.topbar{align-items:flex-start}.nav{display:none}.connection{min-width:0;padding:8px}.connection span{display:none}
        .brand{min-width:0}.brand-mark{width:42px;height:42px}.brand h1{font-size:18px}.brand h1 span{font-size:14px}
        .scene-topbar{left:10px;right:10px;top:9px}.scene-topbar strong{font-size:9px}.scene-status{padding:6px 7px;font-size:7px}.scene-meter-live{left:38%;top:39%;width:6.4%;height:18%}.scene-data-strip{font-size:5px;max-width:95%;gap:1px}.scene-data-strip span{padding:0 3px}
        .kpi-grid{grid-template-columns:1fr 1fr}.kpi{min-height:136px;padding:12px}.kpi-value{font-size:23px}
        .zone-grid,.pse-grid,.bottom-grid{grid-template-columns:1fr}.chart-tabs{display:none}.chart-inner{height:228px}.chart-inner svg{height:185px}.info-grid{grid-template-columns:1fr}.scene-bottom{align-items:flex-start;flex-direction:column}.footer{flex-direction:column}
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
          <div class="kpi-sub"><strong class="${changePct>0?"up":""}">${this._escape(changeText)}</strong><span>porównanie z poprzednim dniem</span></div>
          <div class="kpi-bar"><i style="width:${budgetPercent}%"></i></div>
        </article>

        <article class="kpi">
          <div class="kpi-top"><div class="kpi-icon">⚡</div><span class="kpi-label">Moc chwilowa</span></div>
          <div class="kpi-value">${fmtPower(power)} <small>W</small></div>
          <div class="kpi-sub"><span>${Number.isFinite(power)?"Odczyt chwilowy z HAN":"Brak encji mocy chwilowej"}</span></div>
          <div class="mini-trend"><svg viewBox="0 0 220 40" preserveAspectRatio="none" aria-hidden="true"><polyline class="mini-line" points="0,31 16,25 31,28 47,19 63,23 79,15 95,21 111,10 127,18 143,13 159,20 175,10 191,16 207,7 220,11"/></svg></div>
        </article>

        <article class="kpi">
          <div class="kpi-top"><div class="kpi-icon">◉</div><span class="kpi-label">Koszt dzisiaj</span></div>
          <div class="kpi-value">${fmtMoney(cost)} <small>zł</small></div>
          <div class="kpi-sub"><strong style="color:#ffc45c">Taryfa ${this._escape(String(tariff))}</strong><span>${Number.isFinite(cost)?"Z danych Home Assistant":"Brak encji kosztu"}</span></div>
        </article>

        <article class="kpi">
          <div class="kpi-top"><div class="kpi-icon">⌁</div><span class="kpi-label">Ślad węglowy</span></div>
          <div class="kpi-value">${fmtCarbon(carbon)} <small>CO₂</small></div>
          <div class="kpi-sub"><strong style="color:#59e9a5">CO₂</strong><span>${Number.isFinite(carbon)?"Wartość z Home Assistant":"Brak encji CO₂"}</span></div>
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
          <div class="card-head"><div><strong>Zużycie energii</strong><span>Godzinowy profil · ${selectedLabel}</span></div>
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
          <div class="pse-legend"><span><i class="legend-darkgreen"></i>Zalecane użytkowanie</span><span><i class="legend-green"></i>Normalne użytkowanie</span><span><i class="legend-yellow"></i>Zalecane oszczędzanie</span><span><i class="legend-red"></i>Wymagane ograniczenie</span></div>
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

  this.shadowRoot.querySelectorAll("[data-energy-date]").forEach(button=>{
    button.addEventListener("click",()=>this._changeDate(Number(button.dataset.energyDate)));
  });
  const todayButton=this.shadowRoot.querySelector("[data-energy-today]");
  if(todayButton)todayButton.addEventListener("click",()=>this._goToday());

  this.shadowRoot.querySelectorAll("[data-refresh],.refresh-wide").forEach(button=>{
    button.addEventListener("click",()=>this._refresh());
  });

  const chart=this.shadowRoot.querySelector(".chart-inner");
  const tooltip=this.shadowRoot.querySelector(".chart-tooltip");
  if(chart&&tooltip){
    chart.querySelectorAll(".hourbar").forEach(bar=>{
      const show=event=>{
        tooltip.hidden=false;
        tooltip.innerHTML="<strong>"+bar.dataset.kind+"</strong><span>"+bar.dataset.label+"</span><b>"+this._fmt(Number(bar.dataset.value),2)+" kWh</b>";
      };
      bar.addEventListener("mouseenter",show);
      bar.addEventListener("focus",show);
      bar.addEventListener("mousemove",event=>{
        const rect=chart.getBoundingClientRect();
        const x=event.clientX-rect.left,y=event.clientY-rect.top;
        tooltip.style.left=Math.max(8,Math.min(x+12,rect.width-150))+"px";
        tooltip.style.top=Math.max(8,y-65)+"px";
      });
      bar.addEventListener("mouseleave",()=>{tooltip.hidden=true;});
      bar.addEventListener("blur",()=>{tooltip.hidden=true;});
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
