--[[
  ReaScript Name: Enable Story Cue Studio Remote Target
  Author: Story Cue Studio
  Version: 1.0
  Description: Marks the current saved project as a safe target for the Node remote companion.
]]

local function project_filename()
  local _, filename = reaper.EnumProjects(-1, "")
  return filename or ""
end

local function has_master_asset_tracks()
  local protected = {
    ["guide stem"] = true,
    ["sfx master"] = true,
  }
  for index = 0, reaper.CountTracks(0) - 1 do
    local track = reaper.GetTrack(0, index)
    local _, name = reaper.GetSetMediaTrackInfo_String(track, "P_NAME", "", false)
    if protected[(name or ""):lower()] then
      return true, name
    end
  end
  return false, ""
end

local filename = project_filename()
if filename == "" then
  reaper.MB(
    "Save this as a dedicated storyboard project before enabling remote control.",
    "Story Cue Studio Remote Target",
    0
  )
  return
end

local protected, protected_name = has_master_asset_tracks()
if protected then
  reaper.MB(
    "This project contains the protected master track “" .. protected_name ..
      "”. Remote production has not been enabled.\n\nOpen a separate storyboard project or template.",
    "Master Cue Project Protected",
    0
  )
  return
end

local answer = reaper.MB(
  "Enable remote Story Cue Studio jobs for this project?\n\n" ..
    filename ..
    "\n\nOnly enable a dedicated production project. Stop playback before sending a job.",
  "Enable Story Cue Studio Remote Target",
  4
)
if answer ~= 6 then return end

local _, target_id = reaper.GetProjExtState(0, "StoryCueStudio", "RemoteTargetId")
if target_id == "" then target_id = reaper.genGuid() end

reaper.SetProjExtState(0, "StoryCueStudio", "ProjectRole", "story_target")
reaper.SetProjExtState(0, "StoryCueStudio", "RemoteTargetId", target_id)
reaper.SetProjExtState(0, "StoryCueStudio", "RemoteTargetProjectPath", filename)
reaper.MarkProjectDirty(0)

reaper.MB(
  "Remote Story Cue Studio is enabled for this project.\n\n" ..
    "Keep this project active and stop playback before sending a remote job.",
  "Remote Target Enabled",
  0
)
