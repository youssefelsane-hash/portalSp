export function formatActiveTime(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}س ${minutes}د ${seconds}ث`;
  if (minutes > 0) return `${minutes} دقيقة ${seconds} ثانية`;
  return `${seconds} ثانية`;
}
