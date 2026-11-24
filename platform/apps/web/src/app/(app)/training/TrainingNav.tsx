// Tabs across the training screens. Organisation views only for training.org.
export function TrainingNav({ current, org }: { current: string; org: boolean }) {
  const tabs: [string, string][] = [['/training', 'My training']];
  if (org) tabs.push(['/training/matrix', 'Training matrix'], ['/training/records', 'Records']);
  return (
    <nav className="tabs" aria-label="Training">
      {tabs.map(([href, label]) => (
        <a key={href} href={href} className={`tab ${current === href ? 'active' : ''}`} aria-current={current === href ? 'page' : undefined}>{label}</a>
      ))}
    </nav>
  );
}
