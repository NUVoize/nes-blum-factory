-- M2-T16 (Mesen tier): per play frame, the scanlines of the $2005 split writes, the line/dot of the BG
-- bank switch (R0), the APU write count and a screen checksum. Run on the normal ROM and on the
-- bank-stress ROM; scripts/test-mesen.mjs compares the two.
local cur = { s2005 = {}, chr = {}, apu = 0 }
emu.addMemoryCallback(function(addr, value)
  local s = emu.getState()
  local line = s["ppu.scanline"]
  if line >= 0 and line < 240 then cur.s2005[#cur.s2005 + 1] = line end
end, emu.callbackType.write, 0x2005, 0x2005)

local sel = 0
emu.addMemoryCallback(function(addr, value)
  if (addr & 0xE001) == 0x8000 then
    sel = value
  elseif (addr & 0xE001) == 0x8001 and (sel & 7) == 0 then
    local s = emu.getState()
    local line = s["ppu.scanline"]
    if line >= 0 and line < 240 then cur.chr[#cur.chr + 1] = line * 1000 + s["ppu.cycle"] end
  end
end, emu.callbackType.write, 0x8000, 0x9FFF)

emu.addMemoryCallback(function() cur.apu = cur.apu + 1 end, emu.callbackType.write, 0x4000, 0x4013)

local playAt, recorded = -1, 0
emu.addEventCallback(function()
  R.frame = R.frame + 1
  local p = R.probe()
  if playAt < 0 and p.state == 3 then playAt = R.frame end
  if playAt > 0 and R.frame > playAt + 10 and recorded < CFG.frames then
    recorded = recorded + 1
    R.emit("f", { s = cur.s2005, c = cur.chr, a = cur.apu, h = R.screenHash(), st = p.state, err = p.stress, lag = p.lag })
  end
  cur = { s2005 = {}, chr = {}, apu = 0 }
  if recorded >= CFG.frames or R.frame >= CFG.maxFrames then
    R.emit("summary", { playAt = playAt, recorded = recorded, stress = p.stress })
    R.finish(0)
  end
end, emu.eventType.endFrame)
