/**
 * ChartsApp v2.0.1 - V14 Ready
 * - Tracked stats: damageDealt, damageTaken, healingDone, kills, maxSingleHit, maxSingleHeal, timesDowned
 * - nameDisplay support
 * - Player colours from game.users
 * - Chart.js from CDN
 */

import { exportToExcel } from "./exporter.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const MODULE_ID   = "combat-stats-pf2e";
const S_HISTORY   = "combatHistory";
const CHARTJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js";

let _chartJsReady = false;
async function ensureChartJs() {
  if (_chartJsReady || globalThis.Chart) { _chartJsReady = true; return; }
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src     = CHARTJS_CDN;
    s.onload  = () => { _chartJsReady = true; resolve(); };
    s.onerror = () => reject(new Error("Chart.js CDN load failed"));
    document.head.appendChild(s);
  });
}

function buildPlayerColourMap() {
  const map = {};
  for (const user of game.users ?? []) {
    const actor = user.character;
    if (!actor) continue;
    const col = user.color?.css ?? user.color ?? null;
    if (col) { map[actor.id] = col; map[actor.name] = col; }
  }
  return map;
}

function resolveDisplayName(actorId, actorName, mode) {
  if (mode === "username") {
    const user = game.users?.find(u => u.character?.id === actorId);
    if (user) return user.name ?? actorName;
  }
  if (mode === "firstname") return actorName.split(" ")[0];
  if (mode === "lastname")  { const parts = actorName.split(" "); return parts[parts.length - 1]; }
  return actorName;
}

function sumFights(history) {
  const map = {};
  for (const fight of history) {
    for (const [id, c] of Object.entries(fight.characters ?? {})) {
      if (!map[id]) map[id] = {
        id, name: c.name,
        damageDealt: 0, damageTaken: 0, healingDone: 0,
        kills: 0, maxSingleHit: 0, maxSingleHeal: 0, timesDowned: 0
      };
      map[id].damageDealt  += c.damageDealt  ?? 0;
      map[id].damageTaken  += c.damageTaken  ?? 0;
      map[id].healingDone  += c.healingDone  ?? 0;
      map[id].kills        += c.kills        ?? 0;
      map[id].maxSingleHit  = Math.max(map[id].maxSingleHit,  c.maxSingleHit  ?? 0);
      map[id].maxSingleHeal = Math.max(map[id].maxSingleHeal, c.maxSingleHeal ?? 0);
      map[id].timesDowned  += c.timesDowned  ?? 0;
      map[id].name          = c.name;
    }
  }
  return Object.values(map).sort((a, b) => b.damageDealt - a.damageDealt);
}

function grandTotals(chars) {
  return chars.reduce((a, c) => {
    a.damageDealt += c.damageDealt ?? 0;
    a.damageTaken += c.damageTaken ?? 0;
    a.healingDone += c.healingDone ?? 0;
    a.kills       += c.kills       ?? 0;
    a.timesDowned += c.timesDowned ?? 0;
    return a;
  }, { damageDealt:0, damageTaken:0, healingDone:0, kills:0, timesDowned:0 });
}

export class ChartsApp extends HandlebarsApplicationMixin(ApplicationV2) {

  constructor() {
    super();
    this._chart     = null;
    this._metric    = "dealt";
    this._chartType = "bar";
    this._tab       = "totals";
    this._fightId   = null;
  }

  static DEFAULT_OPTIONS = {
    id:      "combat-stats-charts",
    classes: ["combat-stats", "charts"],
    window:  { title: "Combat Stats", resizable: true, draggable: true },
    position: { width: 1100, height: 620 }
  };

  static PARTS = {
    body: { template: "modules/combat-stats-pf2e/templates/charts.hbs" }
  };

