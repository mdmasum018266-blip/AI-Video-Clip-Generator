import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Loader2,
  Pause,
  Play,
  Volume2,
  VolumeX,
  Trophy,
  Gamepad2,
} from "lucide-react";
import { AspectRatio } from "../types";

export interface ProcessingMeta {
  title: string;
  thumbnailUrl: string;
  sourceType: string;
  aspectRatio: AspectRatio;
  clipType: string;
}

interface ProcessingViewProps {
  meta: ProcessingMeta;
  currentStep: number; // 1 to 4
  progressPct: number; // 0 to 100
  error: string | null;
  onCancel: () => void;
  onRetry?: () => void;
}

const STEPS = [
  "Fetching your video",
  "Preparing your video",
  "Listening to the audio",
  "Finding the best moments",
];

export const ProcessingView: React.FC<ProcessingViewProps> = ({
  meta,
  currentStep,
  progressPct,
  error,
  onCancel,
}) => {
  return (
    <div className="max-w-[1200px] mx-auto px-6 py-6 space-y-6">
      {/* Header matching reference */}
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Back to dashboard"
          className="mt-0.5 p-2 rounded-lg bg-[#15151A] hover:bg-[#1E1E26] border border-[#262630] text-zinc-300 hover:text-white transition-colors shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-white truncate">
            {meta.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400 mt-1 font-mono tabular-nums">
            <span className="font-sans">Today</span>
            <span aria-hidden="true">·</span>
            <span className="font-sans capitalize">{meta.sourceType}</span>
            <span aria-hidden="true">·</span>
            <span>{meta.aspectRatio}</span>
            <span aria-hidden="true">·</span>
            <span className="font-sans">{meta.clipType}</span>
          </div>
        </div>
      </div>

      {/* Main 2-Column Stage: Left Pipeline + Right Flappy Bird Game */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Video Thumbnail + 4-Step Progress */}
        <div className="lg:col-span-7 rounded-xl bg-[#121216] border border-[#24242D] overflow-hidden">
          <div className="relative aspect-video w-full bg-zinc-950 overflow-hidden">
            {meta.thumbnailUrl && (
              <img
                src={meta.thumbnailUrl}
                alt={meta.title}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover opacity-80"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[#121216] via-black/30 to-transparent" />
          </div>

          <div className="p-6 space-y-5">
            <div className="text-center space-y-1">
              <h2 className="text-base font-bold text-white">Getting Your Video</h2>
              <p className="text-xs text-zinc-400 line-clamp-1">
                Processing &ldquo;{meta.title}&rdquo; — hang tight!
              </p>
            </div>

            {error ? (
              <div className="rounded-lg bg-red-950/40 border border-red-500/40 p-4 text-center space-y-3">
                <p className="text-xs text-red-300">{error}</p>
                <button
                  type="button"
                  onClick={onCancel}
                  className="px-4 py-2 rounded-lg bg-[#1A1A22] hover:bg-[#23232D] border border-[#2C2C38] text-xs font-medium text-white"
                >
                  Back to Home
                </button>
              </div>
            ) : (
              <>
                <div className="max-w-sm mx-auto space-y-3 py-1">
                  {STEPS.map((label, idx) => {
                    const stepNum = idx + 1;
                    const done = currentStep > stepNum;
                    const active = currentStep === stepNum;
                    return (
                      <div
                        key={label}
                        className="flex items-center gap-3 text-sm"
                      >
                        {done ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : active ? (
                          <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
                        ) : (
                          <Circle className="w-4 h-4 text-zinc-700 shrink-0" />
                        )}
                        <span
                          className={
                            done
                              ? "text-zinc-300"
                              : active
                              ? "text-blue-400 font-medium"
                              : "text-zinc-600"
                          }
                        >
                          {label}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="space-y-2 pt-2">
                  <div className="w-full h-1.5 rounded-full bg-[#1E1E26] overflow-hidden">
                    <div
                      className="h-full bg-blue-600 rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(100, Math.max(5, progressPct))}%` }}
                    />
                  </div>
                  <p className="text-center text-xs font-mono tabular-nums text-zinc-500">
                    Step {Math.min(4, currentStep)} of 4 · {Math.round(progressPct)}%
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right: Play While You Wait (Flappy Bird Mini-Game) */}
        <div className="lg:col-span-5 rounded-xl bg-[#121216] border border-[#24242D] p-5 space-y-4">
          <div className="text-center space-y-0.5">
            <h2 className="text-sm font-bold text-white">Play while you wait</h2>
            <p className="text-xs text-zinc-400">
              A quick round of Flappy Bird to pass the time.
            </p>
          </div>

          <FlappyWaitGame />
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Playable Flappy Bird Canvas Mini-Game                                      */
/* -------------------------------------------------------------------------- */
const FlappyWaitGame: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState<number>(() => {
    try {
      return Number(localStorage.getItem("sr_flappy_best") || "0");
    } catch {
      return 0;
    }
  });
  const [paused, setPaused] = useState(false);
  const [soundOn, setSoundOn] = useState(false);

  const stateRef = useRef({
    status: "ready" as "ready" | "playing" | "gameover",
    birdY: 180,
    birdV: 0,
    pipes: [] as Array<{ x: number; gapTop: number; passed: boolean }>,
    score: 0,
    frame: 0,
  });

  const beep = (freq: number, dur = 0.06) => {
    if (!soundOn || typeof window === "undefined") return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.value = 0.06;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    } catch {
      // Ignore audio restrictions
    }
  };

  const flap = () => {
    if (paused) return;
    const s = stateRef.current;
    if (s.status === "ready") {
      s.status = "playing";
      s.birdY = 175;
      s.birdV = -5.6;
      s.pipes = [{ x: 340, gapTop: 110, passed: false }];
      s.score = 0;
      setScore(0);
      beep(520);
      return;
    }
    if (s.status === "gameover") {
      s.status = "playing";
      s.birdY = 175;
      s.birdV = -5.6;
      s.pipes = [{ x: 340, gapTop: 110, passed: false }];
      s.score = 0;
      setScore(0);
      beep(520);
      return;
    }
    s.birdV = -5.6;
    beep(480);
  };

  const flapRef = useRef(flap);
  flapRef.current = flap;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        flapRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    const W = canvas.width;
    const H = canvas.height;
    const GAP = 112;
    const PIPE_W = 46;
    const BIRD_X = 76;
    const BIRD_R = 12;

    const tick = () => {
      const s = stateRef.current;

      if (!paused && s.status === "playing") {
        s.frame++;
        s.birdV += 0.3;
        s.birdY += s.birdV;

        // Spawn pipes
        const lastPipe = s.pipes[s.pipes.length - 1];
        if (!lastPipe || lastPipe.x < W - 165) {
          const gapTop = 55 + Math.random() * (H - 180 - GAP);
          s.pipes.push({ x: W + 20, gapTop, passed: false });
        }

        // Move pipes & detect collisions
        for (const p of s.pipes) {
          p.x -= 2.3;
          if (!p.passed && p.x + PIPE_W < BIRD_X) {
            p.passed = true;
            s.score += 1;
            setScore(s.score);
            beep(720, 0.07);
            setBest((prev) => {
              const nextBest = Math.max(prev, s.score);
              try {
                localStorage.setItem("sr_flappy_best", String(nextBest));
              } catch {
                // Ignore
              }
              return nextBest;
            });
          }

          const hitX = BIRD_X + BIRD_R > p.x && BIRD_X - BIRD_R < p.x + PIPE_W;
          const hitY = s.birdY - BIRD_R < p.gapTop || s.birdY + BIRD_R > p.gapTop + GAP;
          if (hitX && hitY) {
            s.status = "gameover";
            beep(180, 0.14);
          }
        }

        s.pipes = s.pipes.filter((p) => p.x + PIPE_W > -10);

        if (s.birdY + BIRD_R >= H - 24 || s.birdY - BIRD_R <= 0) {
          s.status = "gameover";
          beep(180, 0.14);
        }
      } else if (!paused && s.status === "ready") {
        s.frame++;
        s.birdY = 175 + Math.sin(s.frame * 0.08) * 7;
      }

      // Draw night sky gradient
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#10162F");
      sky.addColorStop(1, "#1D2B4E");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // Moon & subtle stars
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.beginPath();
      ctx.arc(245, 72, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      for (const [sx, sy] of [
        [40, 48],
        [110, 82],
        [185, 42],
        [280, 120],
        [65, 130],
      ]) {
        ctx.fillRect(sx, sy, 2, 2);
      }

      // Pipes
      for (const p of s.pipes) {
        ctx.fillStyle = "#22C55E";
        ctx.fillRect(p.x, 0, PIPE_W, p.gapTop);
        ctx.fillRect(p.x, p.gapTop + GAP, PIPE_W, H - 24 - (p.gapTop + GAP));
        ctx.fillStyle = "#16A34A";
        ctx.fillRect(p.x - 3, p.gapTop - 14, PIPE_W + 6, 14);
        ctx.fillRect(p.x - 3, p.gapTop + GAP, PIPE_W + 6, 14);
      }

      // Ground
      ctx.fillStyle = "#15803D";
      ctx.fillRect(0, H - 24, W, 6);
      ctx.fillStyle = "#1E293B";
      ctx.fillRect(0, H - 18, W, 18);

      // Bird
      ctx.save();
      ctx.translate(BIRD_X, s.birdY);
      ctx.rotate(Math.min(0.5, Math.max(-0.4, s.birdV * 0.06)));
      ctx.fillStyle = "#FACC15";
      ctx.beginPath();
      ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2);
      ctx.fill();
      // Wing & eye
      ctx.fillStyle = "#FEF08A";
      ctx.beginPath();
      ctx.ellipse(-3, 2, 6, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.arc(5, -4, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0F172A";
      ctx.beginPath();
      ctx.arc(6.5, -4, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#F97316";
      ctx.beginPath();
      ctx.moveTo(10, -1);
      ctx.lineTo(17, 2);
      ctx.lineTo(10, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Overlay text for Ready / Game Over
      if (s.status === "ready") {
        ctx.fillStyle = "#FFFFFF";
        ctx.font = "700 22px 'Plus Jakarta Sans', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Get Ready", W / 2, 118);
      } else if (s.status === "gameover") {
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "#FFFFFF";
        ctx.font = "700 20px 'Plus Jakarta Sans', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Game Over", W / 2, 145);
        ctx.font = "500 12px 'DM Sans', sans-serif";
        ctx.fillStyle = "#CBD5E1";
        ctx.fillText("Click or press Space to retry", W / 2, 170);
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [paused, soundOn]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#18181F] border border-[#25252F] text-xs font-mono tabular-nums">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-zinc-200">
            <Gamepad2 className="w-3.5 h-3.5 text-zinc-400" />
            Score {score}
          </span>
          <span className="flex items-center gap-1.5 text-amber-400">
            <Trophy className="w-3.5 h-3.5" />
            Best {best}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? "Resume game" : "Pause game"}
            className="p-1 rounded hover:bg-white/10 text-zinc-400 hover:text-white"
          >
            {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => setSoundOn((s) => !s)}
            aria-label={soundOn ? "Mute game sound" : "Enable game sound"}
            className="p-1 rounded hover:bg-white/10 text-zinc-400 hover:text-white"
          >
            {soundOn ? <Volume2 className="w-3.5 h-3.5 text-blue-400" /> : <VolumeX className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      <div className="relative rounded-xl overflow-hidden border border-[#272731] bg-[#10162F]">
        <canvas
          ref={canvasRef}
          width={320}
          height={360}
          onClick={flap}
          className="w-full h-auto block cursor-pointer"
        />
        <div className="pointer-events-none absolute bottom-5 inset-x-0 flex justify-center">
          <span className="px-3 py-1 rounded-full bg-black/75 border border-white/15 text-[11px] font-medium text-zinc-100">
            Click or press Space to flap
          </span>
        </div>
      </div>
    </div>
  );
};
