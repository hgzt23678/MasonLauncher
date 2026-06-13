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
  parentPid: number | null;
  pidInTree: boolean;
  handle: number;
  title: string;
  className: string;
  executablePath: string | null;
  visible: boolean;
  minimized: boolean;
  cloaked: boolean;
  ownerHandle: number;
  bounds: WindowBounds;
  intersectsVirtualScreen: boolean;
};

export type WindowProbeProcess = {
  pid: number;
  parentPid: number | null;
  executablePath: string | null;
};

export type MinecraftWindowProbeResult = {
  supported: boolean;
  rootPid: number;
  checkedAt: string;
  processTree: WindowProbeProcess[];
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
  !candidate.cloaked &&
  candidate.ownerHandle === 0 &&
  candidate.bounds.width > 1 &&
  candidate.bounds.height > 1 &&
  candidate.intersectsVirtualScreen;

const windowsProbeScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class MasonWindowProbe {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint command);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out int value, int size);

  public static IntPtr[] EnumerateWindows() {
    var windows = new List<IntPtr>();
    EnumWindows((handle, parameter) => {
      windows.Add(handle);
      return true;
    }, IntPtr.Zero);
    return windows.ToArray();
  }

  public static string ReadWindowText(IntPtr handle) {
    var text = new StringBuilder(1024);
    GetWindowText(handle, text, text.Capacity);
    return text.ToString();
  }

  public static string ReadClassName(IntPtr handle) {
    var text = new StringBuilder(256);
    GetClassName(handle, text, text.Capacity);
    return text.ToString();
  }
}
'@
$rootPid = [int]$env:MASON_WINDOW_ROOT_PID
$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, ExecutablePath)
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
$processTree = @(
  foreach ($process in $all) {
    if ($ids.Contains([int]$process.ProcessId)) {
      [pscustomobject]@{
        pid = [int]$process.ProcessId
        parentPid = if ([int]$process.ParentProcessId -gt 0) { [int]$process.ParentProcessId } else { $null }
        executablePath = if ($process.ExecutablePath) { [string]$process.ExecutablePath } else { $null }
      }
    }
  }
)
$processById = @{}
foreach ($process in $processTree) {
  $processById[[int]$process.pid] = $process
}
$screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
$candidates = @()
foreach ($handle in [MasonWindowProbe]::EnumerateWindows()) {
  [uint32]$windowPid = 0
  [void][MasonWindowProbe]::GetWindowThreadProcessId($handle, [ref]$windowPid)
  if (-not $ids.Contains([int]$windowPid)) { continue }
  $rect = New-Object MasonWindowProbe+RECT
  $hasRect = [MasonWindowProbe]::GetWindowRect($handle, [ref]$rect)
  $width = if ($hasRect) { $rect.Right - $rect.Left } else { 0 }
  $height = if ($hasRect) { $rect.Bottom - $rect.Top } else { 0 }
  $intersects = $hasRect -and
    $rect.Right -gt $screen.Left -and
    $rect.Left -lt $screen.Right -and
    $rect.Bottom -gt $screen.Top -and
    $rect.Top -lt $screen.Bottom
  [int]$cloakedValue = 0
  $cloakedResult = [MasonWindowProbe]::DwmGetWindowAttribute(
    $handle,
    14,
    [ref]$cloakedValue,
    4
  )
  $processInfo = $processById[[int]$windowPid]
  $candidates += [pscustomobject]@{
    pid = [int]$windowPid
    parentPid = if ($processInfo) { $processInfo.parentPid } else { $null }
    pidInTree = $true
    handle = [long]$handle
    title = [MasonWindowProbe]::ReadWindowText($handle)
    className = [MasonWindowProbe]::ReadClassName($handle)
    executablePath = if ($processInfo) { $processInfo.executablePath } else { $null }
    visible = [MasonWindowProbe]::IsWindowVisible($handle)
    minimized = [MasonWindowProbe]::IsIconic($handle)
    cloaked = $cloakedResult -eq 0 -and $cloakedValue -ne 0
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
  processTree = $processTree
  candidates = $candidates
} | ConvertTo-Json -Depth 5 -Compress
`;

export const probeMinecraftWindow: MinecraftWindowProbe = async (rootPid) => {
  if (process.platform !== 'win32') {
    return {
      supported: false,
      rootPid,
      checkedAt: new Date().toISOString(),
      processTree: [],
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
      processTree: Array.isArray(parsed.processTree)
        ? parsed.processTree
        : parsed.processTree
          ? [parsed.processTree]
          : [],
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
      processTree: [],
      candidates: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
