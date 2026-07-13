/**
 * Combat Stats v2.0.1 - V14 Ready
 */

import { CombatTracker }       from "./tracker.js";
import { ChartsApp }           from "./charts.js";
import { CombatStatsSettings } from "./settings-menu.js";

export const MODULE_ID       = "combat-stats-pf2e";
export const SETTING_HISTORY = "combatHistory";
export const SETTING_CURRENT = "currentCombatData";

export const COLOR_DEFAULTS = {
  accent:       "#d4af37",
  bg:           "#1a1a24",
  bgRow:        "#252530",
  dealt:        "#ff2020",
  taken:        "#52a8e0",
  healed:       "#2ecc71",
  text:         "#eeeeee",
  bigHit:       "#ff6a00",
  maxSingleHit: "#ff4500",
  maxSingleHeal:"#27ae60",
  timesDowned:  "#e8e8e8",
};

class TrackedStatsDialog extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id:       "cs-tracked-stats",
      title:    "Combat Stats — Tracked Statistics",
      template: "modules/combat-stats-pf2e/templates/tracked-stats.hbs",
      width:    340,
      height:   "auto",
      classes:  ["combat-stats", "cs-settings-window"]
    });
  }

  getData() {
    const g = k => game.settings.get(MODULE_ID, k);
    return {
      trackKills:         g("trackKills"),
      trackDamageDealt:   g("trackDamageDealt"),
      trackDamageTaken:   g("trackDamageTaken"),
      trackHealingDone:   g("trackHealingDone"),
      trackMaxSingleHeal: g("trackMaxSingleHeal"),
      trackTimesDowned:   g("trackTimesDowned"),
      chatShowKills:          g("chatShowKills"),
      chatShowDamageDealt:    g("chatShowDamageDealt"),
      chatShowDamageTaken:    g("chatShowDamageTaken"),
      chatShowHealingDone:    g("chatShowHealingDone"),
    };
  }

  async _updateObject(event, formData) {
    for (const [key, value] of Object.entries(formData)) {
      await game.settings.set(MODULE_ID, key, value);
    }
    ui.notifications.info("Combat Stats | Tracked statistics saved.");
  }
}

