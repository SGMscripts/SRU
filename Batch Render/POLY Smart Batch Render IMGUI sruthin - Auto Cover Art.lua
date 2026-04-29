-- @description POLY Smart Batch Render + Auto Cover Art IMGUI sruthin
-- @version 2.0
-- @author Sruthin + Codex
-- @about
--   ReaImGui front-end for folder-based POLY smart batch renders with
--   per-item cover-art injection.
--   Select items on the parent/folder track, then run the batch render.
--   The script forces "selected media items via master", can disable the
--   selected-item render tail to avoid the common +1 second output issue,
--   and restores track/project state after rendering.
--
--   For each selected parent item, the script reads the item's source image file
--   and writes it to:
--     - ID3:APIC_FILE
--     - FLACPIC:APIC_FILE
--   before rendering that item.
--
--   Optional modules:
--     - Inject UCS/ASWG metadata keys into Project Render Metadata
--     - Update next META marker RecType/Microphone/ixmlTrackLayout/ChannelLayout from active folder child tracks
--     - Post-write ixmlTrackLayout/ChannelLayout directly into rendered WAV/BWF files using bwfmetaedit

local r = reaper

if not r.ImGui_CreateContext then
  r.MB(
    "This script needs ReaImGui.\nInstall 'ReaImGui: ReaScript binding for Dear ImGui' from ReaPack.",
    "POLY Smart Batch Render + Auto Cover Art",
    0
  )
  return
end

local SCRIPT_TITLE = "POLY Smart Batch Render + Auto Cover Art IMGUI sruthin"
local EXT_SECTION = "PolySmartBatchRenderImGuiAutoCoverArt"
local RENDER_ACTION_ID = 42230
local RENDER_SOURCE_MASK = 1 | 2 | 32 | 64 | 128 | 4096
local RENDER_SOURCE_SELECTED_ITEMS_VIA_MASTER = 64
local RENDER_BOUNDS_SELECTED_ITEMS = 4
local RENDER_TAIL_SELECTED_ITEMS = 16
local RENDER_SETTINGS_PRESERVE_SOURCE_SRATE = 2 << 16
local RENDER_MODE_POLY = 0
local RENDER_MODE_STEREO = 1
local RENDER_MODE_ITEMS = "POLY WAV (multichannel)\0Stereo mix (child tracks)\0\0"
local RENDER_PROFILE_MODE_STRICT = 0
local RENDER_PROFILE_MODE_SMART = 1
local RENDER_PROFILE_MODE_ITEMS = "Strict Profile (all captured render settings)\0Smart Profile (critical captured settings)\0\0"
local DEFAULT_RENDER_FILENAME_PATTERN = "$marker(Category)[;]/$marker(Subcategory)[;]/$item"
local RENDER_PROFILE_NUMERIC_KEYS = {
  "RENDER_BOUNDSFLAG",
  "RENDER_SETTINGS",
  "RENDER_CHANNELS",
  "RENDER_TAILFLAG",
  "RENDER_TAILMS",
  "RENDER_ADDTOPROJ",
  "RENDER_SRATE",
  "RENDER_SRATE_USE",
  "RENDER_SETTINGS2",
}
local RENDER_PROFILE_STRING_KEYS = {
  "RENDER_FILE",
  "RENDER_PATTERN",
  "RENDER_FORMAT",
  "RENDER_FORMAT2",
  "RENDER_METADATA",
}
local RENDER_PROFILE_SMART_NUMERIC_KEYS = {
  "RENDER_SRATE",
  "RENDER_SRATE_USE",
}
local RENDER_PROFILE_SMART_STRING_KEYS = {
  "RENDER_FORMAT",
  "RENDER_FORMAT2",
  "RENDER_METADATA",
}
local BWF_METAEDIT_PATH = "/usr/local/bin/bwfmetaedit"
local UCS_EMBEDDER_NAME = "REAPER UCS Renaming Tool"
local UCS_DIRECT_VALUES = false
local UCS_ALWAYS_OVERWRITE = false
local RECTYPE_LAYOUT_EXT_KEY = "rectype_layout_map"
local DEFAULT_IXML_TRACK_LAYOUT_BY_RECTYPE = {
  AB = "L,R",
  BIN = "L,R",
  BLUM = "L,R",
  CARD = "C",
  DIN = "L,R",
  ["DMS-DCOD"] = "L,C,R,Ls,Rs",
  ["DMS-RAW"] = "M,S,S",
  EMF = "C",
  FIG8 = "C",
  ["FOA-AFMT-DF"] = "A1,A2,A3,A4",
  ["FOA-AFMT-EF"] = "A1,A2,A3,A4",
  ["FOA-AFMT-UF"] = "A1,A2,A3,A4",
  ["FOA-AMBIX"] = "W,Y,Z,X",
  ["FOA-FUMA"] = "W,X,Y,Z",
  GEO = "C",
  HYDRO = "C",
  HYPCARD = "C",
  INFRA = "C",
  LCR = "L,C,R",
  LRC = "L,R,C",
  ["MS-DCOD"] = "L,R",
  ["MS-RAW"] = "M,S",
  NOS = "L,R",
  OMNI = "C",
  ORTF = "L,R",
  OSS = "L,R",
  PARA = "C",
  QUAD = "L,R,Ls,Rs",
  SASS = "L,R",
  SHOT = "C",
  SUPCARD = "C",
  ULTRA = "C",
  XY = "L,R",
  ["2OA-AMBIX"] = "ACN0,ACN1,ACN2,ACN3,ACN4,ACN5,ACN6,ACN7,ACN8",
  ["2OA-FUMA"] = "W,X,Y,Z,R,S,T,U,V",
  ["3OA-AMBIX"] = "ACN0,ACN1,ACN2,ACN3,ACN4,ACN5,ACN6,ACN7,ACN8,ACN9,ACN10,ACN11,ACN12,ACN13,ACN14,ACN15",
  ["4OA-AMBIX"] = "ACN0,ACN1,ACN2,ACN3,ACN4,ACN5,ACN6,ACN7,ACN8,ACN9,ACN10,ACN11,ACN12,ACN13,ACN14,ACN15,ACN16,ACN17,ACN18,ACN19,ACN20,ACN21,ACN22,ACN23,ACN24",
  ["5.0"] = "L,R,C,Ls,Rs",
  ["5.1"] = "L,R,C,LFE,Ls,Rs",
  ["7.0"] = "L,R,C,Ls,Rs,Lrs,Rrs",
  ["7.1"] = "L,R,C,LFE,Lss,Rss,Lsr,Rsr",
}
local REQUIRED_CASE_LAYOUT_BY_RECTYPE = {
  ["MS-RAW"] = "M,S",
  ["MS-DCOD"] = "L,R",
  ["DMS-RAW"] = "M,S,S",
  ["DMS-DCOD"] = "L,C,R,Ls,Rs",
  ["QUAD"] = "L,R,Ls,Rs",
  ["5.0"] = "L,R,C,Ls,Rs",
  ["5.1"] = "L,R,C,LFE,Ls,Rs",
  ["7.0"] = "L,R,C,Ls,Rs,Lrs,Rrs",
  ["7.1"] = "L,R,C,LFE,Lss,Rss,Lsr,Rsr",
}
local RECTYPE_LAYOUT_DISPLAY_GROUPS = {
  { title = "MONO", keys = { "CARD", "SUPCARD", "HYPCARD", "SHOT", "OMNI", "FIG8" } },
  { title = "STEREO", keys = { "XY", "ORTF", "AB", "NOS", "DIN", "BLUM", "BIN" } },
  { title = "MID-SIDE", keys = { "MS-RAW", "MS-DCOD", "DMS-RAW", "DMS-DCOD" } },
  { title = "SPECIAL (CHANNEL FORMATS)", keys = { "LCR", "LRC", "QUAD", "5.0", "5.1", "7.0", "7.1" } },
  { title = "AMBISONIC", keys = { "FOA-FUMA", "FOA-AMBIX", "FOA-AFMT-UF", "FOA-AFMT-DF", "FOA-AFMT-EF", "2OA-FUMA", "2OA-AMBIX", "3OA-AMBIX", "4OA-AMBIX" } },
  { title = "SPECIAL RECORDING TYPES", keys = { "HYDRO", "EMF", "ULTRA", "INFRA", "GEO", "PARA", "OSS", "SASS" } },
}
local IXML_TRACK_LAYOUT_BY_RECTYPE = {}
local FORCE_OVERWRITE_METADATA_KEYS = {
  ["ASWG:channelConfig"] = true,
  ["ASWG:channelLayout"] = true,
  ["ASWG:channelLayoutText"] = true,
  ["BWF:ChannelLayout"] = true,
  ["CAFINFO:channel layout"] = true,
  ["IXML:ChannelLayout"] = true,
  ["IXML:TRACK_LAYOUT"] = true,
  ["IXML:USER:ChannelLayout"] = true,
  ["IXML:USER:ixmlTrackLayout"] = true,
  ["USER:ChannelLayout"] = true,
  ["WAVEXT:channel configuration"] = true,
}
local COVER_META_KEYS = {
  "ID3:APIC_FILE",
  "FLACPIC:APIC_FILE",
  "ID3:APIC_TYPE",
  "FLACPIC:APIC_TYPE",
}
local LAYOUT_VISIBILITY_META_KEYS = {
  "BWF:Description",
  "IXML:BEXT:BWF_DESCRIPTION",
  "INFO:ICMT",
}
local FORCED_CHANNEL_LAYOUT_META_KEYS = {
  "BWF:ChannelLayout",
  "CAFINFO:channel layout",
  "WAVEXT:channel configuration",
  "ASWG:channelConfig",
  "ASWG:channelLayout",
  "ASWG:channelLayoutText",
  "IXML:ChannelLayout",
  "IXML:USER:ChannelLayout",
  "USER:ChannelLayout",
  "IXML:TRACK_LAYOUT",
  "IXML:USER:ixmlTrackLayout",
}
local FORCED_CHANNEL_LAYOUT_META_KEY_SOURCE = {
  ["BWF:ChannelLayout"] = "channel_layout",
  ["CAFINFO:channel layout"] = "channel_layout",
  ["WAVEXT:channel configuration"] = "channel_layout",
  ["ASWG:channelConfig"] = "channel_layout",
  ["ASWG:channelLayout"] = "channel_layout",
  ["ASWG:channelLayoutText"] = "channel_layout",
  ["IXML:ChannelLayout"] = "channel_layout",
  ["IXML:USER:ChannelLayout"] = "channel_layout",
  ["USER:ChannelLayout"] = "channel_layout",
  ["IXML:TRACK_LAYOUT"] = "ixml_layout",
  ["IXML:USER:ixmlTrackLayout"] = "ixml_layout",
}
local IMAGE_EXTENSIONS = {
  jpg = true,
  jpeg = true,
  png = true,
  bmp = true,
  gif = true,
  tif = true,
  tiff = true,
  webp = true,
}

local ctx = r.ImGui_CreateContext(SCRIPT_TITLE)
local FLT_MIN = 0.0
if r.ImGui_NumericLimits_Float then
  FLT_MIN = select(1, r.ImGui_NumericLimits_Float())
end

local state = {
  disable_tail = true,
  sort_by_time = true,
  auto_refresh = true,
  render_mode = RENDER_MODE_POLY,
  apply_render_profile = true,
  render_profile_mode = RENDER_PROFILE_MODE_SMART,
  render_profile_captured = false,
  render_profile_status = "",
  match_child_sample_rate = true,
  enforce_render_filename_pattern = true,
  render_filename_pattern = DEFAULT_RENDER_FILENAME_PATTERN,
  render_profile = nil,
  inject_ucs_metadata = true,
  update_meta_marker = false,
  post_write_ixml_layout = true,
  post_patch_channel_mask = true,
  force_channel_layout_render_metadata = true,
  mirror_channel_layout_to_description = false,
  append_track_info_to_url = true,
  rectype_layout_text = "",
  rectype_layout_edit_text = "",
  rectype_layout_status = "",
  status_line = "Ready.",
  last_summary = "",
  selection_info = nil,
}

local function get_ext_bool(key, default)
  local v = r.GetExtState(EXT_SECTION, key)
  if v == "" then return default end
  return v == "1"
end

local function set_ext_bool(key, value)
  r.SetExtState(EXT_SECTION, key, value and "1" or "0", true)
end

local function get_ext_int(key, default)
  local v = tonumber(r.GetExtState(EXT_SECTION, key))
  if v == nil then return default end
  return math.floor(v)
end

local function set_ext_int(key, value)
  r.SetExtState(EXT_SECTION, key, tostring(math.floor(value or 0)), true)
end

local function get_ext_text(key, default)
  local v = r.GetExtState(EXT_SECTION, key)
  if v == "" then return default or "" end
  return v
end

local function set_ext_text(key, value)
  r.SetExtState(EXT_SECTION, key, tostring(value or ""), true)
end

state.disable_tail = get_ext_bool("disable_tail", true)
state.sort_by_time = get_ext_bool("sort_by_time", true)
state.auto_refresh = get_ext_bool("auto_refresh", true)
state.render_mode = get_ext_int("render_mode", RENDER_MODE_POLY)
state.apply_render_profile = get_ext_bool("apply_render_profile", true)
state.render_profile_mode = get_ext_int("render_profile_mode", RENDER_PROFILE_MODE_SMART)
state.render_profile_captured = get_ext_bool("render_profile_captured", false)
state.match_child_sample_rate = get_ext_bool("match_child_sample_rate", true)
state.enforce_render_filename_pattern = get_ext_bool("enforce_render_filename_pattern", true)
state.render_filename_pattern = get_ext_text("render_filename_pattern", DEFAULT_RENDER_FILENAME_PATTERN)
if tostring(state.render_filename_pattern or "") == "" then
  state.render_filename_pattern = DEFAULT_RENDER_FILENAME_PATTERN
end
state.inject_ucs_metadata = get_ext_bool("inject_ucs_metadata", true)
state.update_meta_marker = get_ext_bool("update_meta_marker", false)
state.post_write_ixml_layout = get_ext_bool("post_write_ixml_layout", true)
state.post_patch_channel_mask = get_ext_bool("post_patch_channel_mask", true)
state.force_channel_layout_render_metadata = get_ext_bool("force_channel_layout_render_metadata", true)
state.mirror_channel_layout_to_description = false
set_ext_bool("mirror_channel_layout_to_description", false)
state.append_track_info_to_url = get_ext_bool("append_track_info_to_url", true)
if state.render_mode ~= RENDER_MODE_POLY and state.render_mode ~= RENDER_MODE_STEREO then
  state.render_mode = RENDER_MODE_POLY
end
if state.render_profile_mode ~= RENDER_PROFILE_MODE_STRICT and state.render_profile_mode ~= RENDER_PROFILE_MODE_SMART then
  state.render_profile_mode = RENDER_PROFILE_MODE_SMART
end

