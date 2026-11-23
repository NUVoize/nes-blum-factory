-- SEBRING racer (BLUMR-M1), Mesen tier. scripts/racer-mesen.mjs prepends CFG and lib.lua (CFG.replay:
-- this file drives the pad). Same race bot as the jsnes tier (src/core/racer/racer-run.ts racerBot), line
-- for line, integers only. CFG.logFrames / CFG.shotFrames are game frames (the probe's counter): 2
-- emulator frames after seeing one, it logs every write to $2005/$2006/$8001 (scanline, dot) or takes the
-- shot. One line per finished stage; the probe at the end. BLUMR-FIX: CFG.kind = "crash" plays the crash bot
-- (steer into the nearest object) and stops back on the road after CFG.crashStop crashes, one line per crash.
local function rd(o) return emu.read(0x7F00 + o, emu.memType.nesMemory) end
local function sgn(v) if v >= 128 then return v - 256 end return v end
local function probe()
  local p = {
    magic = string.char(rd(0), rd(1), rd(2), rd(3)), state = rd(5), seg = rd(6), curve = sgn(rd(7)),
    frame = rd(8) + 256 * rd(9), speed = rd(10), carX = rd(11), hill = sgn(rd(12)), hy = rd(13),
    dist = rd(0x10) + 256 * rd(0x11), lag = rd(0x14), idle = rd(0x16) + 256 * rd(0x17),
    idleMin = rd(0x18) + 256 * rd(0x19), time = rd(0x1A), continues = rd(0x1B), crashes = rd(0x1C),
    crashKind = rd(0x34), stage = rd(0x1D), checkpoint = rd(0x1E), centre = rd(0x30), paused = rd(0x31), clears = rd(0x36),
    nmiMode = rd(0x43), titles = rd(0x44), traffic = {},
  }
  for i = 0, 7 do
    local k = rd(0x38 + i)
    if k ~= 0 then p.traffic[#p.traffic + 1] = { lane = sgn(rd(0x20 + i)), depth = rd(0x28 + i), kind = k } end
  end
  return p
end

local LANE = 51
local KIND = CFG.kind or "race"
local function bot(p)
  local i = {}
  if p.magic ~= "SBRG" then return i end
  if p.state ~= 3 and p.state ~= 5 then
    if p.state ~= 4 and (p.frame & 15) < 4 then i.start = true end
    return i
  end
  if p.paused ~= 0 then
    if (p.frame & 15) < 4 then i.start = true end
    return i
  end
  local clear = { 255, 255, 255 }
  for _, t in ipairs(p.traffic) do
    if t.depth >= 6 and t.lane >= -1 and t.lane <= 1 and t.depth < clear[t.lane + 2] then clear[t.lane + 2] = t.depth end
  end
  local cur, bestD = 0, 9999
  for l = -1, 1 do
    local d = math.abs(p.centre + l * LANE - p.carX)
    if d < bestD then bestD = d; cur = l end
  end
  local target = cur
  if KIND == "crash" then
    local near = 255
    for _, t in ipairs(p.traffic) do
      if t.depth >= 6 and t.depth < near and t.lane >= -1 and t.lane <= 1 then near = t.depth; target = t.lane end
    end
  elseif clear[cur + 2] < 70 then
    local best = clear[cur + 2]
    for _, l in ipairs({ cur - 1, cur + 1, cur - 2, cur + 2 }) do
      if l >= -1 and l <= 1 then
        local path = 255
        for k = math.min(l, cur), math.max(l, cur) do
          if k ~= cur then path = math.min(path, clear[k + 2]) end
        end
        if path > 25 and clear[l + 2] > best then best = clear[l + 2]; target = l end
      end
    end
  end
  if KIND == "race" and clear[cur + 2] < 40 and clear[target + 2] < 40 then i.b = true else i.a = true end
  local tx = p.centre + target * LANE
  if p.carX < tx - 4 then i.right = true elseif p.carX > tx + 4 then i.left = true end
  return i
end

local logGame, shotGame = {}, {}
for _, f in ipairs(CFG.logFrames or {}) do logGame[f] = true end
for _, s in ipairs(CFG.shotFrames or {}) do shotGame[s.frame] = s.name end
local logSet, shotSet = {}, {}
local writes = {}
local function onWrite(addr, value)
  if not logSet[R.frame] then return end
  local s = emu.getState()
  writes[#writes + 1] = { a = addr, v = value, l = s["ppu.scanline"], d = s["ppu.cycle"] }
end
emu.addMemoryCallback(onWrite, emu.callbackType.write, 0x2005, 0x2006)
emu.addMemoryCallback(function(addr, value) if (addr & 0xE001) == 0x8001 then onWrite(addr, value) end end, emu.callbackType.write, 0x8000, 0x9FFF)

emu.addEventCallback(function() emu.setInput(bot(probe()), 0) end, emu.eventType.inputPolled)

local clears = 0
local crashes = 0
local minFree = 999999
emu.addEventCallback(function()
  R.frame = R.frame + 1
  local p = probe()
  if #writes > 0 then
    R.emit("writes", { frame = R.frame, w = writes, stage = p.stage, hill = p.hill, curve = p.curve })
    writes = {}
  end
  if p.nmiMode == 2 and p.state >= 3 and p.state <= 6 and p.idle * 14 < minFree then minFree = p.idle * 14 end
  if logGame[p.frame] then logGame[p.frame] = nil; logSet[R.frame + 2] = true end
  if shotGame[p.frame] then shotSet[R.frame + 2] = shotGame[p.frame]; shotGame[p.frame] = nil end
  if shotSet[R.frame] then
    R.screenshot(CFG.shots .. "/" .. shotSet[R.frame] .. ".png")
    R.emit("shot", { name = shotSet[R.frame], stage = p.stage, state = p.state })
  end
  if p.clears ~= clears then
    clears = p.clears
    R.emit("clear", { stage = p.stage, time = p.time, crashes = p.crashes, game = p.frame, frame = R.frame, lag = p.lag })
  end
  if p.crashes ~= crashes then
    crashes = p.crashes
    R.emit("crash", { crashes = p.crashes, crashKind = p.crashKind, time = p.time, game = p.frame, lag = p.lag })
  end
  local crashDone = CFG.crashStop and p.crashes >= CFG.crashStop and p.state == 3
  if (p.titles >= 2) or crashDone or R.frame >= CFG.maxFrames then
    p.traffic = nil
    p.minFree = minFree
    R.emit("end", p)
    R.finish(0)
  end
end, emu.eventType.endFrame)
