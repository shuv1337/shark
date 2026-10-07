interface Props {
  onClick: () => void;
  disabled?: boolean;
}

export function AppleButton({ onClick, disabled }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-11 items-center justify-center gap-2.5 rounded-full bg-white px-5 text-[15px] font-medium text-black transition-[background-color,transform] duration-150 hover:bg-white/90 active:scale-[0.97] disabled:opacity-50"
    >
      <svg width="17" height="19" viewBox="0 0 17 19" fill="currentColor" aria-hidden="true">
        <path d="M13.97 10.08c-.02-2.23 1.82-3.32 1.9-3.37a4.08 4.08 0 0 0-3.2-1.73c-1.35-.14-2.66.81-3.35.81-.7 0-1.77-.8-2.92-.77a4.25 4.25 0 0 0-3.58 2.19c-1.55 2.68-.4 6.62 1.09 8.8.74 1.07 1.6 2.26 2.75 2.22 1.12-.05 1.54-.71 2.89-.71 1.34 0 1.74.71 2.9.68 1.2-.02 1.95-1.07 2.66-2.15a8.8 8.8 0 0 0 1.22-2.48 3.86 3.86 0 0 1-2.36-3.5ZM11.8 3.55A3.9 3.9 0 0 0 12.7.7a4 4 0 0 0-2.6 1.35 3.72 3.72 0 0 0-.92 2.74 3.3 3.3 0 0 0 2.62-1.24Z" />
      </svg>
      Sign in with Apple
    </button>
  );
}
