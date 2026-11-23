-- M2-T10 (Mesen tier): boot to title then play, probe frame counter advances, no PPU write while rendering
-- ($2003/$2004/$2006/$2007/$4014 on the pre-render or a visible line with rendering on).
local violations, checked = 0, 0
local function ppuWrite(addr, value)
  local s = emu.getState()
  local line = s["ppu.scanline"]
  local rendering = s["ppu.mask.backgroundEnabled"] or s["ppu.mask.spritesEnabled"]
  checked = checked + 1
  if rendering and line >= -1 and line < 240 then
    violations = violations + 1
    if violations <= 5 then R.emit("violation", { addr = addr, line = line, cycle = s["ppu.cycle"] }) end
  end
end
emu.addMemoryCallback(ppuWrite, emu.callbackType.write, 0x2003, 0x2004)
emu.addMemoryCallback(ppuWrite, emu.callbackType.write, 0x2006, 0x2007)
emu.addMemoryCallback(ppuWrite, emu.callbackType.write, 0x4014, 0x4014)

local titleProbe, playAt, frameAt200, frameAt300 = nil, -1, -1, -1
emu.addEventCallback(function()
  R.frame = R.frame + 1
  local p = R.probe()
  if R.frame == 55 then
    titleProbe = p
    R.screenshot(CFG.shots .. "/mesen-title.png")
  end
  if playAt < 0 and p.state == 3 then playAt = R.frame end
  if playAt > 0 and R.frame == playAt + 200 then frameAt200 = p.frame end
  if playAt > 0 and R.frame == playAt + 300 then
    frameAt300 = p.frame
    R.screenshot(CFG.shots .. "/mesen-play.png")
  end
  if p.state == 5 or p.state == 4 or R.frame >= CFG.maxFrames then
    R.emit("summary", {
      titleMagic = titleProbe and titleProbe.magic or "", titleState = titleProbe and titleProbe.state or -1,
      playAt = playAt, frameAt200 = frameAt200, frameAt300 = frameAt300,
      violations = violations, checked = checked,
      endState = p.state, endEvent = p.event, endX = p.px, lag = p.lag,
    })
    R.finish(0)
  end
end, emu.eventType.endFrame)
