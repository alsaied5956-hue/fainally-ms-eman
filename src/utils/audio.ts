// Robust, leak-free Web Audio and Speech Synthesis manager
let audioContext: AudioContext | null = null;
let activeUtterance: SpeechSynthesisUtterance | null = null;
let speechWatchdogTimer: ReturnType<typeof setTimeout> | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!audioContext || audioContext.state === "closed") {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        audioContext = new AudioCtx();
      }
    }
    if (audioContext && audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }
    return audioContext;
  } catch {
    return null;
  }
}

export function playBeep(type: "success" | "warning" | "error"): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;

    // Automatic node cleanup on finish to prevent memory accumulation
    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {}
    };

    if (type === "success") {
      // Pleasant double chime
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880, now + 0.08); // A5
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.22);
    } else if (type === "warning") {
      // Warning chime
      osc.type = "triangle";
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(370, now + 0.1);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      osc.start(now);
      osc.stop(now + 0.28);
    } else {
      // Error buzz
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.setValueAtTime(130, now + 0.12);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    }
  } catch {
    // Graceful fallback if audio is blocked or unsupported
  }
}

/**
 * Chromium-safe Speech Synthesis with Garbage Collector Protection and Lockup Watchdog
 */
export function speakArabicGreeting(studentName: string, enabled = true): void {
  if (!enabled || typeof window === "undefined" || !("speechSynthesis" in window)) return;

  // Run on next tick so button clicks and state updates are 100% instantaneous
  setTimeout(() => {
    try {
      const synth = window.speechSynthesis;

      // Clear watchdog
      if (speechWatchdogTimer) {
        clearTimeout(speechWatchdogTimer);
        speechWatchdogTimer = null;
      }

      // Cancel any previous hung speech
      synth.cancel();

      // If synth was paused by browser, resume it
      if (synth.paused) {
        synth.resume();
      }

      const cleanName = (studentName || "").split(" ")[0]?.trim() || studentName;
      if (!cleanName) return;

      const utterance = new SpeechSynthesisUtterance(`أهلاً ${cleanName}`);
      utterance.lang = "ar-EG";
      utterance.rate = 1.05;
      utterance.pitch = 1.05;

      // Store in outer reference to prevent premature Chromium Garbage Collection freeze
      activeUtterance = utterance;

      const cleanup = () => {
        if (activeUtterance === utterance) {
          activeUtterance = null;
        }
        if (speechWatchdogTimer) {
          clearTimeout(speechWatchdogTimer);
          speechWatchdogTimer = null;
        }
      };

      utterance.onend = cleanup;
      utterance.onerror = cleanup;

      // Safety watchdog: if browser fails to fire onend within 2.5 seconds, reset
      speechWatchdogTimer = setTimeout(() => {
        try {
          if (synth.speaking) {
            synth.cancel();
          }
        } catch {}
        cleanup();
      }, 2500);

      synth.speak(utterance);
    } catch {
      activeUtterance = null;
    }
  }, 0);
}

