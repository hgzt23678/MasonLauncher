import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WindowProbeCandidate = {
  pid: number;
  pidInTree: boolean;
  handle: number;
  title: string;
  visible: boolean;
  minimized: boolean;
  ownerHandle: number;
  bounds: WindowBounds;
  intersectsVirtualScreen: boolean;
};

export type MinecraftWindowProbeResult = {
  supported: boolean;
  rootPid: number;
  checkedAt: string;
  candidates: WindowProbeCandidate[];
  error?: string;
};

export type MinecraftWindowProbe = (
  rootPid: number,
) => Promise<MinecraftWindowProbeResult>;

export const isConfirmedMinecraftWindow = (
  candidate: WindowProbeCandidate,
) =>
  candidate.pidInTree &&
  candidate.handle !== 0 &&
  candidate.visible &&
  !candidate.minimized &&
  candidate.ownerHandle === 0 &&
  candidate.bounds.width > 1 &&
  candidate.bounds.height > 1 &&
  candidate.intersectsVirtualScreen;

const windowsProbeScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MasonWindowProbe {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint command);
}
'@
$rootPid = [int]$env:MASON_WINDOW_ROOT_PID
$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
$ids = [System.Collections.Generic.HashSet[int]]::new()
[void]$ids.Add($rootPid)
do {
  $changed = $false
  foreach ($process in $all) {
    if ($ids.Contains([int]$process.ParentProcessId) -and $ids.Add([int]$process.ProcessId)) {
      $changed = $true
    }
  }
} while ($changed)
$screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
$candidates = @()
foreach ($id in $ids) {
  $process = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($null -eq $process -or $process.MainWindowHandle -eq 0) { continue }
  $handle = [IntPtr]$process.MainWindowHandle
  $rect = New-Object MasonWindowProbe+RECT
  $hasRect = [MasonWindowProbe]::GetWindowRect($handle, [ref]$rect)
  $width = if ($hasRect) { $rect.Right - $rect.Left } else { 0 }
  $height = if ($hasRect) { $rect.Bottom - $rect.Top } else { 0 }
  $intersects = $hasRect -and
    $rect.Right -gt $screen.Left -and
    $rect.Left -lt $screen.Right -and
    $rect.Bottom -gt $screen.Top -and
    $rect.Top -lt $screen.Bottom
  $candidates += [pscustomobject]@{
    pid = [int]$id
    pidInTree = $true
    handle = [long]$process.MainWindowHandle
    title = [string]$process.MainWindowTitle
    visible = [MasonWindowProbe]::IsWindowVisible($handle)
    minimized = [MasonWindowProbe]::IsIconic($handle)
    ownerHandle = [long][MasonWindowProbe]::GetWindow($handle, 4)
    bounds = [pscustomobject]@{
      x = if ($hasRect) { $rect.Left } else { 0 }
      y = if ($hasRect) { $rect.Top } else { 0 }
      width = $width
      height = $height
    }
    intersectsVirtualScreen = $intersects
  }
}
[pscustomobject]@{
  supported = $true
  rootPid = $rootPid
  checkedAt = [DateTime]::UtcNow.ToString('o')
  candidates = $candidates
} | ConvertTo-Json -Depth 5 -Compress
`;

export const probeMinecraftWindow: MinecraftWindowProbe = async (rootPid) => {
  if (process.platform !== 'win32') {
    return {
      supported: false,
      rootPid,
      checkedAt: new Date().toISOString(),
      candidates: [],
    };
  }
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        windowsProbeScript,
      ],
      {
        env: {
          ...process.env,
          MASON_WINDOW_ROOT_PID: String(rootPid),
        },
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      },
    );
    const parsed = JSON.parse(stdout.trim()) as MinecraftWindowProbeResult;
    return {
      ...parsed,
      candidates: Array.isArray(parsed.candidates)
        ? parsed.candidates
        : parsed.candidates
          ? [parsed.candidates]
          : [],
    };
  } catch (error) {
    return {
      supported: true,
      rootPid,
      checkedAt: new Date().toISOString(),
      candidates: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
