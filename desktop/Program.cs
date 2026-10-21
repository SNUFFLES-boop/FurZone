namespace Pawst;

internal static class Program
{
    /// <summary>The installer waits for this to disappear before replacing files during an update.</summary>
    public const string MutexName = "Local\\PawstSingleInstance";

    [STAThread]
    private static void Main()
    {
        using var mutex = new Mutex(true, MutexName, out var first);
        if (!first)
        {
            // Already open: bring that window forward instead of starting a second copy.
            NativeMethods.FocusExisting();
            return;
        }
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}