local THEME_COLORS = {
  { "Text",                 0.96, 0.97, 0.99, 1.00 },
  { "TextDisabled",         0.58, 0.60, 0.72, 1.00 },
  { "WindowBg",             0.085,0.075,0.145,1.00 },
  { "ChildBg",              0.11, 0.10, 0.17, 1.00 },
  { "PopupBg",              0.12, 0.10, 0.18, 0.98 },
  { "Border",               0.35, 0.70, 0.92, 0.55 },
  { "BorderShadow",         0.00, 0.00, 0.00, 0.40 },
  { "FrameBg",              0.18, 0.16, 0.28, 1.00 },
  { "FrameBgHovered",       0.28, 0.24, 0.42, 1.00 },
  { "FrameBgActive",        0.38, 0.30, 0.55, 1.00 },
  { "TitleBg",              0.12, 0.09, 0.22, 1.00 },
  { "TitleBgActive",        0.55, 0.20, 0.75, 1.00 },
  { "TitleBgCollapsed",     0.10, 0.08, 0.18, 0.80 },
  { "MenuBarBg",            0.14, 0.11, 0.22, 1.00 },
  { "ScrollbarBg",          0.08, 0.07, 0.14, 1.00 },
  { "ScrollbarGrab",        0.30, 0.60, 0.80, 1.00 },
  { "ScrollbarGrabHovered", 0.40, 0.75, 0.95, 1.00 },
  { "ScrollbarGrabActive",  0.50, 0.90, 1.00, 1.00 },
  { "CheckMark",            0.25, 0.95, 0.90, 1.00 },
  { "SliderGrab",           0.95, 0.30, 0.70, 1.00 },
  { "SliderGrabActive",     1.00, 0.45, 0.80, 1.00 },
  { "Button",               0.24, 0.56, 0.88, 1.00 },
  { "ButtonHovered",        0.36, 0.72, 1.00, 1.00 },
  { "ButtonActive",         0.50, 0.85, 1.00, 1.00 },
  { "Header",               0.36, 0.22, 0.62, 1.00 },
  { "HeaderHovered",        0.52, 0.32, 0.82, 1.00 },
  { "HeaderActive",         0.62, 0.42, 0.92, 1.00 },
  { "Separator",            0.40, 0.30, 0.62, 1.00 },
  { "SeparatorHovered",     0.62, 0.45, 0.92, 1.00 },
  { "SeparatorActive",      0.82, 0.60, 1.00, 1.00 },
  { "ResizeGrip",           0.30, 0.60, 0.88, 0.35 },
  { "ResizeGripHovered",    0.45, 0.75, 1.00, 0.75 },
  { "ResizeGripActive",     0.60, 0.90, 1.00, 0.95 },
  { "Tab",                  0.18, 0.14, 0.32, 1.00 },
  { "TabHovered",           0.55, 0.28, 0.80, 1.00 },
  { "TabActive",            0.78, 0.28, 0.66, 1.00 },
  { "TabSelected",          0.78, 0.28, 0.66, 1.00 },
  { "TabUnfocused",         0.14, 0.11, 0.22, 1.00 },
  { "TabUnfocusedActive",   0.40, 0.20, 0.56, 1.00 },
  { "PlotLines",            0.35, 0.85, 0.95, 1.00 },
  { "PlotLinesHovered",     1.00, 0.55, 0.80, 1.00 },
  { "PlotHistogram",        0.55, 0.92, 0.58, 1.00 },
  { "PlotHistogramHovered", 1.00, 0.75, 0.30, 1.00 },
  { "TextSelectedBg",       0.60, 0.25, 0.80, 0.45 },
}

local THEME_VARS_FLOAT = {
  { "WindowRounding",    8.0 },
  { "ChildRounding",     6.0 },
  { "FrameRounding",     5.0 },
  { "GrabRounding",      4.0 },
  { "TabRounding",       5.0 },
  { "ScrollbarRounding", 6.0 },
  { "PopupRounding",     6.0 },
  { "WindowBorderSize",  1.0 },
  { "FrameBorderSize",   0.0 },
}

local THEME_VARS_VEC2 = {
  { "FramePadding",   9.0,  6.0 },
  { "ItemSpacing",   10.0,  7.0 },
  { "WindowPadding", 14.0, 12.0 },
}

local theme_pushed_colors = 0
local theme_pushed_vars = 0

local function push_theme()
  theme_pushed_colors = 0
  theme_pushed_vars = 0
  if not ctx or not r.ImGui_PushStyleColor or not r.ImGui_ColorConvertDouble4ToU32 then
    return
  end
  for _, entry in ipairs(THEME_COLORS) do
    local getter = r["ImGui_Col_" .. entry[1]]
    if type(getter) == "function" then
      local ok_id, id = pcall(getter)
      if ok_id and id then
        local okc, col = pcall(r.ImGui_ColorConvertDouble4ToU32, entry[2], entry[3], entry[4], entry[5])
        if okc and col then
          local ok = pcall(r.ImGui_PushStyleColor, ctx, id, col)
          if ok then theme_pushed_colors = theme_pushed_colors + 1 end
        end
      end
    end
  end
  if r.ImGui_PushStyleVar then
    for _, entry in ipairs(THEME_VARS_FLOAT) do
      local getter = r["ImGui_StyleVar_" .. entry[1]]
      if type(getter) == "function" then
        local ok_id, id = pcall(getter)
        if ok_id and id then
          local ok = pcall(r.ImGui_PushStyleVar, ctx, id, entry[2])
          if ok then theme_pushed_vars = theme_pushed_vars + 1 end
        end
      end
    end
    for _, entry in ipairs(THEME_VARS_VEC2) do
      local getter = r["ImGui_StyleVar_" .. entry[1]]
      if type(getter) == "function" then
        local ok_id, id = pcall(getter)
        if ok_id and id then
          local ok = pcall(r.ImGui_PushStyleVar, ctx, id, entry[2], entry[3])
          if ok then theme_pushed_vars = theme_pushed_vars + 1 end
        end
      end
    end
  end
end

local function pop_theme()
  if theme_pushed_vars > 0 and r.ImGui_PopStyleVar then
    pcall(r.ImGui_PopStyleVar, ctx, theme_pushed_vars)
  end
  if theme_pushed_colors > 0 and r.ImGui_PopStyleColor then
    pcall(r.ImGui_PopStyleColor, ctx, theme_pushed_colors)
  end
  theme_pushed_colors = 0
  theme_pushed_vars = 0
end

local function begin_child_safe(name, height)
  local ok, visible = pcall(r.ImGui_BeginChild, ctx, name, 0, height, 0)
  if ok then return true, visible end
  local ok2, visible2 = pcall(r.ImGui_BeginChild, ctx, name, 0, height, true)
  if ok2 then return true, visible2 end
  return false, false
end

local function begin_tab_bar_safe(name)
  if not r.ImGui_BeginTabBar then
    return false
  end
  local ok, visible = pcall(r.ImGui_BeginTabBar, ctx, name)
  if ok then
    return visible and true or false
  end
  return false
end

local function begin_tab_item_safe(label)
  if not r.ImGui_BeginTabItem then
    return false
  end
  local ok, visible = pcall(r.ImGui_BeginTabItem, ctx, label)
  if ok then
    return visible and true or false
  end
  return false
end

local function color_u32(rf, gf, bf, af)
  if not r.ImGui_ColorConvertDouble4ToU32 then
    return nil
  end
  local ok, col = pcall(r.ImGui_ColorConvertDouble4ToU32, rf, gf, bf, af or 1.0)
  if ok then
    return col
  end
  return nil
end

local function push_style_color_by_name(name, rf, gf, bf, af)
  if not r.ImGui_PushStyleColor then return false end
  local getter = r["ImGui_Col_" .. name]
  if type(getter) ~= "function" then return false end
  local ok_id, id = pcall(getter)
  if not ok_id or not id then return false end
  local col = color_u32(rf, gf, bf, af)
  if not col then return false end
  local ok = pcall(r.ImGui_PushStyleColor, ctx, id, col)
  return ok and true or false
end

local BUTTON_PRESETS = {
  primary = {
    { "Button",        0.96, 0.28, 0.58 },
    { "ButtonHovered", 1.00, 0.44, 0.72 },
    { "ButtonActive",  1.00, 0.60, 0.82 },
    { "Text",          1.00, 1.00, 1.00 },
  },
  success = {
    { "Button",        0.18, 0.62, 0.42 },
    { "ButtonHovered", 0.28, 0.80, 0.54 },
    { "ButtonActive",  0.42, 0.92, 0.66 },
    { "Text",          1.00, 1.00, 1.00 },
  },
  cool = {
    { "Button",        0.22, 0.58, 0.92 },
    { "ButtonHovered", 0.36, 0.74, 1.00 },
    { "ButtonActive",  0.55, 0.88, 1.00 },
    { "Text",          1.00, 1.00, 1.00 },
  },
  amber = {
    { "Button",        0.92, 0.60, 0.18 },
    { "ButtonHovered", 1.00, 0.74, 0.32 },
    { "ButtonActive",  1.00, 0.85, 0.48 },
    { "Text",          0.10, 0.08, 0.14 },
  },
}

local function push_button_accent(preset)
  local set = BUTTON_PRESETS[preset]
  if not set then return 0 end
  local n = 0
  for _, entry in ipairs(set) do
    if push_style_color_by_name(entry[1], entry[2], entry[3], entry[4], entry[5]) then
      n = n + 1
    end
  end
  return n
end

local function pop_style_colors(n)
  if n and n > 0 and r.ImGui_PopStyleColor then
    pcall(r.ImGui_PopStyleColor, ctx, n)
  end
end

local function text_colored_safe(text, color)
  if color and r.ImGui_TextColored then
    local ok = pcall(r.ImGui_TextColored, ctx, color, tostring(text or ""))
    if ok then
      return
    end
  end

  if color and r.ImGui_PushStyleColor and r.ImGui_PopStyleColor and r.ImGui_Col_Text then
    local ok = pcall(r.ImGui_PushStyleColor, ctx, r.ImGui_Col_Text(), color)
    if ok then
      r.ImGui_Text(ctx, tostring(text or ""))
      pcall(r.ImGui_PopStyleColor, ctx)
      return
    end
  end

  r.ImGui_Text(ctx, tostring(text or ""))
end

local function draw_overview_info_lane(info)
  local color_label = color_u32(0.77, 0.84, 0.94, 1.0)
  local color_ok = color_u32(0.58, 0.90, 0.62, 1.0)
  local color_warn = color_u32(0.98, 0.80, 0.44, 1.0)
  local color_bad = color_u32(0.98, 0.48, 0.48, 1.0)
  local color_sep = color_u32(0.45, 0.49, 0.55, 1.0)

  local status_text = tostring(state.status_line or "")
  local status_lower = status_text:lower()
  local status_color = color_label
  if status_lower:find("fail", 1, true) then
    status_color = color_bad
  elseif status_lower:find("running", 1, true) then
    status_color = color_warn
  elseif status_lower:find("ready", 1, true) or status_lower:find("completed", 1, true) then
    status_color = color_ok
  end

  local items = {
    { label = "Selected", value = tostring(info.selected_count or 0), color = color_label },
    { label = "Image-ready", value = tostring(info.image_count or 0), color = color_ok },
    { label = "Non-image", value = tostring(info.non_image_count or 0), color = color_warn },
    { label = "Parent", value = tostring(info.parent_name or "(none)"), color = color_label },
    { label = "Child tracks", value = tostring(info.child_count or 0), color = color_label },
    { label = "Status", value = status_text, color = status_color },
  }

  for i, item in ipairs(items) do
    if i > 1 then
      r.ImGui_SameLine(ctx)
      text_colored_safe(" | ", color_sep)
      r.ImGui_SameLine(ctx)
    end
    text_colored_safe(item.label .. ": " .. item.value, item.color)
  end
end

local function trim(s)
  return tostring(s or ""):match("^%s*(.-)%s*$")
end

local function get_project_render_string(key)
  local _, value = r.GetSetProjectInfo_String(0, tostring(key or ""), "", false)
  return tostring(value or "")
end

local function set_project_render_string(key, value)
  r.GetSetProjectInfo_String(0, tostring(key or ""), tostring(value or ""), true)
end

local function render_profile_mode_label(mode)
  if mode == RENDER_PROFILE_MODE_STRICT then
    return "Strict"
  end
  return "Smart"
end

local function load_render_profile_from_extstate()
  local profile = { numeric = {}, strings = {} }
  local have_any = false

  for _, key in ipairs(RENDER_PROFILE_NUMERIC_KEYS) do
    local raw = get_ext_text("render_profile_num_" .. key, "")
    if raw ~= "" then
      profile.numeric[key] = tonumber(raw) or 0
      have_any = true
    end
  end

  for _, key in ipairs(RENDER_PROFILE_STRING_KEYS) do
    local value = get_ext_text("render_profile_str_" .. key, "")
    profile.strings[key] = value
    if value ~= "" then
      have_any = true
    end
  end

  if not have_any then
    return nil
  end
  return profile
end

local function save_render_profile_to_extstate(profile)
  for _, key in ipairs(RENDER_PROFILE_NUMERIC_KEYS) do
    local value = profile and profile.numeric and profile.numeric[key] or nil
    set_ext_text("render_profile_num_" .. key, (value ~= nil) and tostring(value) or "")
  end

  for _, key in ipairs(RENDER_PROFILE_STRING_KEYS) do
    local value = profile and profile.strings and profile.strings[key] or nil
    set_ext_text("render_profile_str_" .. key, (value ~= nil) and tostring(value) or "")
  end

  local captured = profile ~= nil
  set_ext_bool("render_profile_captured", captured)
  state.render_profile_captured = captured
end

local function clear_render_profile_capture()
  state.render_profile = nil
  save_render_profile_to_extstate(nil)
  state.render_profile_status = "Captured render profile cleared."
end

local function capture_render_profile_from_project()
  local profile = { numeric = {}, strings = {} }

  for _, key in ipairs(RENDER_PROFILE_NUMERIC_KEYS) do
    profile.numeric[key] = r.GetSetProjectInfo(0, key, 0, false)
  end

  for _, key in ipairs(RENDER_PROFILE_STRING_KEYS) do
    profile.strings[key] = get_project_render_string(key)
  end

  state.render_profile = profile
  save_render_profile_to_extstate(profile)
  state.render_profile_status = "Captured current Render to File settings."
  return true
end

local function apply_render_profile_settings(profile, mode)
  if not profile then
    return false, "no captured render profile"
  end

  local numeric_keys = (mode == RENDER_PROFILE_MODE_STRICT) and RENDER_PROFILE_NUMERIC_KEYS or RENDER_PROFILE_SMART_NUMERIC_KEYS
  local string_keys = (mode == RENDER_PROFILE_MODE_STRICT) and RENDER_PROFILE_STRING_KEYS or RENDER_PROFILE_SMART_STRING_KEYS

  for _, key in ipairs(numeric_keys) do
    local value = profile.numeric and profile.numeric[key] or nil
    if value ~= nil then
      r.GetSetProjectInfo(0, key, value, true)
    end
  end

  for _, key in ipairs(string_keys) do
    local value = profile.strings and profile.strings[key] or nil
    if value ~= nil then
      set_project_render_string(key, value)
    end
  end

  return true, nil
end

local function format_seconds(sec)
  return string.format("%.3f s", tonumber(sec) or 0)
end

local function get_track_name(track)
  if not track then return "(none)" end
  local _, name = r.GetTrackName(track)
  name = trim(name)
  if name == "" then
    local idx = r.GetMediaTrackInfo_Value(track, "IP_TRACKNUMBER")
    return "Track " .. tostring(math.floor(idx or 0))
  end
  return name
end

local function get_item_label(item)
  local pos = r.GetMediaItemInfo_Value(item, "D_POSITION")
  local len = r.GetMediaItemInfo_Value(item, "D_LENGTH")
  return string.format("%s to %s", format_seconds(pos), format_seconds(pos + len))
end

local function get_file_extension(path)
  local ext = tostring(path or ""):match("%.([^./\\]+)$")
  return (ext and ext:lower()) or ""
end

local function file_exists(path)
  if trim(path) == "" then return false end
  local f = io.open(path, "rb")
  if not f then return false end
  f:close()
  return true
end

