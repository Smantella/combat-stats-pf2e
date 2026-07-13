/**
 * CombatTracker v2.0.1 - V14 Ready
 *
 * Strategy:
 * - Attacker attribution: intercept createChatMessage for PF2e damage rolls.
 * Damage chat messages carry flags.pf2e.context.actor (attacker uuid/id)
 * and flags.pf2e.target.actor (target uuid).
 * - Damage / healing applied: preUpdateActor snapshot + updateActor delta.
 * PF2e applies all damage (including healing, which is negative) through
 * actor.applyDamage(), which always ends in an updateActor call.
 * - NPC defeat: detected in updateActor when HP reaches 0.
 */

import { SummaryApp } from "./summary.js";

const MODULE_ID = "combat-stats-pf2e";
const S_HISTORY = "combatHistory";
const S_CURRENT = "currentCombatData";
const TTL_MS    = 30_000; 

export class CombatTracker {

  constructor() {
    this._pending     = new Map();
    this._hpSnapshot  = {};
  }

  init() {
    Hooks.on("createCombat", async (combat) => {
      if (!game.user.isGM) return;
      const fightNumber = (game.settings.get(MODULE_ID, S_HISTORY)?.length ?? 0) + 1;
      const defaultName = `Fight #${fightNumber}`;
      const name        = await this._promptFightName(defaultName);
      this._resetCurrent(combat.id, name);
      console.log(`Combat Stats | Started: "${name}" [${combat.id}]`);
    });

    Hooks.on("deleteCombat", async (combat) => {
      if (!game.user.isGM) return;
      const current = game.settings.get(MODULE_ID, S_CURRENT);
      if (!current?.combatId || current.combatId !== combat.id) return;
      await this._finaliseAndSave(combat, current.fightName);
    });

    this._initHooks();
  }

  _promptFightName(defaultName) {
    return new Promise((resolve) => {
      new Dialog({
        title: "Combat Stats — Combat Name",
        content: `
          <div style="padding:8px 4px;">
            <label style="display:block;margin-bottom:6px;font-weight:600;color:var(--cs-accent,#d4af37);">
              Combat name:
            </label>
            <input id="cs-fight-name" type="text" value="${defaultName}"
              style="width:100%;padding:5px 8px;background:#111827;color:#eee;
                     border:1px solid var(--cs-accent,#d4af37);border-radius:4px;
                     font-family:inherit;font-size:1em;" autofocus>
          </div>`,
        buttons: {
          ok: {
            icon:  '<i class="fa-solid fa-swords"></i>',
            label: "Confirm",
            callback: (html) => {
              const val = html.find("#cs-fight-name").val()?.trim();
              resolve(val || defaultName);
            }
          }
        },
        default: "ok",
        close: () => resolve(defaultName)
      }, { classes: ["dialog", "combat-stats-dialog"], width: 360 }).render(true);
    });
  }

  _initHooks() {

    Hooks.on("preUpdateActor", (actor, changes) => {
      if (!game.user.isGM || !game.combat?.active) return;
      if (changes?.system?.attributes?.hp?.value === undefined) return;
      this._hpSnapshot[actor.id] = actor.system.attributes.hp.value;
    });

    Hooks.on("createChatMessage", (message) => {
      if (!game.user.isGM || !game.combat?.active) return;
      const pf2e = message.flags?.pf2e;
      if (!pf2e) return;

      const ctx = pf2e.context;
      if (!ctx || !["damage-roll", "spell-cast"].includes(ctx.type ?? "")) {
        if (ctx?.type && ctx.type !== "damage-roll") return;
      }

      const attackerUuid = ctx?.actor ?? null;
      if (!attackerUuid) return;
      const attackerActor = fromUuidSync?.(attackerUuid) ?? game.actors.get(attackerUuid);
      if (!attackerActor) return;
      if (attackerActor.type !== "character") return; 

      const itemName = pf2e.origin?.name ?? message.item?.name ?? null;

      const isHeal = this._messageIsHeal(message);

      const targetUuid = pf2e.target?.actor ?? null;
      const targetActor = targetUuid ? (fromUuidSync?.(targetUuid) ?? game.actors.get(targetUuid)) : null;

      const entry = {
        attacker: { id: attackerActor.id, name: attackerActor.name },
        itemName,
        isHeal,
        ts: Date.now()
      };

      if (targetActor) {
        this._pending.set(targetActor.id, entry);
      } else {
        this._pending.set(`broadcast:${attackerActor.id}`, entry);
      }

      this._pruneStale();
    });

    Hooks.on("updateActor", (actor, changes) => {
      if (!game.user.isGM || !game.combat?.active) return;
      const newHP = changes?.system?.attributes?.hp?.value;
      if (newHP === undefined) return;
      const current = game.settings.get(MODULE_ID, S_CURRENT);
      if (!current?.combatId) return;

      const priorHP = this._hpSnapshot[actor.id];
      delete this._hpSnapshot[actor.id];
      if (priorHP === undefined || priorHP === newHP) return;

      const delta = newHP - priorHP; 

      const pending = this._pending.get(actor.id) ?? this._findBroadcast();

      if (delta < 0) {
        const dmgApplied = Math.abs(delta); 

        if (actor.type === "character") {
          if (game.settings.get(MODULE_ID, "trackDamageTaken"))
            this._acc(current, actor.id, actor.name, "damageTaken", dmgApplied);

          if (game.settings.get(MODULE_ID, "trackTimesDowned") && newHP <= 0 && priorHP > 0)
            this._acc(current, actor.id, actor.name, "timesDowned", 1);
        }

        if (pending && pending.attacker) {
          if (game.settings.get(MODULE_ID, "trackDamageDealt")) {
            this._acc(current, pending.attacker.id, pending.attacker.name, "damageDealt", dmgApplied, pending.itemName);
          }

          if (game.settings.get(MODULE_ID, "trackKills") && actor.type === "npc" && newHP <= 0 && priorHP > 0) {
            this._accKill(current, pending.attacker.id, pending.attacker.name, actor.name);
          }
        }

        if (actor.type === "npc" && newHP <= 0 && priorHP > 0) {
          if (!current.defeated) current.defeated = [];
          const killedBy = pending?.attacker?.id ?? null;
          if (!current.defeated.some(d => d.id === actor.id && d.killedBy === killedBy))
            current.defeated.push({ name: actor.name, id: actor.id, killedBy });
        }

        if (this._pending.has(actor.id)) this._pending.delete(actor.id);

      } else {
        const healApplied = delta; 

        if (pending?.isHeal && pending.attacker) {
          if (game.settings.get(MODULE_ID, "trackHealingDone")) {
            this._acc(current, pending.attacker.id, pending.attacker.name, "healingDone", healApplied, pending.itemName);
          }

          if (!current.characters) current.characters = {};
          if (!current.characters[pending.attacker.id])
            this._acc(current, pending.attacker.id, pending.attacker.name, "healingDone", 0);
          const floored = Math.floor(healApplied);
          if (floored > (current.characters[pending.attacker.id]?.maxSingleHeal ?? 0)) {
            current.characters[pending.attacker.id].maxSingleHeal       = floored;
            current.characters[pending.attacker.id].maxSingleHealSource = pending.itemName ?? "";
          }

          if (this._pending.has(actor.id)) this._pending.delete(actor.id);
        }
      }

      game.settings.set(MODULE_ID, S_CURRENT, current);
    });
  }