  async _prepareContext() {
    const history     = game.settings.get(MODULE_ID, S_HISTORY) ?? [];
    const nameDisplay = (() => { try { return game.settings.get(MODULE_ID, "nameDisplay"); } catch { return "full"; } })();

    const colourMap = buildPlayerColourMap();
    const totals = sumFights(history).map(c => ({
      ...c,
      displayName:  resolveDisplayName(c.id, c.name, nameDisplay),
      playerColor:  colourMap[c.id] ?? colourMap[c.name] ?? null
    }));
    const gTotal = grandTotals(totals);

    let selectedFight = null, fightChars = [], fightDefeated = [];
    let fightTotal = { damageDealt:0, damageTaken:0, healingDone:0, kills:0 };

    if (this._fightId) {
      selectedFight = history.find(f => f.id === this._fightId);
      if (selectedFight) {
        fightChars = Object.values(selectedFight.characters ?? {})
          .sort((a, b) => (b.damageDealt ?? 0) - (a.damageDealt ?? 0))
          .map(c => ({
            ...c,
            displayName: resolveDisplayName(c.id, c.name, nameDisplay),
            playerColor: colourMap[c.id] ?? colourMap[c.name] ?? null
          }));
        fightTotal = grandTotals(fightChars);
        fightDefeated = (selectedFight.defeated ?? []).map(d => ({
          name:       d.name,
          killerName: d.killedBy ? (game.actors.get(d.killedBy)?.name ?? "Sconosciuto") : null
        }));
      }
    }

    const g = k => { try { return game.settings.get(MODULE_ID, k); } catch { return true; } };
    const show = {
      kills:       g("trackKills"),
      damageDealt: g("trackDamageDealt"),
      damageTaken: g("trackDamageTaken"),
      healingDone: g("trackHealingDone"),
    };

    return {
      history, hasData: history.length > 0,
      tab: this._tab, metric: this._metric, chartType: this._chartType,
      isGM: game.user.isGM,
      totals, grandTotal: gTotal,
      selectedFight, fightChars, fightTotal, fightDefeated,
      date: selectedFight ? new Date(selectedFight.date).toLocaleString() : "",
      show
    };
  }

  _onRender(context, options) {
    const html = this.element;

    html.querySelectorAll(".cs-tab-btn").forEach(btn =>
      btn.addEventListener("click", () => { this._tab = btn.dataset.tab; this.render(true); })
    );

    html.querySelector("#cs-close-fight-tab")?.addEventListener("click", () => {
      this._fightId = null; this._tab = "totals"; this.render(true);
    });

    html.querySelectorAll(".cs-mode-btn").forEach(btn =>
      btn.addEventListener("click", () => {
        this._metric = btn.dataset.mode;
        html.querySelectorAll(".cs-mode-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this._buildChart(html);
      })
    );

    html.querySelectorAll(".cs-type-btn").forEach(btn =>
      btn.addEventListener("click", () => {
        this._chartType = btn.dataset.type;
        html.querySelectorAll(".cs-type-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this._buildChart(html);
      })
    );

    html.querySelector("#cs-fight-select")?.addEventListener("change", (ev) => {
      this._fightId = ev.target.value || null;
      this._tab     = this._fightId ? "fight" : "totals";
      this.render(true);
    });

    html.querySelector("#cs-delete-fight")?.addEventListener("click", async () => {
      if (!this._fightId) return;
      const history = game.settings.get(MODULE_ID, S_HISTORY) ?? [];
      const fight   = history.find(f => f.id === this._fightId);
      if (!fight) return;
      const ok = await foundry.applications.api.DialogV2.confirm({
        window:  { title: "Delete Fight" },
        content: `<p>Do you want to delete <strong>${fight.name}</strong>? This cannot be undone.</p>`
      });
      if (!ok) return;
      await game.settings.set(MODULE_ID, S_HISTORY, history.filter(f => f.id !== this._fightId));
      this._fightId = null; this._tab = "totals";
      this.render(true);
    });

    html.querySelector("#cs-export-excel")?.addEventListener("click", () => {
      exportToExcel(game.settings.get(MODULE_ID, S_HISTORY) ?? [], "combat-stats");
    });

    html.querySelector("#cs-clear-history")?.addEventListener("click", async () => {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window:  { title: "Delete History" },
        content: "<p>Delete <strong>ALL</strong> the history? This cannot be undone.</p>"
      });
      if (ok) {
        await game.settings.set(MODULE_ID, S_HISTORY, []);
        this._fightId = null; this._tab = "totals";
        this.render(true);
      }
    });

    if (this._tab === "history") this._buildChart(html);
  }

