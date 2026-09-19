import { execFile } from 'child_process';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { checkRequest, forbidden } from '@/server/security/auth';

// Native Windows folder picker, modern style (IFileOpenDialog + FOS_PICKFOLDERS).
// Runs on the same machine as the server (localhost), so it shows on the user's desktop.
// `autocloseMs` is for automated testing (force-closes the dialog).
export async function POST(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const body = await req.json().catch(() => ({}));
  const initial = String(body.initial || '');
  const autocloseMs = Math.min(Math.max(parseInt(body.autocloseMs || '0', 10) || 0, 0), 60000);
  const esc = (s: string) => s.replace(/'/g, "''");

  const cs = `
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IFileDialog {
  [PreserveSig] int Show(IntPtr parent);
  void SetFileTypes(int cFileTypes, IntPtr rgFilterSpec);
  void SetFileTypeIndex(int iFileTypeIndex);
  void GetFileTypeIndex(out int piFileTypeIndex);
  void Advise(IntPtr pfde, out int pdwCookie);
  void Unadvise(int dwCookie);
  void SetOptions(uint fos);
  void GetOptions(out uint pfos);
  void SetDefaultFolder(IShellItem psi);
  void SetFolder(IShellItem psi);
  void GetFolder(out IShellItem ppsi);
  void GetCurrentSelection(out IShellItem ppsi);
  void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
  void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
  void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
  void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
  void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
  void GetResult(out IShellItem ppsi);
  void AddPlace(IShellItem psi, int fdap);
  void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
  void Close([MarshalAs(UnmanagedType.Error)] int hr);
  void SetClientGuid(ref Guid guid);
  void ClearClientData();
  void SetFilter(IntPtr pFilter);
}

[ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IShellItem {
  void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
  void GetParent(out IShellItem ppsi);
  void GetDisplayName(uint sigdnName, out IntPtr ppszName);
  void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
  void Compare(IShellItem psi, uint hint, out int piOrder);
}

[ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
class FileOpenDialog { }

public class Ec11Picker {
  const uint FOS_PICKFOLDERS = 0x00000020;
  const uint FOS_FORCEFILESYSTEM = 0x00000040;
  const uint FOS_PATHMUSTEXIST = 0x00000800;
  const uint SIGDN_FILESYSPATH = 0x80058000;

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string pszPath, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItem ppv);

  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

  static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);

  static void ForceForeground(string title) {
    for (int i = 0; i < 150; i++) {
      IntPtr h = FindWindow("#32770", title);
      if (h == IntPtr.Zero) h = FindWindow(null, title);
      if (h != IntPtr.Zero) {
        ShowWindow(h, 5);
        SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040);
        SetForegroundWindow(h);
        return;
      }
      System.Threading.Thread.Sleep(100);
    }
  }

  public static string Show(string title, string initial) {
    IFileDialog dlg = (IFileDialog)(new FileOpenDialog());
    dlg.SetOptions(FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);
    if (!string.IsNullOrEmpty(title)) dlg.SetTitle(title);
    dlg.SetOkButtonLabel("Select Folder");
    if (!string.IsNullOrEmpty(initial)) {
      try {
        Guid iid = new Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe");
        IShellItem start;
        SHCreateItemFromParsingName(initial, IntPtr.Zero, ref iid, out start);
        if (start != null) dlg.SetFolder(start);
      } catch { }
    }
    var fg = new System.Threading.Thread(() => ForceForeground(title));
    fg.IsBackground = true;
    fg.Start();
    int hr = dlg.Show(IntPtr.Zero);
    if (hr != 0) return null;
    IShellItem item;
    dlg.GetResult(out item);
    IntPtr psz;
    item.GetDisplayName(SIGDN_FILESYSPATH, out psz);
    string path = Marshal.PtrToStringUni(psz);
    Marshal.FreeCoTaskMem(psz);
    return path;
  }
}
`;

  const script = [
    'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
    '$src = @\'\n' + cs + '\n\'@',
    'Add-Type -TypeDefinition $src -Language CSharp | Out-Null',
    `$p = [Ec11Picker]::Show('Choose the working folder for EC11', '${esc(initial)}')`,
    'if ($p) { [Console]::Out.Write($p) }',
  ].join('\n');

  const b64 = Buffer.from(script, 'utf16le').toString('base64');

  return new Promise<Response>((resolve) => {
    let autoTimer: NodeJS.Timeout | null = null;
    const child = execFile('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', b64], { timeout: 300000, windowsHide: true }, (err: any, stdout: string, stderr: string) => {
      if (autoTimer) clearTimeout(autoTimer);
      const out = String(stdout || '').trim();
      if (out) return resolve(Response.json({ ok: true, path: out }));
      const msg = String(stderr || err?.message || '').trim().slice(0, 200);
      resolve(Response.json({ ok: false, cancelled: true, error: msg || 'No folder selected.' }));
    });
    if (autocloseMs > 0) autoTimer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, autocloseMs);
  });
}

