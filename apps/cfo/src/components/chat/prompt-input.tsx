"use client";

import { useRef } from "react";

import { Button } from "@openledger-fleet/ui/button";

const MAX_HEIGHT = 160;

export function PromptInput({
  value,
  onValueChange,
  onSubmit,
  busy = false,
  onStop,
  placeholder = "Talk to your money",
}: {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  busy?: boolean;
  onStop?: () => void;
  placeholder?: string;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const ready = value.trim().length > 0 && !busy;

  const resize = () => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`;
  };

  const send = () => {
    if (!ready) return;
    onSubmit();
    const element = field.current;
    if (element) element.style.height = "auto";
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
      className="border-border bg-secondary focus-within:border-foreground/30 flex items-end gap-2 rounded-md border p-1.5 pl-2.5"
    >
      <textarea
        ref={field}
        rows={1}
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onValueChange(event.target.value);
          resize();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey) return;
          event.preventDefault();
          send();
        }}
        className="placeholder:text-muted-foreground my-1.5 min-w-0 flex-1 resize-none bg-transparent text-xs outline-none disabled:opacity-50"
      />
      {busy ? (
        <Button
          type="button"
          size="icon"
          onClick={onStop}
          aria-label="Stop"
          className="shrink-0"
        >
          <span aria-hidden className="text-[9px] leading-none">
            ■
          </span>
        </Button>
      ) : (
        <Button
          type="submit"
          size="icon"
          disabled={!ready}
          aria-label="Send"
          className="shrink-0"
        >
          <span aria-hidden className="text-sm leading-none">
            ↑
          </span>
        </Button>
      )}
    </form>
  );
}
