-- LEGEND OF BLUM engine spike (BLUMZ-PLAN), Mesen tier. scripts/rpg-mesen.mjs prepends CFG and lib.lua
-- (CFG.replay = true: this file drives the pad). Same bot as the jsnes run (src/core/rpg/spike-run.ts
-- rpgBot): talk to Madame Bélanger, walk to the exit, scroll, walk into the enemy, Pouvoir then Attaque.
-- Emits the probe every frame where it changes state, shots SHOT_DELAY frames after each shot condition.
local function rd(o) return emu.read(0x7F00 + o, emu.memType.nesMemory) end
local function magic()
  local m = string.char(rd(0), rd(1), rd(2), rd(3))
  if m:match("^%u%u%u%u$") then return m end
  return "----" -- before boot: keep the JSON line printable
end
local function probe()
  return {
    magic = magic(), state = rd(5), room = rd(6), px = rd(7),
    frame = rd(8) + 256 * rd(9), py = rd(10), facing = rd(11), curNt = rd(12), tOff = rd(13),
    dPage = rd(14), dI = rd(15), bSub = rd(16), ehp = rd(17), php = rd(18), cursor = rd(19),
    lag = rd(0x14), flags = rd(0x15), idle = rd(0x16) + 256 * rd(0x17), idleMin = rd(0x18) + 256 * rd(0x19),
    xp = rd(0x1A), turn = rd(0x1B), dSub = rd(0x1C), vpeak = rd(0x1D), items = rd(0x1E), talked = rd(0x1F),
    scrollX = rd(0x20), scrollNt = rd(0x21), dRow = rd(0x22), tStep = rd(0x23),
  }
end

local function bot(p)
  local i = {}
  if p.magic ~= "BLMZ" then return i end
  local pulse = (p.frame & 3) < 2
  if p.state == 1 then
    if p.room == 0 then
      if (p.flags & 1) == 0 then
        if p.py > 88 then i.up = true elseif pulse then i.a = true end
      else
        if p.py < 112 then i.down = true else i.right = true end
      end
    elseif p.px < CFG.endX then
      i.right = true
    end
  elseif p.state == 3 then
    if p.dSub == 2 and pulse then i.a = true end
  elseif p.state == 4 then
    if p.bSub == 2 then
      if pulse then i.a = true end
    elseif p.bSub == 3 then
      local target = 0
      if p.turn == 0 then target = 1 end
      if p.cursor < target then
        if pulse then i.down = true end
      elseif p.cursor > target then
        if pulse then i.up = true end
      elseif pulse then
        i.a = true
      end
    end
  end
  return i
end

emu.addEventCallback(function()
  emu.setInput(bot(probe()), 0)
end, emu.eventType.inputPolled)

local first = {}
local taken = {}
local lastKey = ""
emu.addEventCallback(function()
  R.frame = R.frame + 1
  local p = probe()
  local key = p.state .. "/" .. p.room .. "/" .. p.dSub .. "/" .. p.dPage .. "/" .. p.bSub .. "/" .. p.turn .. "/" .. p.cursor
  if key ~= lastKey then
    R.emit("p", p)
    lastKey = key
  end
  if R.frame > 10 then R.emit("idle", { idle = p.idle }) end
  for _, s in ipairs(CFG.shotList) do
    if not first[s.name] and s.hit(p) then first[s.name] = R.frame end
    if first[s.name] and not taken[s.name] and R.frame == first[s.name] + CFG.shotDelay then
      taken[s.name] = true
      R.screenshot(CFG.shots .. "/" .. s.name .. ".png")
      R.emit("shot", { name = s.name, probe = p })
    end
  end
  if R.frame >= CFG.maxFrames then
    R.emit("end", p)
    R.finish(0)
  end
end, emu.eventType.endFrame)
