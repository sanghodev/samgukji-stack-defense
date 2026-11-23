import Phaser from 'phaser';

/**
 * Generates crisp 2-head-tall 16-bit chibi spritesheets for Step 5:
 * 1. `guanyu_sheet` (8 frames of 128x128):
 *    Green & gold armor, long majestic black beard, Qinglong Guandao!
 *    0: Idle, 1: Run A, 2: Run B, 3: Wide Sweep 1, 4: Sweep 2, 5: Heavy Overhead, 6: Cyclone A, 7: Cyclone B
 * 2. `huangzhong_sheet` (8 frames of 128x128):
 *    Gold & white armor, noble white beard, curved war bow!
 *    0: Idle, 1: Run A, 2: Run B, 3: Draw Bow, 4: Release Arrow, 5: Heavy Piercing Draw, 6: Arrow Burst, 7: Ready
 * 3. `arrow_projectile` (36x10):
 *    Crisp golden-tipped arrow with white fletching.
 */
export function generateStep5Sprites(scene: Phaser.Scene): void {
  if (!scene.textures.exists('guanyu_sheet')) {
    buildGuanYuSheet(scene);
  }
  if (!scene.textures.exists('huangzhong_sheet')) {
    buildHuangZhongSheet(scene);
  }
  if (!scene.textures.exists('arrow_projectile')) {
    buildArrowTexture(scene);
  }
}

function buildGuanYuSheet(scene: Phaser.Scene): void {
  const fw = 128;
  const fh = 128;
  const frames = 8;
  const canvas = document.createElement('canvas');
  canvas.width = fw * frames;
  canvas.height = fh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;

  for (let f = 0; f < frames; f++) {
    ctx.save();
    ctx.translate(f * fw, 0);
    drawGuanYuFrame(ctx, fw, fh, f);
    ctx.restore();
  }

  scene.textures.addSpriteSheet(
    'guanyu_sheet',
    canvas as unknown as HTMLImageElement,
    { frameWidth: fw, frameHeight: fh },
  );
}

function drawGuanYuFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frame: number,
): void {
  const cx = w / 2;
  const footY = h - 14;
  const isRunA = frame === 1;
  const isRunB = frame === 2;
  const isSweep = frame === 3 || frame === 4;
  const isHeavy = frame === 5;
  const isCyclone = frame === 6 || frame === 7;
  const bodyY = isRunA ? -3 : isRunB ? 2 : 0;

  // Flowing emerald green war cloak
  ctx.fillStyle = '#15803d';
  ctx.strokeStyle = '#052e16';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 10, footY - 44 + bodyY);
  ctx.lineTo(cx - (isCyclone ? 38 : 28), footY - 14 + bodyY);
  ctx.lineTo(cx - 4, footY - 12 + bodyY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Boots
  const lx = cx - 11 + (isRunA ? -7 : isRunB ? 6 : 0);
  const rx = cx + 10 + (isRunA ? 7 : isRunB ? -6 : 0);
  drawRoundedBox(ctx, lx - 7, footY - 14, 15, 13, '#14532d', '#052e16');
  drawRoundedBox(ctx, rx - 7, footY - 14, 15, 13, '#14532d', '#052e16');
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(lx - 6, footY - 14, 13, 3);
  ctx.fillRect(rx - 6, footY - 14, 13, 3);

  // Green & Gold Armored Torso
  const torsoX = cx - 20;
  const torsoY = footY - 48 + bodyY;
  drawRoundedBox(ctx, torsoX, torsoY, 40, 36, '#16a34a', '#052e16');
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(torsoX + 4, torsoY + 6, 32, 7);
  ctx.fillRect(torsoX + 13, torsoY + 22, 14, 8);
  // Gold shoulder guards
  drawCircle(ctx, torsoX + 2, torsoY + 8, 10, '#22c55e', '#052e16');
  drawCircle(ctx, torsoX + 38, torsoY + 8, 10, '#22c55e', '#052e16');
  drawCircle(ctx, torsoX + 2, torsoY + 7, 5, '#fbbf24', '#78350f');
  drawCircle(ctx, torsoX + 38, torsoY + 7, 5, '#fbbf24', '#78350f');

  // Iconic Qinglong Guandao (청룡언월도)
  ctx.save();
  ctx.translate(cx, torsoY + 14);
  const bladeAngle = isCyclone
    ? frame === 6
      ? 0.08
      : -0.08
    : isHeavy
      ? -0.95
      : isSweep
        ? 0.25
        : -0.45;
  ctx.rotate(bladeAngle);

  // Long pole shaft
  ctx.fillStyle = '#78350f';
  ctx.strokeStyle = '#1c120c';
  ctx.lineWidth = 2.5;
  ctx.fillRect(-38, -3, 78, 6);
  ctx.strokeRect(-38, -3, 78, 6);

  // Curved wide crescent dragon blade!
  ctx.fillStyle = isCyclone || isHeavy ? '#86efac' : '#e2e8f0';
  ctx.strokeStyle = '#064e3b';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(34, -4);
  ctx.quadraticCurveTo(54, -22, 64, -4);
  ctx.quadraticCurveTo(58, 14, 34, 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Golden dragon collar & red tassel
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(31, -6, 6, 14);
  ctx.fillStyle = '#dc2626';
  ctx.fillRect(28, 6, 6, 10);
  ctx.restore();

  // Chibi Head (reddish noble complexion, green scholar-general cap, long black beard!)
  const headX = cx;
  const headY = torsoY - 22;
  drawCircle(ctx, headX, headY + 2, 22, '#e58e73', '#451a03');

  // Green war cap with gold trim & trailing ribbons
  drawRoundedBox(ctx, headX - 23, headY - 22, 46, 15, '#15803d', '#052e16');
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(headX - 8, headY - 20, 16, 8);
  ctx.fillStyle = '#16a34a';
  ctx.fillRect(headX - 28, headY - 12, 8, 18);

  // Calm noble eyes & phoenix eyebrows
  drawCircle(ctx, headX - 6, headY - 1, 4.5, '#ffffff', '#1c120c');
  drawCircle(ctx, headX + 8, headY - 1, 4.5, '#ffffff', '#1c120c');
  ctx.fillStyle = '#111827';
  ctx.fillRect(headX - 5, headY - 2, 3, 3);
  ctx.fillRect(headX + 9, headY - 2, 3, 3);
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(headX - 13, headY - 6);
  ctx.lineTo(headX - 2, headY - 4);
  ctx.moveTo(headX + 15, headY - 6);
  ctx.lineTo(headX + 4, headY - 4);
  ctx.stroke();

  // Iconic LONG flowing black beard reaching down over chest!
  ctx.fillStyle = '#111827';
  ctx.strokeStyle = '#030712';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(headX - 12, headY + 9);
  ctx.quadraticCurveTo(headX - 14, headY + 34, headX + 1, headY + 46);
  ctx.quadraticCurveTo(headX + 16, headY + 34, headX + 14, headY + 9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  if (isCyclone) {
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.88)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(cx, footY - 36, 52, 22, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function buildHuangZhongSheet(scene: Phaser.Scene): void {
  const fw = 128;
  const fh = 128;
  const frames = 8;
  const canvas = document.createElement('canvas');
  canvas.width = fw * frames;
  canvas.height = fh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;

  for (let f = 0; f < frames; f++) {
    ctx.save();
    ctx.translate(f * fw, 0);
    drawHuangZhongFrame(ctx, fw, fh, f);
    ctx.restore();
  }

  scene.textures.addSpriteSheet(
    'huangzhong_sheet',
    canvas as unknown as HTMLImageElement,
    { frameWidth: fw, frameHeight: fh },
  );
}

function drawHuangZhongFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frame: number,
): void {
  const cx = w / 2;
  const footY = h - 14;
  const isRunA = frame === 1;
  const isRunB = frame === 2;
  const isDraw = frame === 3 || frame === 5;
  const isRelease = frame === 4 || frame === 6;
  const bodyY = isRunA ? -3 : isRunB ? 2 : 0;

  // Quiver of golden arrows on back
  drawRoundedBox(ctx, cx - 22, footY - 52 + bodyY, 10, 26, '#92400e', '#451a03');
  ctx.fillStyle = '#fef08a';
  ctx.fillRect(cx - 21, footY - 58 + bodyY, 3, 7);
  ctx.fillRect(cx - 16, footY - 57 + bodyY, 3, 6);

  // White & Gold cape
  ctx.fillStyle = '#f8fafc';
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(cx - 10, footY - 42 + bodyY);
  ctx.lineTo(cx - 26, footY - 14 + bodyY);
  ctx.lineTo(cx - 4, footY - 12 + bodyY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Boots
  const lx = cx - 10 + (isRunA ? -7 : isRunB ? 6 : 0);
  const rx = cx + 9 + (isRunA ? 7 : isRunB ? -6 : 0);
  drawRoundedBox(ctx, lx - 7, footY - 14, 14, 13, '#b45309', '#451a03');
  drawRoundedBox(ctx, rx - 7, footY - 14, 14, 13, '#b45309', '#451a03');

  // Gold & White Armored Torso
  const torsoX = cx - 18;
  const torsoY = footY - 46 + bodyY;
  drawRoundedBox(ctx, torsoX, torsoY, 36, 34, '#f8fafc', '#475569');
  ctx.fillStyle = '#eab308';
  ctx.fillRect(torsoX + 4, torsoY + 5, 28, 10);
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(torsoX + 6, torsoY + 21, 24, 6);
  // Gold shoulder pauldrons
  drawCircle(ctx, torsoX + 2, torsoY + 8, 9, '#facc15', '#78350f');
  drawCircle(ctx, torsoX + 34, torsoY + 8, 9, '#facc15', '#78350f');

  // Chibi Veteran Head (white hair, golden helmet crest, majestic white beard!)
  const headX = cx;
  const headY = torsoY - 21;
  drawCircle(ctx, headX, headY + 2, 21, '#f3c29d', '#451a03');

  // Gold & white veteran helmet
  drawRoundedBox(ctx, headX - 22, headY - 21, 44, 13, '#facc15', '#78350f');
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(headX - 18, headY - 12, 36, 4);
  // White plume
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(headX - 4, headY - 30, 8, 10);

  // Sharp veteran archer eyes & white eyebrows
  drawCircle(ctx, headX - 5, headY - 1, 4.5, '#ffffff', '#1c120c');
  drawCircle(ctx, headX + 9, headY - 1, 4.5, '#ffffff', '#1c120c');
  ctx.fillStyle = '#111827';
  ctx.fillRect(headX - 4, headY - 2, 3, 3);
  ctx.fillRect(headX + 10, headY - 2, 3, 3);
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(headX - 12, headY - 6);
  ctx.lineTo(headX - 1, headY - 4);
  ctx.moveTo(headX + 16, headY - 6);
  ctx.lineTo(headX + 5, headY - 4);
  ctx.stroke();

  // Majestic fluffy WHITE beard!
  ctx.fillStyle = '#f8fafc';
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(headX - 16, headY + 8);
  ctx.quadraticCurveTo(headX - 18, headY + 25, headX + 2, headY + 30);
  ctx.quadraticCurveTo(headX + 20, headY + 24, headX + 17, headY + 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Curved Golden War Bow held forward (+X)
  ctx.save();
  ctx.translate(cx + 18, torsoY + 12);
  ctx.strokeStyle = '#78350f';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(0, 0, 24, -Math.PI * 0.44, Math.PI * 0.44);
  ctx.stroke();

  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, 24, -Math.PI * 0.44, Math.PI * 0.44);
  ctx.stroke();

  // Bowstring (pulled back when drawing!)
  const pullX = isDraw ? -14 : 4;
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(4, -23);
  ctx.lineTo(pullX, 0);
  ctx.lineTo(4, 23);
  ctx.stroke();

  // Nocked golden arrow when drawing or bursting
  if (isDraw || isRelease) {
    ctx.fillStyle = frame === 5 || frame === 6 ? '#fde047' : '#ffffff';
    ctx.fillRect(pullX, -2, 34, 4);
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.moveTo(pullX + 34, -5);
    ctx.lineTo(pullX + 42, 0);
    ctx.lineTo(pullX + 34, 5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function buildArrowTexture(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  // Glowing golden energy trail edge
  g.fillStyle(0xfef08a, 0.5);
  g.fillRect(0, 3, 28, 4);
  // Wooden arrow shaft
  g.fillStyle(0x92400e, 1);
  g.fillRect(4, 4, 22, 2);
  // White fletching feathers
  g.fillStyle(0xffffff, 1);
  g.fillTriangle(0, 1, 8, 4, 0, 9);
  // Gleaming golden arrowhead
  g.fillStyle(0xfde047, 1);
  g.fillTriangle(25, 1, 36, 5, 25, 9);
  g.generateTexture('arrow_projectile', 36, 10);
  g.destroy();
}

function drawRoundedBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  stroke: string,
): void {
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6);
  ctx.fill();
  ctx.stroke();
}

function drawCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  fill: string,
  stroke: string,
): void {
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
