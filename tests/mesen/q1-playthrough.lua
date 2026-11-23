-- BLUM-Q1 (Mesen tier): a full no-cheat run of a release BLUM ROM, title -> 9 stages -> ending -> credits,
-- played by an input bot, with per-stage measurements. scripts/qa-playthrough.mjs prepends CFG:
--   CFG.suffix[level] = hex string, one byte (button mask) per frame: the frozen stage script from the
--   frame play begins (tests/engine/blum-scripts, measured on a START_LEVEL build in jsnes);
--   CFG.world[level] = world index (a continue goes back to the first stage of the world);
--   CFG.levels = stage count; CFG.shotDir = screenshot folder.
-- Bot (same rules as runs/tmp/blumfix2/chain-continue.mjs, so jsnes and Mesen can be compared):
--   wait: Start for 2 frames every 40 until play (or boss); feed: one script byte per frame until clear (5),
--   ending (7) or game over (8); game over: 45 frames, Start (continue), back to wait.
-- Measured per stage attempt: deaths, end state, frames, lag, sprites per scanline (OAM, 8x8 sprites),
-- palette RAM snapshots, APU writes per second, music and SFX requests (zero-page NBF_MUSIC_REQ /
-- NBF_SFX_REQ written by music_play / sfx_play), hangs (probe frame counter frozen).
local function rd(o) return emu.read(0x7F00 + o, emu.memType.nesMemory) end
local function booted() return R.frame > 2 and rd(0) == 0x42 and rd(1) == 0x4C and rd(2) == 0x55 and rd(3) == 0x4D end

local function bytes(hex)
  local t = {}
  for i = 1, #hex, 2 do t[#t + 1] = tonumber(hex:sub(i, i + 1), 16) end
  return t
end
local SUFFIX = {}
for lvl, hex in pairs(CFG.suffix) do SUFFIX[lvl] = bytes(hex) end

local function mask(m)
  return {
    a = (m & 1) ~= 0, b = (m & 2) ~= 0, select = (m & 4) ~= 0, start = (m & 8) ~= 0,
    up = (m & 16) ~= 0, down = (m & 32) ~= 0, left = (m & 64) ~= 0, right = (m & 128) ~= 0,
  }
end
local START = 8

local mode, waitI, feedI, goI, endK = "boot", 0, 1, 0, 0
local nextMask = 0
local cur = nil          -- current stage attempt record
local attempts = {}
local continues = 0
local sawEnding, sawCredits, creditsAt, endingAt = false, false, -1, -1
local lastProbeFrame, frozen, maxFrozen = -1, 0, 0
local prevState, prevEvent = -1, 0
local apuThisSecond, apuSecondFrames = 0, 0
local requests = {}

emu.addMemoryCallback(function() apuThisSecond = apuThisSecond + 1 end, emu.callbackType.write, 0x4000, 0x4013)
emu.addMemoryCallback(function(addr, value)
  if value == 0xFF then return end
  local key = addr == CFG.musicReq and "music" or "sfx"
  if cur then
    local t = cur[key]
    t["n" .. value] = (t["n" .. value] or 0) + 1
  end
  if #requests < 4000 then requests[#requests + 1] = { k = key, v = value, f = R.frame, s = rd(0x05), l = rd(0x07) } end
end, emu.callbackType.write, CFG.musicReq, CFG.sfxReq)

emu.addEventCallback(function()
  if booted() then emu.setInput(mask(nextMask), 0) end
end, emu.eventType.inputPolled)

