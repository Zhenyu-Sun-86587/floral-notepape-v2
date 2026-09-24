param(
    [Parameter(Mandatory)][string]$Scenario,
    [ValidateRange(2, 10)][int]$Samples = 3
)
$ErrorActionPreference = 'Stop'

# 只读取进程，不启动、关闭或操作应用。请在人工摆好场景后使用 PowerShell 7 运行。
$snapshots = @()
for ($sampleIndex = 0; $sampleIndex -lt $Samples; $sampleIndex++) {
    $processes = @(Get-CimInstance Win32_Process)
    $roots = @($processes | Where-Object Name -EQ 'hermes-surface-dev.exe')
    $members = [System.Collections.Generic.HashSet[uint32]]::new()
    foreach ($root in $roots) { [void]$members.Add($root.ProcessId) }
    do {
        $added = $false
        foreach ($process in $processes) {
            if ($members.Contains($process.ParentProcessId) -and $members.Add($process.ProcessId)) { $added = $true }
        }
    } while ($added)

    # 同时核对进程树与应用独立 user-data-dir，避免混入其他应用的 WebView2。
    $browserRoots = @($processes | Where-Object {
        $members.Contains($_.ProcessId) -and $_.Name -eq 'msedgewebview2.exe' -and
        $_.CommandLine -match '--user-data-dir=(?:"[^"]*dev\.hermes\.surface[^"]*"|\S*dev\.hermes\.surface\S*)'
    })
    $verified = [System.Collections.Generic.HashSet[uint32]]::new()
    foreach ($browser in $browserRoots) { [void]$verified.Add($browser.ProcessId) }
    do {
        $added = $false
        foreach ($process in $processes) {
            if ($process.Name -eq 'msedgewebview2.exe' -and $verified.Contains($process.ParentProcessId) -and $verified.Add($process.ProcessId)) { $added = $true }
        }
    } while ($added)
    $unverified = @($processes | Where-Object {
        $members.Contains($_.ProcessId) -and $_.Name -eq 'msedgewebview2.exe' -and !$verified.Contains($_.ProcessId)
    })
    $rows = @($processes | Where-Object {
        $_.ProcessId -in $roots.ProcessId -or $verified.Contains($_.ProcessId)
    } | ForEach-Object {
        [pscustomobject]@{
            Id = $_.ProcessId
            Name = $_.Name
            WorkingSetBytes = [long]$_.WorkingSetSize
            PrivateBytes = [long]$_.PrivatePageCount
            CpuSeconds = ([double]$_.KernelModeTime + [double]$_.UserModeTime) / 10000000
        }
    })
    $snapshots += [pscustomobject]@{
        At = [DateTimeOffset]::Now.ToString('o')
        Scenario = $Scenario
        Complete = $unverified.Count -eq 0
        UnverifiedWebViewIds = @($unverified.ProcessId)
        Processes = $rows
        WorkingSetSumBytes = ($rows | Measure-Object WorkingSetBytes -Sum).Sum
        PrivateSumBytes = ($rows | Measure-Object PrivateBytes -Sum).Sum
        MainProcessCount = $roots.Count
        WebViewProcessCount = $verified.Count
    }
    if ($sampleIndex + 1 -lt $Samples) { Start-Sleep -Seconds 2 }
}
# Working Set 求和包含共享页，不能当作独占物理内存；CPU 为累计时间，需对同一 PID 求时间差。
$snapshots | ConvertTo-Json -Depth 5
