# Read-only local computer check. No installation, network upload, rendering or publication.
param([string]$Voice = 'voices/en_US-lessac-medium.onnx')
$ErrorActionPreference = 'Stop'
Write-Host 'InfamousHub Story Agent: Windows computer check'
Write-Host 'Read-only: no changes, purchases, uploads, or publications.'
$missing = 0
foreach ($tool in @('python', 'ffmpeg', 'ffprobe', 'ollama', 'piper')) {
    if (Get-Command $tool -ErrorAction SilentlyContinue) {
        Write-Host "[OK]      $tool found"
    } else {
        Write-Host "[MISSING] $tool not found"
        $missing += 1
    }
}
foreach ($entry in @(
    @{Label='Piper voice .onnx';Path=$Voice},
    @{Label='Piper metadata .onnx.json';Path=($Voice+'.json')}
)) {
    if ((Test-Path -LiteralPath $entry.Path -PathType Leaf) -and
        (Get-Item -LiteralPath $entry.Path).Length -gt 0) {
        Write-Host "[OK]      $($entry.Label) present"
    } else {
        Write-Host "[MISSING] $($entry.Label) absent or empty"
        $missing += 1
    }
}
if (Get-Command ollama -ErrorAction SilentlyContinue) {
    try {
        $list = @(& ollama list 2>$null)
        if ($LASTEXITCODE -eq 0 -and ($list -match '^llama3\.1:8b\s')) {
            Write-Host '[OK]      Ollama llama3.1:8b model listed'
        } else {
            Write-Host '[MISSING] Ollama llama3.1:8b not listed'
            $missing += 1
        }
    } catch {
        Write-Host '[MISSING] Ollama service or model unavailable'
        $missing += 1
    }
}
try {
    $sys = Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
    Write-Host ('[INFO]    Physical RAM: {0:N1} GiB' -f ($sys.TotalPhysicalMemory/1GB))
} catch { Write-Host '[INFO]    RAM information unavailable (nonfatal)' }
try {
    $disk = Get-PSDrive -Name (Get-Location).Drive.Name -ErrorAction Stop
    Write-Host ('[INFO]    Free disk: {0:N1} GiB' -f ($disk.Free/1GB))
} catch { Write-Host '[INFO]    Disk information unavailable (nonfatal)' }
if ($missing -eq 0) {
    Write-Host 'Presence checks passed. Still need an actual video test.'
} else {
    Write-Host "Missing checks: $missing. Publishing must stay OFF."
}
Write-Host 'No account credentials or private files were collected.'