Hooks.once("init", () => {
  console.log("Combat Stats | v2.0.1 — init");

  const hidden = { scope: "world", config: false };

  game.settings.register(MODULE_ID, SETTING_HISTORY, { ...hidden, type: Array,  default: [], name: "History" });
  game.settings.register(MODULE_ID, SETTING_CURRENT, { ...hidden, type: Object, default: {}, name: "Current" });
  game.settings.register(MODULE_ID, "announcerActorId", {
    scope: "world",
    config: true,
    type: String,
    default: "",
    name: "Chat Announcer Actor ID ",
    hint: "Enter the Actor's UUID (e.g., XYZ123ABC). Do not include the 'Actor.' prefix. Leave empty to use the default: Combat Stats."
  });

  game.settings.register(MODULE_ID, "trackKills",             { ...hidden, type: Boolean, default: true });
  game.settings.register(MODULE_ID, "trackDamageDealt",   { ...hidden, type: Boolean, default: true });
  game.settings.register(MODULE_ID, "trackDamageTaken",   { ...hidden, type: Boolean, default: true });
  game.settings.register(MODULE_ID, "trackHealingDone",   { ...hidden, type: Boolean, default: true });
  game.settings.register(MODULE_ID, "trackMaxSingleHeal", { ...hidden, type: Boolean, default: true });
  game.settings.register(MODULE_ID, "trackTimesDowned",       { ...hidden, type: Boolean, default: true });

  game.settings.register(MODULE_ID, "chatShowKills",       { ...hidden, type: Boolean, default: true });
  game.settings.register(MODULE_ID, "chatShowDamageDealt", { ...hidden, type: Boolean, default: true });
  game.settings.register(MODULE_ID, "chatShowDamageTaken", { ...hidden, type: Boolean, default: true });
  game.settings.register(MODULE_ID, "chatShowHealingDone", { ...hidden, type: Boolean, default: true });

  const colorKeys = [
    { key: "colorAccent",       def: COLOR_DEFAULTS.accent       },
    { key: "colorBg",           def: COLOR_DEFAULTS.bg           },
    { key: "colorBgRow",        def: COLOR_DEFAULTS.bgRow        },
    { key: "colorDealt",        def: COLOR_DEFAULTS.dealt        },
    { key: "colorTaken",        def: COLOR_DEFAULTS.taken        },
    { key: "colorHealed",       def: COLOR_DEFAULTS.healed       },
    { key: "colorText",         def: COLOR_DEFAULTS.text         },
    { key: "colorMaxSingleHit", def: COLOR_DEFAULTS.maxSingleHit },
    { key: "colorMaxSingleHeal",def: COLOR_DEFAULTS.maxSingleHeal},
    { key: "colorTimesDowned",  def: COLOR_DEFAULTS.timesDowned  },
  ];
  for (const { key, def } of colorKeys) {
    game.settings.register(MODULE_ID, key, { ...hidden, type: String, default: def, onChange: () => applyTheme() });
  }

  const world = { scope: "world", config: true, restricted: true };

  game.settings.register(MODULE_ID, "playersCanViewCharts", {
    ...world,
    type:    Boolean,
    default: false,
    name:    "Players can view charts",
    hint:    "Allow non-GM players to open the Combat Stats chart window."
  });

  game.settings.register(MODULE_ID, "nameDisplay", {
    ...world,
    type:    String,
    default: "full",
    name:    "Name display in recap",
    hint:    "How character names appear in the end-of-combat chat card.",
    choices: {
      full:      "Full name — e.g. Player Character",
      firstname: "First name only — e.g. Player",
      lastname:  "Last name only — e.g. Character",
      username:  "Foundry username — e.g. Smantella"
    }
  });

  game.settings.register(MODULE_ID, "aoeCountsAsOne", {
    ...world,
    type:    Boolean,
    default: false,
    name:    "Count AoE as a single hit",
    hint:    "When enabled, damage dealt to multiple targets in one roll is summed for the big hit tracker. When disabled, only the highest single-target value is used."
  });

  game.settings.register(MODULE_ID, "bigHitThreshold", {
    ...world,
    type:    Number,
    default: 30,
    range:   { min: 0, max: 999, step: 1 },
    name:    "Big hit threshold",
    hint:    "Minimum damage in a single hit to trigger the achievement message. Set to 0 to disable."
  });

  game.settings.register(MODULE_ID, "bigHitColor", {
    ...hidden,
    type:    String,
    default: "#ff6a00",
    onChange: () => {} 
  });

  game.settings.register(MODULE_ID, "bigHitMessage", {
    ...hidden,
    type:    String,
    default: "" 
  });

  game.settings.registerMenu(MODULE_ID, "trackedStatsMenu", {
    name:  "Tracked Statistics",
    label: "Configure",
    hint:  "Toggle which stats are tracked and displayed.",
    icon:  "fa-solid fa-list-check",
    type:  TrackedStatsDialog,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "themeMenu", {
    name:  "Theme & Data",
    label: "Configure",
    hint:  "Customise colors and manage combat history data.",
    icon:  "fa-solid fa-palette",
    type:  CombatStatsSettings,
    restricted: true
  });
});

Hooks.once("ready", () => {
  applyTheme();
  game.combatStats = new CombatTracker();
  game.combatStats.init();
  console.log("Combat Stats | Ready.");
});

Hooks.on("getSceneControlButtons", (controls) => {
  const canView = game.user?.isGM || game.settings.get(MODULE_ID, "playersCanViewCharts");
  if (!canView) return;

  const entries    = Object.entries(controls);
  const anchorKeys = ["sequencer", "specials", "fxmaster", "token-fxtools"];
  let   anchorIdx  = entries.findIndex(([k]) => anchorKeys.includes(k));
  if (anchorIdx === -1) anchorIdx = entries.length - 1;

  const ourEntry = ["combat-stats", {
    name: "combat-stats", title: "Combat Stats",
    icon: "fa-solid fa-chart-column", visible: true,
    tools: {
      "open-charts": {
        name: "open-charts", title: "Open Combat Stats",
        icon: "fa-solid fa-chart-column", button: true,
        onClick: () => {
          const existing = Object.values(ui.windows ?? {}).find(w => w.constructor?.name === "ChartsApp");
          if (existing) existing.bringToFront?.() ?? existing.bringToTop?.();
          else new ChartsApp().render(true);
        }
      }
    }
  }];

  const before    = entries.slice(0, anchorIdx + 1);
  const after     = entries.slice(anchorIdx + 1);
  const reordered = [...before, ourEntry, ...after];
  for (const k of Object.keys(controls)) delete controls[k];
  for (const [k, v] of reordered) controls[k] = v;
});

export function applyTheme() {
  const g    = k => game.settings.get(MODULE_ID, k);
  const root = document.documentElement;
  try {
    root.style.setProperty("--cs-accent",        g("colorAccent"));
    root.style.setProperty("--cs-bg",            g("colorBg"));
    root.style.setProperty("--cs-bg-row",        g("colorBgRow"));
    root.style.setProperty("--cs-dealt",         g("colorDealt"));
    root.style.setProperty("--cs-taken",         g("colorTaken"));
    root.style.setProperty("--cs-healed",        g("colorHealed"));
    root.style.setProperty("--cs-text",          g("colorText"));

    root.style.setProperty("--cs-maxhit",        g("colorMaxSingleHit"));
    root.style.setProperty("--cs-maxheal",       g("colorMaxSingleHeal"));
    root.style.setProperty("--cs-downed",        g("colorTimesDowned"));
  } catch(e) {
  }
}