local lastPal = ""
local frozenAt = nil
local function newAttempt(level)
  lastPal = ""
  cur = {
    level = level, startFrame = R.frame, startLives = rd(0x0E), startHp = rd(0x0D), deaths = 0, hurts = 0,
    endState = -1, frames = 0, maxLag = 0, maxSpritesLine = 0, overflowFrames = 0, overflowLines = 0,
    palettes = {}, paletteChanges = 0, badColours = 0, silentSeconds = 0, apuWrites = 0, seconds = 0,
    music = {}, sfx = {}, minHp = rd(0x0D), scriptLeft = 0, stuck = false,
  }
  attempts[#attempts + 1] = cur
end

local function measure(state)
  if not cur then return end
  cur.frames = cur.frames + 1
  local lag = rd(0x14)
  if lag > cur.maxLag then cur.maxLag = lag end
  local hp = rd(0x0D)
  if hp < cur.minHp then cur.minHp = hp end
  if state ~= 3 and state ~= 6 then return end
  -- sprites per scanline: 8x8 sprites (PPUCTRL bit 5 is 0 in this engine), y = top line - 1
  local count = {}
  local worst = 0
  for i = 0, 63 do
    local y = emu.read(i * 4, emu.memType.nesSpriteRam)
    if y < 0xEF then
      for l = y + 1, y + 8 do
        local c = (count[l] or 0) + 1
        count[l] = c
        if c > worst then worst = c end
      end
    end
  end
  if worst > cur.maxSpritesLine then cur.maxSpritesLine = worst end
  if worst > 8 then
    cur.overflowFrames = cur.overflowFrames + 1
    local n = 0
    for _, c in pairs(count) do if c > 8 then n = n + 1 end end
    if n > cur.overflowLines then cur.overflowLines = n end
  end
  -- palette RAM: every value a master colour, never $0D; distinct snapshots kept
  local p = {}
  for i = 0, 31 do
    local v = emu.read(i, emu.memType.nesPaletteRam)
    if v == 0x0D or v > 0x3F then cur.badColours = cur.badColours + 1 end
    p[#p + 1] = string.format("%02X", v)
  end
  local key = table.concat(p)
  if key ~= lastPal then
    if lastPal ~= "" then cur.paletteChanges = cur.paletteChanges + 1 end
    lastPal = key
    if not cur.palettes[key] then cur.palettes[key] = R.frame end
  end
  -- music: APU register writes per second of play
  apuSecondFrames = apuSecondFrames + 1
  if apuSecondFrames >= 60 then
    cur.seconds = cur.seconds + 1
    cur.apuWrites = cur.apuWrites + apuThisSecond
    if apuThisSecond == 0 then cur.silentSeconds = cur.silentSeconds + 1 end
    apuThisSecond, apuSecondFrames = 0, 0
  end
end

local function shot(name) R.screenshot(CFG.shotDir .. "/" .. name .. ".png") end

local function closeAttempt(state)
  cur.endState = state
  cur.endFrame = R.frame
  cur.endLives = rd(0x0E)
  cur.endHp = rd(0x0D)
  cur.event = rd(0x10)
  cur.px = rd(0x0A) + 256 * rd(0x0B)
  cur.bossHp = rd(0x11)
  cur.kills = rd(0x1A)
  shot(string.format("L%d-a%d-end-s%d", cur.level, #attempts, state))
  local pals = {}
  for k, _ in pairs(cur.palettes) do pals[#pals + 1] = k end
  cur.palettes = pals
  R.emit("attempt", cur)
  cur = nil
end

emu.addEventCallback(function()
  R.frame = R.frame + 1
  if not booted() then nextMask = 0 return end
  local state = rd(0x05)
  local level = rd(0x07)
  local f = rd(0x08) + 256 * rd(0x09)
  -- hang detector: the main loop writes the probe frame counter every pass
  if f == lastProbeFrame then
    frozen = frozen + 1
    if frozen > maxFrozen then
      maxFrozen = frozen
      frozenAt = { state = state, level = level, mode = mode }
    end
  else
    frozen = 0
  end
  lastProbeFrame = f
  if cur and state == 4 and prevState ~= 4 then cur.deaths = cur.deaths + 1 end
  local ev = rd(0x10)
  if cur and ev == 8 and prevEvent ~= 8 then cur.hurts = cur.hurts + 1 end
  prevEvent = ev
  prevState = state
  measure(state)

  if mode == "boot" then
    nextMask = 0
    if R.frame >= 60 then mode, waitI = "wait", 0 end
  elseif mode == "wait" then
    -- play, or boss when the boss stands in the first screen (4-F, BLUM-FIX3)
    if state == 3 or state == 6 then
      mode, feedI = "feed", 1
      newAttempt(level)
    else
      nextMask = (waitI % 40 < 2 and state ~= 5) and START or 0
      waitI = waitI + 1
    end
  end
  if mode == "feed" then
    if state == 5 or state == 7 or state == 8 then
      local lvl = cur.level
      cur.scriptLeft = #SUFFIX[lvl] - feedI + 1
      closeAttempt(state)
      if state == 8 then
        continues = continues + 1
        if continues > 6 then R.emit("stop", { reason = "too many continues" }) R.finish(0) return end
        mode, goI = "gameover", 0
      elseif lvl + 1 >= CFG.levels then
        mode, endK = "ending", 0
      else
        mode, waitI = "wait", 0
      end
    else
      local s = SUFFIX[cur.level]
      if feedI <= #s then
        nextMask = s[feedI]
        feedI = feedI + 1
        if feedI == 300 then shot(string.format("L%d-a%d-play", cur.level, #attempts)) end
      else
        nextMask = 0
        feedI = feedI + 1
        if feedI > #s + 600 then
          cur.stuck = true
          closeAttempt(state)
          R.emit("stop", { reason = "stage not finished 600 frames after its script" })
          R.finish(0)
          return
        end
      end
    end
  end
  if mode == "gameover" then
    goI = goI + 1
    nextMask = (goI > 45 and goI <= 47) and START or 0
    if goI == 40 then shot(string.format("gameover-%d", continues)) end
    if goI > 47 then mode, waitI = "wait", 0 end
  elseif mode == "ending" then
    if state == 7 and not sawEnding then sawEnding = true endingAt = endK end
    if sawEnding and endK == endingAt + 100 then shot("ending") end
    if rd(0x1D) == 3 and not sawCredits then sawCredits = true creditsAt = endK end
    if sawCredits and endK == creditsAt + 120 then shot("credits") end
    nextMask = (endK % 300 < 2) and START or 0
    endK = endK + 1
    if (sawCredits and endK > creditsAt + 600) or endK > 20000 then
      R.emit("end", { sawEnding = sawEnding, sawCredits = sawCredits, continues = continues, frames = R.frame,
        maxFrozen = maxFrozen, frozenAt = frozenAt, state = state, requests = requests })
      R.finish(0)
    end
  end
  if R.frame >= CFG.maxFrames then
    R.emit("stop", { reason = "maxFrames", state = state, level = level, mode = mode })
    R.finish(0)
  end
end, emu.eventType.endFrame)
