// 24px line icons, copied from the prototype's icon set.
const P: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5M10 21v-6h4v6',
  doc: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M8.5 13h7M8.5 17h5',
  training: 'M3 6.5 12 3l9 3.5-9 3.5zM7 8.3V14c0 1.6 2.2 3 5 3s5-1.4 5-3V8.3M21 6.5V12',
  sign: 'M3 17c3-1 4-6 6-6s1 5 3 5 3-3 4-3M15 4l5 5-9 9H6v-5z',
  quality: 'M12 3 2 20h20zM12 9v5M12 17.5v.5',
  admin: 'M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6zM9 12l2 2 4-4',
  out: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l4-4-4-4M14 12H4',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  printer: 'M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M7 14h10v6H7z',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3'
};

export function Icon({ name, small }: { name: keyof typeof P | string; small?: boolean }) {
  return (
    <svg className={`ico${small ? ' ico-sm' : ''}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={P[name] ?? ''} />
    </svg>
  );
}
