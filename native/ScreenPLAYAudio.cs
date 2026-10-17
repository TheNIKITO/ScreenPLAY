// ScreenPLAYAudio: captura o som do Windows app por app (WASAPI "process loopback",
// Windows 10 build 20348+ / Windows 11) e escreve PCM 48 kHz / 16 bits / estéreo na saída padrão.
//
//   --exclude-pids 123,456 --exclude-names discord.exe,...   som do PC inteiro, menos esses apps
//   --include-hwnd 789                                       só o som do app dono dessa janela
//   --include-pid 789                                        só o som desse processo (e filhos)
//
// Mensagens vão para a saída de erro: "READY" quando começou, "ERROR ..." se não deu.
// Fecha sozinho quando a entrada padrão fecha (o ScreenPLAY saiu).
//
// Compilar: tools\build-audio.ps1 (usa o csc.exe do .NET Framework que já vem no Windows).

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace ScreenPLAYAudio
{
    static class Program
    {
        const int TickFrames = 480;   // 10 ms a 48 kHz

        static readonly object sync = new object();
        static readonly Dictionary<int, Capture> captures = new Dictionary<int, Capture>();
        static readonly HashSet<int> failed = new HashSet<int>();
        static readonly HashSet<int> excludePids = new HashSet<int>();
        static readonly HashSet<string> excludeNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        [MTAThread]
        static int Main(string[] args)
        {
            long hwnd = 0;
            int includePid = 0;
            for (int i = 0; i + 1 < args.Length; i += 2)
            {
                string key = args[i], val = args[i + 1];
                if (key == "--exclude-pids")
                {
                    foreach (string s in val.Split(','))
                    {
                        int p;
                        if (int.TryParse(s.Trim(), out p)) { excludePids.Add(p); }
                    }
                }
                else if (key == "--exclude-names")
                {
                    foreach (string s in val.Split(','))
                    {
                        if (s.Trim().Length > 0) { excludeNames.Add(s.Trim()); }
                    }
                }
                else if (key == "--include-hwnd") { long.TryParse(val, out hwnd); }
                else if (key == "--include-pid") { int.TryParse(val, out includePid); }
            }

            Native.timeBeginPeriod(1);
            int self = Process.GetCurrentProcess().Id;
            excludePids.Add(self);
            WatchStdin();

            // Este Windows tem a API? (testa capturando o próprio processo, que não toca nada)
            try
            {
                using (Capture.Start(self)) { }
            }
            catch (Exception e)
            {
                Console.Error.WriteLine("ERROR unsupported: " + e.Message);
                return 2;
            }

            if (hwnd != 0 || includePid != 0)
            {
                int pid = includePid;
                if (hwnd != 0)
                {
                    uint owner;
                    Native.GetWindowThreadProcessId(new IntPtr(hwnd), out owner);
                    pid = (int)owner;
                }
                if (pid == 0)
                {
                    Console.Error.WriteLine("ERROR window not found");
                    return 3;
                }
                try
                {
                    captures[pid] = Capture.Start(pid);
                    Log("capturing only pid " + pid);
                }
                catch (Exception e)
                {
                    Console.Error.WriteLine("ERROR " + e.Message);
                    return 4;
                }
            }
            else
            {
                Refresh();
                var watcher = new Thread(() =>
                {
                    while (true)
                    {
                        Thread.Sleep(2000);
                        try { Refresh(); }
                        catch (Exception e) { Log("refresh failed: " + e.Message); }
                    }
                });
                watcher.IsBackground = true;
                watcher.Start();
            }

            Console.Error.WriteLine("READY");
            MixLoop();
            return 0;
        }

        static void Log(string msg)
        {
            Console.Error.WriteLine("INFO " + msg);
        }

        static void WatchStdin()
        {
            var t = new Thread(() =>
            {
                try
                {
                    Stream input = Console.OpenStandardInput();
                    var b = new byte[64];
                    while (input.Read(b, 0, b.Length) > 0) { }
                }
                catch { }
                Environment.Exit(0);
            });
            t.IsBackground = true;
            t.Start();
        }

        // Modo "PC inteiro": captura cada app que tem som, menos os excluídos e seus filhos.
        static void Refresh()
        {
            Dictionary<int, ProcInfo> procs = ProcessTable.Snapshot();
            HashSet<int> sessions = AudioSessions.Pids();
            var wanted = new HashSet<int>();
            foreach (int pid in sessions)
            {
                if (!procs.ContainsKey(pid)) { continue; }
                if (IsExcluded(pid, procs)) { continue; }
                if (AncestorHasSession(pid, procs, sessions)) { continue; }   // a captura do "pai" já inclui
                wanted.Add(pid);
            }

            var toStart = new List<int>();
            var toStop = new List<Capture>();
            lock (sync)
            {
                foreach (int pid in wanted)
                {
                    if (!captures.ContainsKey(pid) && !failed.Contains(pid)) { toStart.Add(pid); }
                }
                var gone = new List<int>();
                foreach (var kv in captures)
                {
                    if (!wanted.Contains(kv.Key)) { gone.Add(kv.Key); }
                }
                foreach (int pid in gone)
                {
                    toStop.Add(captures[pid]);
                    captures.Remove(pid);
                    Log("stopped pid " + pid);
                }
            }
            foreach (Capture c in toStop) { c.Dispose(); }

            foreach (int pid in toStart)
            {
                try
                {
                    Capture c = Capture.Start(pid);
                    lock (sync) { captures[pid] = c; }
                    Log("capturing pid " + pid + " " + procs[pid].Name);
                }
                catch (Exception e)
                {
                    lock (sync) { failed.Add(pid); }
                    Log("skip pid " + pid + " " + procs[pid].Name + ": " + e.Message);
                }
            }
            foreach (int pid in sessions)
            {
                if (procs.ContainsKey(pid) && IsExcluded(pid, procs) && excludedLogged.Add(pid))
                {
                    Log("excluded pid " + pid + " " + procs[pid].Name);
                }
            }
        }
        static readonly HashSet<int> excludedLogged = new HashSet<int>();

        static bool IsExcluded(int pid, Dictionary<int, ProcInfo> procs)
        {
            var seen = new HashSet<int>();
            int cur = pid;
            for (int depth = 0; depth < 32 && cur > 0 && seen.Add(cur); depth++)
            {
                if (excludePids.Contains(cur)) { return true; }
                ProcInfo info;
                if (!procs.TryGetValue(cur, out info)) { return false; }
                if (excludeNames.Contains(info.Name)) { return true; }
                cur = info.Parent;
            }
            return false;
        }

        static bool AncestorHasSession(int pid, Dictionary<int, ProcInfo> procs, HashSet<int> sessions)
        {
            var seen = new HashSet<int> { pid };
            ProcInfo info;
            if (!procs.TryGetValue(pid, out info)) { return false; }
            int cur = info.Parent;
            for (int depth = 0; depth < 32 && cur > 0 && seen.Add(cur); depth++)
            {
                if (sessions.Contains(cur) && !IsExcluded(cur, procs)) { return true; }
                if (!procs.TryGetValue(cur, out info)) { return false; }
                cur = info.Parent;
            }
            return false;
        }

        // Junta todas as capturas em blocos de 10 ms e manda para a saída padrão.
        static void MixLoop()
        {
            Stream output = Console.OpenStandardOutput();
            var sw = Stopwatch.StartNew();
            long tick = 0;
            var acc = new int[TickFrames * 2];
            var tmp = new byte[TickFrames * 4];
            var outBuf = new byte[TickFrames * 4];
            while (true)
            {
                long due = (tick + 1) * 10;
                long now = sw.ElapsedMilliseconds;
                if (now < due)
                {
                    Thread.Sleep((int)Math.Max(1, Math.Min(5, due - now)));
                    continue;
                }
                if (now - due > 500) { tick = now / 10; continue; }   // ficou para trás (PC suspenso etc.)

                Array.Clear(acc, 0, acc.Length);
                lock (sync)
                {
                    foreach (Capture c in captures.Values)
                    {
                        int n = c.Ring.Read(tmp, tmp.Length);
                        for (int i = 0, s = 0; i + 1 < n; i += 2, s++)
                        {
                            acc[s] += (short)(tmp[i] | (tmp[i + 1] << 8));
                        }
                    }
                }
                for (int s = 0; s < acc.Length; s++)
                {
                    int v = acc[s];
                    if (v > 32767) { v = 32767; } else if (v < -32768) { v = -32768; }
                    outBuf[s * 2] = (byte)v;
                    outBuf[s * 2 + 1] = (byte)(v >> 8);
                }
                try
                {
                    output.Write(outBuf, 0, outBuf.Length);
                    output.Flush();
                }
                catch (IOException)
                {
                    Environment.Exit(0);
                }
                tick++;
            }
        }
    }

    // Fila circular de áudio de uma captura (com um pouco de folga para não engasgar).
    sealed class Ring
    {
        const int Size = 48000 * 4;          // 1 s
        const int Prime = 48000 * 4 / 50;    // 20 ms
        const int MaxKeep = 48000 * 4 / 8;   // 125 ms
        readonly byte[] data = new byte[Size];
        int read, count;
        bool primed;

        public void Write(byte[] src, int n)
        {
            lock (this)
            {
                if (n > Size) { return; }
                if (count + n > Size)
                {
                    int drop = count + n - Size;
                    read = (read + drop) % Size;
                    count -= drop;
                }
                int write = (read + count) % Size;
                int first = Math.Min(n, Size - write);
                System.Buffer.BlockCopy(src, 0, data, write, first);
                if (n > first) { System.Buffer.BlockCopy(src, first, data, 0, n - first); }
                count += n;
                if (count > MaxKeep)
                {
                    int drop = count - Prime * 2;
                    drop -= drop % 4;
                    read = (read + drop) % Size;
                    count -= drop;
                }
            }
        }

        public int Read(byte[] dst, int n)
        {
            lock (this)
            {
                if (!primed)
                {
                    if (count < Prime) { return 0; }
                    primed = true;
                }
                int m = Math.Min(n, count);
                m -= m % 4;
                int first = Math.Min(m, Size - read);
                System.Buffer.BlockCopy(data, read, dst, 0, first);
                if (m > first) { System.Buffer.BlockCopy(data, 0, dst, first, m - first); }
                read = (read + m) % Size;
                count -= m;
                if (m < n) { primed = false; }
                return m;
            }
        }
    }

    // Uma captura "process loopback" (inclui o processo e os filhos dele).
    sealed class Capture : IDisposable
    {
        public readonly Ring Ring = new Ring();
        IAudioClient client;
        IAudioCaptureClient cap;
        AutoResetEvent evt;
        Thread thread;
        volatile bool stopping;
        object keepOp, keepHandler;

        public static Capture Start(int pid)
        {
            var c = new Capture();
            try { c.Open(pid); }
            catch { c.Dispose(); throw; }
            return c;
        }

        void Open(int pid)
        {
            IntPtr pParams = Marshal.AllocHGlobal(12);
            IntPtr pv = Marshal.AllocHGlobal(24);
            try
            {
                Marshal.WriteInt32(pParams, 0, 1);     // AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
                Marshal.WriteInt32(pParams, 4, pid);
                Marshal.WriteInt32(pParams, 8, 0);     // PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
                for (int i = 0; i < 24; i += 4) { Marshal.WriteInt32(pv, i, 0); }
                Marshal.WriteInt16(pv, 0, 65);         // PROPVARIANT VT_BLOB
                Marshal.WriteInt32(pv, 8, 12);
                Marshal.WriteIntPtr(pv, IntPtr.Size == 8 ? 16 : 12, pParams);

                var handler = new Completion();
                IActivateAudioInterfaceAsyncOperation op;
                Guid iid = Native.IID_IAudioClient;
                Native.Check(Native.ActivateAudioInterfaceAsync("VAD\\Process_Loopback", ref iid, pv, handler, out op), "activate");
                if (!handler.Done.WaitOne(5000)) { throw new Exception("activate timeout"); }
                int hr;
                object iface;
                Native.Check(op.GetActivateResult(out hr, out iface), "activate result");
                Native.Check(hr, "activate");
                client = (IAudioClient)iface;
                keepOp = op;
                keepHandler = handler;
            }
            finally
            {
                Marshal.FreeHGlobal(pv);
                Marshal.FreeHGlobal(pParams);
            }

            var fmt = new WAVEFORMATEX
            {
                wFormatTag = 1, nChannels = 2, nSamplesPerSec = 48000,
                nAvgBytesPerSec = 192000, nBlockAlign = 4, wBitsPerSample = 16, cbSize = 0
            };
            const uint flags = 0x00020000u | 0x00040000u | 0x80000000u | 0x08000000u; // LOOPBACK | EVENTCALLBACK | AUTOCONVERTPCM | SRC_DEFAULT_QUALITY
            Native.Check(client.Initialize(0, flags, 400000, 0, ref fmt, IntPtr.Zero), "initialize");
            object svc;
            Guid iidCap = Native.IID_IAudioCaptureClient;
            Native.Check(client.GetService(ref iidCap, out svc), "capture client");
            cap = (IAudioCaptureClient)svc;
            evt = new AutoResetEvent(false);
            Native.Check(client.SetEventHandle(evt.SafeWaitHandle.DangerousGetHandle()), "event");
            Native.Check(client.Start(), "start");
            thread = new Thread(Loop);
            thread.IsBackground = true;
            thread.Start();
        }

        void Loop()
        {
            var tmp = new byte[48000 * 4 / 10];
            while (!stopping)
            {
                if (!evt.WaitOne(200)) { continue; }
                uint packet;
                if (cap.GetNextPacketSize(out packet) != 0) { return; }
                while (packet > 0 && !stopping)
                {
                    IntPtr data;
                    uint frames, bufFlags;
                    ulong pos, qpc;
                    if (cap.GetBuffer(out data, out frames, out bufFlags, out pos, out qpc) != 0) { return; }
                    int bytes = (int)frames * 4;
                    if (bytes > tmp.Length) { tmp = new byte[bytes]; }
                    if ((bufFlags & 2) != 0) { Array.Clear(tmp, 0, bytes); }   // AUDCLNT_BUFFERFLAGS_SILENT
                    else { Marshal.Copy(data, tmp, 0, bytes); }
                    Ring.Write(tmp, bytes);
                    cap.ReleaseBuffer(frames);
                    if (cap.GetNextPacketSize(out packet) != 0) { return; }
                }
            }
        }

        public void Dispose()
        {
            stopping = true;
            if (thread != null) { thread.Join(500); }
            try { if (client != null) { client.Stop(); } } catch { }
            try { if (cap != null) { Marshal.ReleaseComObject(cap); } } catch { }
            try { if (client != null) { Marshal.ReleaseComObject(client); } } catch { }
            cap = null;
            client = null;
        }
    }

    sealed class Completion : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        public readonly ManualResetEvent Done = new ManualResetEvent(false);
        public int ActivateCompleted(IActivateAudioInterfaceAsyncOperation op)
        {
            Done.Set();
            return 0;
        }
    }

    struct ProcInfo
    {
        public int Parent;
        public string Name;
    }

    static class ProcessTable
    {
        public static Dictionary<int, ProcInfo> Snapshot()
        {
            var map = new Dictionary<int, ProcInfo>();
            IntPtr snap = Native.CreateToolhelp32Snapshot(2, 0);   // TH32CS_SNAPPROCESS
            if (snap == new IntPtr(-1)) { return map; }
            try
            {
                var e = new PROCESSENTRY32W();
                e.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32W));
                if (Native.Process32FirstW(snap, ref e))
                {
                    do
                    {
                        map[(int)e.th32ProcessID] = new ProcInfo { Parent = (int)e.th32ParentProcessID, Name = e.szExeFile };
                    } while (Native.Process32NextW(snap, ref e));
                }
            }
            finally
            {
                Native.CloseHandle(snap);
            }
            return map;
        }
    }

    // Quais processos têm som (sessões de áudio) em qualquer saída de som ativa.
    static class AudioSessions
    {
        public static HashSet<int> Pids()
        {
            var pids = new HashSet<int>();
            var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorCo();
            IMMDeviceCollection devices;
            Native.Check(enumerator.EnumAudioEndpoints(0, 1, out devices), "endpoints");   // eRender, ACTIVE
            uint count;
            devices.GetCount(out count);
            for (uint d = 0; d < count; d++)
            {
                IMMDevice device;
                if (devices.Item(d, out device) != 0) { continue; }
                Guid iid = Native.IID_IAudioSessionManager2;
                object obj;
                if (device.Activate(ref iid, 23, IntPtr.Zero, out obj) != 0) { continue; }
                var manager = (IAudioSessionManager2)obj;
                IAudioSessionEnumerator sessions;
                if (manager.GetSessionEnumerator(out sessions) != 0) { continue; }
                int n;
                sessions.GetCount(out n);
                for (int i = 0; i < n; i++)
                {
                    object s;
                    if (sessions.GetSession(i, out s) != 0) { continue; }
                    var ctl = (IAudioSessionControl2)s;
                    int state;
                    uint pid;
                    if (ctl.GetState(out state) != 0 || state == 2) { continue; }   // expirada
                    if (ctl.GetProcessId(out pid) != 0 || pid == 0) { continue; }
                    pids.Add((int)pid);
                }
            }
            return pids;
        }
    }

    // ---------------- Windows / COM ----------------

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    struct WAVEFORMATEX
    {
        public ushort wFormatTag;
        public ushort nChannels;
        public uint nSamplesPerSec;
        public uint nAvgBytesPerSec;
        public ushort nBlockAlign;
        public ushort wBitsPerSample;
        public ushort cbSize;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct PROCESSENTRY32W
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    static class Native
    {
        public static readonly Guid IID_IAudioClient = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
        public static readonly Guid IID_IAudioCaptureClient = new Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317");
        public static readonly Guid IID_IAudioSessionManager2 = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");

        public static void Check(int hr, string what)
        {
            if (hr < 0) { throw new Exception(what + " failed (0x" + hr.ToString("X8") + ")"); }
        }

        [DllImport("Mmdevapi.dll", ExactSpelling = true)]
        public static extern int ActivateAudioInterfaceAsync(
            [MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath, ref Guid riid, IntPtr activationParams,
            IActivateAudioInterfaceCompletionHandler completionHandler, out IActivateAudioInterfaceAsyncOperation operation);

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        public static extern bool Process32FirstW(IntPtr snapshot, ref PROCESSENTRY32W entry);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        public static extern bool Process32NextW(IntPtr snapshot, ref PROCESSENTRY32W entry);

        [DllImport("kernel32.dll")]
        public static extern bool CloseHandle(IntPtr handle);

        [DllImport("winmm.dll")]
        public static extern uint timeBeginPeriod(uint ms);
    }

    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceAsyncOperation
    {
        [PreserveSig] int GetActivateResult(out int activateResult, [MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface);
    }

    [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceCompletionHandler
    {
        [PreserveSig] int ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation);
    }

    [ComImport, Guid("94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAgileObject { }

    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioClient
    {
        [PreserveSig] int Initialize(int shareMode, uint streamFlags, long bufferDuration, long periodicity, ref WAVEFORMATEX format, IntPtr audioSessionGuid);
        [PreserveSig] int GetBufferSize(out uint frames);
        [PreserveSig] int GetStreamLatency(out long latency);
        [PreserveSig] int GetCurrentPadding(out uint padding);
        [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closestMatch);
        [PreserveSig] int GetMixFormat(out IntPtr format);
        [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr eventHandle);
        [PreserveSig] int GetService(ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioCaptureClient
    {
        [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
        [PreserveSig] int ReleaseBuffer(uint frames);
        [PreserveSig] int GetNextPacketSize(out uint frames);
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorCo { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int Item(uint index, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2
    {
        [PreserveSig] int GetAudioSessionControl(IntPtr sessionGuid, int streamFlags, out IntPtr sessionControl);
        [PreserveSig] int GetSimpleAudioVolume(IntPtr sessionGuid, int streamFlags, out IntPtr volume);
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessionEnum);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetSession(int index, [MarshalAs(UnmanagedType.IUnknown)] out object session);
    }

    [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl2
    {
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName(out IntPtr name);
        [PreserveSig] int SetDisplayName(IntPtr name, IntPtr eventContext);
        [PreserveSig] int GetIconPath(out IntPtr path);
        [PreserveSig] int SetIconPath(IntPtr path, IntPtr eventContext);
        [PreserveSig] int GetGroupingParam(out Guid groupingParam);
        [PreserveSig] int SetGroupingParam(ref Guid groupingParam, IntPtr eventContext);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr client);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr client);
        [PreserveSig] int GetSessionIdentifier(out IntPtr id);
        [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr id);
        [PreserveSig] int GetProcessId(out uint processId);
    }
}