  async _buildChart(html) {
    const canvas = html.querySelector("#cs-chart-canvas");
    if (!canvas) return;
    const history = game.settings.get(MODULE_ID, S_HISTORY) ?? [];
    if (!history.length) return;

    try { await ensureChartJs(); } catch(e) {
      const c = html.querySelector(".cs-chart-container");
      if (c) c.innerHTML = `<p class="cs-no-data">Chart.js non disponibile.<br>Controlla la connessione internet.</p>`;
      return;
    }

    if (this._chart) { this._chart.destroy(); this._chart = null; }

    const nameDisplay = (() => { try { return game.settings.get(MODULE_ID, "nameDisplay"); } catch { return "full"; } })();
    const actorKeys   = new Map();
    history.forEach(f => Object.entries(f.characters ?? {}).forEach(([id, c]) => {
      if (!actorKeys.has(id)) actorKeys.set(id, resolveDisplayName(id, c.name, nameDisplay));
    }));

    const fieldMap = {
      dealt:  "damageDealt",
      taken:  "damageTaken",
      healed: "healingDone",
      kills:  "kills",
      maxhit: "maxSingleHit",
      maxheal:"maxSingleHeal",
      downed: "timesDowned"
    };
    const field = fieldMap[this._metric] ?? "damageDealt";

    const colourMap = buildPlayerColourMap();
    const fallback  = ["#ce4141","#e67e22","#2ecc71","#52a8e0","#e0c852","#a352e0","#e07f52","#52e0d1"];
    const textColor = getComputedStyle(document.documentElement).getPropertyValue("--cs-text").trim() || "#eee";

    const isMax = field === "maxSingleHit" || field === "maxSingleHeal";
    const labels = [];
    const barData = [];
    const barColors = [];
    const barBorders = [];
    let i = 0;
    for (const [id, displayName] of actorKeys) {
      const colour = colourMap[id] ?? fallback[i % fallback.length];
      const values = history.flatMap(fight => {
        const entry = Object.entries(fight.characters ?? {}).find(([eid]) => eid === id);
        return entry ? [entry[1][field] ?? 0] : [0];
      });
      const total = isMax ? Math.max(...values) : values.reduce((a, b) => a + b, 0);
      labels.push(displayName);
      barData.push(total);
      barColors.push(colour + "99");
      barBorders.push(colour);
      i++;
    }

    const isDoughnut = this._chartType === "doughnut";

    const datasets = [{
      label: "",
      data: barData,
      backgroundColor: isDoughnut ? barBorders.map(c => c + "cc") : barColors,
      borderColor:     isDoughnut ? barBorders.map(c => c + "ff") : barBorders,
      borderWidth: 2,
      tension: 0.3
    }];

    this._chart = new Chart(canvas.getContext("2d"), {
      type: this._chartType,
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: isDoughnut
            ? { display: true, position: "right", labels: { color: textColor, padding: 16, font: { size: 13 } } }
            : { display: false },
          tooltip: { callbacks: {
            label: isDoughnut
              ? c => ` ${c.label}: ${c.parsed}`
              : c => ` ${c.parsed.y}`
          }}
        },
        scales: isDoughnut ? {} : {
          x: { ticks: { color: textColor }, grid: { color: "#44444488" } },
          y: { beginAtZero: true, ticks: { color: textColor }, grid: { color: "#44444488" } }
        }
      }
    });
  }
}