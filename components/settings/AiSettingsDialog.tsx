"use client";

import { CheckIcon, PlugIcon } from "@phosphor-icons/react";
import { FormEvent, useState } from "react";
import type { ReactNode } from "react";
import {
  readAiSettings,
  resetAiSettings,
  type LearnerAiSettings,
  writeAiSettings,
} from "@/components/ai/aiSettings";

const imageSizes = ["1024x1024", "1024x1536", "1536x1024", "auto"];
const imageQualities = ["low", "medium", "high", "auto"];
const imageBackgrounds = ["opaque", "transparent", "auto"];
const imageFormats = ["png", "jpeg", "webp"];

function Field({
  label,
  onChange,
  type = "text",
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  type?: "password" | "text";
  value: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-white/48">{label}</span>
      <input
        className="h-9 w-full rounded-md border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none transition focus:border-white/24 focus:bg-white/[0.07]"
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </label>
  );
}

function SelectField({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-white/48">{label}</span>
      <select
        className="h-9 w-full rounded-md border border-white/10 bg-[#242424] px-3 text-sm text-white outline-none transition focus:border-white/24 focus:bg-[#2b2b2b]"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Section({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="space-y-3 border-t border-white/[0.08] pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-white/36">{title}</h3>
      {children}
    </section>
  );
}

export default function AiSettingsDialog({
  onClose,
  open,
}: {
  onClose: () => void;
  open: boolean;
}) {
  const [settings, setSettings] = useState<LearnerAiSettings>(() => readAiSettings());
  const [status, setStatus] = useState("");
  const [isTesting, setIsTesting] = useState(false);

  if (!open) return null;

  function updateSetting(key: keyof LearnerAiSettings, value: string) {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function saveSettings(nextSettings = settings) {
    writeAiSettings(nextSettings);
    await window.learner?.configureAi?.(nextSettings);
    setStatus("Saved.");
  }

  async function testConnection() {
    setIsTesting(true);
    setStatus("");

    try {
      const models = await window.learner?.listAiModels?.(settings);
      const count = models?.length ?? 0;
      const hasImageModel = models?.some((model) => model.id === settings.imageModel);
      setStatus(`${count} models available${hasImageModel ? `, including ${settings.imageModel}` : ""}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Connection test failed.");
    } finally {
      setIsTesting(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void saveSettings();
  }

  function resetDefaults() {
    const nextSettings = resetAiSettings();
    setSettings(nextSettings);
    void window.learner?.configureAi?.(nextSettings);
    setStatus("Defaults restored.");
  }

  return (
    <div className="app-no-drag fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4">
      <form
        onSubmit={handleSubmit}
        className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-white/10 bg-[#202020] text-white shadow-2xl"
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/[0.08] px-4">
          <h2 className="text-sm font-medium">AI Settings</h2>
          <button
            className="rounded-md px-2 py-1 text-sm text-white/52 transition hover:bg-white/10 hover:text-white"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          <Section title="Connection">
            <p className="text-sm leading-6 text-white/48">
              Shared endpoint and API key for chat, graph extraction, embeddings, and image generation.
            </p>
            <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
              <Field label="Base URL" onChange={(value) => updateSetting("baseUrl", value)} value={settings.baseUrl} />
              <Field
                label="API key"
                onChange={(value) => updateSetting("apiKey", value)}
                type="password"
                value={settings.apiKey}
              />
            </div>
          </Section>

          <Section title="Models">
            <p className="text-sm leading-6 text-white/48">
              Each capability can use a different model on the same configured endpoint.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Chat model" onChange={(value) => updateSetting("chatModel", value)} value={settings.chatModel} />
              <Field label="Graph model" onChange={(value) => updateSetting("graphModel", value)} value={settings.graphModel} />
              <Field
                label="Embedding model"
                onChange={(value) => updateSetting("embeddingModel", value)}
                value={settings.embeddingModel}
              />
              <Field label="Image model" onChange={(value) => updateSetting("imageModel", value)} value={settings.imageModel} />
            </div>
          </Section>

          <Section title="Image Generation">
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                label="Size"
                onChange={(value) => updateSetting("imageSize", value)}
                options={imageSizes}
                value={settings.imageSize}
              />
              <SelectField
                label="Quality"
                onChange={(value) => updateSetting("imageQuality", value)}
                options={imageQualities}
                value={settings.imageQuality}
              />
              <SelectField
                label="Background"
                onChange={(value) => updateSetting("imageBackground", value)}
                options={imageBackgrounds}
                value={settings.imageBackground}
              />
              <SelectField
                label="Output format"
                onChange={(value) => updateSetting("imageOutputFormat", value)}
                options={imageFormats}
                value={settings.imageOutputFormat}
              />
            </div>
          </Section>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] px-4 py-3">
          <p className="min-h-5 text-sm text-white/52">{status}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              className="rounded-md px-3 py-1.5 text-sm text-white/58 transition hover:bg-white/10 hover:text-white"
              onClick={resetDefaults}
              type="button"
            >
              Reset
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-md border border-white/10 px-3 py-1.5 text-sm text-white/76 transition hover:bg-white/10 hover:text-white disabled:opacity-45"
              disabled={isTesting}
              onClick={testConnection}
              type="button"
            >
              <PlugIcon size={15} />
              {isTesting ? "Testing" : "Test"}
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black transition hover:bg-white/90"
              type="submit"
            >
              <CheckIcon size={15} />
              Save
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
