const MY_TEAM_PORTRAIT_PLACEHOLDER = "/static/hero-portraits/placeholder.svg";

function loadMyTeams() {
  const root = document.getElementById("my-teams-root");
  const status = document.getElementById("my-teams-status");
  if (!root) return;
  bindMyTeamPortraits(root);
  if (status) status.textContent = "LOADING";
  root.innerHTML = '<div class="hud-state hud-state-loading">正在读取自己的队伍…</div>';
  fetch("/api/my-teams")
    .then((response) => {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    })
    .then((data) => {
      if (status) status.textContent = data.lineupReady ? "READY" : "PARTIAL";
      root.innerHTML = renderMyTeams(data);
    })
    .catch((error) => {
      if (status) status.textContent = "ERROR";
      root.innerHTML = `<div class="hud-state">读取失败：${escapeMyTeam(error.message || error)}</div>`;
    });
}

function bindMyTeamPortraits(root) {
  if (root.dataset.portraitBound) return;
  root.dataset.portraitBound = "1";
  root.addEventListener("error", (event) => {
    const image = event.target;
    if (!image?.classList?.contains("my-team-portrait")) return;
    const placeholder = image.dataset.placeholderSrc || MY_TEAM_PORTRAIT_PLACEHOLDER;
    const fallback = image.dataset.fallbackSrc || placeholder;
    if (image.getAttribute("src") !== fallback) {
      image.dataset.fallbackSrc = placeholder;
      image.src = fallback;
      return;
    }
    if (image.getAttribute("src") !== placeholder) image.src = placeholder;
  }, true);
}

function renderMyTeams(data) {
  const reports = data.reportTeams || [];
  const note = `<p class="my-team-note">${escapeMyTeam(data.hint || "")}</p>`;
  const summary = `<p class="my-team-count">${escapeMyTeam(data.roleName || "当前账号")} · 战报队伍 ${reports.length}</p>`;
  const reportMarkup = reports.map(renderReportTeam).join("");
  const cities = (data.cities || []).map(renderMyTeamCity).join("");
  const loose = !reports.length && (data.looseHeroes || []).length
    ? `<section class="my-team-card"><header class="my-team-head"><div class="my-team-identity"><h3>未挂到部队的武将</h3></div></header><div class="my-team-grid">${(data.looseHeroes || []).map((hero) => renderMyTeamHeroCard("未分位", hero)).join("")}</div></section>`
    : "";
  if (!reportMarkup && !cities && !loose) {
    return `${summary}${note}<div class="hud-state">这个账号还没有带武将的战报。抓包开着时打一仗，再回来刷新。</div>`;
  }
  return `${summary}${note}${reportMarkup}${cities}${loose}`;
}

function renderReportTeam(team) {
  const heroes = (team.slots || []).map((slot) => slot.hero || {});
  const title = heroes.map((hero) => hero.name).filter(Boolean).join(" / ") || "队伍";
  const placeName = String(team.lastPlace || "").trim();
  const meta = [
    `${team.sampleSize || 0} 场`,
    placeName,
    team.lastTime || "",
    team.side === "def" ? "防守" : "进攻",
  ].filter(Boolean).join(" · ");
  const slots = (team.slots || []).map((slot) => renderMyTeamHeroCard(slot.slot, slot.hero || {})).join("");
  return `<article class="my-team-card"><header class="my-team-head"><div class="my-team-identity"><div><h3>${escapeMyTeam(title)}</h3><p>${escapeMyTeam(meta)}</p></div></div></header><div class="my-team-grid">${slots}</div></article>`;
}

function renderMyTeamCity(city) {
  const armies = (city.armies || []).map(renderMyTeamArmy).join("");
  return `<section class="my-team-card"><header class="my-team-head"><div class="my-team-identity"><h3>${escapeMyTeam(city.label || "驻地")}</h3></div></header>${armies}</section>`;
}

function renderMyTeamArmy(army) {
  const slots = (army.slots || []).map((slot) => {
    return slot.hero
      ? renderMyTeamHeroCard(slot.slot, slot.hero)
      : `<article class="my-team-hero"><div class="my-team-hero-body"><span class="my-team-slot">${escapeMyTeam(slot.slot)}</span><strong>${slot.heroUid ? "武将详情未到" : "空位"}</strong></div></article>`;
  }).join("");
  const state = army.state == null ? "" : `状态 ${army.state}`;
  const ready = army.lineupReady ? "" : "阵容未齐";
  const meta = [state, ready].filter(Boolean).join(" · ");
  return `<article><header class="my-team-head"><div class="my-team-identity"><h3>部队 ${army.armyId}</h3>${meta ? `<p>${escapeMyTeam(meta)}</p>` : ""}</div></header><div class="my-team-grid">${slots}</div></article>`;
}

function renderMyTeamHeroCard(slot, hero) {
  const name = hero.name || (hero.heroId ? `武将 ${hero.heroId}` : `实例 ${hero.heroUid || ""}`);
  const bits = [];
  if (hero.level != null) bits.push(`Lv.${hero.level}`);
  if (hero.advance != null && hero.advance > 0) bits.push(`★${hero.advance}`);
  const troops = hero.hpMax != null ? hero.hpMax : hero.hp;
  if (troops != null) bits.push(`兵力 ${troops}`);
  if (hero.energy != null) bits.push(`体力 ${hero.energy}`);
  const skills = hero.skills || [];
  const skillMarkup = skills.length
    ? `<ul class="my-team-skills">${skills.map((skill) => {
      const skillName = skill.name || `#${skill.id}`;
      const level = skill.level ? `<small>Lv.${skill.level}</small>` : "";
      return `<li><span>${escapeMyTeam(skillName)}</span>${level}</li>`;
    }).join("")}</ul>`
    : `<span class="my-team-skill-empty">${hero.configured ? "这场战报没有战法" : "武将和战法还没同步到"}</span>`;
  return `<article class="my-team-hero" data-camp="${Number(hero.camp) || 0}">${myTeamPortrait(hero)}<div class="my-team-hero-body"><span class="my-team-slot">${escapeMyTeam(slot || "")}</span><strong>${escapeMyTeam(name)}</strong><small>${escapeMyTeam(bits.join(" · ") || "暂无等级和兵力")}</small>${skillMarkup}</div></article>`;
}

function myTeamPortrait(hero) {
  const name = hero.name || "武将";
  return `<img class="my-team-portrait" src="${escapeMyTeam(myTeamPortraitSrc(hero))}" alt="${escapeMyTeam(name)}画像" loading="lazy" decoding="async" data-fallback-src="${escapeMyTeam(hero.portraitFallbackUrl || MY_TEAM_PORTRAIT_PLACEHOLDER)}" data-placeholder-src="${MY_TEAM_PORTRAIT_PLACEHOLDER}">`;
}

function myTeamPortraitSrc(hero) {
  return hero.portraitUrl || hero.portraitFallbackUrl || MY_TEAM_PORTRAIT_PLACEHOLDER;
}

function escapeMyTeam(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
