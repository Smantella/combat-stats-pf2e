/**
 * SummaryApp v2.0.2 - V14 Ready
 * End-of-combat chat card con supporto per attore personalizzato
 */

const MODULE_ID = "combat-stats-pf2e";
const _posted   = new Set();

function resolveDisplayName(actorId, actorName, mode) {
  if (mode === "username") {
    const user = game.users?.find(u => u.character?.id === actorId);
    if (user) return user.name ?? actorName;
  }
  if (mode === "firstname") return actorName.split(" ")[0];
  if (mode === "lastname")  { const parts = actorName.split(" "); return parts[parts.length - 1]; }
  return actorName; 
}

export class SummaryApp {

  static openOnce(record) {
    if (_posted.has(record.id)) return;
    _posted.add(record.id);
    SummaryApp.postToChat(record);
  }

  static async postToChat(record) {
    const chars = Object.values(record.characters ?? {})
      .sort((a, b) => (b.damageDealt ?? 0) - (a.damageDealt ?? 0));
    if (!chars.length) return;

    const g = k => { try { return game.settings.get(MODULE_ID, k); } catch { return null; } };
    const nameDisplay     = g("nameDisplay")     ?? "full";
    const bigHitThreshold = g("bigHitThreshold") ?? 30;
    const bigHitColor     = g("bigHitColor")     ?? "#ff6a00";

    const cAccent = g("colorAccent") ?? "#d4af37";
    const cDealt  = g("colorDealt")  ?? "#ce4141";
    const cTaken  = g("colorTaken")  ?? "#e67e22";
    const cHealed = g("colorHealed") ?? "#2ecc71";
    const cBg     = g("colorBg")     ?? "#1a1a24";
    const cBgRow  = g("colorBgRow")  ?? "#252530";
    const cText   = g("colorText")   ?? "#eeeeee";

    const show = {
      kills:       g("trackKills")       !== false,
      damageDealt: g("trackDamageDealt") !== false,
      damageTaken: g("trackDamageTaken") !== false,
      healingDone: g("trackHealingDone") !== false,
    };

    const colourMap = {};
    for (const user of game.users ?? []) {
      const actor = user.character;
      if (!actor) continue;
      const col = user.color?.css ?? user.color ?? null;
      if (col) { colourMap[actor.id] = col; colourMap[actor.name] = col; }
    }

    const cellS = `flex:1;display:flex;align-items:center;justify-content:center;padding:8px 4px;`;
    const valS  = `font-weight:700;line-height:1;white-space:nowrap;`;
    const subS  = `font-size:0.75em;font-weight:600;opacity:0.9;white-space:nowrap;`;
    const rowS  = `display:flex;align-items:stretch;border-bottom:1px solid rgba(255,255,255,0.04);background:${cBgRow};`;
    const nameS = `width:90px;min-width:60px;max-width:90px;flex-shrink:0;display:flex;align-items:center;padding:0 8px;overflow:hidden;`;

    const chatShow = {
      kills:       g("chatShowKills")       !== false,
      damageDealt: g("chatShowDamageDealt") !== false,
      damageTaken: g("chatShowDamageTaken") !== false,
      healingDone: g("chatShowHealingDone") !== false,
    };
    const activeCols = [];
    if (chatShow.kills)       activeCols.push({ key:"kills",       color:cAccent,   sub:null });
    if (chatShow.damageDealt) activeCols.push({ key:"damageDealt", color:cDealt    });
    if (chatShow.damageTaken) activeCols.push({ key:"damageTaken", color:"#52a8e0" });
    if (chatShow.healingDone) activeCols.push({ key:"healingDone", color:cHealed   });

    const headerIcons = { kills:"fa-skull", damageDealt:"fa-burst", damageTaken:"fa-shield-halved", healingDone:"fa-heart" };
    const headerColors = { kills:cAccent, damageDealt:cDealt, damageTaken:"#52a8e0", healingDone:cHealed };
    const headerCells = activeCols.map(col =>
      `<div style="${cellS}background:${cBg};padding:6px 4px;">
        <i class="fa-solid ${headerIcons[col.key]}" style="color:${headerColors[col.key]};font-size:1.05em;"></i>
      </div>`
    ).join("");
    const headerRow = `
      <div style="display:flex;align-items:stretch;background:${cBg};border-bottom:1px solid rgba(255,255,255,0.08);">
        <div style="${nameS}height:34px;background:${cBg};"></div>
        ${headerCells}
      </div>`;

    const rows = chars.map(c => {
      const displayName = resolveDisplayName(c.id, c.name, nameDisplay);
      const nameColour  = colourMap[c.id] ?? colourMap[c.name] ?? cText;
      const shadow      = "text-shadow:0 0 4px rgba(0,0,0,0.9),0 0 8px rgba(0,0,0,0.7);";

      const cells = activeCols.map(col => {
        const val    = c[col.key] ?? 0;
        const subVal = col.sub ? (c[col.sub] ?? 0) : 0;
        const showSub = col.sub && show[col.sub] && subVal > 0;
        const subSpan = showSub
          ? ` <span style="${subS}color:${col.subColor};" title="${col.subTitle}">(+${subVal})</span>`
          : "";
        return `<div style="${cellS}"><span style="${valS}color:${col.color};">${val}</span>${subSpan}</div>`;
      }).join("");

      return `
      <div style="${rowS}">
        <div style="${nameS}">
          <span style="font-weight:700;font-size:0.88em;color:${nameColour};${shadow};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;width:100%;">${displayName}</span>
        </div>
        ${cells}
      </div>`;
    }).join("");

    const totals = chars.reduce((a, c) => {
      a.kills             += c.kills             ?? 0;
      a.damageDealt += c.damageDealt ?? 0;
      a.damageTaken += c.damageTaken ?? 0;
      a.healingDone += c.healingDone ?? 0;
      return a;
    }, { kills:0, damageDealt:0, damageTaken:0, healingDone:0 });

    const totalCells = activeCols.map(col =>
      `<div style="${cellS}"><span style="${valS}color:${col.color};">${totals[col.key]}</span></div>`
    ).join("");
    const totalsRow = `
      <div style="display:flex;align-items:stretch;background:${cBg};border-top:2px solid ${cAccent}55;">
        <div style="${nameS}background:${cBg};height:40px;">
          <span style="font-size:0.8em;font-weight:700;color:${cAccent};">${game.i18n.localize("COMBATSTATS.Table.Total")}</span>
        </div>
        ${totalCells}
      </div>`;

    let bigHitHTML = "";
    if (bigHitThreshold > 0) {
      let bestHit = 0, bestChar = null;
      for (const c of chars) {
        if ((c.maxSingleHit ?? 0) > bestHit) {
          bestHit = c.maxSingleHit;
          bestChar = c;
        }
      }
      if (bestChar && bestHit >= bigHitThreshold) {
        const name = resolveDisplayName(bestChar.id, bestChar.name, nameDisplay);
        const customMsg = g("bigHitMessage") ?? "";
        const defaultMsg = game.i18n.localize("COMBATSTATS.Chat.BigHit");
        const msgTemplate = customMsg.trim() || defaultMsg;
        const source = bestChar.maxSingleHitSource?.trim() ?? "";
        let bigHitText = msgTemplate
          .replace(/\{\{name\}\}/g, name)
          .replace(/\{\{value\}\}/g, bestHit);
        if (source) {
          bigHitText = bigHitText.replace(/\{\{source\}\}/g, source);
        } else {
          bigHitText = bigHitText.replace(/\s*(with|con|using|tramite)\s*\{\{source\}\}/gi, "").replace(/\{\{source\}\}/g, "");
        }
        bigHitHTML = `
      <div style="padding:6px 10px 8px;border-top:1px solid rgba(255,106,0,0.3);
                  background:rgba(255,106,0,0.05);display:flex;align-items:center;gap:8px;">
        <i class="fa-solid fa-khanda" style="color:${bigHitColor};font-size:1.1em;flex-shrink:0;"></i>
        <span style="color:${bigHitColor};font-weight:700;font-size:0.88em;">
          ${bigHitText}
        </span>
      </div>`;
      }
    }

    const defeated = record.defeated ?? [];
    let defeatedHTML = "";
    if (defeated.length) {
      const groups = new Map();
      for (const d of defeated) {
        const killerActor = d.killedBy ? game.actors.get(d.killedBy) : null;
        const killerName  = killerActor?.name ?? null;
        const key = `${d.killedBy ?? ""}|${d.name.toLowerCase()}`;
        if (!groups.has(key)) groups.set(key, { name: d.name, killerName, count: 0 });
        groups.get(key).count++;
      }
      const tags = [...groups.values()].map(grp => {
        const badge = grp.count > 1
          ? `<span style="background:${cAccent}33;border-radius:8px;padding:0 5px;font-size:0.9em;font-weight:700;color:${cAccent};">${grp.count}×</span>`
          : "";
        return `<span style="background:${cDealt}1a;border:1px solid ${cDealt}55;
                      border-radius:10px;padding:2px 9px;font-size:0.8em;
                      display:inline-flex;align-items:center;gap:5px;">
          ${grp.killerName ? `<span style="color:${cAccent};font-weight:700;">${grp.killerName}</span>
            <i class="fa-solid fa-skull" style="color:${cDealt};font-size:0.75em;"></i>` : ""}
          <span style="opacity:0.7;color:${cText};">${grp.name}</span>
          ${badge}
        </span>`;
      }).join("");
      const defeatedLabel = game.i18n.localize("COMBATSTATS.Chat.Defeated");
      defeatedHTML = `
      <div style="padding:6px 10px 8px;border-top:1px solid ${cAccent}33;background:${cBgRow};">
        <div style="font-size:0.75em;color:${cAccent};font-weight:700;margin-bottom:5px;letter-spacing:0.04em;">
          <i class="fa-solid fa-skull"></i> ${defeatedLabel} (${defeated.length})
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">${tags}</div>
      </div>`;
    }

    const content = `
<div style="font-family:'Signika',sans-serif;border:2px solid ${cAccent};border-radius:8px;
            background:${cBg};overflow:hidden;color:${cText};width:100%;box-sizing:border-box;">
  <div style="background:linear-gradient(135deg,${cAccent},${cAccent}bb);color:${cBg};
              padding:7px 12px;display:flex;align-items:center;gap:8px;">
    <i class="fa-solid fa-swords" style="font-size:0.9em;"></i>
    <strong style="font-size:1em;">${record.name}</strong>
  </div>
  ${headerRow}
  ${rows}
  ${totalsRow}
  ${bigHitHTML}
  ${defeatedHTML}
</div>`;

    // Recupero dell'impostazione dell'attore personalizzato[cite: 1]
    const announcerId = game.settings.get(MODULE_ID, "announcerActorId");
    const announcer = announcerId ? game.actors.get(announcerId) : null;

    await ChatMessage.create({
      content,
      // Se l'attore esiste ed è valido, usa lui, altrimenti usa l'alias di default[cite: 1]
      speaker: announcer 
        ? ChatMessage.getSpeaker({ actor: announcer }) 
        : { alias: "⚔️ Combat Stats" },
      style: CONST.CHAT_MESSAGE_STYLES?.OTHER ?? 0,
      flags: { "combat-stats": { summary: true, fightId: record.id } }
    });
  }
}