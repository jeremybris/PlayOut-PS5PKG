// PlayOut's PS5 package helper: unpacks fake/debug PS5 packages (FPKG) into game folders with PS5PKGTool's own
// extraction (PS5PKGTool.Core.Services.SonyPackageExtraction, GPL-3.0), the same files PS5PKGTool's Extract writes.
// Copyright (C) 2026 PlayOut contributors. GPL-3.0-or-later (see LICENSE); PS5PKGTool by pearlxcore, GPL-3.0.
//
// Output: one JSON object per line on stdout (see README.md). Anything the libraries print goes to stderr.

using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using PS5PKGTool.Core.Builders;
using PS5PKGTool.Core.Models;
using PS5PKGTool.Core.Parsers;
using PS5PKGTool.Core.Services;

namespace PlayOutPs5Pkg;

internal static class Program
{
    /// <summary>The csproj's Version (one place to change it).</summary>
    private static readonly string Version =
        typeof(Program).Assembly.GetName().Version is { } v ? $"{v.Major}.{v.Minor}.{v.Build}" : "unknown";
    private static TextWriter _stdout = Console.Out;
    private static readonly object Gate = new();

    private static int Main(string[] args)
    {
        _stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
        Console.SetOut(Console.Error);
        try
        {
            if (args.Length == 0 || args[0] is "--help" or "-h") return Usage();
            if (args[0] == "--version")
            {
                Write(new JsonObject { ["type"] = "version", ["version"] = Version, ["engine"] = EngineVersion() });
                return 0;
            }
            return args[0] switch
            {
                "info" when args.Length == 2 => Info(args[1]),
                "extract" when args.Length >= 3 => Extract(args[1], args[2], args.Skip(3).ToArray()),
                _ => Usage()
            };
        }
        catch (Exception ex)
        {
            Fail(ex.Message, ex is FileNotFoundException or DirectoryNotFoundException ? "missing" : "failed");
            return 1;
        }
    }

    private static int Usage()
    {
        Console.Error.WriteLine("PlayOutPs5Pkg info <package.pkg>");
        Console.Error.WriteLine("PlayOutPs5Pkg extract <package.pkg> <outDir> [--passcode <32 characters>]");
        Console.Error.WriteLine("PlayOutPs5Pkg --version | --help");
        return 2;
    }

    private static string EngineVersion() =>
        typeof(SonyPackageExtraction).Assembly.GetName().Version?.ToString() ?? "unknown";

    /// <summary>What the package is: only kind "fpkg" (a finalized debug/fake base package) can be unpacked.</summary>
    private static int Info(string path)
    {
        var full = Path.GetFullPath(path);
        if (!File.Exists(full)) throw new FileNotFoundException("The package does not exist: " + full);
        var reader = new SonyPkgReader();
        if (!reader.IsSonyPackage(full))
        {
            Write(new JsonObject { ["type"] = "done", ["kind"] = "unknown", ["unpackable"] = false });
            return 0;
        }
        SonyPkgSummary summary = reader.Read(full);
        Write(new JsonObject
        {
            ["type"] = "done",
            ["kind"] = KindName(summary.Kind),
            ["unpackable"] = summary.Kind == SonyPkgKind.FinalizedDebug,
            ["contentId"] = summary.ContentId,
            ["contentType"] = summary.ContentType,
            ["size"] = summary.FileSize
        });
        return 0;
    }

    private static string KindName(SonyPkgKind kind) => kind switch
    {
        SonyPkgKind.FinalizedDebug => "fpkg",
        SonyPkgKind.FinalizedPatch => "patch",
        SonyPkgKind.FinalizedRetail => "retail",
        SonyPkgKind.MetadataContainer => "metadata",
        _ => "unknown"
    };

