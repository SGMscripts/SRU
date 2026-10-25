-- @description Remember peak display per project
-- @version 1.1
-- @author SGM
-- @about
--   Run once per REAPER session, or from a startup action.
--   Remembers peak display choices locally by saved project path.
--   Unvisited projects use normal peaks. The initial project keeps its current mode.
--   Unsaved projects are remembered only while open. No project audio is changed.
-- @changelog
--   Guard empty/closing projects and duplicate instances; throttle polling.
--   Write preferences only when changed, instead of every defer cycle.

local section = "CodexProjectPeakDisplay"
local owner_key = "running_v11"
local owner = reaper.genGuid()
-- A newly launched copy replaces an older v1.1 loop without a dialog.
reaper.SetExtState(section, owner_key, owner, false)
local modes = {43209,42295,42294,43207,43208,43146,43148,43145,43147,42073,42301}
local valid = {}
for _,id in ipairs(modes) do valid[id] = true end
local memory, previous, previous_path, previous_mode = {}, nil, nil, nil
local initialized, next_poll = false, 0
local function current()
  for _,id in ipairs(modes) do
    if reaper.GetToggleCommandState(id) == 1 then return id end
  end
end
local function remember(project, path, mode)
  if not project or not mode then return end
  memory[project] = mode
  if path and path ~= "" then
    local value = tostring(mode)
    if reaper.GetExtState(section, path) ~= value then
      reaper.SetExtState(section, path, value, true)
    end
  end
end
local function poll()
  local project, path = reaper.EnumProjects(-1, "")
  -- During project closure/shutdown there may be no valid active project.
  if not project or not reaper.ValidatePtr(project, "ReaProject*") then return end
  path = path or ""
  local mode = current()
  if not initialized then
    initialized = true
    -- Never force a different display on the project already open at launch.
    remember(project, path, mode)
  elseif project ~= previous then
    -- Use the last mode observed BEFORE switching; global state may already differ.
    remember(previous, previous_path, previous_mode)
    local saved = path ~= "" and tonumber(reaper.GetExtState(section, path)) or memory[project]
    if not valid[saved] then saved = 42301 end
    if mode ~= saved then
      reaper.Main_OnCommand(42301, 0)
      if saved ~= 42301 then reaper.Main_OnCommand(saved, 0) end
      mode = current()
    end
    remember(project, path, mode)
  elseif mode ~= previous_mode or path ~= previous_path then
    remember(project, path, mode)
  end
  previous, previous_path, previous_mode = project, path, mode
  -- Discard closed unsaved projects so recycled handles cannot inherit their mode.
  for ptr in pairs(memory) do
    if not reaper.ValidatePtr(ptr, "ReaProject*") then memory[ptr] = nil end
  end
end
local function tick()
  if reaper.GetExtState(section, owner_key) ~= owner then return end
  local now = reaper.time_precise()
  if now >= next_poll then
    next_poll = now + 0.25
    local ok, err = pcall(poll)
    if not ok then
      reaper.ShowConsoleMsg("Remember peak display stopped safely: " .. tostring(err) .. "\n")
      return
    end
  end
  reaper.defer(tick)
end
reaper.atexit(function()
  if reaper.GetExtState(section, owner_key) == owner then
    reaper.DeleteExtState(section, owner_key, false)
  end
end)
tick()
