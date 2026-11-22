#!/bin/sh
# Stop the packaged processes before dpkg replaces their executable files.

read_process_start_time() {
  IFS= read -r process_stat 2>/dev/null < "$1/stat" || return 1
  # The command name may contain spaces or parentheses before stat fields 3–22.
  process_fields=${process_stat##*) }
  [ "$process_fields" != "$process_stat" ] || return 1
  # shellcheck disable=SC2086
  set -- $process_fields
  [ "$#" -ge 20 ] || return 1
  case "$1" in Z|X|x) return 1 ;; esac
  shift 19
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  process_start_time=$1
}

read_packaged_executable() {
  executable=$(readlink "$1/exe" 2>/dev/null) || return 1
  executable=${executable%" (deleted)"}
  appimage_device=''
  case "$executable" in
    '/opt/知远智能体 (ZhiYuan Agent)'/*|/opt/知远/*|/opt/ZhiYuanAgent/*) return 0 ;;
    /*/.mount_*/*)
      mount_tail=${executable##*/.mount_}
      # AppImage uses a six-byte artifact prefix followed by six generated characters.
      case "${mount_tail%%/*}" in
        知远??????|ZhiYua??????|ZhiYuanAgent??????) ;;
        *) return 1 ;;
      esac
      appimage_mount=${executable%"$mount_tail"}${mount_tail%%/*}
      appimage_device=$(APPIMAGE_MOUNT="$appimage_mount" awk '
        {
          mount = $5
          gsub(/\\040/, " ", mount)
          gsub(/\\011/, "\t", mount)
          gsub(/\\012/, "\n", mount)
          gsub(/\\134/, "\\\\", mount)
          if (mount != ENVIRON["APPIMAGE_MOUNT"]) next
          for (field = 7; field < NF; field++) {
            if ($field != "-") continue
            if ($(field + 1) ~ /^fuse(\.|$)/ && $3 ~ /^[0-9]+:[0-9]+$/) {
              print $3
              exit
            }
            break
          }
        }
      ' "$1/mountinfo" 2>/dev/null) || return 1
      [ -n "$appimage_device" ] && return 0
      ;;
  esac
  return 1
}

same_packaged_process() {
  read_packaged_executable "$1" || return 1
  if [ -n "$appimage_device" ]; then
    case " $appimage_devices " in
      *" $appimage_device "*) ;;
      *) return 1 ;;
    esac
  fi
  read_process_start_time "$1" && [ "$process_start_time" = "$2" ]
}

stop_packaged_processes() {
  process_root=$1
  candidates=''
  appimage_devices=''
  for process_dir in "$process_root"/[0-9]*; do
    pid=${process_dir##*/}
    case "$pid" in ''|*[!0-9]*) continue ;; esac
    [ "$pid" -gt 1 ] && [ "$pid" -ne "$$" ] || continue
    read_process_start_time "$process_dir" || continue
    original_start=$process_start_time
    read_packaged_executable "$process_dir" || continue
    read_process_start_time "$process_dir" && [ "$process_start_time" = "$original_start" ] || continue
    candidates="$candidates $pid:$original_start"
    if [ -n "$appimage_device" ]; then
      # The packaged app identifies its mount for sidecars even if their environment is scrubbed.
      case "$executable" in
        "$appimage_mount"/知远|"$appimage_mount"/ZhiYuanAgent)
          appimage_devices="$appimage_devices $appimage_device"
          ;;
      esac
    fi
  done

  targets=''
  for candidate in $candidates; do
    pid=${candidate%%:*}
    if same_packaged_process "$process_root/$pid" "${candidate#*:}" && kill -TERM "$pid" 2>/dev/null; then
      targets="$targets $candidate"
    fi
  done

  waited=0
  while [ "$waited" -lt 10 ] && [ -n "$targets" ]; do
    remaining=''
    for target in $targets; do
      if read_process_start_time "$process_root/${target%%:*}" &&
        [ "$process_start_time" = "${target#*:}" ]; then
        remaining="$remaining $target"
      fi
    done
    targets=$remaining
    [ -n "$targets" ] || break
    sleep 1
    waited=$((waited + 1))
  done

  for target in $targets; do
    pid=${target%%:*}
    if same_packaged_process "$process_root/$pid" "${target#*:}"; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
}

stop_packaged_processes /proc
exit 0
