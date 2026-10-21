using System.Runtime.InteropServices;

namespace Pawst;

internal static partial class NativeMethods
{
    [LibraryImport("dwmapi.dll")]
    private static partial int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    [LibraryImport("user32.dll", StringMarshalling = StringMarshalling.Utf16, EntryPoint = "FindWindowW")]
    private static partial IntPtr FindWindow(string? className, string windowName);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool SetForegroundWindow(IntPtr hwnd);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool ShowWindow(IntPtr hwnd, int cmd);

    /// <summary>Dark title bar on Windows 10 20H1+ and 11.</summary>
    public static void UseDarkTitleBar(IntPtr hwnd)
    {
        var on = 1;
        if (DwmSetWindowAttribute(hwnd, 20, ref on, sizeof(int)) != 0)
        {
            DwmSetWindowAttribute(hwnd, 19, ref on, sizeof(int));
        }
    }

    public static void FocusExisting()
    {
        var hwnd = FindWindow(null, "Pawst");
        if (hwnd != IntPtr.Zero)
        {
            ShowWindow(hwnd, 9); // SW_RESTORE
            SetForegroundWindow(hwnd);
        }
    }
}
