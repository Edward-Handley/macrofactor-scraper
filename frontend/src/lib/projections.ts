export interface RegressionResult {
  slope: number;
  intercept: number;
}

export function linearRegression(points: { x: number; y: number }[]): RegressionResult | null {
  const n = points.length;
  if (n < 2) return null;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-10) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

export function projectDaysToTarget(
  reg: RegressionResult,
  currentX: number,
  targetY: number,
): number | null {
  if (Math.abs(reg.slope) < 1e-10) return null;
  const x = (targetY - reg.intercept) / reg.slope;
  const days = Math.round(x - currentX);
  if (days < 0 || days > 365) return null;
  return days;
}

export function forecastTail(
  reg: RegressionResult,
  fromX: number,
  days: number,
): { x: number; y: number }[] {
  return Array.from({ length: days + 1 }, (_, i) => ({
    x: fromX + i,
    y: reg.intercept + reg.slope * (fromX + i),
  }));
}

export function weightRatePerWeek(reg: RegressionResult): number {
  return reg.slope * 7;
}
