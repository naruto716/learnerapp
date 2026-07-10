"use client";

import { MicrophoneIcon, SpinnerGapIcon, StopIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { readAiSettings } from "@/components/ai/aiSettings";

type SpeechState = "idle" | "recording" | "transcribing";

function preferredMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || "";
}

export default function SpeechToTextButton({
  disabled = false,
  onTranscript,
}: {
  disabled?: boolean;
  onTranscript: (text: string) => void;
}) {
  const [error, setError] = useState("");
  const [state, setState] = useState<SpeechState>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  useEffect(() => () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    releaseStream();
  }, []);

  const startRecording = async () => {
    setError("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = preferredMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const chunks: BlobPart[] = [];

      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      recorder.addEventListener("stop", async () => {
        const recordedMimeType = recorder.mimeType || mimeType || "audio/webm";
        releaseStream();
        setState("transcribing");

        try {
          const audio = new Uint8Array(await new Blob(chunks, { type: recordedMimeType }).arrayBuffer());
          const result = await window.learner?.transcribeSpeech({
            audio,
            mimeType: recordedMimeType,
            settings: readAiSettings(),
          });
          if (!result) throw new Error("Speech transcription is not available.");
          onTranscript(result.text);
        } catch (transcriptionError) {
          setError(transcriptionError instanceof Error ? transcriptionError.message : "Transcription failed.");
        } finally {
          recorderRef.current = null;
          setState("idle");
        }
      });
      recorder.start();
      setState("recording");
    } catch (recordingError) {
      releaseStream();
      setError(recordingError instanceof Error ? recordingError.message : "Microphone access failed.");
      setState("idle");
    }
  };

  const toggleRecording = () => {
    if (state === "recording") {
      recorderRef.current?.stop();
      return;
    }
    if (state === "idle") void startRecording();
  };

  const label = state === "recording" ? "Stop recording" : state === "transcribing" ? "Transcribing" : "Dictate answer";

  return (
    <div className="flex min-w-0 items-center gap-2">
      {error && <p className="max-w-72 truncate text-xs text-red-200" title={error}>{error}</p>}
      <button
        aria-label={label}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition disabled:pointer-events-none disabled:opacity-30 ${
          state === "recording"
            ? "bg-red-300/16 text-red-100 hover:bg-red-300/24"
            : "text-white/52 hover:bg-white/[0.07] hover:text-white/88"
        }`}
        disabled={disabled || state === "transcribing"}
        onClick={toggleRecording}
        title={label}
        type="button"
      >
        {state === "recording" ? (
          <StopIcon size={16} weight="fill" />
        ) : state === "transcribing" ? (
          <SpinnerGapIcon className="animate-spin" size={17} />
        ) : (
          <MicrophoneIcon size={17} />
        )}
      </button>
    </div>
  );
}