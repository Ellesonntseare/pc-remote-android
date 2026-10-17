// PC Remote desktop agent. Runs only as the signed-in Windows user while the
// user has explicitly started the visible Node server and a paired viewer connects.
// Binary stdout: [1-byte type][4-byte BE length][JPEG frame or JSON metadata].
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;

internal static class Program
{
    private static readonly object OutputLock = new();
    private static volatile bool running = true;
    private static Rectangle primary;

    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length != 3 || !int.TryParse(args[0], out int fps)
            || !long.TryParse(args[1], out long quality)
            || !double.TryParse(args[2], NumberStyles.Float, CultureInfo.InvariantCulture, out double scale)
            || fps < 1 || fps > 15 || quality < 20 || quality > 90 || scale < .25 || scale > 1.0)
        {
            Console.Error.WriteLine("Usage: RemoteAgent <fps:1..15> <jpeg-quality:20..90> <scale:0.25..1>");
            Environment.ExitCode = 2;
            return;
        }
        try
        {
            Native.SetProcessDPIAware();
            primary = Screen.PrimaryScreen?.Bounds ?? throw new InvalidOperationException("No active desktop monitor");
            if (primary.Width <= 0 || primary.Height <= 0) throw new InvalidOperationException("Invalid monitor size");
            int outW = Math.Max(1, (int)Math.Round(primary.Width * scale));
            int outH = Math.Max(1, (int)Math.Round(primary.Height * scale));
            int msPerFrame = Math.Max(65, 1000 / fps);
            var stdout = Console.OpenStandardOutput();
            Send(stdout, 1, JsonSerializer.SerializeToUtf8Bytes(new { w = primary.Width, h = primary.Height }));
            using var source = new Bitmap(primary.Width, primary.Height, PixelFormat.Format24bppRgb);
            using var small = new Bitmap(outW, outH, PixelFormat.Format24bppRgb);
            using var capture = Graphics.FromImage(source);
            using var scaled = Graphics.FromImage(small);
            scaled.InterpolationMode = InterpolationMode.Bilinear;
            var jpeg = ImageCodecInfo.GetImageEncoders().First(e => e.MimeType == "image/jpeg");
            using var encoder = new EncoderParameters(1);
            encoder.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
            _ = Task.Run(() => ProcessInput(stdout));
            using var memory = new MemoryStream();
            while (running)
            {
                var start = Environment.TickCount64;
                try
                {
                    capture.CopyFromScreen(primary.Left, primary.Top, 0, 0, primary.Size);
                    DrawCursor(capture);
                    Image image = source;
                    if (outW != primary.Width || outH != primary.Height)
                    {
                        scaled.DrawImage(source, new Rectangle(0, 0, outW, outH));
                        image = small;
                    }
                    memory.Position = 0;
                    memory.SetLength(0);
                    image.Save(memory, jpeg, encoder);
                    Send(stdout, 0, memory.ToArray());
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("Capture unavailable (desktop locked or permission denied): " + ex.Message);
                    Thread.Sleep(500);
                }
                int remaining = msPerFrame - (int)(Environment.TickCount64 - start);
                if (remaining > 0) Thread.Sleep(remaining);
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("Desktop agent error: " + ex);
            Environment.ExitCode = 1;
        }
    }

    private static void Send(Stream output, byte type, byte[] payload)
    {
        Span<byte> header = stackalloc byte[5];
        header[0] = type;
        header[1] = (byte)(payload.Length >> 24);
        header[2] = (byte)(payload.Length >> 16);
        header[3] = (byte)(payload.Length >> 8);
        header[4] = (byte)payload.Length;
        lock (OutputLock)
        {
            output.Write(header);
            output.Write(payload);
            output.Flush();
        }
    }

    private static void DrawCursor(Graphics g)
    {
        var cursor = new Native.CURSORINFO { cbSize = Marshal.SizeOf<Native.CURSORINFO>() };
        if (!Native.GetCursorInfo(ref cursor) || (cursor.flags & 1) == 0) return;
        int hotX = 0, hotY = 0;
        if (Native.GetIconInfo(cursor.hCursor, out var info))
        {
            hotX = (int)info.xHotspot;
            hotY = (int)info.yHotspot;
            if (info.hbmMask != IntPtr.Zero) Native.DeleteObject(info.hbmMask);
            if (info.hbmColor != IntPtr.Zero) Native.DeleteObject(info.hbmColor);
        }
        IntPtr hdc = g.GetHdc();
        try { Native.DrawIconEx(hdc, cursor.pt.X - primary.Left - hotX, cursor.pt.Y - primary.Top - hotY,
            cursor.hCursor, 0, 0, 0, IntPtr.Zero, 3); }
        finally { g.ReleaseHdc(hdc); }
    }

    private static void ProcessInput(Stream output)
    {
        try
        {
            string? line;
            while ((line = Console.ReadLine()) != null)
            {
                // Acknowledged commands are used by the phone typing panel only.
                // An acknowledgement means Windows accepted SendInput, not that a
                // particular application accepted text (e.g. UAC/secure desktop).
                if (line.StartsWith("ack ", StringComparison.Ordinal))
                {
                    var fields = line.Split(' ', 3);
                    if (fields.Length != 3) continue;
                    try
                    {
                        Execute(fields[2]);
                        Send(output, 2, JsonSerializer.SerializeToUtf8Bytes(new { id = fields[1], ok = true }));
                    }
                    catch (Exception ex)
                    {
                        Console.Error.WriteLine("Desktop typing failed: " + ex.Message);
                        Send(output, 2, JsonSerializer.SerializeToUtf8Bytes(new { id = fields[1], ok = false, error = ex.Message }));
                    }
                }
                else
                {
                    try { Execute(line); }
                    catch (Exception ex) { Console.Error.WriteLine("Invalid desktop input: " + ex.Message); }
                }
            }
        }
        finally { running = false; }
    }

    private static int Number(string s) => int.Parse(s, CultureInfo.InvariantCulture);
    private static void Execute(string line)
    {
        var parts = line.Split(' ', 2, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 1) return;
        var words = (parts.Length > 1 ? parts[1] : "").Split(' ', StringSplitOptions.RemoveEmptyEntries);
        switch (parts[0])
        {
            case "mv":
                if (words.Length != 2) return;
                if (Native.GetCursorPos(out var pos))
                    Native.SetCursorPos(pos.X + Number(words[0]), pos.Y + Number(words[1]));
                break;
            case "abs":
                if (words.Length != 2) return;
                Native.SetCursorPos(primary.Left + Math.Clamp(Number(words[0]), 0, primary.Width - 1),
                    primary.Top + Math.Clamp(Number(words[1]), 0, primary.Height - 1));
                break;
            case "wheel":
                if (words.Length != 1) return;
                Native.mouse_event(0x0800, 0, 0, Number(words[0]), UIntPtr.Zero);
                break;
            case "click": case "down": case "up":
                if (words.Length != 1 || words[0].Length != 1) return;
                PressMouse(words[0][0], parts[0]);
                break;
            case "dbl": PressMouse('l', "click"); Thread.Sleep(75); PressMouse('l', "click"); break;
            case "key": case "keydown": case "keyup":
                if (words.Length != 1) return;
                PressKey(Number(words[0]), parts[0]);
                break;
            case "combo":
                if (words.Length != 1) return;
                var keys = words[0].Split(',').Select(Number).ToArray();
                foreach (int key in keys) PressKey(key, "keydown");
                foreach (int key in keys.Reverse()) PressKey(key, "keyup");
                break;
            case "text":
                if (words.Length != 1) return;
                var bytes = Convert.FromBase64String(words[0]);
                if (bytes.Length > 600) return;
                var inputText = new UTF8Encoding(false, true).GetString(bytes);
                foreach (char ch in inputText)
                {
                    if (ch == '\r') continue;
                    if (ch == '\n') { PressKey(13, "key"); continue; }
                    SendUnicode(ch);
                }
                break;
        }
    }

    private static void PressMouse(char button, string kind)
    {
        (uint down, uint up) = button switch
        {
            'l' => (0x0002u, 0x0004u), 'r' => (0x0008u, 0x0010u), 'm' => (0x0020u, 0x0040u),
            _ => (0u, 0u)
        };
        if (down == 0) return;
        if (kind != "up") Native.mouse_event(down, 0, 0, 0, UIntPtr.Zero);
        if (kind != "down") Native.mouse_event(up, 0, 0, 0, UIntPtr.Zero);
    }
    private static void PressKey(int value, string kind)
    {
        if (value < 0 || value > 255) return;
        if (kind != "keyup") Native.keybd_event((byte)value, 0, 0, UIntPtr.Zero);
        if (kind != "keydown") Native.keybd_event((byte)value, 0, 2, UIntPtr.Zero);
    }
    private static void SendUnicode(char value)
    {
        var down = new Native.INPUT { type = 1, U = new Native.INPUTUNION { ki = new Native.KEYBDINPUT { wScan = value, dwFlags = 0x0004 } } };
        var up = new Native.INPUT { type = 1, U = new Native.INPUTUNION { ki = new Native.KEYBDINPUT { wScan = value, dwFlags = 0x0004 | 0x0002 } } };
        var inputs = new[] { down, up };
        uint inserted = Native.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<Native.INPUT>());
        if (inserted != inputs.Length)
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(),
                "Windows refused Unicode keyboard input (check that the desktop is unlocked and the target app is not elevated)");
    }
}

internal static class Native
{
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] public struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public POINT pt; }
    [StructLayout(LayoutKind.Sequential)] public struct ICONINFO { [MarshalAs(UnmanagedType.Bool)] public bool fIcon; public uint xHotspot; public uint yHotspot; public IntPtr hbmMask; public IntPtr hbmColor; }
    [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION U; }
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool GetCursorInfo(ref CURSORINFO info);
    [DllImport("user32.dll")] public static extern bool GetIconInfo(IntPtr cursor, out ICONINFO info);
    [DllImport("user32.dll")] public static extern bool DrawIconEx(IntPtr hdc, int x, int y, IntPtr icon, int cx, int cy, int step, IntPtr brush, int flags);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr obj);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int delta, UIntPtr extra);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
}
