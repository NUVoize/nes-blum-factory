-- M6-T8 (Mesen tier): the BLUM cheat build reaches the ending. Start presses replayed by probe frame
-- (CFG.inputs, as m4-replay); the cheat byte $7F40 (invincible + skip stage) is written on every play or
-- boss frame whose probe frame counter is a multiple of 30, the rule of the jsnes run.
local function rd(o) return emu.read(0x7F00 + o, emu.memType.nesMemory) end
local function booted() return R.frame > 2 and rd(0) == 0x42 and rd(1) == 0x4C and rd(2) == 0x55 and rd(3) == 0x4D end
local maxLag = 0

emu.addEventCallback(function()
  if not booted() then return end
  local f = rd(0x08) + 256 * rd(0x09)
  local m = CFG.inputs[f] or 0
  emu.setInput({ start = (m & 8) ~= 0 }, 0)
end, emu.eventType.inputPolled)

emu.addEventCallback(function()
  R.frame = R.frame + 1
  if not booted() then return end
  local f = rd(0x08) + 256 * rd(0x09)
  local st = rd(0x05)
  if (st == 3 or st == 6) and f % 30 == 0 then emu.write(0x7F40, 3, emu.memType.nesMemory) end
  if st == 7 or R.frame >= CFG.maxFrames then
    R.emit("end", { frame = f, state = st, textScreen = rd(0x1D), lives = rd(0x0E), lag = rd(0x14) })
    if CFG.shot ~= "" then R.screenshot(CFG.shot) end
    R.finish(0)
  end
end, emu.eventType.endFrame)
