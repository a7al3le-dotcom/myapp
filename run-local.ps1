# تشغيل معاينة واختبار محلي على Windows PowerShell
# هذا الملف يشغّل Firebase Emulator Suite محلياً فقط، ولا ينشر إلى Firebase.

$ErrorActionPreference = "Stop"
$projectId = "demo-myapp-local"
$previewUrl = "http://127.0.0.1:5000/?emu=1"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw "Node.js غير موجود. ثبّت إصدار LTS ثم افتح PowerShell من جديد."
    }
    if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
        throw "npx غير موجود. أعد تثبيت Node.js LTS مع npm."
    }
    if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
        throw "Java غير موجود في PATH. ثبّت Java مدعوماً من Firebase Emulator Suite ثم افتح PowerShell من جديد."
    }
    if (-not (Test-Path -LiteralPath (Join-Path $root "firebase.json") -PathType Leaf)) {
        throw "لم يُعثر على firebase.json في جذر المشروع."
    }

    Write-Host "تشغيل محاكيات Auth وRealtime Database وHosting للمشروع المحلي $projectId فقط."
    Write-Host "هذا تشغيل محلي؛ لا يوجد نشر ولا اتصال بمشروع Firebase الإنتاجي."
    Write-Host "الرابط: $previewUrl"
    Write-Host "أوقف المحاكيات في أي وقت بالضغط على Ctrl+C."

    $edge = Get-Command msedge -ErrorAction SilentlyContinue
    if ($edge) {
        Start-Process -FilePath $edge.Source -ArgumentList $previewUrl
    } else {
        $edgePaths = @(
            (Join-Path $env:ProgramFiles "Microsoft/Edge/Application/msedge.exe"),
            (Join-Path ${env:ProgramFiles(x86)} "Microsoft/Edge/Application/msedge.exe")
        ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }
        if ($edgePaths) {
            Start-Process -FilePath $edgePaths[0] -ArgumentList $previewUrl
        } else {
            Write-Warning "لم يُعثر على Microsoft Edge. افتح الرابط يدوياً بعد بدء المحاكيات: $previewUrl"
        }
    }

    & npx --yes firebase-tools emulators:start --project $projectId --only auth,database,hosting
    if ($LASTEXITCODE -ne 0) {
        throw "توقفت Firebase Emulator Suite برمز خطأ $LASTEXITCODE. راجع الرسالة أعلاه وتحقق من اتصال الإنترنت لأول تنزيل."
    }
} catch {
    Write-Error $_
    exit 1
}
