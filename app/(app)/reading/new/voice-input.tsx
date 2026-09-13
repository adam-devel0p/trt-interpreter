'use client';

import * as React from 'react';

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Optional voice entry for the question (§6.2 step 14) via the Web Speech API. Renders nothing
 * where the API is absent; the typed path is always there. Audio never leaves the browser's
 * own recogniser — this app receives text only.
 */
export function VoiceInput({ onText }: { onText: (text: string) => void }) {
  const [supported, setSupported] = React.useState(false);
  const [listening, setListening] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const rec = React.useRef<RecognitionLike | null>(null);

  React.useEffect(() => {
    setSupported(recognitionCtor() !== null);
  }, []);

  if (!supported) return null;

  const toggle = () => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = document.documentElement.lang || 'en';
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (ev) => {
      const t = ev.results[0]?.[0]?.transcript;
      if (t) onText(t);
    };
    r.onerror = () => setNote("Couldn't hear that. You can type instead.");
    r.onend = () => setListening(false);
    rec.current = r;
    setNote(null);
    setListening(true);
    r.start();
  };

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={listening}
        className="min-h-9 rounded-chip bg-surface px-3 text-sm text-fg-muted hairline hover:bg-surface-2"
      >
        {listening ? 'Listening… tap to stop' : 'Speak instead'}
      </button>
      {note ? (
        <span role="status" className="text-xs text-fg-muted">
          {note}
        </span>
      ) : null}
    </div>
  );
}
