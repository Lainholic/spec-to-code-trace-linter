[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,

    [Parameter(Mandatory = $false)]
    [string]$VoiceoverPath = "",

    [Parameter(Mandatory = $false)]
    [string]$OutputPath = "",

    [Parameter(Mandatory = $false)]
    [double]$MaxDurationSeconds = 300.0,

    [Parameter(Mandatory = $false)]
    [switch]$SkipLoudnorm
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function Assert-CommandExists {
    param([string]$Name)
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $cmd) {
        throw "Required tool '$Name' was not found on PATH."
    }
    return $cmd.Source
}

function Get-MediaDurationSeconds {
    param([string]$FfprobePath, [string]$MediaFile)
    $raw = & $FfprobePath -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $MediaFile
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) {
        throw "ffprobe could not read duration for '$MediaFile'."
    }
    [double]$seconds = 0
    if (-not [double]::TryParse(($raw | Select-Object -First 1).Trim(), [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$seconds)) {
        throw "Unexpected ffprobe duration output '$raw' for '$MediaFile'."
    }
    return $seconds
}

function Test-HasAudioStream {
    param([string]$FfprobePath, [string]$MediaFile)
    $raw = & $FfprobePath -v error -select_streams a -show_entries stream=index -of csv=p=0 $MediaFile
    if ($LASTEXITCODE -ne 0) {
        return $false
    }
    return -not [string]::IsNullOrWhiteSpace(($raw -join "").Trim())
}

$ffmpeg = Assert-CommandExists "ffmpeg"
$ffprobe = Assert-CommandExists "ffprobe"

if (-not (Test-Path -LiteralPath $InputPath)) {
    throw "Input video file does not exist: $InputPath"
}
$resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path

$resolvedVoiceover = ""
if (-not [string]::IsNullOrWhiteSpace($VoiceoverPath)) {
    if (-not (Test-Path -LiteralPath $VoiceoverPath)) {
        throw "Voiceover audio file does not exist: $VoiceoverPath"
    }
    $resolvedVoiceover = (Resolve-Path -LiteralPath $VoiceoverPath).Path
}

$repoRoot = Resolve-RepoRoot
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $repoRoot "_reports\submission_package_20261114\Spec-to-Code-Trace-Demo-1080p.mp4"
}
$outputDir = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

$inputDuration = Get-MediaDurationSeconds -FfprobePath $ffprobe -MediaFile $resolvedInput
Write-Host ("Source video duration: {0:N2}s" -f $inputDuration)
if ($inputDuration -ge $MaxDurationSeconds) {
    throw ("FAIL: Source video duration ({0:N2}s) must be strictly under {1:N1}s (5-minute limit)." -f $inputDuration, $MaxDurationSeconds)
}

if (-not [string]::IsNullOrWhiteSpace($resolvedVoiceover)) {
    $audioDuration = Get-MediaDurationSeconds -FfprobePath $ffprobe -MediaFile $resolvedVoiceover
    Write-Host ("Source voiceover duration: {0:N2}s" -f $audioDuration)
    if ($audioDuration -ge $MaxDurationSeconds) {
        throw ("FAIL: Voiceover audio duration ({0:N2}s) must be strictly under {1:N1}s (5-minute limit)." -f $audioDuration, $MaxDurationSeconds)
    }
}

$videoFilter = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#090d16,setsar=1,fps=30,format=yuv420p"

$ffArgs = @("-y", "-i", $resolvedInput)
$hasAudio = $false

if (-not [string]::IsNullOrWhiteSpace($resolvedVoiceover)) {
    $ffArgs += @("-i", $resolvedVoiceover, "-map", "0:v:0", "-map", "1:a:0")
    $hasAudio = $true
} elseif (Test-HasAudioStream -FfprobePath $ffprobe -MediaFile $resolvedInput) {
    $ffArgs += @("-map", "0:v:0", "-map", "0:a:0")
    $hasAudio = $true
} else {
    Write-Warning "No audio stream detected and no -VoiceoverPath provided. Rendering video-only MP4."
    $ffArgs += @("-map", "0:v:0", "-an")
}

$ffArgs += @(
    "-vf", $videoFilter,
    "-c:v", "libx264",
    "-profile:v", "high",
    "-level:v", "4.1",
    "-crf", "18",
    "-preset", "medium"
)

if ($hasAudio) {
    if (-not $SkipLoudnorm) {
        $ffArgs += @("-af", "loudnorm=I=-16:TP=-1.5:LRA=11")
    }
    $ffArgs += @(
        "-c:a", "aac",
        "-ar", "48000",
        "-ac", "2",
        "-b:a", "192k"
    )
}

$ffArgs += @("-movflags", "+faststart", "-shortest", $OutputPath)

Write-Host "Running ffmpeg 1080p packaging..."
& $ffmpeg @ffArgs
if ($LASTEXITCODE -ne 0) {
    throw "ffmpeg exited with code $LASTEXITCODE."
}

$finalDuration = Get-MediaDurationSeconds -FfprobePath $ffprobe -MediaFile $OutputPath
if ($finalDuration -ge $MaxDurationSeconds) {
    throw ("FAIL: Final MP4 duration ({0:N2}s) exceeds {1:N1}s hard gate." -f $finalDuration, $MaxDurationSeconds)
}

$sizeMb = (Get-Item -LiteralPath $OutputPath).Length / 1MB
Write-Host ("PASS: Packaged 1080p MP4 -> {0} ({1:N2}s, {2:N2} MB)" -f $OutputPath, $finalDuration, $sizeMb)
