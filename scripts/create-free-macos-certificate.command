#!/bin/zsh
# Local experimental signing helper; never upload its credentials or private key.
set -eu
umask 077
unset XTL_DEV_LOG
task_root="${0:A:h:h}"
helper="$task_root/local-build/tools/xtool-source/.build/release/xtool"
identity_dir="$HOME/Library/Application Support/FolioSigningExperiment/identity"
if [[ ! -x "$helper" ]]; then
  print "先按照 Docs/MAC_WIDGETS_FREE_SIGNING.md 编译签名辅助工具。"
  exit 1
fi
"$helper" ds certificates folio-preflight
"$helper" auth login --mode password
if [[ "${1:-}" == "--renew-profiles" ]]; then
  mac_udid=$(python3 -c 'import json,subprocess; print(json.loads(subprocess.check_output(["system_profiler","SPHardwareDataType","-json"]))["SPHardwareDataType"][0]["provisioning_UDID"])')
  "$helper" ds certificates folio-profiles "$mac_udid" "$HOME/Library/Application Support/FolioSigningExperiment/group-profiles"
else
  "$helper" ds certificates folio-create "$identity_dir"
fi
print "完成。私钥和登录数据保留在本机，不要复制到聊天或提交仓库。"
