-- NES BLUM FACTORY Mesen tier: shared helpers. scripts/test-mesen.mjs prepends `local CFG = {...}`.
-- Results go to CFG.out as JSON lines; the exit code is 0 when the script finished its run.

local R = { frame = 0, lines = {} }

local function probe(o) return emu.read(0x7F00 + o, emu.memType.nesMemory) end
local function probe16(o) return probe(o) + 256 * probe(o + 1) end

function R.probe()
  return {
    magic = string.char(probe(0), probe(1), probe(2), probe(3)),
    state = probe(0x05), frame = probe16(0x08), px = probe16(0x0A), py = probe(0x0C),
    hp = probe(0x0D), lives = probe(0x0E), flags = probe(0x0F), event = probe(0x10),
    lag = probe(0x14), stress = probe(0x18),
  }
end

local function json(v)
  local t = type(v)
  if t == "table" then
    if #v > 0 or next(v) == nil then
      local parts = {}
      for i = 1, #v do parts[#parts + 1] = json(v[i]) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    local parts = {}
    for k, x in pairs(v) do parts[#parts + 1] = string.format("%q:%s", tostring(k), json(x)) end
    return "{" .. table.concat(parts, ",") .. "}"
  elseif t == "string" then return string.format("%q", v)
  elseif t == "boolean" then return v and "true" or "false"
  else return tostring(v) end
end

function R.emit(kind, data)
  data.kind = kind
  data.f = R.frame
  R.lines[#R.lines + 1] = json(data)
end

function R.finish(code)
  if R.done then return end
  R.done = true
  local f = io.open(CFG.out, "w")
  f:write(table.concat(R.lines, "\n"))
  f:close()
  emu.stop(code)
end

function R.screenshot(path)
  local png = emu.takeScreenshot()
  local f = io.open(path, "wb")
  f:write(png)
  f:close()
end

-- Rolling checksum of the screen (framebuffer glitch comparison between two ROMs).
function R.screenHash()
  local buf = emu.getScreenBuffer()
  local h = 0
  for i = 1, #buf do h = (h * 31 + buf[i]) & 0x7FFFFFFF end
  return h
end

-- Input policy shared with tests/engine/rom.ts runRight(): Start at frames 61-63, then hold Right and
-- hold A for CFG.jumpFrames frames each time the player passes the next x in CFG.jumps while grounded.
local jumpQueue = {}
for i, x in ipairs(CFG.jumps or {}) do jumpQueue[i] = x end
local jumping = 0
local function policy()
  local i = {}
  if R.frame >= 61 and R.frame <= 63 then i.start = true end
  local p = R.probe()
  if p.state == 3 and R.frame > CFG.playFrom then
    i.right = true
    if jumping == 0 and #jumpQueue > 0 and p.px >= jumpQueue[1] and (p.flags & 1) == 1 then
      table.remove(jumpQueue, 1)
      jumping = CFG.jumpFrames or 22
    end
    if jumping > 0 then
      i.a = true
      jumping = jumping - 1
    end
  end
  emu.setInput(i, 0)
end
-- replay scripts (m4-replay.lua) drive the pad themselves
if not CFG.replay then emu.addEventCallback(policy, emu.eventType.inputPolled) end

return R
