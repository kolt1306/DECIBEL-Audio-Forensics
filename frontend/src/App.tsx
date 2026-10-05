import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import SignalAtmosphere from "./components/SignalAtmosphere";
import SignalCursor from "./components/SignalCursor";
import ProbabilityReadout from "./components/ProbabilityReadout";
import { reveal, disclose } from "./lib/motion";
import {
  ArrowDown,
  ArrowUpRight,
  AudioLines,
  Check,
  ChevronRight,
  FileAudio,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Square,
  Upload,
  X,
} from "lucide-react";
import SignalField from "./components/SignalField";
import RiskScale from "./components/RiskScale";
import SegmentTimeline from "./components/SegmentTimeline";
import Investigation from "./components/Investigation";
import BatchAnalysis from "./components/BatchAnalysis";
import { decodeFile, time, type SignalAudio } from "./lib/audio";
import {
  submitAnalysis,
  readJob,
  cancelJob,
  jobFailure,
  waitForPoll,
  getHealth,
  type Analysis,
  type Comparison,
  type Job,
  type Health,
} from "./lib/api";
import { useRecorder } from "./hooks/useRecorder";

const verdicts = {
  real: "Real voice",
  possible_deepfake: "Possible deepfake",
  deepfake: "Deepfake detected",
};
export default function App() {
  const reduced = useReducedMotion();
  const entrance = reduced ? { duration: 0 } : reveal;
  const [signal, setSignal] = useState<SignalAudio | null>(null);
  const signalRef = useRef<SignalAudio | null>(null);
  const [phone, setPhone] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [compare, setCompare] = useState(false);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const jobRef = useRef<Job | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const batchInput = useRef<HTMLInputElement>(null);
  const [region, setRegion] = useState<{ start: number; end: number } | null>(
    null,
  );
  const regionRef = useRef<{ start: number; end: number } | null>(null);
  const [loop, setLoop] = useState(false);
  const loopRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const [analyzing, setAnalyzing] = useState(false);
  const busyRef = useRef(false);
  const [result, setResult] = useState<Analysis | null>(null);
  const [error, setError] = useState("");
  const [health, setHealth] = useState<Health | null>(null);
  const [connection, setConnection] = useState("Connecting to API");
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showMethod, setShowMethod] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const player = useRef<HTMLAudioElement>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const dragDepth = useRef(0);
  const checkBackend = async (abort?: AbortSignal) => {
    try {
      const h = await getHealth(abort);
      if (!abort?.aborted) {
        setHealth(h);
        setConnection(h.model_loaded ? "Model online" : "Model offline");
      }
    } catch {
      if (!abort?.aborted) {
        setHealth(null);
        setConnection("API unreachable");
      }
    }
  };
  useEffect(() => {
    const c = new AbortController();
    void checkBackend(c.signal);
    const timer = setInterval(() => {
      void checkBackend(c.signal);
    }, 30000);
    return () => {
      c.abort();
      clearInterval(timer);
      generation.current++;
      request.current?.abort();
      const active = jobRef.current;
      if (active && ["queued", "processing"].includes(active.state))
        void cancelJob(active.job_id).catch(() => {});
      if (signalRef.current) URL.revokeObjectURL(signalRef.current.url);
    };
  }, []);
  const selectFile = async (file: File) => {
    if (busyRef.current || loadingRef.current) return;
    const id = ++generation.current;
    loadingRef.current = true;
    setLoading(true);
    setError("");
    setResult(null);
    setComparison(null);
    setRegion(null);
    regionRef.current = null;
    player.current?.pause();
    setPlaying(false);
    setProgress(0);
    try {
      const next = await decodeFile(file);
      if (id !== generation.current) {
        URL.revokeObjectURL(next.url);
        return;
      }
      if (signalRef.current) URL.revokeObjectURL(signalRef.current.url);
      signalRef.current = next;
      setSignal(next);
    } catch (e) {
      if (id === generation.current) {
        if (signalRef.current) URL.revokeObjectURL(signalRef.current.url);
        signalRef.current = null;
        setSignal(null);
        setError(
          e instanceof Error ? e.message : "Cannot read this audio file.",
        );
      }
    } finally {
      loadingRef.current = false;
      if (id === generation.current) setLoading(false);
    }
  };
  const recorder = useRecorder((file) => {
    void selectFile(file);
  }, setError);
  const busy = analyzing || loading || recorder.recording || recorder.starting;
  const clear = () => {
    if (busy) return;
    generation.current++;
    player.current?.pause();
    if (signalRef.current) URL.revokeObjectURL(signalRef.current.url);
    signalRef.current = null;
    setSignal(null);
    setResult(null);
    setComparison(null);
    setRegion(null);
    regionRef.current = null;
    setJob(null);
    jobRef.current = null;
    setError("");
    setPlaying(false);
    setProgress(0);
    if (input.current) input.current.value = "";
  };
  const analyze = async () => {
    if (!signal || busyRef.current || busy) return;
    busyRef.current = true;
    setAnalyzing(true);
    setResult(null);
    setComparison(null);
    setJob(null);
    jobRef.current = null;
    setCancelling(false);
    setError("");
    player.current?.pause();
    setPlaying(false);
    const c = new AbortController();
    request.current = c;
    try {
      let current = await submitAnalysis(signal.file, phone, compare, c.signal);
      jobRef.current = current;
      setJob(current);
      const deadline = Date.now() + 30 * 60 * 1000;
      while (["queued", "processing"].includes(current.state)) {
        if (Date.now() > deadline) {
          void cancelJob(current.job_id).catch(() => {});
          throw new Error(
            "Analysis exceeded 30 minutes. Cancellation requested; check the GPU server before retrying.",
          );
        }
        await waitForPoll(c.signal);
        current = await readJob(current.job_id, c.signal);
        jobRef.current = current;
        setJob(current);
      }
      if (current.state === "failed") throw new Error(jobFailure(current));
      if (current.state === "completed" && current.result) {
        if ("standard" in current.result) {
          setComparison(current.result);
          setResult(current.result.standard);
        } else setResult(current.result);
      }
    } catch (e) {
      const active = jobRef.current;
      if (active && ["queued", "processing"].includes(active.state))
        void cancelJob(active.job_id).catch(() => {});
      if (!c.signal.aborted)
        setError(e instanceof Error ? e.message : "Analysis was interrupted.");
    } finally {
      if (!c.signal.aborted) {
        busyRef.current = false;
        setAnalyzing(false);
        setCancelling(false);
        void checkBackend();
      }
    }
  };
  const cancel = async () => {
    if (!jobRef.current || cancelling) return;
    setCancelling(true);
    try {
      await cancelJob(jobRef.current.job_id);
    } catch {
      setError("Cannot request cancellation. Check the backend connection.");
      setCancelling(false);
    }
  };
  const seekRegion = (start: number, end: number, play = false) => {
    if (!player.current) return;
    regionRef.current = { start, end };
    setRegion({ start, end });
    player.current.currentTime = start;
    setProgress(start / (signal?.duration || 1));
    if (play)
      void player.current
        .play()
        .catch(() =>
          setError("Playback failed. Try playing the recording again."),
        );
  };
  const color =
    result?.risk === "high"
      ? "#e68b79"
      : result?.risk === "medium"
        ? "#e3bb72"
        : result
          ? "#a9d7b4"
          : recorder.recording
            ? "#e68b79"
            : "#cad8df";
  const status = recorder.recording
    ? "RECORDING"
    : recorder.starting
      ? "OPENING MICROPHONE"
      : loading
        ? "DECODING SIGNAL"
        : analyzing
          ? cancelling
            ? "CANCELLING AFTER SEGMENT"
            : job?.state === "queued"
              ? "QUEUED FOR INFERENCE"
              : "ANALYSIS IN PROGRESS"
          : result
            ? "CLASSIFICATION COMPLETE"
            : signal
              ? "SIGNAL READY"
              : dragging
                ? "RELEASE TO LOAD"
                : "AWAITING SIGNAL";
  return (
    <main style={{ "--signal": color } as React.CSSProperties}>
      <SignalAtmosphere />
      <SignalCursor />
      <header className="masthead">
        <a
          className="wordmark"
          href="/"
          aria-label="DECIBEL home"
          data-magnetic
        >
          <AudioLines size={24} />
          <span>DECIBEL</span>
        </a>
        <span className="descriptor">VOICE AUTHENTICITY SYSTEM</span>
        <button
          className="connection"
          onClick={() => {
            void checkBackend();
          }}
          aria-label="Refresh backend connection"
        >
          <i className={health?.model_loaded ? "online" : ""} />
          {connection}
          <RotateCcw size={11} />
        </button>
      </header>
      <motion.section
        className="intro"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={entrance}
      >
        <div>
          <p className="eyebrow">
            AUDIO AUTHENTICITY FORENSICS / INSTRUMENT 01
          </p>
          <h1>
            Listen beyond
            <br />
            the voice<span>.</span>
          </h1>
        </div>
        <div className="intro-aside">
          <div className="crosshair">+</div>
          <p>
            A familiar voice.
            <br />
            An unfamiliar signal.
          </p>
          <p className="explanation">
            Examine a recording for signs of
            <br className="desktop-break" /> AI-generated speech.
          </p>
          <button
            onClick={() => setShowMethod((v) => !v)}
            className="text-link"
            data-magnetic
            aria-expanded={showMethod}
          >
            Behind the analysis <ArrowUpRight size={15} />
          </button>
        </div>
      </motion.section>
      <section
        className={`instrument ${dragging ? "drag-active" : ""} ${analyzing ? "scanning" : ""} ${recorder.recording ? "recording" : ""} ${signal ? "has-signal" : ""}`}
        aria-label="Audio analysis instrument"
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current++;
          if (!busy) setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          e.preventDefault();
          dragDepth.current--;
          if (dragDepth.current <= 0) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          if (!busy && e.dataTransfer.files[0])
            void selectFile(e.dataTransfer.files[0]);
        }}
      >
        <div className="instrument-top">
          <div className="channel-label">
            <span className="channel-number">01</span> SIGNAL INPUT
          </div>
          <span className="signal-status" aria-live="polite">
            <i className={recorder.recording ? "record-dot" : ""} />
            {status}
          </span>
          <span className="format">
            16 KHZ <b>/</b> MONO
          </span>
        </div>
        <div className="signal-window">
          <div className="amplitude-labels">
            <span>+1.0</span>
            <span>0.0</span>
            <span>−1.0</span>
          </div>
          <SignalField
            peaks={signal?.peaks}
            analyser={recorder.analyser}
            analyzing={analyzing}
            dragging={dragging}
            phone={phone}
            color={color}
            progress={progress}
            duration={signal?.duration}
            onSeek={(seconds) => {
              if (!player.current || !signal) return;
              regionRef.current = null;
              setRegion(null);
              player.current.currentTime = seconds;
              setProgress(seconds / signal.duration);
            }}
          />
          {!signal && !recorder.recording && !loading && (
            <div className="empty-overlay">
              <span className="target-bracket">[</span>
              <span>
                {dragging
                  ? "DROP YOUR RECORDING"
                  : "YOUR VOICE IS THE EVIDENCE"}
              </span>
              <span className="target-bracket">]</span>
            </div>
          )}
          {analyzing && (
            <div className="scan-caption">
              {job?.segments_total
                ? `${job.segments_completed} / ${job.segments_total} SEGMENTS COMPLETE`
                : job?.state === "queued"
                  ? "QUEUED / WAITING FOR GPU"
                  : "DECODING & PREPARING"}{" "}
              <span>/ SIGNAL EXAMINATION</span>
            </div>
          )}
          {recorder.recording && (
            <div className="record-time">
              {time(recorder.elapsed)}
              <small> / 10:00.00</small>
            </div>
          )}
        </div>
        <div className="timeline">
          {Array.from({ length: 7 }, (_, i) => {
            const seconds = (i / 6) * (signal?.duration || 29);
            return (
              <span key={i}>
                {signal && signal.duration > 60
                  ? time(seconds).slice(0, 5)
                  : `${seconds.toFixed(signal ? 1 : 0).padStart(2, "0")}s`}
              </span>
            );
          })}
        </div>
        {result && signal && (
          <SegmentTimeline
            key={`${result.analysis_id}-${result.phone_mode}`}
            segments={result.segments}
            duration={signal.duration}
            onSeek={seekRegion}
          />
        )}
        <div className="signal-meta">
          <span>
            {signal ? (
              <>
                <FileAudio size={13} />
                <b title={signal.file.name}>{signal.file.name}</b>
                <span>{(signal.file.size / 1024 / 1024).toFixed(2)} MB</span>
              </>
            ) : (
              <>
                <span className="tiny-square" />
                {recorder.recording
                  ? "LIVE MICROPHONE CAPTURE"
                  : "ILLUSTRATIVE REFERENCE / NO AUDIO LOADED"}
              </>
            )}
          </span>
          <span>
            {signal
              ? `${time(signal.duration)} / FULL RECORDING`
              : "TIME DOMAIN / AMPLITUDE"}
          </span>
        </div>
        <div className="input-controls">
          <div className="capture-controls">
            <input
              ref={input}
              type="file"
              accept="audio/*,.wav,.mp3,.flac,.m4a,.webm,.ogg"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void selectFile(f);
                e.target.value = "";
              }}
            />
            <button
              className="upload-button"
              data-magnetic
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              <Upload size={17} />
              {signal ? "Replace recording" : "Upload recording"}
              <ArrowUpRight size={16} />
            </button>
            <span className="or">or</span>
            <button
              className={`record-button ${recorder.recording ? "active" : ""}`}
              data-magnetic
              disabled={analyzing || loading || recorder.starting}
              onClick={() => {
                setError("");
                if (recorder.recording) recorder.stop();
                else {
                  clear();
                  void recorder.start();
                }
              }}
            >
              {recorder.recording ? <Square size={13} /> : <Mic size={16} />}{" "}
              {recorder.recording
                ? "Stop capture"
                : recorder.starting
                  ? "Opening mic…"
                  : "Record voice"}
            </button>
            {signal && (
              <button
                disabled={busy}
                className="clear-button"
                onClick={clear}
                aria-label="Clear recording"
              >
                <X size={16} />
              </button>
            )}
          </div>
          <span className="upload-note">
            WAV, MP3, FLAC + more
            <br />
            Up to 10 minutes / 50 MB
          </span>
        </div>
        {signal && (
          <div className="playback">
            <button
              disabled={analyzing || recorder.recording}
              aria-label={playing ? "Pause recording" : "Play recording"}
              onClick={() => {
                if (playing) player.current?.pause();
                else {
                  if (
                    regionRef.current &&
                    player.current &&
                    player.current.currentTime >= regionRef.current.end
                  )
                    player.current.currentTime = regionRef.current.start;
                  void player.current
                    ?.play()
                    .catch(() =>
                      setError("Playback failed. Replace the recording."),
                    );
                }
              }}
            >
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <span>
              {region
                ? `${time(region.start)}—${time(region.end)}`
                : "MONITOR RECORDING"}
            </span>
            <audio
              ref={player}
              src={signal.url}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => {
                if (regionRef.current && loopRef.current && player.current) {
                  player.current.currentTime = regionRef.current.start;
                  void player.current.play().catch(() => setPlaying(false));
                } else {
                  setPlaying(false);
                  setProgress(0);
                }
              }}
              onTimeUpdate={() => {
                const audio = player.current;
                if (!audio) return;
                if (
                  regionRef.current &&
                  audio.currentTime >= regionRef.current.end
                ) {
                  if (loopRef.current)
                    audio.currentTime = regionRef.current.start;
                  else audio.pause();
                }
                setProgress(Math.min(1, audio.currentTime / signal.duration));
              }}
            />
            <input
              type="range"
              aria-label="Seek recording"
              min={0}
              max={signal.duration}
              step={0.05}
              value={player.current?.currentTime || 0}
              onChange={(e) => {
                setRegion(null);
                regionRef.current = null;
                if (player.current)
                  player.current.currentTime = Number(e.target.value);
              }}
            />
            {region && (
              <>
                <button
                  className="loop-region"
                  aria-pressed={loop}
                  onClick={() => {
                    loopRef.current = !loop;
                    setLoop(!loop);
                  }}
                >
                  LOOP {loop ? "ON" : "OFF"}
                </button>
                <button
                  onClick={() => {
                    regionRef.current = null;
                    setRegion(null);
                  }}
                >
                  FULL AUDIO
                </button>
              </>
            )}
          </div>
        )}
        <div className="analysis-controls">
          <div className="mode-settings">
            <div className="phone-setting">
              <button
                className={`toggle ${phone ? "checked" : ""}`}
                role="switch"
                aria-checked={phone}
                aria-label="Phone Call Mode"
                disabled={busy || compare}
                onClick={() => {
                  setPhone((v) => !v);
                  setResult(null);
                  setComparison(null);
                }}
              >
                <span>{phone && <Check size={11} />}</span>
              </button>
              <div>
                <label>Phone Call Mode</label>
                <p>
                  {phone
                    ? "PHONE CHANNEL SIMULATION / 16 → 8 → 16 KHZ"
                    : "Simulates phone-call compression before analysis."}
                </p>
              </div>
            </div>
            <label className="compare-setting">
              <input
                type="checkbox"
                checked={compare}
                disabled={busy}
                onChange={(e) => {
                  setCompare(e.target.checked);
                  setResult(null);
                  setComparison(null);
                }}
              />
              Compare standard & phone channels <span>2× SEGMENT WORK</span>
            </label>
          </div>
          <div className="analysis-actions">
            {analyzing && job && (
              <button
                className="cancel-analysis"
                disabled={cancelling}
                onClick={() => {
                  void cancel();
                }}
              >
                {cancelling ? "CANCELLING…" : "CANCEL"}
              </button>
            )}
            <motion.button
              whileTap={reduced ? undefined : { scale: 0.985 }}
              className="analyze-button"
              data-magnetic
              disabled={!signal || busy}
              onClick={() => {
                void analyze();
              }}
            >
              {analyzing
                ? job?.segments_total
                  ? `${(job.progress * 100).toFixed(0)}% / ANALYZING`
                  : "PREPARING ANALYSIS"
                : "ANALYZE SIGNAL"}
              <ChevronRight size={19} />
            </motion.button>
          </div>
        </div>
      </section>
      <div className="batch-entry">
        <input
          type="file"
          multiple
          accept="audio/*,.wav,.mp3,.flac,.m4a,.webm,.ogg"
          ref={batchInput}
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length > 10)
              setError("Choose up to 10 recordings for a batch.");
            else if (files.some((f) => f.size > 50 * 1024 * 1024))
              setError("Each batch recording must be smaller than 50 MB.");
            else {
              setBatchFiles(files);
              setError("");
            }
            e.target.value = "";
          }}
        />
        <button
          disabled={busy || batchFiles.length > 0}
          onClick={() => batchInput.current?.click()}
        >
          ADD A BATCH <ArrowUpRight size={12} />
        </button>
        <span>INDEPENDENT FILES / SHARED INFERENCE QUEUE</span>
      </div>
      {batchFiles.length > 0 && (
        <BatchAnalysis
          files={batchFiles}
          phone={phone}
          compare={compare}
          disabled={busy}
          onClose={() => setBatchFiles([])}
          onOpen={(file, data) => {
            void selectFile(file).then(() => {
              if (signalRef.current?.file !== file) return;
              if ("standard" in data) {
                setComparison(data);
                setResult(data.standard);
              } else {
                setComparison(null);
                setResult(data);
              }
            });
          }}
        />
      )}
      <AnimatePresence>
        {error && (
          <motion.div
            role="alert"
            className="error-message"
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={reduced ? { duration: 0 } : disclose}
          >
            <span>SIGNAL INTERRUPTED</span>
            <p>{error}</p>
            <button onClick={() => setError("")} aria-label="Dismiss error">
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      {!health?.model_loaded && (
        <div className="backend-note">
          <span>OFFLINE</span>
          <p>
            {health
              ? health.diagnostic ||
                "Initialize the model to enable classification."
              : "The API is unreachable. Start the backend to run classification."}{" "}
            Audio preview and capture are available.
          </p>
        </div>
      )}
      <AnimatePresence mode="wait">
        {result ? (
          <motion.section
            key="result"
            className={`result ${result.risk}`}
            initial={reduced ? false : { opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.15 }}
            transition={entrance}
            aria-live="polite"
          >
            <div className="result-heading">
              <p className="eyebrow">02 / CLASSIFICATION</p>
              <h2>
                {verdicts[result.verdict]}
                <ArrowUpRight size={32} />
              </h2>
              <span className="risk-label">
                {result.risk.toUpperCase()} RISK
              </span>
              <p className="result-caveat">
                Overall verdict uses the peak segment probability.
                <br />A model estimate, not proof of authenticity.
              </p>
            </div>
            <div className="result-measurement">
              <div className="probability">
                <ProbabilityReadout value={result.fake_percentage} />
                <span>
                  PEAK SEGMENT
                  <br />
                  DEEPFAKE PROBABILITY
                </span>
              </div>
              <RiskScale probability={result.fake_probability} />
              <div className="result-details">
                <span>
                  REAL VOICE AT PEAK{" "}
                  <b>{(result.real_probability * 100).toFixed(1)}%</b>
                </span>
                <span>
                  RECORDING <b>{time(result.duration_seconds)}</b>
                </span>
                <span>
                  CHANNEL <b>{result.phone_mode ? "PHONE" : "STANDARD"}</b>
                </span>
              </div>
            </div>
          </motion.section>
        ) : (
          <motion.div
            className="lower-strip"
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={entrance}
          >
            <span>
              CAPTURE <ChevronRight size={11} /> EXAMINE{" "}
              <ChevronRight size={11} /> CLASSIFY
            </span>
            <p>
              Your recording is processed for this analysis.
              <br />
              No audio is permanently stored.
            </p>
            <span className="strip-symbol">
              <ArrowDown size={18} /> SIGNAL, NOT SPECULATION.
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      {result && (
        <Investigation
          key={result.analysis_id}
          result={result}
          comparison={comparison}
          onMode={setResult}
          onRegion={seekRegion}
          onError={setError}
        />
      )}
      <AnimatePresence>
        {showMethod && (
          <motion.section
            className="method"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduced ? { duration: 0 } : disclose}
          >
            <div>
              <p className="eyebrow">THE METHOD</p>
              <h2>
                A voice leaves
                <br />a signal signature.
              </h2>
            </div>
            <div>
              <p>
                DECIBEL uses the frozen Gemma 4 E4B audio tower and the original
                trained TrueVoice classifier. Audio becomes mono at 16 kHz. Long
                recordings are examined in overlapping 25-second windows with a
                2-second overlap by default, using the same classifier for every
                usable segment.
              </p>
              <p>
                The overall verdict uses the highest segment probability. Risk
                time uses the highest active risk in overlapping windows,
                counting each instant once. Quality diagnostics measure
                recording suitability, independently of authenticity.
              </p>
              <p>
                The classification thresholds are 40% for caution and 70% for
                high risk. These are model scores, not calibrated guarantees.
                Recording conditions and unfamiliar synthesis methods can affect
                results.
              </p>
              <a
                href="https://github.com/hyeminss11/true-voice-gemma4"
                target="_blank"
                rel="noreferrer"
                className="text-link"
              >
                TrueVoice research & attribution <ArrowUpRight size={14} />
              </a>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
      <footer>
        <span>
          DECIBEL <b>/</b> VOICE AUTHENTICITY SYSTEM
        </span>
        <span>MODEL FOUNDATION: TRUEVOICE + GEMMA 4 E4B</span>
        <span>BUILD 01.00</span>
      </footer>
    </main>
  );
}
