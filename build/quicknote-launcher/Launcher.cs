// "Lumina Quick Note.exe" — a ~10 KB launcher that exists only so Windows has a
// second *executable* to list. "Open with" and Settings > Default apps enumerate
// programs, not launch flags, so `Lumina.exe --quicknote` alone can never show up
// there as its own app. This stub forwards to that exact command and exits; all
// real behaviour (single-instance lock, tabs, routing) stays in Lumina.exe.
//
// Compiled by scripts/build-quicknote-launcher.ps1 with the csc.exe that ships
// in every Windows 10/11 (.NET Framework 4.x), so the build needs no new toolchain.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;

[assembly: AssemblyTitle("Lumina Quick Note")]   // -> FileDescription, Windows' fallback display name
[assembly: AssemblyProduct("Lumina Quick Note")]
[assembly: AssemblyCompany("Nihil")]
[assembly: AssemblyCopyright("Copyright © 2026 Nihil")]
[assembly: AssemblyVersion(LauncherVersion.Value)]
[assembly: AssemblyFileVersion(LauncherVersion.Value)]

static class Launcher
{
    // Explorer grants foreground rights to the process it started — this stub,
    // not the Electron process we spawn. Without passing the right on, a new
    // Quick Note window can open behind the one the user just clicked in.
    [DllImport("user32.dll")]
    static extern bool AllowSetForegroundWindow(int processId);
    const int ASFW_ANY = -1;

    static int Main()
    {
        string dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string lumina = Path.Combine(dir, "Lumina.exe");
        if (!File.Exists(lumina)) return 2;

        AllowSetForegroundWindow(ASFW_ANY);

        // Forward the raw tail of our command line instead of re-quoting parsed
        // argv: Windows quoting rules (backslashes before quotes) are easy to get
        // subtly wrong, and the caller already quoted it correctly for us.
        string args = "--quicknote" + TailAfterProgramName(Environment.CommandLine);
        var psi = new ProcessStartInfo(lumina, args)
        {
            UseShellExecute = false,
            // Keep the caller's cwd so relative paths from a terminal still resolve.
            WorkingDirectory = Environment.CurrentDirectory
        };
        using (Process.Start(psi)) { }
        return 0;
    }

    // CommandLineToArgvW's rule for argv[0]: a leading quote runs to the next
    // quote, otherwise the name ends at the first whitespace. No escapes apply.
    static string TailAfterProgramName(string cmd)
    {
        int i = 0;
        if (cmd.Length > 0 && cmd[0] == '"')
        {
            int close = cmd.IndexOf('"', 1);
            i = close < 0 ? cmd.Length : close + 1;
        }
        else
        {
            while (i < cmd.Length && cmd[i] != ' ' && cmd[i] != '\t') i++;
        }
        string tail = cmd.Substring(i).TrimStart(' ', '\t');
        return tail.Length == 0 ? "" : " " + tail;
    }
}
