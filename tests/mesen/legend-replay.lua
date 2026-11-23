-- BLUMZ-M1 (Mesen tier): THE LEGEND OF BLUM slice. scripts/legend-mesen.mjs prepends CFG and lib.lua
-- (CFG.replay = true: this file drives the pad). Replays the jsnes bot's input trace frame for frame, keyed
-- by the probe frame counter ($7F08, read when the game polls the pad, like m4-replay.lua), and emits the
-- same state-change trace as src/core/rpg/legend/run.ts playSlice (traceKey), the idle loops, the shots
-- (at the emulator frames the jsnes run took them) and the end probe.
-- CFG.inputs[probeFrame] = button mask (A 1, B 2, SELECT 4, START 8, UP 16, DOWN 32, LEFT 64, RIGHT 128).
local function rd(o) return emu.read(0x7F00 + o, emu.memType.nesMemory) end
local function mask(m)
  return {
    a = (m & 1) ~= 0, b = (m & 2) ~= 0, select = (m & 4) ~= 0, start = (m & 8) ~= 0,
    up = (m & 16) ~= 0, down = (m & 32) ~= 0, left = (m & 64) ~= 0, right = (m & 128) ~= 0,
  }
end
-- WRAM holds power-on garbage (or the last battery save) until the reset code writes the probe magic
local function booted() return rd(0) == 0x42 and rd(1) == 0x4C and rd(2) == 0x4D and rd(3) == 0x5A and rd(4) == 2 end
local function probe()
  local flags = {}
  for i = 0, 31 do flags[#flags + 1] = rd(0x30 + i) end
  return {
    state = rd(5), screen = rd(6), px = rd(7), frame = rd(8) + 256 * rd(9), py = rd(0x0A),
    dSub = rd(0x1C), bSub = rd(0x10), mSub = rd(0x55), turn = rd(0x1B), cursor = rd(0x13),
    lag = rd(0x14), idle = rd(0x16) + 256 * rd(0x17), idleMin = rd(0x18) + 256 * rd(0x19),
    hp = rd(0x12), ehp = rd(0x11), xp = rd(0x1A), level = rd(0x27), cls = rd(0x26), vpeak = rd(0x1D),
    items = rd(0x50), saves = rd(0x5A), flags = flags,
  }
end

emu.addEventCallback(function()
  if not booted() then return end
  local f = rd(8) + 256 * rd(9)
  emu.setInput(mask(CFG.inputs[f] or 0), 0)
end, emu.eventType.inputPolled)

local lastKey = ""
local shotAt = {}
for _, s in ipairs(CFG.shotList) do shotAt[s.frame] = s.name end
local endAt = nil
emu.addEventCallback(function()
  R.frame = R.frame + 1
  if booted() then
    local p = probe()
    local key = p.state .. "/" .. p.screen .. "/" .. p.dSub .. "/" .. p.bSub .. "/" .. p.mSub .. "/" .. p.turn .. "/" .. p.cursor
    if key ~= lastKey then
      R.emit("p", { k = key })
      lastKey = key
    end
    if R.frame > 10 then R.emit("i", { v = p.idle }) end
    if shotAt[R.frame] then
      R.screenshot(CFG.shots .. "/" .. shotAt[R.frame] .. ".png")
      R.emit("shot", { name = shotAt[R.frame] })
    end
    if R.frame >= CFG.endFrame then
      R.emit("end", p)
      R.finish(0)
    end
  end
  if R.frame >= CFG.maxFrames then
    R.emit("end", { state = -1 })
    R.finish(0)
  end
end, emu.eventType.endFrame)
