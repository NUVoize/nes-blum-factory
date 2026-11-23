-- BLUMEV-M (EverDrive): real-hardware audit of one ROM in Mesen 2 (scripts/everdrive-audit.mjs prepends CFG).
-- Monkey input from a seeded LCG for CFG.frames frames (one soft reset at 2/3), WRAM filled with random bytes
-- at power-on when CFG.randomWram (Mesen randomises internal RAM itself through settings.json). Records:
--   uninit   reads of RAM / WRAM never written since power-on (PC, address, opcode; stores = dummy reads)
--   mapper   every MMC3 register write: latch 0 count, $A001 values, $8000 mode bits, bank numbers out of range
--   bus      reads of write-only PPU/APU registers, reads/writes of $4018-$5FFF (open bus on MMC3),
--            WRAM access while $A001 bit 7 is off
--   irq/nmi  entries per frame, longest run of frames without NMI, code executed below $8000
--   probe    lag counter ($7F14) and a screen hash every 30 frames (det vs det-reva comparison)
local out = { uninit = {}, uninitCount = 0, latch0 = 0, latches = {}, a001 = {}, mode8000 = {}, badBank = {},
  bus = {}, busCount = 0, ramExec = 0, irqHist = {}, nmiGapMax = 0, hashes = {}, frames = 0, resets = 0 }
local seed = CFG.seed
local function rnd() seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF return seed end

local wRam, wWram = {}, {}
local booted = false
local a001 = 0
local reg = 0
local irqThis, nmiThis, nmiGap = 0, 0, 0

local function pc() return emu.getState()["cpu.pc"] end
-- Mesen's cpu.pc is past the operand while the instruction runs: a store (dummy read of abs,X / abs,Y /
-- (zp),Y) is recognised by its opcode 3 bytes back (absolute, operand base within 255 of the address) or
-- 2 bytes back (zero page / indirect). Both count as dummy reads ("store" in the result).
local ABS = { [0x8D]=1,[0x9D]=1,[0x99]=1,[0x8C]=1,[0x8E]=1 }
local ZP = { [0x81]=1,[0x85]=1,[0x91]=1,[0x95]=1,[0x84]=1,[0x94]=1,[0x86]=1,[0x96]=1 }
local function rd(a) return emu.read(a & 0xFFFF, emu.memType.nesMemory) end
local function isStore(p, addr)
  if ABS[rd(p - 3)] then
    local base = rd(p - 2) + 256 * rd(p - 1)
    local d = (addr - base) & 0xFFFF
    if d <= 255 or ((base - addr) & 0xFFFF) <= 0x100 then return true end
  end
  if ZP[rd(p - 2)] then return true end
  -- 6502 dummy stack reads: JSR (cycle 3), PLA / PLP (cycle 3), RTS / RTI (cycle 3) read $0100+S, the byte
  -- below the stack top, before using it; the real pulls are checked like any read
  if addr >= 0x100 and addr <= 0x1FF then
    if rd(p - 3) == 0x20 then return true end
    local o = rd(p - 1)
    if o == 0x68 or o == 0x28 or o == 0x60 or o == 0x40 then return true end
  end
  return false
end
local function noteUninit(kind, addr)
  local p = pc()
  local store = isStore(p, kind == "wram" and addr or addr)
  local key = string.format("%s:%04X:%04X", kind, p, addr)
  out.uninitCount = out.uninitCount + 1
  if not out.uninit[key] then out.uninit[key] = { n = 0, op = rd(p - 3) * 65536 + rd(p - 2) * 256 + rd(p - 1), store = store, f = out.frames } end
  out.uninit[key].n = out.uninit[key].n + 1
end
local function noteBus(what, addr)
  out.busCount = out.busCount + 1
  local key = string.format("%s:%04X:%04X", what, pc(), addr)
  out.bus[key] = (out.bus[key] or 0) + 1
end

local function powerOn()
  if booted then return end
  booted = true
  if CFG.randomWram then
    for a = 0, 0x1FFF do emu.write(a, rnd() & 0xFF, emu.memType.nesWorkRam) end
  end
end
emu.addMemoryCallback(function() powerOn() end, emu.callbackType.exec, 0xE000, 0xFFFF)

emu.addMemoryCallback(function(addr) wRam[addr & 0x7FF] = true end, emu.callbackType.write, 0x0000, 0x1FFF)
emu.addMemoryCallback(function(addr)
  if not wRam[addr & 0x7FF] then noteUninit("ram", addr) end
end, emu.callbackType.read, 0x0000, 0x1FFF)
emu.addMemoryCallback(function(addr)
  if (a001 & 0x80) == 0 then noteBus("wram-off-write", addr) end
  wWram[addr] = true
end, emu.callbackType.write, 0x6000, 0x7FFF)
emu.addMemoryCallback(function(addr)
  if (a001 & 0x80) == 0 then noteBus("wram-off-read", addr) end
  if not wWram[addr] then noteUninit("wram", addr) end
end, emu.callbackType.read, 0x6000, 0x7FFF)