local function get_root_media_source(src)
  local src_to_read = src
  if r.GetMediaSourceParent then
    local safety = 0
    while src_to_read and safety < 16 do
      safety = safety + 1
      local src_type = r.GetMediaSourceType(src_to_read, "")
      if src_type ~= "SECTION" and src_type ~= "REVERSE" then
        break
      end
      local parent = r.GetMediaSourceParent(src_to_read)
      if not parent or parent == src_to_read then
        break
      end
      src_to_read = parent
    end
  end
  return src_to_read
end

local function get_item_source_path(item)
  local take = r.GetActiveTake(item)
  if not take then
    return nil, "no active take on selected item"
  end

  local src = r.GetMediaItemTake_Source(take)
  if not src then
    return nil, "active take has no media source"
  end

  local src_to_read = get_root_media_source(src)

  local src_path = trim(r.GetMediaSourceFileName(src_to_read, "") or "")
  if src_path == "" then
    return nil, "source file path is empty"
  end
  return src_path
end

local function normalize_sample_rate(value)
  local sample_rate = math.floor((tonumber(value) or 0) + 0.5)
  if sample_rate > 0 then
    return sample_rate
  end
  return nil
end

local function format_sample_rate(value)
  local sample_rate = normalize_sample_rate(value)
  if not sample_rate then
    return "unknown"
  end
  return tostring(sample_rate) .. " Hz"
end

local function get_item_source_sample_rate(item)
  if not r.GetMediaSourceSampleRate then
    return nil, "GetMediaSourceSampleRate is not available"
  end

  local take = r.GetActiveTake(item)
  if not take then
    return nil, "no active take"
  end

  local src = r.GetMediaItemTake_Source(take)
  if not src then
    return nil, "active take has no media source"
  end

  local src_to_read = get_root_media_source(src)
  local sample_rate = src_to_read and r.GetMediaSourceSampleRate(src_to_read) or 0
  sample_rate = normalize_sample_rate(sample_rate)
  if not sample_rate then
    return nil, "source has no audio sample rate"
  end
  return sample_rate, nil
end