    /// <summary>
    /// Unpacks a fake/debug base package into <paramref name="outDir"/> (which must not exist): PS5PKGTool stages the
    /// files in a sibling folder and moves it into place only when every file is written. Retail and patch packages
    /// are refused before anything is written (retail ones are locked with Sony's keys; patches need their base).
    /// </summary>
    private static int Extract(string path, string outDir, string[] options)
    {
        var full = Path.GetFullPath(path);
        if (!File.Exists(full)) throw new FileNotFoundException("The package does not exist: " + full);
        string passcode = SonyDebugPackageCredentials.DefaultPasscode;
        for (int i = 0; i < options.Length; i++)
        {
            if (options[i] == "--passcode" && i + 1 < options.Length) passcode = options[++i];
            else return Usage();
        }
        if (passcode.Length != 32 || passcode.Any(c => c < 0x20 || c > 0x7e))
        {
            Fail("The passcode must be 32 printable characters.", "passcode");
            return 1;
        }

        var reader = new SonyPkgReader();
        if (!reader.IsSonyPackage(full))
        {
            Fail("This is not a PS5 package.", "notPs5");
            return 1;
        }
        SonyPkgKind kind = reader.Read(full, passcode).Kind;
        if (kind == SonyPkgKind.FinalizedRetail)
        {
            Fail("This is a retail package: it is locked with Sony's keys, so it cannot be unpacked. Only fake (FPKG) packages can.", "retail");
            return 1;
        }
        if (kind == SonyPkgKind.FinalizedPatch)
        {
            Fail("This is an update (patch) package: it can only be unpacked together with its game, which is not supported yet.", "patch");
            return 1;
        }
        if (kind != SonyPkgKind.FinalizedDebug)
        {
            Fail("This package holds no game files to unpack.", "unsupported");
            return 1;
        }

        var target = Path.GetFullPath(outDir);
        if (Directory.Exists(target) || File.Exists(target))
        {
            Fail("The destination already exists: " + target, "exists");
            return 1;
        }

        var clock = Stopwatch.StartNew();
        long lastReport = -1000;
        var progress = new SyncProgress(p =>
        {
            if (clock.ElapsedMilliseconds - lastReport < 250 && p.CompletedBytes < p.TotalBytes) return;
            lastReport = clock.ElapsedMilliseconds;
            Write(new JsonObject
            {
                ["type"] = "progress",
                ["done"] = p.CompletedBytes,
                ["total"] = p.TotalBytes,
                ["percent"] = p.TotalBytes > 0 ? Math.Floor(100.0 * p.CompletedBytes / p.TotalBytes) : 0,
                ["path"] = p.CurrentPath
            });
        });
        // Reading the package (decrypting and decompressing its image) comes first and reports nothing.
        Write(new JsonObject { ["type"] = "progress", ["phase"] = "reading", ["done"] = 0, ["total"] = 0, ["percent"] = 0 });
        SonyPackageExtractResult result;
        try
        {
            result = SonyPackageExtraction
                .ExtractAsync(full, target, passcode, progress, CancellationToken.None)
                .GetAwaiter()
                .GetResult();
        }
        catch (InvalidDataException ex) when (
            !ex.Message.StartsWith("This package uses a format", StringComparison.Ordinal) &&
            (ex.Message.StartsWith("Package contents could not be decoded", StringComparison.Ordinal) ||
             ex.Message.Contains("require a passcode", StringComparison.Ordinal)))
        {
            // A fake package made with its own passcode (not the default 32 zeros) cannot be read without it.
            Fail(passcode == SonyDebugPackageCredentials.DefaultPasscode
                ? "This package could not be decrypted with the default passcode: it was probably made with its own passcode, or it is damaged. (" + ex.Message + ")"
                : "This package could not be decrypted with that passcode, or it is damaged. (" + ex.Message + ")", "passcode");
            return 1;
        }
        Write(new JsonObject
        {
            ["type"] = "done",
            ["dest"] = result.Destination,
            ["files"] = result.FileCount,
            ["bytes"] = result.ExtractedBytes,
            ["seconds"] = Math.Round(clock.Elapsed.TotalSeconds, 1)
        });
        return 0;
    }

    private static void Fail(string message, string code) =>
        Write(new JsonObject { ["type"] = "error", ["code"] = code, ["message"] = message });

    private static void Write(JsonNode node)
    {
        var line = node.ToJsonString(new JsonSerializerOptions
        {
            Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
        });
        lock (Gate) _stdout.WriteLine(line);
    }

    /// <summary>IProgress that runs on the reporting thread (Progress&lt;T&gt; would post to a thread pool).</summary>
    private sealed class SyncProgress(Action<SonyPackageExtractProgress> report) : IProgress<SonyPackageExtractProgress>
    {
        public void Report(SonyPackageExtractProgress value) => report(value);
    }
}