  _messageIsHeal(message) {
    const pf2e = message.flags?.pf2e ?? {};

    const opts = pf2e.context?.options ?? [];
    if (opts.includes?.("action:heal") || opts.some?.(o => o.includes("healing"))) return true;

    const itemType = pf2e.origin?.type ?? "";
    if (itemType === "heal-action") return true;

    for (const roll of (message.rolls ?? [])) {
      try {
        const formula = typeof roll === "string" ? roll : (roll.formula ?? roll._formula ?? "");
        if (formula.toLowerCase().includes("[healing]")) return true;
      } catch {  }
    }

    return false;
  }

  _findBroadcast() {
    const now = Date.now();
    for (const [key, entry] of this._pending) {
      if (!key.startsWith("broadcast:")) continue;
      if (now - entry.ts <= TTL_MS) return entry;
    }
    return null;
  }

  _pruneStale() {
    const cut = Date.now() - TTL_MS;
    for (const [k, v] of this._pending) if (v.ts < cut) this._pending.delete(k);
  }

  _acc(current, actorId, actorName, field, amount, source = null) {
    if (!current.characters) current.characters = {};
    if (!current.characters[actorId])
      current.characters[actorId] = {
        id: actorId, name: actorName,
        damageDealt: 0, damageTaken: 0, healingDone: 0,
        kills: 0, maxSingleHit: 0, maxSingleHitSource: "",
        maxSingleHeal: 0, maxSingleHealSource: "", timesDowned: 0
      };
    current.characters[actorId][field] = Math.floor((current.characters[actorId][field] ?? 0) + amount);
    current.characters[actorId].name   = actorName;
    current.characters[actorId].id     = actorId;

    if (field === "damageDealt") {
      const floored = Math.floor(amount);
      if (floored > (current.characters[actorId].maxSingleHit ?? 0)) {
        current.characters[actorId].maxSingleHit       = floored;
        current.characters[actorId].maxSingleHitSource = source ?? "";
      }
    }
  }

  _accKill(current, actorId, actorName, victimName) {
    if (!current.characters) current.characters = {};
    if (!current.characters[actorId])
      current.characters[actorId] = {
        id: actorId, name: actorName,
        damageDealt: 0, damageTaken: 0, healingDone: 0,
        kills: 0, maxSingleHit: 0
      };
    current.characters[actorId].kills = (current.characters[actorId].kills ?? 0) + 1;
    console.log(`Combat Stats | Kill: ${actorName} → ${victimName}`);
  }

  _resetCurrent(combatId, fightName) {
    game.settings.set(MODULE_ID, S_CURRENT, { combatId, fightName, characters: {}, defeated: [] });
  }

  async _finaliseAndSave(combat, fightName) {
    const current = game.settings.get(MODULE_ID, S_CURRENT);
    const history = game.settings.get(MODULE_ID, S_HISTORY) ?? [];
    const record  = {
      id:         crypto.randomUUID(),
      date:       new Date().toISOString(),
      name:       fightName || combat.name || `Fight #${history.length + 1}`,
      characters: current.characters ?? {},
      defeated:   current.defeated   ?? []
    };
    history.push(record);
    await game.settings.set(MODULE_ID, S_HISTORY, history);
    await game.settings.set(MODULE_ID, S_CURRENT, {});
    console.log(`Combat Stats | Saved: ${record.name}`);
    SummaryApp.openOnce(record);
  }
}