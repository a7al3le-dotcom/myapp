# Start the local preview and Firebase Emulator Suite from Windows PowerShell.
# This script is local only. It does not deploy or connect to production Firebase.

$ErrorActionPreference = "Stop"
$projectId = "demo-myapp-local"
$previewUrl = "http://127.0.0.1:5000/?emu=1"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw "Node.js is missing. Install an LTS release, then reopen PowerShell."
    }
    if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
        throw "npx is missing. Reinstall Node.js LTS with npm."
    }
    if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
        throw "Java 21 or newer is required by Firebase Emulator Suite. Install a JDK 21+ and reopen PowerShell."
    }
    $javaVersionOutput = & java -version 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0 -or $javaVersionOutput -notmatch '(?im)\bversion\s+"(?<major>\d+)') {
        throw "Could not determine the Java version. Install a JDK 21+ and confirm java -version works in PowerShell."
    }
    $javaMajor = [int]$Matches.major
    if ($javaMajor -lt 21) {
        throw "Firebase Emulator Suite requires Java 21 or newer. Java $javaMajor is active; update JAVA_HOME and PATH, then reopen PowerShell."
    }
    if (-not (Test-Path -LiteralPath (Join-Path $root "firebase.json") -PathType Leaf)) {
        throw "firebase.json was not found in the project root."
    }

    Write-Host "Starting local Auth, Realtime Database, and Hosting emulators for $projectId only."
    Write-Host "Local only: this does not deploy or connect to production Firebase."
    Write-Host "Preview URL: $previewUrl"
    Write-Host "Stop the emulators at any time with Ctrl+C."

    $edgeCandidates = @()
    $edgeCommand = Get-Command msedge -ErrorAction SilentlyContinue
    if ($edgeCommand -and $edgeCommand.Source -and (Test-Path -LiteralPath $edgeCommand.Source -PathType Leaf)) {
        $edgeCandidates += $edgeCommand.Source
    }
    $edgeCandidates += @(
        (Join-Path $env:ProgramFiles "Microsoft/Edge/Application/msedge.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Microsoft/Edge/Application/msedge.exe")
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }
    $edgePath = $edgeCandidates | Select-Object -First 1
    if ($edgePath) {
        try {
            Start-Process -FilePath $edgePath -ArgumentList $previewUrl -ErrorAction Stop
        } catch {
            Write-Warning "Microsoft Edge could not be opened ($($_.Exception.Message)). Open this URL manually after the emulators start: $previewUrl"
        }
    } else {
        Write-Warning "Microsoft Edge was not found. Open this URL manually after the emulators start: $previewUrl"
    }

    & npx --yes firebase-tools emulators:start --project $projectId --only auth,database,hosting
    if ($LASTEXITCODE -ne 0) {
        throw "Firebase Emulator Suite exited with code $LASTEXITCODE. Check the message above and your Internet connection for the initial download."
    }
} catch {
    Write-Error $_
    exit 1
}
