-- @description Remember peak display per project
-- @version 1.0
-- @author SGM
-- @about
--   Remembers each project's peak display mode locally while this script runs.
--   Run once per REAPER session, or add it to your startup actions.
--   Previously visited projects restore their remembered mode; unvisited projects
--   use normal peaks. On startup, the current project keeps its existing mode.
--   Saved projects are identified by file path. Preferences are stored locally,
--   not in the project file, and do not transfer to another computer.
-- @changelog
--   Initial release.

-- Store each project's chosen peak display locally, without changing project audio.
local section = "CodexProjectPeakDisplay"
local modes = {43209,42295,42294,43207,43208,43146,43148,43145,43147,42073,42301}
local valid = {}
for _,id in ipairs(modes) do valid[id]=true end
local function current()
  for _,id in ipairs(modes) do
    if reaper.GetToggleCommandState(id)==1 then return id end
  end
end
local previous, previous_path, previous_key
local function remember(key, mode, persist)
  if mode then reaper.SetExtState(section,key,tostring(mode),persist) end
end
local function tick()
  local project,path = reaper.EnumProjects(-1, "")
  local key = path ~= "" and path or tostring(project)
  if project ~= previous or path ~= previous_path then
    if previous_key then remember(previous_key,current(),previous_path ~= "") end
    local mode = tonumber(reaper.GetExtState(section,key))
    if not previous then mode = mode or current() end
    if not valid[mode] then mode=42301 end
    if current() ~= mode then
      reaper.Main_OnCommand(42301,0)
      if mode ~= 42301 then reaper.Main_OnCommand(mode,0) end
    end
    previous,previous_path,previous_key=project,path,key
  end
  remember(key,current(),path ~= "")
  reaper.defer(tick)
end
tick()
