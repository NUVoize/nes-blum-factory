-- SEBRING engine spike (BLUMR-PLAN), Mesen tier. scripts/racer-spike.mjs prepends CFG and lib.lua
-- (CFG.replay = true: this file drives the pad). Same bot as the jsnes run (src/core/racer/spike-bot.ts):
-- hold A, steer back toward x 128. Logs, per frame: probe values; on CFG.logFrames: every write to
-- $2005/$2006/$8001 with its scanline and dot; screenshots when the spike reaches each shot condition.
local function rd(o) return emu.read(0x7F00 + o, emu.memType.nesMemory) end
local function sgn(v) if v >= 128 then return v - 256 end return v end
local function probe()
  return {
    magic = string.char(rd(0), rd(1), rd(2), rd(3)), state = rd(5), seg = rd(6), curve = sgn(rd(7)),
    frame = rd(8) + 256 * rd(9), speed = rd(10), carX = rd(11), hill = sgn(rd(12)), hy = rd(13),
    phase = rd(14), offroad = rd(15), dist = rd(16) + 256 * rd(17), bdX = rd(18) + 256 * rd(19),
    lag = rd(0x14), idle = rd(0x16) + 256 * rd(0x17), idleMin = rd(0x18) + 256 * rd(0x19),
  }
end

local logSet = {}
for _, f in ipairs(CFG.logFrames or {}) do logSet[f] = true end
local writes = {}
local function onWrite(addr, value)
  if not logSet[R.frame] then return end
  local s = emu.getState()
  writes[#writes + 1] = { a = addr, v = value, l = s["ppu.scanline"], d = s["ppu.cycle"] }
end
emu.addMemoryCallback(onWrite, emu.callbackType.write, 0x2005, 0x2006)
emu.addMemoryCallback(function(addr, value) if (addr & 0xE001) == 0x8001 then onWrite(addr, value) end end, emu.callbackType.write, 0x8000, 0x9FFF)

emu.addEventCallback(function()
  local p = probe()
  local i = {}
  if p.magic == "SBRG" then
    i.a = true
    if p.carX < 120 then i.right = true elseif p.carX > 136 then i.left = true end
  end
  emu.setInput(i, 0)
end, emu.eventType.inputPolled)

local shotsDone = {}
emu.addEventCallback(function()
  R.frame = R.frame + 1
  local p = probe()
  if #writes > 0 then
    R.emit("writes", { frame = R.frame, w = writes })
    writes = {}
  end
  if R.frame % 60 == 0 then R.emit("p", p) end
  for _, s in ipairs(CFG.shotList or {}) do
    if not shotsDone[s.name] then
      local hit = false
      if s.frame then hit = R.frame == s.frame
      else hit = p.seg == s.seg and p.curve == s.curve and p.hill == s.hill end
      if hit then
        shotsDone[s.name] = true
        R.screenshot(CFG.shots .. "/" .. s.name .. ".png")
        R.emit("shot", { name = s.name, probe = p })
      end
    end
  end
  if R.frame >= CFG.maxFrames then
    R.emit("end", p)
    R.finish(0)
  end
end, emu.eventType.endFrame)
