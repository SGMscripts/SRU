local r=reaper
local _,file,section,id=r.get_action_context()
local ns='SoundminerV7Link'
if r.GetExtState(ns,'active')=='1' then r.SetExtState(ns,'active','0',false);return end
if not r.ImGui_GetBuiltinPath then r.ShowMessageBox('Install ReaImGui through ReaPack first.','Soundminer link',0);return end
package.path=r.ImGui_GetBuiltinPath()..'/?.lua;'..package.path
local ImGui=require('imgui')('0.9.3')
local ctx=ImGui.CreateContext('Soundminer V7 video audition')
local proj=r.EnumProjects(-1,'')
if r.GetPlayStateEx(proj)~=0 then r.ShowMessageBox('Stop REAPER before enabling the link.','Soundminer V7',0);return end
local dir=file:match('^(.*[/\\])')
if not r.GetOS():match('OSX') and not r.GetOS():match('macOS') then r.ShowMessageBox('This package supports macOS only.','Soundminer link',0);return end
local token=tostring(r.time_precise())
local run=r.GetResourcePath()..'/Data/SoundminerVideoLink/'..token..'/'
r.RecursiveCreateDirectory(run,0)
local function write(n,v) local f=assert(io.open(run..n..'.tmp','w'));f:write(v);f:close();assert(os.rename(run..n..'.tmp',run..n)) end
local function read(n) local f=io.open(run..n,'r');if not f then return '' end local s=f:read('*a');f:close();return s end
os.remove(run..'error');write('command','');write('lease',token..' '..os.time())
local function q(s) return "'"..s:gsub("'","'\\''").."'" end
local py=nil
local override=io.open(dir..'python-path.txt','r')
local candidates={}
if override then candidates[1]=override:read('*l');override:close() end
for _,v in ipairs({'/opt/homebrew/bin/python3','/usr/local/bin/python3','/usr/bin/python3'}) do candidates[#candidates+1]=v end
for _,v in ipairs(candidates) do
 if r.file_exists(v) then
  local result=r.ExecProcess('"'..v..'" -c "import sys,json,select,subprocess,pathlib; print(736219) if sys.version_info >= (3,9) else None"',2500)
  if result:find('736219',1,true) then py=v;break end
 end
end
if not py then
 r.ShowMessageBox('Python 3.9 or newer is required. Install Python 3 from python.org, or put its full executable path in python-path.txt beside this Lua file.','Soundminer link setup',0)
 return
end
os.execute(q(py)..' '..q(dir..'bridge.py')..' '..q(run)..' '..q(token)..' > '..q(run..'log')..' 2>&1 &')
local anchor=r.GetCursorPositionEx(proj)
local enabled=true
local returnOnPause=true
local mute=true
local master=r.GetMasterTrack(proj)
local originalMute=r.GetMediaTrackInfo_Value(master,'B_MUTE')
r.SetMediaTrackInfo_Value(master,'B_MUTE',1)
local status='Connecting to V7…'
local pendingReturn=false
local previous=false;local owned=false;local ack='0';local ready=false;local lastLease=0;local started=r.time_precise()
r.SetExtState(ns,'active','1',false);r.SetToggleCommandState(section,id,1);r.RefreshToolbar2(section,id)
local function reset()
 if owned then r.OnStopButtonEx(proj) end
 r.SetEditCurPos2(proj,anchor,false,false)
 owned=false
end
r.atexit(function()
 write('lease','off 0');if owned then reset() end;r.SetMediaTrackInfo_Value(master,'B_MUTE',originalMute);r.SetExtState(ns,'active','0',false);r.SetToggleCommandState(section,id,0);r.RefreshToolbar2(section,id)
end)
local function loop()
 if r.GetExtState(ns,'active')~='1' or r.EnumProjects(-1,'')~=proj or r.GetPlayStateEx(proj)&4~=0 then return end
 local now=r.time_precise()
 if now-lastLease>.5 then write('lease',token..' '..os.time());lastLease=now end
 if r.GetExtState(ns,'return')=='1' then
  r.DeleteExtState(ns,'return',false);write('command',tostring(now)..' return');pendingReturn=true;reset()
 end
 local err=read('error');if err~='' then r.ShowMessageBox(err,'Soundminer link disconnected',0);return end
 local t,stamp,playing,pos,total,has,newack=read('state'):match('^(%S+) (%S+) (%S+) (%S+) (%S+) (%S+) (%S+)')
 if t==token then
  if os.time()-tonumber(stamp)>4 then r.ShowMessageBox('Soundminer connection timed out.','Soundminer V7',0);return end
  local on=playing=='1'
  if newack~=ack then reset();ack=newack;previous=false;pendingReturn=false end
  status=on and 'Soundminer playing' or 'Soundminer paused / stopped'
  if enabled and not pendingReturn and on and not previous then
   if not owned then anchor=r.GetCursorPositionEx(proj);owned=true end
   r.OnPlayButtonEx(proj)
  elseif enabled and not on and previous and owned then
   if returnOnPause then reset() else r.OnPauseButtonEx(proj) end
  end
  previous=on;ready=true
 elseif not ready and now-started>8 then r.ShowMessageBox('Could not connect to Soundminer V7. Open V7 and try again.','Soundminer V7',0);return end
 ImGui.SetNextWindowSize(ctx,420,260,ImGui.Cond_FirstUseEver)
 local visible,open=ImGui.Begin(ctx,'Soundminer V7 • Video audition',true)
 if visible then
  ImGui.Text(ctx,status)
  local changed,value=ImGui.Checkbox(ctx,'Link playback',enabled)
  if changed then enabled=value;if not enabled then reset() else previous=false end end
  changed,value=ImGui.Checkbox(ctx,'Mute REAPER audio',mute)
  if changed then mute=value;r.SetMediaTrackInfo_Value(master,'B_MUTE',mute and 1 or originalMute) end
  changed,value=ImGui.Checkbox(ctx,'Return to cursor when Soundminer pauses',returnOnPause)
  if changed then returnOnPause=value end
  ImGui.Separator(ctx)
  ImGui.Text(ctx,string.format('Return point: %.3f seconds',anchor))
  ImGui.TextWrapped(ctx,'Start point follows the REAPER edit cursor automatically.')
  if ImGui.Button(ctx,'Stop / Return',-1,36) then
   write('command',tostring(now)..' return');pendingReturn=true;reset()
  end
  ImGui.TextWrapped(ctx,'Uses Soundminer’s normal Play/Pause. Linked playback is approximate, not frame-accurate.')
  ImGui.End(ctx)
 end
 r.SetExtState(ns,'anchor',tostring(anchor),false)
 if open then r.defer(loop) end
end
loop()
