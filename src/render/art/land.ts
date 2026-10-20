import { nextPlotCost, plotBlocker } from '../../sim/land';
import type { Point } from '../../sim/types';
import { FONTS } from '../../theme';
import type { Frame } from './util';

const COLORS = {
  foreign: 'rgba(14, 29, 40, 0.46)',
  hatch: 'rgba(234, 230, 220, 0.07)',
  border: 'rgba(234, 230, 220, 0.75)',
  buyable: 'rgba(210, 174, 112, 0.14)',
  buyableHover: 'rgba(210, 174, 112, 0.3)',
  gold: '#D2AE70',
  label: '#EAE6DC',
};

/**
 * Terreno: lo que no es del jugador se atenúa y se raya, como una parcela ajena en un plano catastral.
 * El límite de lo propio va en línea discontinua mármol. Con la herramienta de terrenos, las parcelas
 * comprables se marcan en oro con su precio.
 */
export function drawLand(f: Frame, landTool: boolean, hover: Point | null): void {
  const { ctx, state, px, py, s } = f;
  const { land, map } = state;
  if (!land) return;
  const ps = land.plotSize;
  const cost = nextPlotCost(state);
  const hoverPlot = hover ? Math.floor(hover.y / ps) * land.cols + Math.floor(hover.x / ps) : -1;
  const rect = (p: number) => {
    const cx = p % land.cols;
    const cy = (p - cx) / land.cols;
    const x0 = px(cx * ps);
    const y0 = py(cy * ps);
    return [x0, y0, px(Math.min(map.width, (cx + 1) * ps)) - x0, py(Math.min(map.height, (cy + 1) * ps)) - y0] as const;
  };

  for (let p = 0; p < land.owned.length; p++) {
    if (land.owned[p]) continue;
    const [x, y, w, h] = rect(p);
    if (x > ctx.canvas.width || y > ctx.canvas.height || x + w < 0 || y + h < 0) continue;
    ctx.fillStyle = COLORS.foreign;
    ctx.fillRect(x, y, w, h);
    // Rayado diagonal
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.strokeStyle = COLORS.hatch;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const gap = Math.max(8, s * 0.9);
    for (let d = -h; d < w; d += gap) {
      ctx.moveTo(x + d, y + h);
      ctx.lineTo(x + d + h, y);
    }
    ctx.stroke();
    ctx.restore();

    if (!landTool) continue;
    const buyable = !plotBlocker(state, p);
    if (!buyable) continue;
    ctx.fillStyle = p === hoverPlot ? COLORS.buyableHover : COLORS.buyable;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = COLORS.gold;
    ctx.lineWidth = p === hoverPlot ? 2 : 1;
    ctx.setLineDash([6, 5]);
    ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
    ctx.setLineDash([]);
    if (w > 70) {
      ctx.fillStyle = COLORS.label;
      ctx.font = `600 ${Math.round(Math.min(18, w / 9))}px ${FONTS.display}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`$${cost.toLocaleString('es-ES')}`, x + w / 2, y + h / 2);
    }
  }

  // Límite del terreno propio: discontinua en los bordes entre parcela propia y ajena (o el borde del mapa no)
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  for (let p = 0; p < land.owned.length; p++) {
    if (!land.owned[p]) continue;
    const cx = p % land.cols;
    const cy = (p - cx) / land.cols;
    const [x, y, w, h] = rect(p);
    const foreign = (dx: number, dy: number) => {
      const nx = cx + dx;
      const ny = cy + dy;
      return nx >= 0 && ny >= 0 && nx < land.cols && ny < land.rows && !land.owned[ny * land.cols + nx];
    };
    if (foreign(0, -1)) { ctx.moveTo(x, y); ctx.lineTo(x + w, y); }
    if (foreign(0, 1)) { ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h); }
    if (foreign(-1, 0)) { ctx.moveTo(x, y); ctx.lineTo(x, y + h); }
    if (foreign(1, 0)) { ctx.moveTo(x + w, y); ctx.lineTo(x + w, y + h); }
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
}
