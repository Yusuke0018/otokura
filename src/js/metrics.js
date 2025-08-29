// metrics: 再生割合・統計更新（単純判定）
export function reachedNinetyPercent(currentMs, durationMs){
  if (!durationMs || durationMs <= 0) return false;
  return (currentMs / durationMs) >= 0.9;
}