local function summarize_child_sample_rates(entries)
  local chosen = nil
  local seen = {}
  local unique = {}

  for _, entry in ipairs(entries or {}) do
    local sample_rate = normalize_sample_rate(entry and entry.sample_rate)
    if sample_rate then
      if not chosen then
        chosen = sample_rate
      end
      if not seen[sample_rate] then
        seen[sample_rate] = true
        unique[#unique + 1] = sample_rate
      end
    end
  end

  table.sort(unique)
  return chosen, unique
end

local function format_sample_rate_set(sample_rate_set)
  local rates = {}
  for sample_rate in pairs(sample_rate_set or {}) do
    rates[#rates + 1] = sample_rate
  end
  table.sort(rates)

  local labels = {}
  for _, sample_rate in ipairs(rates) do
    labels[#labels + 1] = format_sample_rate(sample_rate)
  end

  if #labels == 0 then
    return "none"
  end
  return table.concat(labels, ", ")
end

local function describe_sample_rate_entries(entries)
  local labels = {}
  for _, entry in ipairs(entries or {}) do
    local sample_rate = normalize_sample_rate(entry and entry.sample_rate)
    if sample_rate then
      local track_name = trim(entry.track_name)
      if track_name == "" then
        track_name = "child"
      end
      labels[#labels + 1] = track_name .. "=" .. format_sample_rate(sample_rate)
      if #labels >= 4 then
        break
      end
    end
  end
  if #(entries or {}) > #labels then
    labels[#labels + 1] = "..."
  end
  return table.concat(labels, ", ")
end

local function get_item_image_path(item)
  local path, err = get_item_source_path(item)
  if not path then
    return nil, err
  end

  local ext = get_file_extension(path)
  if not IMAGE_EXTENSIONS[ext] then
    return nil, "source is not an image file"
  end

  if not file_exists(path) then
    return nil, "image file not found"
  end

  return path
end

local function clear_sends(track)
  for i = r.GetTrackNumSends(track, 0) - 1, 0, -1 do
    r.RemoveTrackSend(track, 0, i)
  end
end

local function get_take_output_channels(item)
  local take = r.GetActiveTake(item)
  if not take then return 1 end

  local chanmode = r.GetMediaItemTakeInfo_Value(take, "I_CHANMODE")
  local src = r.GetMediaItemTake_Source(take)
  local src_ch = src and r.GetMediaSourceNumChannels(src) or 1

  if chanmode > 66 then return 2 end
  if chanmode > 1 then return 1 end
  if src_ch >= 2 then return 2 end
  return 1
end

local function get_overlapping_item(track, start_t, end_t)
  for i = 0, r.CountTrackMediaItems(track) - 1 do
    local it = r.GetTrackMediaItem(track, i)
    if r.GetMediaItemInfo_Value(it, "B_MUTE") == 0 then
      local s = r.GetMediaItemInfo_Value(it, "D_POSITION")
      local e = s + r.GetMediaItemInfo_Value(it, "D_LENGTH")
      if s < end_t and e > start_t then
        return it
      end
    end
  end
  return nil
end

local function capture_selected_items()
  local items = {}
  local count = r.CountSelectedMediaItems(0)
  for i = 0, count - 1 do
    items[#items + 1] = r.GetSelectedMediaItem(0, i)
  end
  return items
end

local function restore_selected_items(items)
  r.SelectAllMediaItems(0, false)
  for _, item in ipairs(items or {}) do
    if item and r.ValidatePtr2(0, item, "MediaItem*") then
      r.SetMediaItemSelected(item, true)
    end
  end
end

local function collect_selected_items()
  local count = r.CountSelectedMediaItems(0)
  if count == 0 then
    return nil, "Select items on the POLY parent/folder track (image items for cover art, or empty items for no image metadata)."
  end

  local items = {}
  local parent = nil
  local image_count = 0

  for i = 0, count - 1 do
    local item = r.GetSelectedMediaItem(0, i)
    local track = item and r.GetMediaItemTrack(item) or nil
    if not parent then
      parent = track
    elseif track ~= parent then
      return nil, "All selected items must be on the same parent track."
    end

    local image_path = get_item_image_path(item)
    if image_path then
      image_count = image_count + 1
    end

    items[#items + 1] = item
  end

  return {
    items = items,
    parent = parent,
    image_count = image_count,
    non_image_count = count - image_count,
    total_count = count,
  }
end

local function collect_child_tracks(parent)
  local tracks = {}
  if not parent then return tracks end

  local parent_idx = r.GetMediaTrackInfo_Value(parent, "IP_TRACKNUMBER") - 1
  local depth = 1
  local t = parent_idx + 1

  while depth > 0 do
    local tr = r.GetTrack(0, t)
    if not tr then break end
    depth = depth + r.GetMediaTrackInfo_Value(tr, "I_FOLDERDEPTH")
    tracks[#tracks + 1] = tr
    t = t + 1
  end

  return tracks
end

local function capture_track_chunks(tracks)
  local snapshots = {}
  for _, tr in ipairs(tracks or {}) do
    local ok, chunk = r.GetTrackStateChunk(tr, "", false)
    if ok then
      snapshots[#snapshots + 1] = { track = tr, chunk = chunk }
    end
  end
  return snapshots
end

local function restore_track_chunks(snapshots)
  for _, entry in ipairs(snapshots or {}) do
    if entry.track and entry.chunk and r.ValidatePtr2(0, entry.track, "MediaTrack*") then
      r.SetTrackStateChunk(entry.track, entry.chunk, false)
    end
  end
end

local function snapshot_render_state(parent)
  return {
    render_channels = r.GetSetProjectInfo(0, "RENDER_CHANNELS", 0, false),
    render_boundsflag = r.GetSetProjectInfo(0, "RENDER_BOUNDSFLAG", 0, false),
    render_settings = r.GetSetProjectInfo(0, "RENDER_SETTINGS", 0, false),
    render_tailflag = r.GetSetProjectInfo(0, "RENDER_TAILFLAG", 0, false),
    render_tailms = r.GetSetProjectInfo(0, "RENDER_TAILMS", 0, false),
    render_addtoproj = r.GetSetProjectInfo(0, "RENDER_ADDTOPROJ", 0, false),
    render_srate = r.GetSetProjectInfo(0, "RENDER_SRATE", 0, false),
    render_srate_use = r.GetSetProjectInfo(0, "RENDER_SRATE_USE", 0, false),
    parent_channels = parent and r.GetMediaTrackInfo_Value(parent, "I_NCHAN") or nil,
  }
end

local function restore_render_state(parent, snap)
  if not snap then return end
  r.GetSetProjectInfo(0, "RENDER_CHANNELS", snap.render_channels or 2, true)
  r.GetSetProjectInfo(0, "RENDER_BOUNDSFLAG", snap.render_boundsflag or 0, true)
  r.GetSetProjectInfo(0, "RENDER_SETTINGS", snap.render_settings or 0, true)
  r.GetSetProjectInfo(0, "RENDER_TAILFLAG", snap.render_tailflag or 0, true)
  r.GetSetProjectInfo(0, "RENDER_TAILMS", snap.render_tailms or 0, true)
  r.GetSetProjectInfo(0, "RENDER_ADDTOPROJ", snap.render_addtoproj or 0, true)
  r.GetSetProjectInfo(0, "RENDER_SRATE", snap.render_srate or 0, true)
  r.GetSetProjectInfo(0, "RENDER_SRATE_USE", snap.render_srate_use or 0, true)
  if parent and snap.parent_channels then
    r.SetMediaTrackInfo_Value(parent, "I_NCHAN", snap.parent_channels)
  end
end

local function ensure_track_channels(track, needed)
  local target = math.max(2, math.floor(needed or 2))
  local current = r.GetMediaTrackInfo_Value(track, "I_NCHAN")
  if current < target then
    r.SetMediaTrackInfo_Value(track, "I_NCHAN", target)
  end
end

local function sort_items_by_position(items)
  table.sort(items, function(a, b)
    local a_pos = r.GetMediaItemInfo_Value(a, "D_POSITION")
    local b_pos = r.GetMediaItemInfo_Value(b, "D_POSITION")
    if a_pos == b_pos then
      local a_len = r.GetMediaItemInfo_Value(a, "D_LENGTH")
      local b_len = r.GetMediaItemInfo_Value(b, "D_LENGTH")
      return a_len < b_len
    end
    return a_pos < b_pos
  end)
end

local function apply_render_prefs(parent, dst_channels, disable_tail, snap, render_sample_rate)
  local render_settings = math.floor((snap and snap.render_settings) or 0)
  render_settings = (render_settings & ~RENDER_SOURCE_MASK) | RENDER_SOURCE_SELECTED_ITEMS_VIA_MASTER
  local sample_rate = normalize_sample_rate(render_sample_rate)
  if sample_rate then
    render_settings = render_settings & ~RENDER_SETTINGS_PRESERVE_SOURCE_SRATE
  end

  local render_addtoproj = math.floor((snap and snap.render_addtoproj) or 0)
  render_addtoproj = render_addtoproj & 2

  local tail_flag = math.floor((snap and snap.render_tailflag) or 0)
  if disable_tail then
    tail_flag = tail_flag & ~RENDER_TAIL_SELECTED_ITEMS
  end

  r.GetSetProjectInfo(0, "RENDER_BOUNDSFLAG", RENDER_BOUNDS_SELECTED_ITEMS, true)
  r.GetSetProjectInfo(0, "RENDER_SETTINGS", render_settings, true)
  r.GetSetProjectInfo(0, "RENDER_CHANNELS", dst_channels, true)
  r.GetSetProjectInfo(0, "RENDER_TAILFLAG", tail_flag, true)
  if disable_tail then
    r.GetSetProjectInfo(0, "RENDER_TAILMS", 0, true)
  end
  r.GetSetProjectInfo(0, "RENDER_ADDTOPROJ", render_addtoproj, true)
  if sample_rate then
    r.GetSetProjectInfo(0, "RENDER_SRATE", sample_rate, true)
  elseif snap and snap.render_srate ~= nil then
    r.GetSetProjectInfo(0, "RENDER_SRATE", snap.render_srate or 0, true)
  end

  ensure_track_channels(parent, dst_channels)

  if state.enforce_render_filename_pattern then
    local pattern = trim(state.render_filename_pattern)
    if pattern ~= "" then
      set_project_render_string("RENDER_PATTERN", pattern)
    end
  end
end

local function get_render_metadata(meta_key)
  local _, value = r.GetSetProjectInfo_String(0, "RENDER_METADATA", meta_key, false)
  return tostring(value or "")
end

local function set_render_metadata(meta_key, value)
  r.GetSetProjectInfo_String(0, "RENDER_METADATA", meta_key .. "|" .. tostring(value or ""), true)
end

local function snapshot_cover_metadata()
  local snap = {}
  for _, key in ipairs(COVER_META_KEYS) do
    snap[key] = get_render_metadata(key)
  end
  return snap
end

local function restore_cover_metadata(snap)
  if not snap then return end
  for _, key in ipairs(COVER_META_KEYS) do
    set_render_metadata(key, snap[key] or "")
  end
end

local function snapshot_layout_visibility_metadata()
  local snap = {}
  for _, key in ipairs(LAYOUT_VISIBILITY_META_KEYS) do
    snap[key] = get_render_metadata(key)
  end
  return snap
end

local function restore_layout_visibility_metadata(snap)
  if not snap then return end
  for _, key in ipairs(LAYOUT_VISIBILITY_META_KEYS) do
    set_render_metadata(key, snap[key] or "")
  end
end

local function strip_layout_visibility_suffix(value)
  local s = tostring(value or "")
  s = s:gsub("%s*|%s*ChannelLayout=[^|]*", "")
  s = s:gsub("%s*|%s*ixmlTrackLayout=[^|]*", "")
  return trim(s)
end

local function build_layout_visibility_suffix(child_meta)
  local parts = {}
  local channel_layout = trim(child_meta and child_meta.channel_layout or "")
  local ixml_layout = trim(child_meta and child_meta.ixml_layout or "")
  if channel_layout ~= "" then
    parts[#parts + 1] = "ChannelLayout=" .. channel_layout
  end
  if ixml_layout ~= "" then
    parts[#parts + 1] = "ixmlTrackLayout=" .. ixml_layout
  end
  return table.concat(parts, " | ")
end

local function apply_layout_visibility_metadata(child_meta, layout_visibility_snap)
  if not child_meta then
    return false, "missing child metadata"
  end

  local suffix = build_layout_visibility_suffix(child_meta)
  if suffix == "" then
    return false, "layout values are empty"
  end

  for _, key in ipairs(LAYOUT_VISIBILITY_META_KEYS) do
    local base_value = (layout_visibility_snap and layout_visibility_snap[key]) or get_render_metadata(key)
    local cleaned = strip_layout_visibility_suffix(base_value)
    local merged = (cleaned == "") and suffix or (cleaned .. " | " .. suffix)
    set_render_metadata(key, merged)
  end
  return true, nil
end

local function snapshot_forced_channel_layout_metadata()
  local snap = {}
  for _, key in ipairs(FORCED_CHANNEL_LAYOUT_META_KEYS) do
    snap[key] = get_render_metadata(key)
  end
  return snap
end

local function restore_forced_channel_layout_metadata(snap)
  if not snap then return end
  for _, key in ipairs(FORCED_CHANNEL_LAYOUT_META_KEYS) do
    set_render_metadata(key, snap[key] or "")
  end
end

local function apply_forced_channel_layout_metadata(child_meta)
  if not child_meta then
    return false, "missing child metadata"
  end

  local channel_layout = trim(child_meta.channel_layout)
  local ixml_layout = trim(child_meta.ixml_layout)
  if channel_layout == "" and ixml_layout == "" then
    return false, "layout values are empty"
  end

  local written = 0
  for _, key in ipairs(FORCED_CHANNEL_LAYOUT_META_KEYS) do
    local source = FORCED_CHANNEL_LAYOUT_META_KEY_SOURCE[key]
    local value = (source == "ixml_layout") and ixml_layout or channel_layout
    if trim(value) ~= "" then
      set_render_metadata(key, value)
      written = written + 1
    end
  end

  if written == 0 then
    return false, "no technical ChannelLayout metadata keys were written"
  end
  return true, nil
end

local function set_cover_image_metadata(image_path)
  set_render_metadata("ID3:APIC_FILE", image_path)
  set_render_metadata("FLACPIC:APIC_FILE", image_path)
  set_render_metadata("ID3:APIC_TYPE", "3")
  set_render_metadata("FLACPIC:APIC_TYPE", "3")
end

local function clear_cover_image_metadata()
  set_render_metadata("ID3:APIC_FILE", "")
  set_render_metadata("FLACPIC:APIC_FILE", "")
  set_render_metadata("ID3:APIC_TYPE", "")
  set_render_metadata("FLACPIC:APIC_TYPE", "")
end

local function url_encode_component(value)
  local s = tostring(value or "")
  return (s:gsub("([^%w%-%_%.~])", function(ch)
    return string.format("%%%02X", string.byte(ch))
  end))
end

local function append_query_param(url, key, value)
  local v = trim(value)
  if v == "" then
    return url
  end
  local sep = url:find("?", 1, true) and "&" or "?"
  return url .. sep .. tostring(key) .. "=" .. url_encode_component(v)
end

local function is_marker_expression(value)
  return tostring(value or ""):find("$marker(", 1, true) ~= nil
end

local function get_base_track_info_url()
  local ret, meta_url = r.GetProjExtState(0, "UCS_WebInterface", "MetaURL")
  local ucs_meta_url = (ret == 1) and tostring(meta_url or "") or ""
  local candidates = {
    ucs_meta_url,
    get_render_metadata("IXML:USER:URL"),
    get_render_metadata("BWF:OriginatorReference"),
    get_render_metadata("INFO:IURL"),
  }
  for _, candidate in ipairs(candidates) do
    local value = trim(candidate)
    if value ~= "" and not is_marker_expression(value) then
      return value
    end
  end
  return ""
end

local function apply_track_info_url_metadata(child_meta, out_channels, active_track_names)
  if not child_meta then
    return false, "missing child metadata"
  end

  local base_url = get_base_track_info_url()
  if base_url == "" then
    return false, "base URL is empty (set UCS MetaURL to enable URL track info)"
  end

  local tracks = table.concat(active_track_names or {}, ",")
  local url = base_url
  url = append_query_param(url, "channels", tostring(math.floor(out_channels or 0)))
  url = append_query_param(url, "ixmlTrackLayout", child_meta.ixml_layout)
  url = append_query_param(url, "ChannelLayout", child_meta.channel_layout)
  url = append_query_param(url, "RecType", child_meta.rectype)
  url = append_query_param(url, "Microphone", child_meta.miclist)
  url = append_query_param(url, "Tracks", tracks)

  set_render_metadata("BWF:OriginatorReference", url)
  set_render_metadata("IXML:USER:URL", url)
  set_render_metadata("INFO:IURL", url)
  return true, nil
end

--------------------------------------------------------
-- Post-render iXML layout patching
--------------------------------------------------------
local function shell_quote(value)
  return "'" .. tostring(value or ""):gsub("'", "'\\''") .. "'"
end

local function command_succeeded(cmd)
  local ok, why, code = os.execute(cmd)
  if ok == true or ok == 0 then
    return true, nil
  end
  return false, tostring(why or ok or "failed") .. " " .. tostring(code or "")
end

local function path_exists(path)
  local f = io.open(path or "", "rb")
  if f then
    f:close()
    return true
  end
  return false
end

local function read_text_file(path)
  local f = io.open(path or "", "rb")
  if not f then return nil end
  local data = f:read("*a")
  f:close()
  return data
end

local function write_text_file(path, data)
  local f = io.open(path or "", "wb")
  if not f then return false end
  f:write(data or "")
  f:close()
  return true
end

local function make_temp_xml_path()
  local path = os.tmpname()
  os.remove(path)
  return path .. ".xml"
end

local function xml_escape(value)
  return tostring(value or "")
    :gsub("&", "&amp;")
    :gsub("<", "&lt;")
    :gsub(">", "&gt;")
    :gsub('"', "&quot;")
    :gsub("'", "&apos;")
end

local function is_wave_like_path(path)
  local ext = tostring(path or ""):match("%.([^%.\\/]+)$")
  ext = ext and ext:lower() or ""
  return ext == "wav" or ext == "bwf" or ext == "w64" or ext == "wave"
end

local function ensure_ixml_user_block(xml)
  xml = tostring(xml or "")
  if trim(xml) == "" or not xml:find("</BWFXML>", 1, true) then
    xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<BWFXML>\n  <USER>\n  </USER>\n</BWFXML>\n"
  elseif not xml:find("<USER>", 1, true) then
    xml = xml:gsub("</BWFXML>", "  <USER>\n  </USER>\n</BWFXML>", 1)
  end
  return xml
end

local function build_case_insensitive_xml_tag_pattern(tag_name)
  local src = tostring(tag_name or "")
  local out = {}
  for i = 1, #src do
    local ch = src:sub(i, i)
    if ch:match("%a") then
      out[#out + 1] = "[" .. ch:lower() .. ch:upper() .. "]"
    elseif ch:match("[%^%$%(%)%%%.%[%]%*%+%-%?]") then
      out[#out + 1] = "%" .. ch
    else
      out[#out + 1] = ch
    end
  end
  return table.concat(out)
end

local function set_ixml_user_field(xml, field_name, value)
  xml = ensure_ixml_user_block(xml)
  local escaped = xml_escape(value)
  local tag_pattern = build_case_insensitive_xml_tag_pattern(field_name)
  local replaced, n = xml:gsub("(<USER>)(.-)(</USER>)", function(open_tag, body, close_tag)
    -- Normalize same field written with different case variants (e.g. IxmlTrackLayout vs ixmlTrackLayout).
    local cleaned = body:gsub("<" .. tag_pattern .. ">.-</" .. tag_pattern .. ">%s*", "")
    cleaned = cleaned:gsub("%s*$", "")
    if cleaned == "" then
      cleaned = "\n"
    else
      cleaned = cleaned .. "\n"
    end
    return open_tag .. cleaned .. "    <" .. field_name .. ">" .. escaped .. "</" .. field_name .. ">\n  " .. close_tag
  end, 1)
  if n and n > 0 then
    return replaced
  end
  return xml:gsub("</USER>", "    <" .. field_name .. ">" .. escaped .. "</" .. field_name .. ">\n  </USER>", 1)
end

local function ensure_ixml_named_block(xml, block_name)
  xml = ensure_ixml_user_block(xml)
  local open_tag = "<" .. block_name .. ">"
  if not xml:find(open_tag, 1, true) then
    xml = xml:gsub("</BWFXML>", "  <" .. block_name .. ">\n  </" .. block_name .. ">\n</BWFXML>", 1)
  end
  return xml
end

local function set_ixml_named_field(xml, block_name, field_name, value)
  xml = ensure_ixml_named_block(xml, block_name)
  local escaped = xml_escape(value)
  local pattern = "(<" .. block_name .. ">.-)<" .. field_name .. ">.-</" .. field_name .. ">(.-</" .. block_name .. ">)"
  local replaced, n = xml:gsub(pattern, function(before, after)
    return before .. "<" .. field_name .. ">" .. escaped .. "</" .. field_name .. ">" .. after
  end, 1)
  if n and n > 0 then
    return replaced
  end
  return xml:gsub("</" .. block_name .. ">", "    <" .. field_name .. ">" .. escaped .. "</" .. field_name .. ">\n  </" .. block_name .. ">", 1)
end

local function set_ixml_root_field(xml, field_name, value)
  xml = ensure_ixml_user_block(xml)
  local escaped = xml_escape(value)
  local tag_pattern = build_case_insensitive_xml_tag_pattern(field_name)
  local replaced, n = xml:gsub("(<BWFXML>)(.-)(</BWFXML>)", function(open_tag, body, close_tag)
    body = body:gsub("%s*<" .. tag_pattern .. ">.-</" .. tag_pattern .. ">%s*", "\n")
    body = body:gsub("%s*$", "")
    local line = "  <" .. field_name .. ">" .. escaped .. "</" .. field_name .. ">"
    if body == "" then
      return open_tag .. "\n" .. line .. "\n" .. close_tag
    end
    return open_tag .. body .. "\n" .. line .. "\n" .. close_tag
  end, 1)
  if n and n > 0 then
    return replaced
  end
  return xml:gsub("</BWFXML>", "  <" .. field_name .. ">" .. escaped .. "</" .. field_name .. ">\n</BWFXML>", 1)
end

local function split_ixml_layout_tokens(layout_text)
  local tokens = {}
  for token in tostring(layout_text or ""):gmatch("[^,/%s]+") do
    tokens[#tokens + 1] = token
  end
  return tokens
end

local function set_ixml_track_list(xml, ixml_layout)
  xml = ensure_ixml_user_block(xml)
  local tokens = split_ixml_layout_tokens(ixml_layout)
  if #tokens == 0 then
    return xml, 0
  end

  local lines = { "  <TRACK_LIST>" }
  for i, token in ipairs(tokens) do
    lines[#lines + 1] = "    <TRACK>"
    lines[#lines + 1] = "      <CHANNEL_INDEX>" .. tostring(i) .. "</CHANNEL_INDEX>"
    lines[#lines + 1] = "      <INTERLEAVE_INDEX>" .. tostring(i) .. "</INTERLEAVE_INDEX>"
    lines[#lines + 1] = "      <NAME>" .. xml_escape(token) .. "</NAME>"
    lines[#lines + 1] = "    </TRACK>"
  end
  lines[#lines + 1] = "  </TRACK_LIST>"
  local block = table.concat(lines, "\n")

  local replaced, n = xml:gsub("(<BWFXML>)(.-)(</BWFXML>)", function(open_tag, body, close_tag)
    body = body:gsub("%s*<TRACK_LIST>.-</TRACK_LIST>%s*", "\n")
    body = body:gsub("%s*$", "")
    if body == "" then
      return open_tag .. "\n" .. block .. "\n" .. close_tag
    end
    return open_tag .. body .. "\n" .. block .. "\n" .. close_tag
  end, 1)
  if n and n > 0 then
    return replaced, #tokens
  end
  return xml:gsub("</BWFXML>", block .. "\n</BWFXML>", 1), #tokens
end

local function get_render_targets()
  local _, targets = r.GetSetProjectInfo_String(0, "RENDER_TARGETS", "", false)
  local list = {}
  for raw_target in tostring(targets or ""):gmatch("[^;\r\n]+") do
    local target = trim(raw_target)
    target = target:gsub('^"(.*)"$', "%1")
    if target ~= "" then
      list[#list + 1] = target
    end
  end
  return list
end

local function resolve_bwfmetaedit_path()
  if path_exists(BWF_METAEDIT_PATH) then
    return BWF_METAEDIT_PATH
  end
  local p = io.popen("command -v bwfmetaedit 2>/dev/null")
  if not p then
    return ""
  end
  local detected = trim(p:read("*a") or "")
  p:close()
  if detected ~= "" and path_exists(detected) then
    return detected
  end
  return ""
end

local function read_xml_tag_value(xml, tag_name)
  local value = tostring(xml or ""):match("<" .. tostring(tag_name or "") .. ">(.-)</" .. tostring(tag_name or "") .. ">")
  if value == nil then
    return nil
  end
  return trim(value)
end

local function patch_file_ixml_layout(path, ixml_layout, channel_layout)
  if trim(ixml_layout) == "" and trim(channel_layout) == "" then
    return false, "no layout value"
  end
  local bwfmetaedit_path = resolve_bwfmetaedit_path()
  if bwfmetaedit_path == "" then
    return false, "bwfmetaedit not found (checked " .. BWF_METAEDIT_PATH .. " and PATH)"
  end
  if not path_exists(path) then
    return false, "render target missing: " .. tostring(path)
  end
  if not is_wave_like_path(path) then
    return false, "not a WAV/BWF target: " .. tostring(path)
  end

  local tmp_in = make_temp_xml_path()
  local tmp_out = make_temp_xml_path()
  local out_cmd = shell_quote(bwfmetaedit_path) ..
    " --out-iXML=" .. shell_quote(tmp_in) ..
    " " .. shell_quote(path) .. " >/dev/null 2>&1"
  command_succeeded(out_cmd)

  local xml = ensure_ixml_user_block(read_text_file(tmp_in) or "")
  local track_count = 0
  if trim(ixml_layout) ~= "" then
    xml = set_ixml_user_field(xml, "ixmlTrackLayout", ixml_layout)
    xml = set_ixml_root_field(xml, "TRACK_LAYOUT", ixml_layout)
    xml, track_count = set_ixml_track_list(xml, ixml_layout)
  end
  if trim(channel_layout) ~= "" then
    xml = set_ixml_user_field(xml, "ChannelLayout", channel_layout)
    xml = set_ixml_named_field(xml, "ASWG", "channelConfig", channel_layout)
    xml = set_ixml_named_field(xml, "ASWG", "channelLayout", channel_layout)
    xml = set_ixml_named_field(xml, "ASWG", "channelLayoutText", channel_layout)
  end
  if track_count > 0 then
    xml = set_ixml_root_field(xml, "TRACK_COUNT", tostring(track_count))
  end

  if not write_text_file(tmp_out, xml) then
    os.remove(tmp_in)
    return false, "could not write temporary iXML file"
  end

  local in_cmd = shell_quote(bwfmetaedit_path) ..
    " --in-iXML=" .. shell_quote(tmp_out) ..
    " " .. shell_quote(path) .. " >/dev/null 2>&1"
  local ok, err = command_succeeded(in_cmd)
  os.remove(tmp_in)
  os.remove(tmp_out)
  if not ok then
    return false, "bwfmetaedit failed: " .. tostring(err or "")
  end

  -- Verify write result by reading iXML back from the rendered file.
  local tmp_verify = make_temp_xml_path()
  local verify_cmd = shell_quote(bwfmetaedit_path) ..
    " --out-iXML=" .. shell_quote(tmp_verify) ..
    " " .. shell_quote(path) .. " >/dev/null 2>&1"
  local verify_ok, verify_err = command_succeeded(verify_cmd)
  if not verify_ok then
    os.remove(tmp_verify)
    return false, "bwfmetaedit verification read failed: " .. tostring(verify_err or "")
  end
  local verify_xml = read_text_file(tmp_verify) or ""
  os.remove(tmp_verify)

  if trim(ixml_layout) ~= "" then
    local got_ixml = read_xml_tag_value(verify_xml, "ixmlTrackLayout") or ""
    if got_ixml ~= trim(ixml_layout) then
      return false, "verify mismatch ixmlTrackLayout (expected '" .. trim(ixml_layout) .. "' got '" .. tostring(got_ixml or "") .. "')"
    end
  end
  if trim(channel_layout) ~= "" then
    local got_channel = read_xml_tag_value(verify_xml, "ChannelLayout") or ""
    if got_channel ~= trim(channel_layout) then
      return false, "verify mismatch ChannelLayout (expected '" .. trim(channel_layout) .. "' got '" .. tostring(got_channel or "") .. "')"
    end
  end
  return true, nil
end

local function patch_render_targets_ixml_layout(targets, ixml_layout, channel_layout)
  local patched = 0
  local skipped = 0
  local messages = {}
  if not targets or #targets == 0 then
    return 0, 1, { "RENDER_TARGETS was empty after render" }
  end
  for _, target in ipairs(targets or {}) do
    local ok, err = patch_file_ixml_layout(target, ixml_layout, channel_layout)
    if ok then
      patched = patched + 1
    else
      skipped = skipped + 1
      if err and #messages < 5 then
        messages[#messages + 1] = tostring(target) .. " -> " .. err
      end
    end
  end
  return patched, skipped, messages
end

local function read_u16_le(data, pos)
  local b1, b2 = data:byte(pos, pos + 1)
  if not b2 then return nil end
  return b1 + (b2 * 256)
end

local function read_u32_le(data, pos)
  local b1, b2, b3, b4 = data:byte(pos, pos + 3)
  if not b4 then return nil end
  return b1 + (b2 * 256) + (b3 * 65536) + (b4 * 16777216)
end

local function write_u16_le(value)
  local v = math.max(0, math.floor(tonumber(value) or 0))
  local b1 = v % 256
  local b2 = math.floor(v / 256) % 256
  return string.char(b1, b2)
end

local function write_u32_le(value)
  local v = math.max(0, math.floor(tonumber(value) or 0))
  local b1 = v % 256
  local b2 = math.floor(v / 256) % 256
  local b3 = math.floor(v / 65536) % 256
  local b4 = math.floor(v / 16777216) % 256
  return string.char(b1, b2, b3, b4)
end

local function popcount32(value)
  local x = math.max(0, math.floor(tonumber(value) or 0))
  local n = 0
  while x > 0 do
    if (x % 2) == 1 then
      n = n + 1
    end
    x = math.floor(x / 2)
  end
  return n
end

local CHANNEL_MASK_BY_TOKEN = {
  L = 0x1,
  FL = 0x1,
  R = 0x2,
  FR = 0x2,
  C = 0x4,
  FC = 0x4,
  M = 0x4,
  LFE = 0x8,
  SUB = 0x8,
  BL = 0x10,
  RL = 0x10,
  BR = 0x20,
  RR = 0x20,
  FLC = 0x40,
  FRC = 0x80,
  BC = 0x100,
  SL = 0x200,
  LS = 0x200,
  SR = 0x400,
  RS = 0x400,
  TC = 0x800,
  TFL = 0x1000,
  TFC = 0x2000,
  TFR = 0x4000,
  TBL = 0x8000,
  TBC = 0x10000,
  TBR = 0x20000,
}

local DEFAULT_CHANNEL_MASK_BY_COUNT = {
  [1] = 0x4,
  [2] = 0x3,
  [3] = 0x7,
  [4] = 0x33,
  [5] = 0x37,
  [6] = 0x3F,
  [7] = 0x13F,
  [8] = 0x63F,
}

local LR_PAIR_MASK_ORDER = {
  0x1,
  0x2,
  0x10,
  0x20,
  0x200,
  0x400,
  0x1000,
  0x4000,
  0x8000,
  0x20000,
}

local function split_layout_tokens(layout_text)
  local tokens = {}
  for token in tostring(layout_text or ""):upper():gmatch("[^,/%s]+") do
    tokens[#tokens + 1] = token
  end
  return tokens
end

local function tokens_are_lr_pairs(tokens)
  if not tokens or #tokens == 0 then return false end
  for _, token in ipairs(tokens) do
    if token ~= "L" and token ~= "R" and token ~= "FL" and token ~= "FR" then
      return false
    end
  end
  return true
end

local function build_mask_from_order(channel_count, mask_order)
  local count = math.max(0, math.floor(tonumber(channel_count) or 0))
  local mask = 0
  for i = 1, math.min(count, #mask_order) do
    mask = mask | mask_order[i]
  end
  if mask == 0 then
    mask = 0x3
  end
  return mask
end

local function default_channel_mask_for_count(channel_count)
  local count = math.max(0, math.floor(tonumber(channel_count) or 0))
  local exact = DEFAULT_CHANNEL_MASK_BY_COUNT[count]
  if exact then
    return exact
  end
  return build_mask_from_order(count, LR_PAIR_MASK_ORDER)
end

local function compute_channel_mask(ixml_layout, channel_layout, channel_count)
  local count = math.max(0, math.floor(tonumber(channel_count) or 0))
  if count <= 0 then
    return 0
  end

  local source_layout = trim(channel_layout)
  if source_layout == "" then
    source_layout = trim(ixml_layout)
  end

  local tokens = split_layout_tokens(source_layout)
  if #tokens > 0 then
    if tokens_are_lr_pairs(tokens) then
      -- Repeated L/R tokens are ambiguous (e.g. L,R,L,R...). Use a standard mask by channel count.
      return default_channel_mask_for_count(count)
    end

    local mask = 0
    for _, token in ipairs(tokens) do
      local bit = CHANNEL_MASK_BY_TOKEN[token]
      if bit then
        mask = mask | bit
      end
    end

    if mask ~= 0 then
      -- If repeated/ambiguous tokens under-specify channels, prefer deterministic count-based fallback.
      if popcount32(mask) < math.min(count, 8) then
        return default_channel_mask_for_count(count)
      end
      return mask
    end
  end

  return default_channel_mask_for_count(count)
end

local function is_riff_wave_path(path)
  local ext = tostring(path or ""):match("%.([^%.\\/]+)$")
  ext = ext and ext:lower() or ""
  return ext == "wav" or ext == "bwf" or ext == "wave"
end

local function parse_wave_fmt_info(data)
  if not data or #data < 44 then
    return nil, "could not read WAV file"
  end

  local riff_id = data:sub(1, 4)
  if riff_id ~= "RIFF" and riff_id ~= "RF64" then
    return nil, "not a RIFF/RF64 WAVE file"
  end
  if data:sub(9, 12) ~= "WAVE" then
    return nil, "not a WAVE file"
  end

  local pos = 13
  while pos + 7 <= #data do
    local chunk_id = data:sub(pos, pos + 3)
    local chunk_size = read_u32_le(data, pos + 4)
    if not chunk_size then
      break
    end

    local chunk_data_pos = pos + 8
    if chunk_size < 0 or chunk_data_pos > (#data + 1) then
      break
    end

    if chunk_id == "fmt " then
      if chunk_data_pos + chunk_size - 1 > #data then
        return nil, "fmt chunk is truncated"
      end
      if chunk_size < 16 then
        return nil, "fmt chunk is too small"
      end

      local format_tag = read_u16_le(data, chunk_data_pos)
      local channel_count = read_u16_le(data, chunk_data_pos + 2)
      local sample_rate = read_u32_le(data, chunk_data_pos + 4)
      local byte_rate = read_u32_le(data, chunk_data_pos + 8)
      local block_align = read_u16_le(data, chunk_data_pos + 12)
      local bits_per_sample = read_u16_le(data, chunk_data_pos + 14)

      if not format_tag or not channel_count or not sample_rate or not byte_rate or not block_align or not bits_per_sample then
        return nil, "could not parse fmt header"
      end

      return {
        riff_id = riff_id,
        fmt_chunk_pos = pos,
        fmt_data_pos = chunk_data_pos,
        fmt_size = chunk_size,
        format_tag = format_tag,
        channel_count = channel_count,
        sample_rate = sample_rate,
        byte_rate = byte_rate,
        block_align = block_align,
        bits_per_sample = bits_per_sample,
      }, nil
    end

    local advance = 8 + chunk_size + (chunk_size % 2)
    if advance <= 0 then
      break
    end
    pos = pos + advance
  end

  return nil, "fmt chunk not found"
end

local function subtype_guid_for_format_tag(format_tag)
  local subtype_tag = (format_tag == 3) and 3 or 1
  return write_u32_le(subtype_tag) ..
    write_u16_le(0x0000) ..
    write_u16_le(0x0010) ..
    string.char(0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71)
end

local function build_extensible_fmt_payload(info, desired_mask)
  local channels = math.max(1, math.floor(tonumber(info.channel_count) or 1))
  local bits = math.max(1, math.floor(tonumber(info.bits_per_sample) or 16))
  local valid_bits = bits
  local block_align = math.max(0, math.floor(tonumber(info.block_align) or 0))
  if block_align <= 0 then
    block_align = math.max(1, math.floor((channels * bits + 7) / 8))
  end
  local byte_rate = math.max(0, math.floor(tonumber(info.byte_rate) or 0))
  if byte_rate <= 0 then
    byte_rate = math.max(1, math.floor(tonumber(info.sample_rate) or 0) * block_align)
  end
  return write_u16_le(0xFFFE) ..
    write_u16_le(channels) ..
    write_u32_le(info.sample_rate) ..
    write_u32_le(byte_rate) ..
    write_u16_le(block_align) ..
    write_u16_le(bits) ..
    write_u16_le(22) ..
    write_u16_le(valid_bits) ..
    write_u32_le(desired_mask) ..
    subtype_guid_for_format_tag(info.format_tag)
end

local function rewrite_fmt_chunk_as_extensible(data, info, desired_mask)
  if info.riff_id ~= "RIFF" then
    return nil, "non-extensible fmt on RF64 is not supported"
  end

  local old_pad = info.fmt_size % 2
  local old_chunk_end = info.fmt_chunk_pos + 8 + info.fmt_size + old_pad - 1
  if old_chunk_end > #data then
    return nil, "fmt chunk is truncated"
  end

  local new_payload = build_extensible_fmt_payload(info, desired_mask)
  local new_chunk = "fmt " .. write_u32_le(#new_payload) .. new_payload
  local rewritten = data:sub(1, info.fmt_chunk_pos - 1) .. new_chunk .. data:sub(old_chunk_end + 1)

  local old_riff_size = read_u32_le(data, 5)
  if old_riff_size then
    local delta = #rewritten - #data
    local new_riff_size = old_riff_size + delta
    if new_riff_size < 0 then
      return nil, "RIFF size underflow while rewriting fmt chunk"
    end
    rewritten = rewritten:sub(1, 4) .. write_u32_le(new_riff_size) .. rewritten:sub(9)
  end

  return rewritten, nil
end

local function patch_file_channel_mask(path, ixml_layout, channel_layout)
  if not path_exists(path) then
    return false, "render target missing: " .. tostring(path)
  end
  if not is_riff_wave_path(path) then
    return false, "channel-mask patch supports WAV/BWF only: " .. tostring(path)
  end

  local data = read_text_file(path)
  local info, parse_err = parse_wave_fmt_info(data)
  if not info then
    return false, parse_err
  end
  if info.channel_count <= 0 then
    return false, "could not parse fmt header"
  end

  local desired_mask = compute_channel_mask(ixml_layout, channel_layout, info.channel_count)
  if desired_mask == 0 then
    return false, "computed channel mask was zero"
  end

  local patched = nil
  if info.format_tag == 0xFFFE and info.fmt_size >= 40 then
    local mask_pos = info.fmt_data_pos + 20
    local current_mask = read_u32_le(data, mask_pos)
    if current_mask == nil then
      return false, "could not read current channel mask"
    end
    if current_mask == desired_mask then
      return true, nil
    end
    patched = data:sub(1, mask_pos - 1) .. write_u32_le(desired_mask) .. data:sub(mask_pos + 4)
  elseif (info.format_tag == 1 or info.format_tag == 3) and info.fmt_size >= 16 then
    local rewritten, rewrite_err = rewrite_fmt_chunk_as_extensible(data, info, desired_mask)
    if not rewritten then
      return false, rewrite_err
    end
    patched = rewritten
  else
    return false, string.format("unsupported fmt tag for channel-mask patch: 0x%X", info.format_tag)
  end

  if not write_text_file(path, patched) then
    return false, "could not write patched WAV"
  end

  local verify = read_text_file(path)
  local verify_info, verify_parse_err = parse_wave_fmt_info(verify)
  if not verify_info then
    return false, "verify parse failed: " .. tostring(verify_parse_err or "")
  end
  if verify_info.format_tag ~= 0xFFFE or verify_info.fmt_size < 40 then
    return false, "verify failed: file is not WAVE_FORMAT_EXTENSIBLE"
  end
  local verify_mask = read_u32_le(verify, verify_info.fmt_data_pos + 20)
  if verify_mask ~= desired_mask then
    return false, string.format("verify mismatch channel mask (expected 0x%X got 0x%X)", desired_mask, tonumber(verify_mask or 0))
  end
  return true, nil
end

local function patch_render_targets_channel_mask(targets, ixml_layout, channel_layout)
  local patched = 0
  local skipped = 0
  local messages = {}
  if not targets or #targets == 0 then
    return 0, 1, { "RENDER_TARGETS was empty after render" }
  end
  for _, target in ipairs(targets or {}) do
    local ok, err = patch_file_channel_mask(target, ixml_layout, channel_layout)
    if ok then
      patched = patched + 1
    else
      skipped = skipped + 1
      if err and #messages < 5 then
        messages[#messages + 1] = tostring(target) .. " -> " .. err
      end
    end
  end
  return patched, skipped, messages
end

--------------------------------------------------------
-- META marker RecType/Microphone/ixmlTrackLayout/ChannelLayout updater
--------------------------------------------------------
local function get_last_word(str)
  if not str then return nil end
  return str:match("(%S+)%s*$")
end

local function parse_track_name_for_meta(name)
  local n = trim(name or "")
  if n == "" then
    return "", ""
  end

  -- Preferred format: MIC_RECTYPE
  local mic, rectype = n:match("^([^_]+)_(.+)$")
  if mic and rectype then
    return trim(mic), trim(rectype)
  end

  -- Fallback format: MIC-RECTYPE
  mic, rectype = n:match("^([^-]+)%-(.+)$")
  if mic and rectype then
    return trim(mic), trim(rectype)
  end

  -- Final fallback: keep full name as RecType, first token as microphone.
  return (trim(get_last_word(n) or n)), n
end

local function find_meta_marker_after(pos)
  local num_markers, num_regions = r.CountProjectMarkers(0)
  local total = num_markers + num_regions

  for i = 0, total - 1 do
    local _, isrgn, mpos, _, name, marker_id = r.EnumProjectMarkers(i)
    if not isrgn
      and name
      and name ~= "META"
      and name:find("RecType=", 1, true)
      and mpos > pos
    then
      return marker_id, mpos, name
    end
  end
end

local function replace_rectype(meta, rectype)
  return meta:gsub("RecType=[^;]*", "RecType=" .. rectype)
end

local function replace_or_append_meta_field(meta, field_name, value)
  local pattern = field_name:gsub("([^%w])", "%%%1") .. "=[^;]*"
  local replacement = field_name .. "=" .. tostring(value or "")
  if meta:find(field_name .. "=", 1, true) then
    return meta:gsub(pattern, replacement)
  end
  return meta .. ";" .. replacement
end

local function layout_for_rectype(rectype)
  local key = trim(rectype):upper()
  if key == "" then
    return ""
  end

  local candidates = {}
  local seen = {}
  local function add_candidate(candidate)
    if candidate ~= "" and not seen[candidate] then
      seen[candidate] = true
      candidates[#candidates + 1] = candidate
    end
  end

  add_candidate(key)
  add_candidate(key:gsub("%s+", ""))
  add_candidate(key:gsub("[%s_]+", "-"))
  add_candidate(key:gsub("[%s%-]+", "_"))
  add_candidate(key:gsub("[^%w%.]+", ""))

  for _, candidate in ipairs(candidates) do
    local layout = IXML_TRACK_LAYOUT_BY_RECTYPE[candidate]
    if layout and layout ~= "" then
      return layout
    end
  end
  return ""
end

local function build_default_layout_tokens(channel_count)
  local count = math.floor(tonumber(channel_count) or 0)
  local tokens = {}
  if count <= 0 then
    return tokens
  end
  if count == 1 then
    tokens[1] = "M"
    return tokens
  end
  for i = 1, count do
    tokens[#tokens + 1] = (i % 2 == 1) and "L" or "R"
  end
  return tokens
end

local function split_layout_labels(layout_text, preserve_case)
  local tokens = {}
  local normalized = tostring(layout_text or "")
  -- Normalize labels like "L (1)"/"R(2)" to plain L/R tokens.
  normalized = normalized:gsub("([%a][%w]*)%s*%(%d+%)", "%1")
  for raw_token in normalized:gmatch("[^,/%s]+") do
    local token = trim(raw_token)
    if not preserve_case then
      token = token:upper()
    end
    if token ~= "" and not token:match("^%(?%d+%)?$") then
      tokens[#tokens + 1] = token
    end
  end
  return tokens
end

local function map_entry_count(map)
  local n = 0
  for _ in pairs(map or {}) do
    n = n + 1
  end
  return n
end

local function serialize_rectype_layout_map(map)
  local lines = {
    "# RecType short code to layout map",
    "# Format: SHORT=Token,Token,Token",
    "# You may also use spaces or / as separators in layout values.",
  }

  local emitted = {}
  for _, group in ipairs(RECTYPE_LAYOUT_DISPLAY_GROUPS) do
    lines[#lines + 1] = ""
    lines[#lines + 1] = "# " .. tostring(group.title)
    for _, key in ipairs(group.keys or {}) do
      local value = map and map[key] or nil
      if value and tostring(value) ~= "" then
        lines[#lines + 1] = key .. "=" .. tostring(value)
        emitted[key] = true
      end
    end
  end

  local extras = {}
  for key in pairs(map or {}) do
    if not emitted[key] then
      extras[#extras + 1] = tostring(key)
    end
  end
  table.sort(extras)

  if #extras > 0 then
    lines[#lines + 1] = ""
    lines[#lines + 1] = "# EXTRA (custom/legacy)"
    for _, key in ipairs(extras) do
      lines[#lines + 1] = key .. "=" .. tostring(map[key] or "")
    end
  end

  return table.concat(lines, "\n")
end

local function parse_rectype_layout_map_text(text)
  local map = {}
  local invalid_lines = {}
  local line_no = 0
  for raw_line in tostring(text or ""):gmatch("[^\r\n]+") do
    line_no = line_no + 1
    local line = trim(raw_line)
    if line ~= ""
      and line:sub(1, 1) ~= "#"
      and line:sub(1, 1) ~= ";"
      and line:sub(1, 2) ~= "//"
      and line:sub(1, 2) ~= "--"
    then
      local key, value = line:match("^([^=:%s]+)%s*[:=]%s*(.+)$")
      if not key then
        key, value = line:match("^([^%s]+)%s+(.+)$")
      end

      if key and value and trim(value) ~= "" then
        key = trim(key):upper():gsub("%s+", "")
        local tokens = split_layout_labels(value, true)
        if key ~= "" and #tokens > 0 then
          map[key] = table.concat(tokens, ",")
        else
          invalid_lines[#invalid_lines + 1] = tostring(line_no)
        end
      else
        invalid_lines[#invalid_lines + 1] = tostring(line_no)
      end
    end
  end
  return map, invalid_lines
end

local function apply_rectype_layout_map_text(text, persist)
  local parsed, invalid_lines = parse_rectype_layout_map_text(text)
  local count = map_entry_count(parsed)
  if count <= 0 then
    return false, "No valid RecType layout mappings found. Use SHORT=L,R format."
  end

  local forced_keys = {}
  for key, value in pairs(REQUIRED_CASE_LAYOUT_BY_RECTYPE) do
    if parsed[key] ~= value then
      parsed[key] = value
      forced_keys[#forced_keys + 1] = key
    end
  end
  table.sort(forced_keys)
  count = map_entry_count(parsed)

  local canonical_text = serialize_rectype_layout_map(parsed)

  IXML_TRACK_LAYOUT_BY_RECTYPE = parsed
  state.rectype_layout_text = canonical_text
  if persist then
    set_ext_text(RECTYPE_LAYOUT_EXT_KEY, canonical_text)
  end

  local msg = string.format("RecType layout map loaded: %d entries.", count)
  if #invalid_lines > 0 then
    msg = msg .. " Ignored invalid lines: " .. table.concat(invalid_lines, ", ")
  end
  if #forced_keys > 0 then
    msg = msg .. " Enforced exact case-sensitive layouts for: " .. table.concat(forced_keys, ", ")
  end
  return true, msg
end

local function initialize_rectype_layout_map()
  local default_text = serialize_rectype_layout_map(DEFAULT_IXML_TRACK_LAYOUT_BY_RECTYPE)
  local saved_text = get_ext_text(RECTYPE_LAYOUT_EXT_KEY, "")
  if trim(saved_text) == "" then
    local _, msg = apply_rectype_layout_map_text(default_text, false)
    state.rectype_layout_edit_text = state.rectype_layout_text
    state.rectype_layout_status = msg
    return
  end

  local ok, msg = apply_rectype_layout_map_text(saved_text, false)
  if ok then
    state.rectype_layout_edit_text = state.rectype_layout_text
    state.rectype_layout_status = msg
    return
  end

  local _, fallback_msg = apply_rectype_layout_map_text(default_text, true)
  state.rectype_layout_edit_text = state.rectype_layout_text
  state.rectype_layout_status = "Saved RecType layout map was invalid, defaults restored. " .. tostring(fallback_msg or "")
end

local function tokens_are_anonymous_layout(tokens)
  if not tokens or #tokens == 0 then
    return false
  end
  for _, token in ipairs(tokens) do
    if not tostring(token):upper():match("^A%d+$") then
      return false
    end
  end
  return true
end

local function normalize_child_layout(ixml_layout, channel_layout, channel_count, keep_anonymous_tokens)
  local tokens = split_layout_labels(ixml_layout, true)
  if #tokens == 0 then
    tokens = split_layout_labels(channel_layout, true)
  end
  if (not keep_anonymous_tokens) and tokens_are_anonymous_layout(tokens) then
    tokens = build_default_layout_tokens(#tokens)
  end
  if #tokens == 0 then
    tokens = build_default_layout_tokens(channel_count)
  end
  return table.concat(tokens, ","), table.concat(tokens, "/")
end

local function build_child_track_metadata(active_track_names, out_channels)
  local have_names = active_track_names and #active_track_names > 0

  local rectypes = {}
  local microphones = {}
  local ixml_layout_parts = {}
  if have_names then
    for _, name in ipairs(active_track_names) do
      local mic, rectype = parse_track_name_for_meta(name)
      if rectype and rectype ~= "" then
        rectypes[#rectypes + 1] = rectype
        local layout = layout_for_rectype(rectype)
        if layout ~= "" then
          ixml_layout_parts[#ixml_layout_parts + 1] = layout
        end
      end
      if mic and mic ~= "" then
        microphones[#microphones + 1] = mic
      end
    end
  end

  local rectype = table.concat(rectypes, ",")
  local miclist = table.concat(microphones, ",")
  local ixml_layout, channel_layout = normalize_child_layout(table.concat(ixml_layout_parts, ","), "", out_channels, true)

  return {
    rectype = rectype,
    miclist = miclist,
    ixml_layout = ixml_layout,
    channel_layout = channel_layout,
  }, nil
end

local function update_meta_marker_rectype_mic(item_end, active_track_names, out_channels)
  local meta, err = build_child_track_metadata(active_track_names, out_channels)
  if not meta then
    return false, err
  end
  if trim(meta.rectype) == "" then
    return false, "could not parse RecType from active child track names"
  end

  local marker_id, mpos, meta_name = find_meta_marker_after(item_end)
  if not marker_id then
    return false, "no META marker found after item"
  end

  local new_name = replace_rectype(meta_name, meta.rectype)
  new_name = replace_or_append_meta_field(new_name, "Microphone", meta.miclist)
  new_name = replace_or_append_meta_field(new_name, "ixmlTrackLayout", meta.ixml_layout)
  new_name = replace_or_append_meta_field(new_name, "ChannelLayout", meta.channel_layout)
  r.SetProjectMarker(marker_id, false, mpos, 0, new_name)
  return true, nil
end

--------------------------------------------------------
-- UCS/ASWG metadata injector
--------------------------------------------------------
local function reaper_version_ok_633()
  return (tonumber(r.GetAppVersion():match("%d+%.%d+")) or 0) >= 6.33
end

local HAVE_633 = reaper_version_ok_633()

local function get_ucs_ext(name)
  local ret, val = r.GetProjExtState(0, "UCS_WebInterface", name)
  if ret == 1 then return val end
  return ""
end

local function get_metadata_blob()
  local _, blob = r.GetSetProjectInfo_String(0, "RENDER_METADATA", "", false)
  return tostring(blob or "")
end

local function metadata_key_exists(blob, meta_key)
  for line in blob:gmatch("[^\n]+") do
    if line:sub(1, #meta_key + 1) == (meta_key .. "|") then
      return true
    end
  end
  return false
end

local function build_ucs_values()
  local vals = {}
  local function grab(field, ext_key)
    vals[field] = get_ucs_ext(ext_key)
  end

  -- Core UCS
  grab("CatID", "CatID")
  grab("Category", "Category")
  grab("SubCategory", "Subcategory")
  grab("FXName", "Name")
  grab("Notes", "Data")
  grab("Show", "Show")
  grab("UserCategory", "UserCategory")
  grab("VendorCategory", "VendorCategory")
  grab("TrackTitle", "MetaTitle")
  grab("Description", "MetaDesc")
  grab("Keywords", "MetaKeys")
  grab("Microphone", "MetaMic")
  grab("MicPerspective", "MetaPersp")
  grab("RecType", "MetaConfig")
  grab("RecMedium", "MetaRecMed")
  grab("Designer", "MetaDsgnr")
  grab("Location", "MetaLoc")
  grab("URL", "MetaURL")
  grab("Manufacturer", "MetaMftr")
  grab("Library", "MetaLib")
  grab("MetaNotes", "Notes")

  -- Layout values
  grab("ixmlTrackLayout", "TrackLayout")
  grab("ChannelLayout", "TrackLayout")

  -- Derivatives
  if vals.Category ~= "" and vals.SubCategory ~= "" then
    vals.CategoryFull = vals.Category .. "-" .. vals.SubCategory
  end

  do
    local d = vals.Designer or ""
    local short = ""
    for w in d:gmatch("%S+") do
      short = short .. w:sub(1, 3)
    end
    vals.ShortID = short
  end

  vals.LongID = vals.CatID
  vals.Source = vals.Show
  vals.Artist = vals.Designer

  -- ASWG extstate values
  local aswg_list = {
    "ASWGcontentType", "ASWGproject", "ASWGoriginatorStudio", "ASWGnotes", "ASWGstate",
    "ASWGeditor", "ASWGmixer", "ASWGfxChainName", "ASWGchannelConfig", "ASWGambisonicFormat",
    "ASWGambisonicChnOrder", "ASWGambisonicNorm", "ASWGisDesigned", "ASWGrecEngineer",
    "ASWGrecStudio", "ASWGimpulseLocation", "ASWGtext", "ASWGefforts", "ASWGeffortType",
    "ASWGprojection", "ASWGlanguage", "ASWGtimingRestriction", "ASWGcharacterName",
    "ASWGcharacterGender", "ASWGcharacterAge", "ASWGcharacterRole", "ASWGactorName",
    "ASWGactorGender", "ASWGdirection", "ASWGdirector", "ASWGfxUsed", "ASWGusageRights",
    "ASWGisUnion", "ASWGaccent", "ASWGemotion", "ASWGcomposer", "ASWGartist", "ASWGsongTitle",
    "ASWGgenre", "ASWGsubGenre", "ASWGproducer", "ASWGmusicSup", "ASWGinstrument",
    "ASWGmusicPublisher", "ASWGrightsOwner", "ASWGintensity", "ASWGorderRef", "ASWGisSource",
    "ASWGisLoop", "ASWGisFinal", "ASWGisOst", "ASWGisCinematic", "ASWGisLicensed",
    "ASWGisDiegetic", "ASWGmusicVersion", "ASWGisrcId", "ASWGtempo", "ASWGtimeSig",
    "ASWGinKey", "ASWGbillingCode"
  }
  for _, f in ipairs(aswg_list) do
    vals[f] = get_ucs_ext(f)
  end

  return vals
end

local function build_ucs_map()
  local map = {
    -- IXML USER
    ["IXML:USER:CatID"] = "CatID",
    ["IXML:USER:Category"] = "Category",
    ["IXML:USER:SubCategory"] = "SubCategory",
    ["IXML:USER:CategoryFull"] = "CategoryFull",
    ["IXML:USER:FXName"] = "FXName",
    ["IXML:USER:Notes"] = "Notes",
    ["IXML:USER:Show"] = "Show",
    ["IXML:USER:UserCategory"] = "UserCategory",
    ["IXML:USER:VendorCategory"] = "VendorCategory",
    ["IXML:USER:TrackTitle"] = "TrackTitle",
    ["IXML:USER:Description"] = "Description",
    ["IXML:USER:ChannelLayout"] = "ChannelLayout",
    ["IXML:USER:ixmlTrackLayout"] = "ixmlTrackLayout",

    -- iXML layouts
    ["IXML:TRACK_LAYOUT"] = "ixmlTrackLayout",
    ["IXML:ChannelLayout"] = "ChannelLayout",

    -- Other formats
    ["IXML:BEXT:BWF_DESCRIPTION"] = "Description",
    ["USER:ChannelLayout"] = "ChannelLayout",
    ["BWF:Description"] = "Description",
    ["BWF:ChannelLayout"] = "ChannelLayout",
    ["CAFINFO:channel layout"] = "ChannelLayout",
    ["BWF:Originator"] = "Designer",
    ["BWF:OriginatorReference"] = "URL",

    -- REAPER's exact writable row for Technical > Channel Layout Text.
    -- The ASWG/WAVEXT entries below are extra compatibility attempts.
    ["ASWG:channelConfig"] = "ChannelLayout",
    ["ASWG:channelLayout"] = "ChannelLayout",
    ["ASWG:channelLayoutText"] = "ChannelLayout",
    ["WAVEXT:channel configuration"] = "ChannelLayout",

    ["ID3:TIT2"] = "TrackTitle",
    ["ID3:COMM"] = "Description",
    ["ID3:TPE1"] = "Designer",
    ["ID3:TPE2"] = "Show",
    ["ID3:TCON"] = "Category",
    ["ID3:TALB"] = "Library",

    ["INFO:ICMT"] = "Description",
    ["INFO:IART"] = "Designer",
    ["INFO:IGNR"] = "Category",
    ["INFO:INAM"] = "TrackTitle",
    ["INFO:IPRD"] = "Library",

    ["ASWG:session"] = "ASWGsession",
  }

  for k, v in pairs({ channelConfig = "ChannelLayout" }) do
    map["ASWG:" .. k] = v
  end

  return map
end

local function apply_single_ucs_metadata(meta_key, field_name, literal, opts)
  local value = ""
  if field_name == "ReleaseDate" then
    value = "$date"
  elseif field_name == "Embedder" then
    value = UCS_EMBEDDER_NAME
  elseif field_name == "ASWGsession" then
    value = "$project"
  elseif opts.direct_values then
    value = literal or ""
  else
    local suffix = HAVE_633 and "[;]" or ""
    value = "$marker(" .. field_name .. ")" .. suffix
  end

  set_render_metadata(meta_key, value)
end

local function inject_ucs_render_metadata(opts)
  local values = build_ucs_values()
  local map = build_ucs_map()
  local applied = 0
  local skipped = 0
  local blob = get_metadata_blob()

  for meta_key, field_name in pairs(map) do
    local force_overwrite = FORCE_OVERWRITE_METADATA_KEYS[meta_key] == true
    if (not force_overwrite) and (not opts.always_overwrite) and metadata_key_exists(blob, meta_key) then
      skipped = skipped + 1
    else
      apply_single_ucs_metadata(meta_key, field_name, values[field_name], opts)
      applied = applied + 1
      blob = blob .. "\n" .. meta_key .. "|"
    end
  end

  return applied, skipped
end

local function build_selection_info()
  local gathered, err = collect_selected_items()
  if not gathered then
    return {
      ok = false,
      message = err,
      selected_count = 0,
      image_count = 0,
      non_image_count = 0,
      child_count = 0,
      parent_name = "(none)",
      folder_depth = 0,
      selected_item_tail_enabled = false,
      selected_item_tail_ms = 0,
      render_source_is_selected_items_via_master = false,
    }
  end

  local parent = gathered.parent
  local child_tracks = collect_child_tracks(parent)
  local folder_depth = r.GetMediaTrackInfo_Value(parent, "I_FOLDERDEPTH")
  local render_tailflag = math.floor(r.GetSetProjectInfo(0, "RENDER_TAILFLAG", 0, false))
  local render_tailms = r.GetSetProjectInfo(0, "RENDER_TAILMS", 0, false)
  local render_settings = math.floor(r.GetSetProjectInfo(0, "RENDER_SETTINGS", 0, false))

  return {
    ok = true,
    message = "",
    selected_count = gathered.total_count,
    image_count = gathered.image_count,
    non_image_count = gathered.non_image_count,
    child_count = #child_tracks,
    parent_name = get_track_name(parent),
    folder_depth = folder_depth,
    selected_item_tail_enabled = (render_tailflag & RENDER_TAIL_SELECTED_ITEMS) ~= 0 and (render_tailms or 0) > 0,
    selected_item_tail_ms = render_tailms or 0,
    render_source_is_selected_items_via_master = (render_settings & RENDER_SOURCE_SELECTED_ITEMS_VIA_MASTER) ~= 0,
  }
end

local function set_status(msg)
  state.status_line = msg or ""
end

local function run_batch_render()
  local gathered, err = collect_selected_items()
  if not gathered then
    return false, err
  end

  local parent = gathered.parent
  if not parent then
    return false, "Could not resolve the parent track from the selected items."
  end

  local items = {}
  for _, item in ipairs(gathered.items) do
    items[#items + 1] = item
  end

  if state.sort_by_time then
    sort_items_by_position(items)
  end

  local child_tracks = collect_child_tracks(parent)
  if #child_tracks == 0 then
    return false, "No child tracks were found under the selected parent track."
  end

  local original_selected_items = capture_selected_items()
  local render_snap = snapshot_render_state(parent)
  local render_apply_snap = render_snap
  local cover_meta_snap = snapshot_cover_metadata()
  local forced_channel_layout_snap = snapshot_forced_channel_layout_metadata()
  local layout_visibility_snap = snapshot_layout_visibility_metadata()

  local tracks_to_restore = { parent }
  for _, tr in ipairs(child_tracks) do
    tracks_to_restore[#tracks_to_restore + 1] = tr
  end
  local track_snapshots = capture_track_chunks(tracks_to_restore)

  local rendered = 0
  local rendered_with_cover = 0
  local rendered_without_cover = 0
  local skipped = {}
  local warning_lines = {}
  local meta_markers_updated = 0
  local meta_markers_skipped = 0
  local post_ixml_patched = 0
  local post_ixml_skipped = 0
  local post_ixml_warnings = {}
  local post_mask_patched = 0
  local post_mask_skipped = 0
  local post_mask_warnings = {}
  local forced_layout_applied = 0
  local forced_layout_skipped = 0
  local forced_layout_warnings = {}
  local layout_visibility_applied = 0
  local layout_visibility_skipped = 0
  local layout_visibility_warnings = {}
  local url_trackinfo_applied = 0
  local url_trackinfo_skipped = 0
  local url_trackinfo_warnings = {}
  local sample_rate_matched = 0
  local sample_rate_fallbacks = 0
  local sample_rate_mixed = 0
  local sample_rate_warnings = {}
  local sample_rate_values = {}
  local profile_applied = false
  local profile_mode_name = render_profile_mode_label(state.render_profile_mode)
  local forced_filename_pattern = trim(state.render_filename_pattern)
  if forced_filename_pattern == "" then
    forced_filename_pattern = DEFAULT_RENDER_FILENAME_PATTERN
    state.render_filename_pattern = forced_filename_pattern
    set_ext_text("render_filename_pattern", forced_filename_pattern)
  end
  local ucs_applied = 0
  local ucs_skipped = 0
  local mode_name = (state.render_mode == RENDER_MODE_STEREO) and "Stereo mix (child tracks)" or "POLY WAV (multichannel)"
  local folder_depth = r.GetMediaTrackInfo_Value(parent, "I_FOLDERDEPTH")
  if folder_depth <= 0 then
    warning_lines[#warning_lines + 1] = "Parent track is not a folder track. The script still ran, but folder routing was assumed."
  end
  if gathered.non_image_count > 0 then
    warning_lines[#warning_lines + 1] = string.format(
      "%d of %d selected items do not point to valid image files. They will render without embedded cover art.",
      gathered.non_image_count,
      gathered.total_count
    )
  end

  r.Undo_BeginBlock()
  r.PreventUIRefresh(1)

  if state.apply_render_profile then
    if state.render_profile then
      local ok_profile, profile_err = apply_render_profile_settings(state.render_profile, state.render_profile_mode)
      if ok_profile then
        profile_applied = true
        render_apply_snap = snapshot_render_state(parent)
      else
        warning_lines[#warning_lines + 1] = "Captured render profile apply failed: " .. tostring(profile_err or "")
      end
    else
      warning_lines[#warning_lines + 1] = "Captured render profile apply is enabled, but no profile has been captured yet."
    end
  end

  if state.enforce_render_filename_pattern and forced_filename_pattern ~= "" then
    set_project_render_string("RENDER_PATTERN", forced_filename_pattern)
    render_apply_snap = snapshot_render_state(parent)
  end

  if state.inject_ucs_metadata then
    ucs_applied, ucs_skipped = inject_ucs_render_metadata({
      direct_values = UCS_DIRECT_VALUES,
      always_overwrite = UCS_ALWAYS_OVERWRITE,
    })
  end

  local ok, result_or_err = xpcall(function()
    for _, poly_item in ipairs(items) do
      local image_path = get_item_image_path(poly_item)
      clear_sends(parent)

      local pos = r.GetMediaItemInfo_Value(poly_item, "D_POSITION")
      local endt = pos + r.GetMediaItemInfo_Value(poly_item, "D_LENGTH")
      local dst = 0
      local active_sources = 0
      local active_track_names = {}
      local active_sample_rates = {}

      for _, tr in ipairs(child_tracks) do
        clear_sends(tr)
        r.SetMediaTrackInfo_Value(tr, "B_MAINSEND", 0)

        local it = get_overlapping_item(tr, pos, endt)
        if it then
          local _, tr_name = r.GetTrackName(tr)
          tr_name = trim(tr_name)
          if tr_name ~= "" then
            active_track_names[#active_track_names + 1] = tr_name
          end
          if state.match_child_sample_rate then
            local child_sample_rate = get_item_source_sample_rate(it)
            if child_sample_rate then
              active_sample_rates[#active_sample_rates + 1] = {
                sample_rate = child_sample_rate,
                track_name = (tr_name ~= "") and tr_name or get_track_name(tr),
              }
            end
          end

          if state.render_mode == RENDER_MODE_STEREO then
            ensure_track_channels(tr, 2)
            local send = r.CreateTrackSend(tr, parent)
            r.SetTrackSendInfo_Value(tr, 0, send, "I_SRCCHAN", 0)
            r.SetTrackSendInfo_Value(tr, 0, send, "I_DSTCHAN", 0)
            active_sources = active_sources + 1
          else
            local ch = get_take_output_channels(it)
            ensure_track_channels(tr, ch)

            local send = r.CreateTrackSend(tr, parent)
            if ch == 1 then
              r.SetTrackSendInfo_Value(tr, 0, send, "I_SRCCHAN", 1024)
              r.SetTrackSendInfo_Value(tr, 0, send, "I_DSTCHAN", 1024 + dst)
              dst = dst + 1
            else
              r.SetTrackSendInfo_Value(tr, 0, send, "I_SRCCHAN", 0)
              r.SetTrackSendInfo_Value(tr, 0, send, "I_DSTCHAN", dst)
              dst = dst + 2
            end
          end
        end
      end

      local out_channels = 0
      if state.render_mode == RENDER_MODE_STEREO then
        if active_sources > 0 then out_channels = 2 end
      else
        out_channels = dst
      end

      if out_channels > 0 then
        local render_sample_rate = nil
        if state.match_child_sample_rate then
          local unique_sample_rates = nil
          render_sample_rate, unique_sample_rates = summarize_child_sample_rates(active_sample_rates)
          if render_sample_rate then
            sample_rate_matched = sample_rate_matched + 1
            sample_rate_values[render_sample_rate] = true
            if unique_sample_rates and #unique_sample_rates > 1 then
              sample_rate_mixed = sample_rate_mixed + 1
              if #sample_rate_warnings < 5 then
                local details = describe_sample_rate_entries(active_sample_rates)
                sample_rate_warnings[#sample_rate_warnings + 1] = string.format(
                  "%s has mixed child source sample rates; using %s. %s",
                  get_item_label(poly_item),
                  format_sample_rate(render_sample_rate),
                  details
                )
              end
            end
          else
            sample_rate_fallbacks = sample_rate_fallbacks + 1
          end
        end

        local child_meta, child_meta_err = build_child_track_metadata(active_track_names, out_channels)

        if state.force_channel_layout_render_metadata then
          local call_ok, forced_ok_or_err, forced_err = pcall(apply_forced_channel_layout_metadata, child_meta)
          if call_ok and forced_ok_or_err then
            forced_layout_applied = forced_layout_applied + 1
          else
            forced_layout_skipped = forced_layout_skipped + 1
            local warning = nil
            if not call_ok then
              warning = "Technical ChannelLayout write internal error: " .. tostring(forced_ok_or_err or "")
            else
              warning = forced_err
            end
            if warning and #forced_layout_warnings < 5 then
              forced_layout_warnings[#forced_layout_warnings + 1] = warning
            end
          end
        end

        if state.mirror_channel_layout_to_description then
          local call_ok, mirror_ok_or_err, mirror_err = pcall(apply_layout_visibility_metadata, child_meta, layout_visibility_snap)
          if call_ok and mirror_ok_or_err then
            layout_visibility_applied = layout_visibility_applied + 1
          else
            layout_visibility_skipped = layout_visibility_skipped + 1
            local warning = nil
            if not call_ok then
              warning = "Description/comment mirror internal error: " .. tostring(mirror_ok_or_err or "")
            else
              warning = mirror_err
            end
            if warning and #layout_visibility_warnings < 5 then
              layout_visibility_warnings[#layout_visibility_warnings + 1] = warning
            end
          end
        end

        if state.append_track_info_to_url then
          local call_ok, url_ok_or_err, url_err = pcall(apply_track_info_url_metadata, child_meta, out_channels, active_track_names)
          if call_ok and url_ok_or_err then
            url_trackinfo_applied = url_trackinfo_applied + 1
          else
            url_trackinfo_skipped = url_trackinfo_skipped + 1
            local warning = nil
            if not call_ok then
              warning = "URL track info internal error: " .. tostring(url_ok_or_err or "")
            else
              warning = url_err
            end
            if warning and #url_trackinfo_warnings < 5 then
              url_trackinfo_warnings[#url_trackinfo_warnings + 1] = warning
            end
          end
        end

        if state.update_meta_marker then
          local marker_ok = update_meta_marker_rectype_mic(endt, active_track_names, out_channels)
          if marker_ok then
            meta_markers_updated = meta_markers_updated + 1
          else
            meta_markers_skipped = meta_markers_skipped + 1
          end
        end

        if image_path then
          set_cover_image_metadata(image_path)
          rendered_with_cover = rendered_with_cover + 1
        else
          clear_cover_image_metadata()
          rendered_without_cover = rendered_without_cover + 1
        end

        apply_render_prefs(parent, out_channels, state.disable_tail, render_apply_snap, render_sample_rate)
        r.SelectAllMediaItems(0, false)
        r.SetMediaItemSelected(poly_item, true)
        r.Main_OnCommand(RENDER_ACTION_ID, 0)

        local render_targets = nil
        if child_meta and (state.post_write_ixml_layout or state.post_patch_channel_mask) then
          render_targets = get_render_targets()
        end

        if state.post_write_ixml_layout then
          if child_meta then
            local patched, patch_skipped, patch_messages = patch_render_targets_ixml_layout(
              render_targets,
              child_meta.ixml_layout,
              child_meta.channel_layout
            )
            post_ixml_patched = post_ixml_patched + patched
            post_ixml_skipped = post_ixml_skipped + patch_skipped
            for _, message in ipairs(patch_messages or {}) do
              if #post_ixml_warnings < 5 then
                post_ixml_warnings[#post_ixml_warnings + 1] = message
              end
            end
          else
            post_ixml_skipped = post_ixml_skipped + 1
            if child_meta_err and #post_ixml_warnings < 5 then
              post_ixml_warnings[#post_ixml_warnings + 1] = child_meta_err
            end
          end
        end

        if state.post_patch_channel_mask then
          if child_meta then
            local patched, patch_skipped, patch_messages = patch_render_targets_channel_mask(
              render_targets,
              child_meta.ixml_layout,
              child_meta.channel_layout
            )
            post_mask_patched = post_mask_patched + patched
            post_mask_skipped = post_mask_skipped + patch_skipped
            for _, message in ipairs(patch_messages or {}) do
              if #post_mask_warnings < 5 then
                post_mask_warnings[#post_mask_warnings + 1] = message
              end
            end
          else
            post_mask_skipped = post_mask_skipped + 1
            if child_meta_err and #post_mask_warnings < 5 then
              post_mask_warnings[#post_mask_warnings + 1] = child_meta_err
            end
          end
        end

        rendered = rendered + 1
      else
        skipped[#skipped + 1] = string.format("%s (no overlapping child audio found)", get_item_label(poly_item))
      end
    end

    local lines = {}
    lines[#lines + 1] = "Batch render finished."
    lines[#lines + 1] = "Parent: " .. get_track_name(parent)
    lines[#lines + 1] = "Mode: " .. mode_name
    if state.apply_render_profile then
      if profile_applied then
        lines[#lines + 1] = "Captured render profile applied: " .. profile_mode_name
      else
        lines[#lines + 1] = "Captured render profile apply: enabled (no profile applied)"
      end
    else
      lines[#lines + 1] = "Captured render profile apply: disabled"
    end
    if state.enforce_render_filename_pattern then
      lines[#lines + 1] = "Forced filename pattern: " .. forced_filename_pattern
    else
      lines[#lines + 1] = "Forced filename pattern: disabled"
    end
    lines[#lines + 1] = string.format("Selected items: %d", gathered.total_count)
    lines[#lines + 1] = string.format("Image-ready items: %d", gathered.image_count or 0)
    lines[#lines + 1] = string.format("Rendered: %d", rendered)
    lines[#lines + 1] = string.format("Rendered with cover art: %d", rendered_with_cover)
    lines[#lines + 1] = string.format("Rendered with no cover art: %d", rendered_without_cover)
    if state.match_child_sample_rate then
      lines[#lines + 1] = string.format("Child sample-rate matching applied: %d", sample_rate_matched)
      if sample_rate_matched > 0 then
        lines[#lines + 1] = "Child sample rates used: " .. format_sample_rate_set(sample_rate_values)
      end
      if sample_rate_fallbacks > 0 then
        lines[#lines + 1] = string.format("Child sample-rate fallback to render profile/project: %d", sample_rate_fallbacks)
      end
      if sample_rate_mixed > 0 then
        lines[#lines + 1] = string.format("Mixed child sample-rate renders: %d", sample_rate_mixed)
      end
      for _, message in ipairs(sample_rate_warnings) do
        lines[#lines + 1] = "Child sample-rate warning: " .. message
      end
    else
      lines[#lines + 1] = "Child sample-rate matching: disabled"
    end
    if state.inject_ucs_metadata then
      lines[#lines + 1] = string.format("UCS metadata injected: %d", ucs_applied)
      if ucs_skipped > 0 then
        lines[#lines + 1] = string.format("UCS metadata skipped (already present): %d", ucs_skipped)
      end
    else
      lines[#lines + 1] = "UCS metadata injection: disabled"
    end
    if state.update_meta_marker then
      lines[#lines + 1] = string.format("META markers updated: %d", meta_markers_updated)
      if meta_markers_skipped > 0 then
        lines[#lines + 1] = string.format("META marker updates skipped: %d", meta_markers_skipped)
      end
    else
      lines[#lines + 1] = "META marker update: disabled"
    end
    if state.post_write_ixml_layout then
      lines[#lines + 1] = string.format("Post-render iXML layout patched: %d", post_ixml_patched)
      if post_ixml_skipped > 0 then
        lines[#lines + 1] = string.format("Post-render iXML layout skipped: %d", post_ixml_skipped)
      end
      for _, message in ipairs(post_ixml_warnings) do
        lines[#lines + 1] = "Post-render iXML warning: " .. message
      end
    else
      lines[#lines + 1] = "Post-render iXML layout patch: disabled"
    end
    if state.post_patch_channel_mask then
      lines[#lines + 1] = string.format("Post-render channel-mask patched: %d", post_mask_patched)
      if post_mask_skipped > 0 then
        lines[#lines + 1] = string.format("Post-render channel-mask skipped: %d", post_mask_skipped)
      end
      for _, message in ipairs(post_mask_warnings) do
        lines[#lines + 1] = "Post-render channel-mask warning: " .. message
      end
    else
      lines[#lines + 1] = "Post-render channel-mask patch: disabled"
    end
    if state.force_channel_layout_render_metadata then
      lines[#lines + 1] = string.format("Technical ChannelLayout metadata write applied: %d", forced_layout_applied)
      if forced_layout_skipped > 0 then
        lines[#lines + 1] = string.format("Technical ChannelLayout metadata write skipped: %d", forced_layout_skipped)
      end
      for _, message in ipairs(forced_layout_warnings) do
        lines[#lines + 1] = "Technical ChannelLayout metadata warning: " .. message
      end
    else
      lines[#lines + 1] = "Technical ChannelLayout metadata write: disabled"
    end
    if state.mirror_channel_layout_to_description then
      lines[#lines + 1] = string.format("Description/comment mirror applied: %d", layout_visibility_applied)
      if layout_visibility_skipped > 0 then
        lines[#lines + 1] = string.format("Description/comment mirror skipped: %d", layout_visibility_skipped)
      end
      for _, message in ipairs(layout_visibility_warnings) do
        lines[#lines + 1] = "Description/comment mirror warning: " .. message
      end
    end
    if state.append_track_info_to_url then
      lines[#lines + 1] = string.format("URL track info appended: %d", url_trackinfo_applied)
      if url_trackinfo_skipped > 0 then
        lines[#lines + 1] = string.format("URL track info skipped: %d", url_trackinfo_skipped)
      end
      for _, message in ipairs(url_trackinfo_warnings) do
        lines[#lines + 1] = "URL track info warning: " .. message
      end
    else
      lines[#lines + 1] = "URL track info append: disabled"
    end
    if #skipped > 0 then
      lines[#lines + 1] = string.format("Skipped: %d", #skipped)
      for _, label in ipairs(skipped) do
        lines[#lines + 1] = "Skipped item: " .. label
      end
    end
    if state.disable_tail then
      lines[#lines + 1] = "Selected-item render tail was disabled for this run."
    else
      lines[#lines + 1] = "Selected-item render tail was left unchanged."
    end
    for _, line in ipairs(warning_lines) do
      lines[#lines + 1] = "Warning: " .. line
    end
    return table.concat(lines, "\n")
  end, debug.traceback)

  restore_cover_metadata(cover_meta_snap)
  restore_forced_channel_layout_metadata(forced_channel_layout_snap)
  restore_layout_visibility_metadata(layout_visibility_snap)
  restore_track_chunks(track_snapshots)
  restore_render_state(parent, render_snap)
  restore_selected_items(original_selected_items)
  r.PreventUIRefresh(-1)
  r.TrackList_AdjustWindows(false)
  r.UpdateArrange()
  r.Undo_EndBlock("POLY Smart Batch Render + Auto Cover Art IMGUI", -1)

  if not ok then
    return false, result_or_err
  end
  return true, result_or_err
end

local function refresh_selection_info()
  state.selection_info = build_selection_info()
end

state.render_profile = load_render_profile_from_extstate()
if state.render_profile then
  state.render_profile_captured = true
else
  state.render_profile_captured = false
  set_ext_bool("render_profile_captured", false)
end

initialize_rectype_layout_map()
refresh_selection_info()

local function draw_overview()
  local info = state.selection_info or build_selection_info()

  text_colored_safe("POLY Smart Batch Render + Auto Cover Art", color_u32(1.00, 0.45, 0.78, 1.00))
  r.ImGui_TextWrapped(ctx, "Select items on the POLY parent track. Image items embed cover art, and empty/non-image items still render with cover-art metadata cleared.")
  r.ImGui_Separator(ctx)

  draw_overview_info_lane(info)

  r.ImGui_Separator(ctx)

  local changed = false
  changed, state.disable_tail = r.ImGui_Checkbox(ctx, "Disable selected-item render tail", state.disable_tail)
  if changed then set_ext_bool("disable_tail", state.disable_tail) end

  changed, state.sort_by_time = r.ImGui_Checkbox(ctx, "Sort selected items by timeline position", state.sort_by_time)
  if changed then set_ext_bool("sort_by_time", state.sort_by_time) end

  changed, state.render_mode = r.ImGui_Combo(ctx, "Render mode", state.render_mode, RENDER_MODE_ITEMS)
  if changed then set_ext_int("render_mode", state.render_mode) end

  changed, state.match_child_sample_rate = r.ImGui_Checkbox(ctx, "Match render sample rate to child media", state.match_child_sample_rate)
  if changed then set_ext_bool("match_child_sample_rate", state.match_child_sample_rate) end

  changed, state.inject_ucs_metadata = r.ImGui_Checkbox(ctx, "Inject UCS/ASWG metadata keys", state.inject_ucs_metadata)
  if changed then set_ext_bool("inject_ucs_metadata", state.inject_ucs_metadata) end

  changed, state.update_meta_marker = r.ImGui_Checkbox(ctx, "Update META marker RecType + Microphone + layouts", state.update_meta_marker)
  if changed then set_ext_bool("update_meta_marker", state.update_meta_marker) end

  changed, state.post_write_ixml_layout = r.ImGui_Checkbox(ctx, "Post-write iXML layout into rendered WAV/BWF", state.post_write_ixml_layout)
  if changed then set_ext_bool("post_write_ixml_layout", state.post_write_ixml_layout) end

  changed, state.post_patch_channel_mask = r.ImGui_Checkbox(ctx, "Post-patch WAV channel mask in rendered files", state.post_patch_channel_mask)
  if changed then set_ext_bool("post_patch_channel_mask", state.post_patch_channel_mask) end

  changed, state.force_channel_layout_render_metadata = r.ImGui_Checkbox(ctx, "Force-write ChannelLayout into technical WAV/BWF metadata keys", state.force_channel_layout_render_metadata)
  if changed then set_ext_bool("force_channel_layout_render_metadata", state.force_channel_layout_render_metadata) end

  changed, state.append_track_info_to_url = r.ImGui_Checkbox(ctx, "Append track layout info into URL metadata", state.append_track_info_to_url)
  if changed then set_ext_bool("append_track_info_to_url", state.append_track_info_to_url) end

  local render_accent = push_button_accent("primary")
  if r.ImGui_Button(ctx, "Render Now", 220, 32.0) then
    set_status("Running batch render...")
    local ok, msg = run_batch_render()
    if ok then
      state.last_summary = msg
      set_status("Render completed.")
    else
      state.last_summary = msg or "Render failed."
      set_status("Render failed.")
      r.MB(state.last_summary, SCRIPT_TITLE, 0)
    end
    refresh_selection_info()
  end
  pop_style_colors(render_accent)

  r.ImGui_SameLine(ctx)
  local refresh_accent = push_button_accent("cool")
  if r.ImGui_Button(ctx, "Refresh Selection", 170, 32.0) then
    refresh_selection_info()
    set_status("Selection info refreshed.")
  end
  pop_style_colors(refresh_accent)

  changed, state.auto_refresh = r.ImGui_Checkbox(ctx, "Auto refresh selection info", state.auto_refresh)
  if changed then set_ext_bool("auto_refresh", state.auto_refresh) end
end

local function draw_rectype_layout_settings_tab()
  if trim(state.rectype_layout_edit_text) == "" then
    state.rectype_layout_edit_text = state.rectype_layout_text
  end

  local loaded_count = map_entry_count(IXML_TRACK_LAYOUT_BY_RECTYPE)

  text_colored_safe("RecType Layout Settings", color_u32(1.00, 0.45, 0.78, 1.00))
  r.ImGui_TextWrapped(ctx, "Configure short-code mappings used to generate ixmlTrackLayout and ChannelLayout from child track names.")
  r.ImGui_TextWrapped(ctx, "Track naming format: Microphone_RecType (examples: Boom_XY, Mid_MS-RAW, Amb_FOA-AMBIX).")
  r.ImGui_Separator(ctx)

  text_colored_safe("Loaded mappings: " .. tostring(loaded_count), color_u32(0.55, 0.95, 0.80, 1.00))
  r.ImGui_TextWrapped(ctx, "Line format: SHORT=Token,Token,Token")

  local save_accent = push_button_accent("success")
  if r.ImGui_Button(ctx, "Save Map", 130, 0.0) then
    local ok_apply, msg = apply_rectype_layout_map_text(state.rectype_layout_edit_text or "", true)
    state.rectype_layout_status = msg
    if ok_apply then
      state.rectype_layout_edit_text = state.rectype_layout_text
      set_status("RecType layout map saved.")
    else
      set_status("RecType layout map not saved.")
    end
  end
  pop_style_colors(save_accent)
  r.ImGui_SameLine(ctx)
  local reload_accent = push_button_accent("cool")
  if r.ImGui_Button(ctx, "Reload Active", 130, 0.0) then
    state.rectype_layout_edit_text = state.rectype_layout_text
    state.rectype_layout_status = "Editor reset to active mappings."
  end
  pop_style_colors(reload_accent)
  r.ImGui_SameLine(ctx)
  local reset_accent = push_button_accent("amber")
  if r.ImGui_Button(ctx, "Reset Defaults", 140, 0.0) then
    local defaults = serialize_rectype_layout_map(DEFAULT_IXML_TRACK_LAYOUT_BY_RECTYPE)
    state.rectype_layout_edit_text = defaults
    local _, msg = apply_rectype_layout_map_text(defaults, true)
    state.rectype_layout_edit_text = state.rectype_layout_text
    state.rectype_layout_status = msg
    set_status("RecType layout map reset to defaults.")
  end
  pop_style_colors(reset_accent)

  local changed = false
  changed, state.rectype_layout_edit_text = r.ImGui_InputTextMultiline(
    ctx,
    "##RecTypeLayoutMapEditor",
    state.rectype_layout_edit_text or "",
    -FLT_MIN,
    270
  )
  if changed and trim(state.rectype_layout_status) == "" then
    state.rectype_layout_status = "Editor updated. Click Save Map to apply changes."
  end

  if trim(state.rectype_layout_status) ~= "" then
    r.ImGui_TextWrapped(ctx, "Status: " .. state.rectype_layout_status)
  end

  r.ImGui_Separator(ctx)
  text_colored_safe("Quick examples", color_u32(0.35, 0.90, 0.95, 1.00))
  r.ImGui_TextWrapped(ctx, "Mono: CARD=C | SUPCARD=C | HYPCARD=C | SHOT=C | OMNI=C | FIG8=C")
  r.ImGui_TextWrapped(ctx, "Stereo: XY=L,R | ORTF=L,R | AB=L,R | BIN=L,R")
  r.ImGui_TextWrapped(ctx, "Mid-Side: MS-RAW=M,S | MS-DCOD=L,R | DMS-RAW=M,S,S | DMS-DCOD=L,C,R,Ls,Rs")
  r.ImGui_TextWrapped(ctx, "Surround: QUAD=L,R,Ls,Rs | 5.0=L,R,C,Ls,Rs | 5.1=L,R,C,LFE,Ls,Rs | 7.0=L,R,C,Ls,Rs,Lrs,Rrs | 7.1=L,R,C,LFE,Lss,Rss,Lsr,Rsr")
  r.ImGui_TextWrapped(ctx, "Ambisonic: FOA-AMBIX=W,Y,Z,X | FOA-FUMA=W,X,Y,Z")
end

local function draw_summary()
  text_colored_safe("Summary", color_u32(1.00, 0.45, 0.78, 1.00))
  local started, visible = begin_child_safe("Summary", 220)
  if started then
    if visible then
      if state.last_summary ~= "" then
        r.ImGui_TextWrapped(ctx, state.last_summary)
      else
        r.ImGui_TextWrapped(ctx, "No render has been run yet.")
      end
      r.ImGui_EndChild(ctx)
    end
  end
end

local function loop()
  if state.auto_refresh then
    refresh_selection_info()
  end

  push_theme()
  r.ImGui_SetNextWindowSize(ctx, 920, 680, r.ImGui_Cond_FirstUseEver())
  local visible, open = r.ImGui_Begin(ctx, SCRIPT_TITLE, true)
  if visible then
    local drew_tabs = false
    local tab_bar_open = begin_tab_bar_safe("MainTabs")
    if tab_bar_open then
      drew_tabs = true

      local render_tab_open = begin_tab_item_safe("Render")
      if render_tab_open then
        draw_overview()
        r.ImGui_EndTabItem(ctx)
      end

      local layout_tab_open = begin_tab_item_safe("RecType Layouts")
      if layout_tab_open then
        draw_rectype_layout_settings_tab()
        r.ImGui_EndTabItem(ctx)
      end

      local summary_tab_open = begin_tab_item_safe("Summary")
      if summary_tab_open then
        draw_summary()
        r.ImGui_EndTabItem(ctx)
      end

      r.ImGui_EndTabBar(ctx)
    end

    if not drew_tabs then
      draw_overview()
      r.ImGui_Separator(ctx)
      draw_rectype_layout_settings_tab()
      r.ImGui_Separator(ctx)
      draw_summary()
    end
    r.ImGui_End(ctx)
  end
  pop_theme()

  if open then
    r.defer(loop)
  else
    if r.ImGui_DestroyContext then
      pcall(r.ImGui_DestroyContext, ctx)
    end
  end
end

r.defer(loop)
