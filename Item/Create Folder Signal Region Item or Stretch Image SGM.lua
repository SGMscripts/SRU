-- @description Create Folder Signal Region Item or Stretch Image SGM
-- @version 1.0.0
-- @author SGM
-- @about
--   Select a folder parent track and place the edit cursor over audio/MIDI
--   signal on its child tracks. The script finds the continuous child-track
--   signal region under the cursor, then either stretches an overlapping image
--   item on the folder track to that range or creates an empty named item there.
--
-- @changelog
--   v1.0.0
--   - Initial ReaPack release

function get_cursor_signal_region(folder_track)
  local cursor = reaper.GetCursorPosition()
  local folder_depth = reaper.GetTrackDepth(folder_track)
  local folder_idx = reaper.GetMediaTrackInfo_Value(folder_track, "IP_TRACKNUMBER") - 1

  local item_ranges = {}
  local track_count = reaper.CountTracks(0)

  for i = folder_idx + 1, track_count - 1 do
    local child = reaper.GetTrack(0, i)

    if reaper.GetTrackDepth(child) <= folder_depth then
      break
    end

    local item_count = reaper.CountTrackMediaItems(child)

    for j = 0, item_count - 1 do
      local item = reaper.GetTrackMediaItem(child, j)
      local start_pos = reaper.GetMediaItemInfo_Value(item, "D_POSITION")
      local length = reaper.GetMediaItemInfo_Value(item, "D_LENGTH")
      local end_pos = start_pos + length

      table.insert(item_ranges, {
        start = start_pos,
        endt = end_pos
      })
    end
  end

  table.sort(item_ranges, function(a, b)
    return a.start < b.start
  end)

  local merged = {}

  for i = 1, #item_ranges do
    local r = item_ranges[i]

    if #merged == 0 then
      table.insert(merged, {
        start = r.start,
        endt = r.endt
      })
    else
      local last = merged[#merged]

      if r.start <= last.endt + 0.0001 then
        last.endt = math.max(last.endt, r.endt)
      else
        table.insert(merged, {
          start = r.start,
          endt = r.endt
        })
      end
    end
  end

  for _, r in ipairs(merged) do
    if cursor >= r.start and cursor <= r.endt then
      return r.start, r.endt
    end
  end

  return nil, nil
end

function is_image_item(item)
  local take = reaper.GetActiveTake(item)
  if not take then return false end

  local source = reaper.GetMediaItemTake_Source(take)
  if not source then return false end

  local filename = reaper.GetMediaSourceFileName(source, "")
  filename = filename:lower()

  return filename:match("%.png$") or
         filename:match("%.jpg$") or
         filename:match("%.jpeg$") or
         filename:match("%.bmp$") or
         filename:match("%.gif$") or
         filename:match("%.webp$") or
         filename:match("%.tif$") or
         filename:match("%.tiff$")
end

function item_overlaps_range(item, range_start, range_end)
  local item_start = reaper.GetMediaItemInfo_Value(item, "D_POSITION")
  local item_length = reaper.GetMediaItemInfo_Value(item, "D_LENGTH")
  local item_end = item_start + item_length

  return item_start < range_end and item_end > range_start
end

function find_image_item_in_range(track, range_start, range_end)
  local item_count = reaper.CountTrackMediaItems(track)

  for i = 0, item_count - 1 do
    local item = reaper.GetTrackMediaItem(track, i)

    if is_image_item(item) and item_overlaps_range(item, range_start, range_end) then
      return item
    end
  end

  return nil
end

function name_item_take(item, name)
  local take = reaper.GetActiveTake(item)

  if take then
    reaper.GetSetMediaItemTakeInfo_String(take, "P_NAME", name, true)
  end
end

function main()
  local folder_track = reaper.GetSelectedTrack(0, 0)

  if not folder_track then
    reaper.MB("Select a folder parent track.", "No Track Selected", 0)
    return
  end

  if reaper.GetMediaTrackInfo_Value(folder_track, "I_FOLDERDEPTH") < 1 then
    reaper.MB("Selected track is not a folder parent.", "Invalid Folder Track", 0)
    return
  end

  local retval, folder_name = reaper.GetSetMediaTrackInfo_String(folder_track, "P_NAME", "", false)

  if not retval or folder_name == "" then
    folder_name = "Folder"
  end

  local start_pos, end_pos = get_cursor_signal_region(folder_track)

  if not start_pos then
    reaper.MB("No signal under cursor in child tracks.", "No Signal", 0)
    return
  end

  reaper.Undo_BeginBlock()
  reaper.PreventUIRefresh(1)

  local image_item = find_image_item_in_range(folder_track, start_pos, end_pos)

  if image_item then
    reaper.SetMediaItemInfo_Value(image_item, "D_POSITION", start_pos)
    reaper.SetMediaItemInfo_Value(image_item, "D_LENGTH", end_pos - start_pos)
    name_item_take(image_item, folder_name)
  else
    local item = reaper.AddMediaItemToTrack(folder_track)

    reaper.SetMediaItemInfo_Value(item, "D_POSITION", start_pos)
    reaper.SetMediaItemInfo_Value(item, "D_LENGTH", end_pos - start_pos)

    local take = reaper.AddTakeToMediaItem(item)
    reaper.GetSetMediaItemTakeInfo_String(take, "P_NAME", folder_name, true)
  end

  reaper.PreventUIRefresh(-1)
  reaper.Undo_EndBlock("Create Folder Signal Region Item or Stretch Image SGM", -1)
  reaper.UpdateArrange()
end

main()