-- PPU: only $2002, $2004, $2007 are readable
emu.addMemoryCallback(function(addr)
  local r = addr & 7
  if r ~= 2 and r ~= 4 and r ~= 7 then noteBus("ppu-wo-read", addr) end
end, emu.callbackType.read, 0x2000, 0x3FFF)
emu.addMemoryCallback(function(addr) noteBus("apu-wo-read", addr) end, emu.callbackType.read, 0x4000, 0x4014)
emu.addMemoryCallback(function(addr) if addr >= 0x4018 then noteBus("openbus-read", addr) end end, emu.callbackType.read, 0x4018, 0x5FFF)
emu.addMemoryCallback(function(addr) noteBus("openbus-write", addr) end, emu.callbackType.write, 0x4018, 0x5FFF)

emu.addMemoryCallback(function(addr, value)
  local r = addr & 0xE001
  if r == 0x8000 then
    reg = value & 7
    out.mode8000[string.format("%02X", value & 0xC0)] = true
  elseif r == 0x8001 then
    if reg >= 6 then
      if value >= CFG.prgBanks then out.badBank[string.format("R%d=%d", reg, value)] = true end
    elseif value >= CFG.chrBanks then out.badBank[string.format("R%d=%d", reg, value)] = true end
  elseif r == 0xA001 then
    a001 = value
    out.a001[string.format("%02X", value)] = true
  elseif r == 0xC000 then
    out.latches[value] = (out.latches[value] or 0) + 1
    if value == 0 then out.latch0 = out.latch0 + 1 end
  end
end, emu.callbackType.write, 0x8000, 0xFFFF)

emu.addMemoryCallback(function() out.ramExec = out.ramExec + 1 end, emu.callbackType.exec, 0x0000, 0x7FFF)
local irqAt = emu.read(0xFFFE, emu.memType.nesMemory) + 256 * emu.read(0xFFFF, emu.memType.nesMemory)
local nmiAt = emu.read(0xFFFA, emu.memType.nesMemory) + 256 * emu.read(0xFFFB, emu.memType.nesMemory)
emu.addMemoryCallback(function() irqThis = irqThis + 1 end, emu.callbackType.exec, irqAt, irqAt)
emu.addMemoryCallback(function() nmiThis = nmiThis + 1 end, emu.callbackType.exec, nmiAt, nmiAt)

-- monkey pad: a new random mask every 6 frames, biased to Right / A (platformer), Start now and then
local pad = {}
emu.addEventCallback(function() emu.setInput(pad, 0) end, emu.eventType.inputPolled)
local function newPad()
  local r = rnd()
  pad = {
    right = (r % 100) < CFG.right, left = ((r >> 7) % 100) < 12, up = ((r >> 9) % 100) < 15,
    down = ((r >> 11) % 100) < 15, a = ((r >> 13) % 100) < 35, b = ((r >> 15) % 100) < 15,
    start = ((r >> 17) % 100) < 4, select = ((r >> 19) % 100) < 2,
  }
end

local resetAt = math.floor(CFG.frames * 2 / 3)
emu.addEventCallback(function()
  out.frames = out.frames + 1
  local k = tostring(irqThis)
  out.irqHist[k] = (out.irqHist[k] or 0) + 1
  irqThis = 0
  if nmiThis == 0 then nmiGap = nmiGap + 1 else nmiGap = 0 end
  if nmiGap > out.nmiGapMax then out.nmiGapMax = nmiGap end
  nmiThis = 0
  if out.frames % 6 == 0 then newPad() end
  if out.frames % 30 == 0 then
    local buf = emu.getScreenBuffer()
    local h = 0
    for i = 1, #buf, 7 do h = (h * 31 + buf[i]) & 0x7FFFFFFF end
    out.hashes[#out.hashes + 1] = h
  end
  for _, s in ipairs(CFG.shots or {}) do
    if s == out.frames then
      local png = emu.takeScreenshot()
      local f = io.open(string.format("%s-%05d.png", CFG.shotPrefix, s), "wb") f:write(png) f:close()
    end
  end
  if out.frames == resetAt and CFG.softReset then out.resets = 1 emu.reset() end
  if out.frames >= CFG.frames then
    out.lag = emu.read(0x7F14, emu.memType.nesMemory)
    out.probeMagic = string.char(emu.read(0x7F00, emu.memType.nesMemory), emu.read(0x7F01, emu.memType.nesMemory),
      emu.read(0x7F02, emu.memType.nesMemory), emu.read(0x7F03, emu.memType.nesMemory))
    local parts = {}
    local function enc(v)
      local t = type(v)
      if t == "table" then
        local p = {}
        local isArr = #v > 0
        if isArr then for i = 1, #v do p[#p + 1] = enc(v[i]) end return "[" .. table.concat(p, ",") .. "]" end
        for kk, x in pairs(v) do p[#p + 1] = string.format("%q:%s", tostring(kk), enc(x)) end
        return "{" .. table.concat(p, ",") .. "}"
      elseif t == "string" then return string.format("%q", v)
      elseif t == "boolean" then return v and "true" or "false" end
      return tostring(v)
    end
    local f = io.open(CFG.out, "w") f:write(enc(out)) f:close()
    emu.stop(0)
  end
end, emu.eventType.endFrame)
