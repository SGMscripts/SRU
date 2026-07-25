--[[
  ReaScript Name: Disable Story Cue Studio Remote Target
  Author: Story Cue Studio
  Version: 1.0
]]

reaper.SetProjExtState(0, "StoryCueStudio", "ProjectRole", "")
reaper.SetProjExtState(0, "StoryCueStudio", "RemoteTargetId", "")
reaper.SetProjExtState(0, "StoryCueStudio", "RemoteTargetProjectPath", "")
reaper.MarkProjectDirty(0)
reaper.MB("Remote Story Cue Studio jobs are disabled for this project.", "Remote Target Disabled", 0)
