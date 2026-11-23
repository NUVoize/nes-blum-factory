-- M4-T11 (Mesen tier): replay a jsnes input trace frame for frame, keyed by the probe frame counter
-- ($7F08: the game polls the pad in the main loop that follows it), then report the end probe.
-- CFG.inputs[probeFrame] = button mask (A 1, B 2, SELECT 4, START 8, UP 16, DOWN 32, LEFT 64, RIGHT 128).
local function mask(m)
  return {
    a = (m & 1) ~= 0, b = (m & 2) ~= 0, select = (m & 4) ~= 0, start = (m & 8) ~= 0,
    up = (m & 16) ~= 0, down = (m & 32) ~= 0, left = (m & 64) ~= 0, right = (m & 128) ~= 0,
  }
end

local function rd(o) return emu.read(0x7F00 + o, emu.memType.nesMemory) end
local maxLag = 0
-- WRAM holds power-on garbage until the reset code has written the probe magic "BLUM"
local function booted() return R.frame > 2 and rd(0) == 0x42 and rd(1) == 0x4C and rd(2) == 0x55 and rd(3) == 0x4D end

emu.addEventCallback(function()
  if not booted() then return end
  local f = rd(0x08) + 256 * rd(0x09)
  emu.setInput(mask(CFG.inputs[f] or 0), 0)
end, emu.eventType.inputPolled)

emu.addEventCallback(function()
  R.frame = R.frame + 1
  local f = rd(0x08) + 256 * rd(0x09)
  if not booted() then return end
  if f >= CFG.endFrame or R.frame >= CFG.maxFrames then
    R.emit("end", {
      frame = f, state = rd(0x05), event = rd(0x10), hp = rd(0x0D), lives = rd(0x0E),
      px = rd(0x0A) + 256 * rd(0x0B), py = rd(0x0C), bossHp = rd(0x11), enemies = rd(0x12),
      kills = rd(0x1A), bossPhase = rd(0x1C), lag = rd(0x14), flags = rd(0x0F),
    })
    if CFG.shot ~= "" then R.screenshot(CFG.shot) end
    R.finish(0)
  end
end, emu.eventType.endFrame)
